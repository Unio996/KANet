// settle-safe-json.test.mjs — sign_input_for_settle 生产者枚举测试 + safe_json round-trip 行为测试
// (2026-07-18 J1tn, Codex MSG-20260717-008 acceptance condition 2 + ANTI-PATTERNS 规则 64 机器 clamp)
//
// 两层:
//   A. 枚举层(grep-allowlist 起步形态): 全仓扫 sign_input_for_settle 构造点, 每个调用点必须
//      ①经单源 helper(tx_hex 来自 toSettleSafeJsonTxHex 产物)+ safe_json:true, 或
//      ②在显式 allowlist 内(带原因)——新增第 N+1 个裸 JSON 调用点 = 本测试 FAIL, c8188d98
//      "修 N-1/N 个拷贝"事故(jepu1 401 次拒签半根因)不再可能静默复发。
//   B. 行为层(round-trip, 真 scriptPublicKey fixture): helper 产物经 Transaction.deserializeFromSafeJSON
//      逆转换后 spk/金额/lockTime 逐字段无损——防"helper 被改坏但枚举层看不出"。
// 跑法: cd kasia-console && node src/lib/settle-safe-json.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { toSettleSafeJsonTxHex } from './settle-safe-json.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name} ${detail}`); }
};

// ── A. 枚举层 ──────────────────────────────────────────────────────────────────
// allowlist: 调用点文件 → { mode: 'safe_json'(必须同文件内可见 toSettleSafeJsonTxHex 或字面 safe_json: true 与调用共存)
//                        | 'exempt'(豁免, 必须写原因) }
// ⚠ 改这张表 = 改签名安全面, 必须走审(设计稿/NWT), 不是顺手加一行的地方。
const ALLOWLIST = {
  'services/bettor-prediction-voter.js': { mode: 'safe_json' },   // c8188d98 两站点(d060e872 单源 import)+ 第五站点 refund-disagreement(本测试首跑抓出, 同批补修)
  'services/trade-protocol-filter.js': { mode: 'safe_json' },     // 第三站点, d060e872 补修
  'services/bshard-close-voter.js': { mode: 'safe_json' },        // :376/:497 bshard proven 路, 硬编码 safe_json:true
  'lib/pool-shard-settle.mjs': { mode: 'safe_json' },             // :320 close_attest 委员签, txSafeJson + safe_json:true 已是常态(本测试首跑发现枚举漏登, 核实已 safe)
  'services/bshard-auto-settler.mjs': { mode: 'safe_json' },      // :365/:749 settle/cancel 委员签, safe_json:true 已是常态(同上, 核实已 safe)
  'services/bettor-prediction-settler.js': {
    mode: 'exempt',
    reason: 'consensual 1v1 exchange 双签路径, 同族风险候选【未定性】——单独立卡定性后处置(jepu1 设计稿 §1.6, 2026-07-18)。定性结论出来必须回来改本行: 坏→补修转 safe_json, 好→写排除依据。',
  },
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, acc); }
    else if (/\.(js|mjs)$/.test(name) && !name.endsWith('.test.mjs')) acc.push(p);
  }
  return acc;
}

const producers = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  // 只认"构造 sign 命令"的生产者: type: 'sign_input_for_settle' 字面出现(注释里的纯提及不算——要求引号+冒号形态)
  if (/type:\s*['"]sign_input_for_settle['"]/.test(text)) producers.push({ file, text });
}
ok('枚举层: 至少发现 4 个已知生产者文件(voter/filter/bshard-voter/settler)', producers.length >= 4, `found=${producers.length}`);

for (const { file, text } of producers) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const entry = ALLOWLIST[rel];
  if (!entry) {
    ok(`枚举层: ${rel} 在 allowlist`, false, '新的 sign_input_for_settle 生产者未登记——按规则64走审后补表, 禁止静默新增');
    continue;
  }
  if (entry.mode === 'exempt') {
    ok(`枚举层: ${rel} 豁免登记有原因`, typeof entry.reason === 'string' && entry.reason.length > 10);
    continue;
  }
  // safe_json 模式: 文件内必须 (a) 引用单源 helper 或 (b) 字面 safe_json: true 与调用共存; 且不允许裸 JSON.stringify 直接喂 tx_hex 给本命令。
  const usesHelper = /toSettleSafeJsonTxHex/.test(text);
  const hasSafeFlag = /safe_json:\s*true/.test(text);
  ok(`枚举层: ${rel} 走 safe_json 形态(helper 或字面 flag)`, usesHelper || hasSafeFlag);
  // 裸 JSON 检测: `type: 'sign_input_for_settle'` 出现的语句块附近若有 tx_hex: JSON.stringify( 即 FAIL。
  // 粗粒度(±300 字符窗口)——宁可误报走人工确认, 不可漏报。
  let bare = false;
  const re = /type:\s*['"]sign_input_for_settle['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const win = text.slice(Math.max(0, m.index - 300), m.index + 300);
    if (/tx_hex:\s*JSON\.stringify\(/.test(win)) { bare = true; break; }
  }
  ok(`枚举层: ${rel} 无裸 JSON.stringify 直喂 tx_hex`, !bare);
}

// ── B. 行为层 round-trip(真 scriptPublicKey fixture) ─────────────────────────────
// fixture: 最小可序列化 tx_obj, spk 用真实 P2SH 形态 flat-hex(version 0 前缀 0000 + 34B script hex 样例)。
// 断言: helper 产物是字符串(serializeToSafeJSON 的 hex/json 输出) + deserializeFromSafeJSON 逆转换后
// spk/value/lockTime 逐字段与输入一致(c8188d98 NWT 实测 lossless 的回归化)。
const FIXTURE_SPK = '0000aa20' + 'ab'.repeat(32) + '87'; // version(2B LE hex 前缀 0000) + OP_HASH256-ish P2SH shape 样例 34B
const fixtureTx = {
  version: 0,
  lockTime: 1783500000000,
  gas: 0,
  subnetworkId: '0000000000000000000000000000000000000000',
  payload: '',
  inputs: [{
    previousOutpoint: { transactionId: '11'.repeat(32), index: 0 },
    signatureScript: '',
    sequence: 0,
    sigOpCount: 1,
    utxo: {
      // 语法合法的 kaspatest 地址(J1tn gateway 地址, 纯 fixture 用途——helper/serialize 只需要格式合法)
      address: 'kaspatest:qzdh7nar8wnq4nsag835qv563zkc5q8pufjeq3fcc2nq337mrr04wcfjx6f6u',
      outpoint: { transactionId: '11'.repeat(32), index: 0 },
      amount: 1234567890,
      scriptPublicKey: FIXTURE_SPK,
      blockDaaScore: 61000000,
      isCoinbase: false,
    },
  }],
  outputs: [{ value: 1234000000, scriptPublicKey: FIXTURE_SPK }],
};

try {
  const safe = await toSettleSafeJsonTxHex(fixtureTx);
  ok('行为层: helper 对真 spk fixture 产出非空 safe_json', typeof safe === 'string' && safe.length > 0);
  const { Transaction } = await import('kaspa-wasm');
  const back = Transaction.deserializeFromSafeJSON(safe);
  ok('行为层: deserializeFromSafeJSON 逆转换成功', !!back);
  const backObj = JSON.parse(back.serializeToJSON ? back.serializeToJSON() : JSON.stringify(back));
  const backSpk = String(backObj?.outputs?.[0]?.scriptPublicKey ?? '');
  ok('行为层: 输出 spk round-trip 保留(flat-hex 含 script 主体)', backSpk.includes('ab'.repeat(32)), `got=${backSpk.slice(0, 40)}...`);
  const backVal = String(backObj?.outputs?.[0]?.value ?? '');
  ok('行为层: 输出 value round-trip 无损', backVal === '1234000000', `got=${backVal}`);
  const backLock = String(backObj?.lockTime ?? '');
  ok('行为层: lockTime round-trip 无损', backLock === '1783500000000', `got=${backLock}`);
} catch (e) {
  ok('行为层: round-trip 全程无异常', false, e.message);
}

console.log(fail === 0 ? `\n✅ ALL PASS (${pass})` : `\n❌ ${fail} FAIL / ${pass} pass`);
process.exit(fail === 0 ? 0 : 1);
