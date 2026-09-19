// utxo-facts.test.mjs — 批9 9-0(R1/R2)离线回归(J2 2026-09-19, 设计 v0.3.1 §12.11)。
// 夹具: 条目由【真实 kaspa-wasm】UtxoEntryReference 生成(经 Transaction 输入的 utxo 字段反序列化, 与 relay 从
//   rpc.getUtxosByAddresses 拿到的同一个类); covenant 条目的 covenantId 经真实 UtxoEntry 的 setter 设置(真实 Hash
//   对象, 原型 getter, `'covenantId' in entry` 为真)。🟡 诚实边界: getter 返回的 entry 每次是新克隆, 无法就地改, 所以
//   covenant 夹具 = 真实引用 + 把 `entry` 换成【设置过 covenantId 的真实 UtxoEntry】(见 realEntry); 这一层是合成的,
//   真实性由 9-0 验收①(对同一 simnet 节点同一 UTXO 逐字节比对)承担, 不由本文件承担。
// 不做的事: 不连节点、不起 RpcClient、零链上副作用。
// Run: cd kasia-relay && node src/lib/utxo-facts.test.mjs

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as kaspa from 'kaspa-wasm';
import {
  FACTS_LIST_MAX, FACTS_OUTPOINTS_MAX, FACTS_VERSION, FACTS_RPC_WAIT_MS, FACTS_RPC_CALL_MS, FactsError,
  parseFactsRequest, buildFactsResponse, handleGetAddressUtxos, handleGetPastMedianTime,
} from './utxo-facts.mjs';
import { COMMAND_TYPES, isValidCommandType, validateCommandPayload } from './commands.mjs';
import { READONLY_ALLOWLIST } from './authorize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..');
const BASE_COMMIT = '6f6f9901'; // 9-0 基线(origin/bshard-m3-deploy 当时头), 不可变——用来取【真实旧版】验证器

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const rejectsWith = async (fn, code) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `应该抛错(${code}), 实际未抛`);
  assert.ok(err instanceof FactsError, `应该是 FactsError, 实际 ${err && err.name}: ${err && err.message}`);
  assert.strictEqual(err.code, code, `期望 code=${code}, 实际 ${err.code} (${err.message})`);
};
const throwsWith = (fn, code) => { let err = null; try { fn(); } catch (e) { err = e; } assert.ok(err, `应该抛错(${code})`); assert.ok(err instanceof FactsError); assert.strictEqual(err.code, code, `期望 ${code}, 实际 ${err.code}`); };

// ── 夹具 ───────────────────────────────────────────────────────────────────────────────────────
const SPK_HEX = 'aa20' + 'ee'.repeat(32) + '87';                 // P2SH(与 NWT 探针同款 covenant genesis 输出脚本)
const P2PK_HEX = '20' + 'cd'.repeat(32) + 'ac';                  // 普通 P2PK 形状(relay 自己的 fee 输入)
const COV_A = '9a5719c10ea67dfb'.padEnd(64, '0');
const COV_B = 'e479cf6497cc32d4'.padEnd(64, '0');
const txid = (n) => n.toString(16).padStart(64, '0');           // 确定性 64 位小写 hex

function realRef({ txidHex, index, amount, spkHex }) {
  const spk = new kaspa.ScriptPublicKey(0, spkHex);
  const outpoint = { transactionId: txidHex, index };
  return new kaspa.Transaction({
    version: 1, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    inputs: [{ previousOutpoint: outpoint, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 0, utxo: { outpoint, amount, scriptPublicKey: spk, blockDaaScore: 4335n } }],
    outputs: [new kaspa.TransactionOutput(1000n, spk)],
  }).inputs[0].utxo;                                             // 真实 UtxoEntryReference
}
function realEntry({ txidHex, index = 0, amount = 20000000n, spkHex = SPK_HEX, covenantIdHex = null }) {
  const ref = realRef({ txidHex, index, amount, spkHex });
  if (covenantIdHex === null) return ref;                        // 普通条目: 完全是真实对象
  const inner = ref.entry;                                       // 新克隆
  inner.covenantId = new kaspa.Hash(covenantIdHex);              // 真实 Hash, 真实 setter
  return Object.create(ref, { entry: { value: inner, enumerable: true } });
}
// 模拟"旧 wasm 构建": entry 上根本没有 covenantId 字段(键都不存在)
const oldWasmEntry = ({ txidHex, index = 0, amount = 20000000n }) => ({
  outpoint: { transactionId: txidHex, index }, amount, scriptPublicKey: { version: 0, script: SPK_HEX }, entry: { amount },
});
// 模拟 v0.3 之前的手写夹具错误: covenantId 放在顶层、entry 上没有 → 生产读取必须报错而不是 null
const topLevelCovEntry = ({ txidHex, index = 0, amount = 20000000n }) => ({
  outpoint: { transactionId: txidHex, index }, amount, scriptPublicKey: { version: 0, script: SPK_HEX }, covenantId: COV_A, entry: { amount },
});

const lcg = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const shuffled = (arr, seed) => { const a = arr.slice(); const r = lcg(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const ADDR = 'kaspasim:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

// ══ 结构性证明: facts 路径没有 per-call RpcClient(取代 v0.3 的 spy 判据: connectRpc 是 p2sh.mjs 内部绑定, spy 永远绿) ══
const FORBIDDEN = [/\bconnectRpc\b/, /new\s+RpcClient\b/, /from\s+['"]kaspa-wasm['"]/, /import\s*\(\s*['"]kaspa-wasm/, /from\s+['"][^'"]*p2sh\.mjs['"]/, /\bprocess\.env\b/];
const scanForbidden = (src) => FORBIDDEN.filter((re) => re.test(stripComments(src))).map(String);

await t('S1 utxo-facts.mjs 源码(去注释)不含 connectRpc / new RpcClient / kaspa-wasm import / p2sh.mjs import / process.env', () => {
  const src = fs.readFileSync(path.join(here, 'utxo-facts.mjs'), 'utf8');
  assert.deepStrictEqual(scanForbidden(src), []);
});
await t('S1-变异 扫描器本身有效: 往源码里塞 new RpcClient / connectRpc / process.env 后必红(否则 S1 是空判据)', () => {
  const src = fs.readFileSync(path.join(here, 'utxo-facts.mjs'), 'utf8');
  for (const evil of ['const c = new RpcClient({});', 'await connectRpc(net);', "import * as k from 'kaspa-wasm';", 'const n = process.env.FACTS_LIST_MAX;', "import { getAddressUtxos } from './p2sh.mjs';"]) {
    assert.ok(scanForbidden(src + '\n' + evil + '\n').length >= 1, `扫描器没抓到: ${evil}`);
  }
  // 注释里出现这些词不该误报(本文件头注释就写了它们)
  assert.deepStrictEqual(scanForbidden('// connectRpc new RpcClient process.env\nexport const x = 1;\n'), []);
});
await t('S2 relay.mjs 的 get_address_utxos / get_past_median_time 两个 case 只注入 waitForRpc(FACTS_RPC_WAIT_MS), 不含 connectRpc / new RpcClient', () => {
  const src = fs.readFileSync(path.join(here, '..', 'relay.mjs'), 'utf8');
  const a = src.indexOf("case 'get_address_utxos': {");
  const b = src.indexOf("case 'prediction_settle_build_preimage': {");
  assert.ok(a > 0 && b > a, '找不到两个 case 的边界(relay.mjs 结构变了? 同步本测试)');
  const block = stripComments(src.slice(a, b));
  assert.ok(block.includes("case 'get_past_median_time': {"), 'get_past_median_time case 不在 get_address_utxos 之后/prediction_settle_build_preimage 之前');
  assert.strictEqual((block.match(/waitForRpc\(FACTS_RPC_WAIT_MS\)/g) || []).length, 2, '两个 case 各恰一处 waitForRpc(FACTS_RPC_WAIT_MS)');
  assert.ok(!/new\s+RpcClient\b/.test(block) && !/\bconnectRpc\b/.test(block), 'case 块里不该出现 connectRpc / new RpcClient');
  assert.ok(FACTS_RPC_WAIT_MS < 15000, `FACTS_RPC_WAIT_MS(${FACTS_RPC_WAIT_MS}) 须小于 console 读命令 IPC 超时 15000`);
});
await t('S3 FACTS_LIST_MAX===200 / FACTS_OUTPOINTS_MAX===8 / FACTS_VERSION===1, 且源码无 env 读取(S1 已含 process.env 扫描)', () => {
  assert.strictEqual(FACTS_LIST_MAX, 200);
  assert.strictEqual(FACTS_OUTPOINTS_MAX, 8);
  assert.strictEqual(FACTS_VERSION, 1);
  // S-1: 总预算 = 等共享客户端(8s) + RPC 调用本身(5s) 必须小于 console 读命令 IPC 超时(15s)
  assert.strictEqual(FACTS_RPC_CALL_MS, 5000);
  assert.ok(FACTS_RPC_WAIT_MS + FACTS_RPC_CALL_MS < 15000, `${FACTS_RPC_WAIT_MS}+${FACTS_RPC_CALL_MS} 必须 < 15000`);
});

// ══ 旧路径字节不变 ═════════════════════════════════════════════════════════════════════════════
await t('B1 不带 facts: 结果 == { ok:true, utxos: <旧函数原样返回> }(深比较+同一对象引用), 旧函数以 (address, networkId) 调一次, 共享 RpcClient 从未被取', async () => {
  const legacyOut = [{ outpoint: { transactionId: txid(1), index: 0 }, amount: '123' }];
  let legacyArgs = null, sharedCalls = 0;
  const r = await handleGetAddressUtxos({
    cmd: { type: 'get_address_utxos', address: ADDR },
    getSharedRpc: async () => { sharedCalls++; throw new Error('不该被调'); },
    legacyGetAddressUtxos: async (a, n) => { legacyArgs = [a, n]; return legacyOut; },
    getNetworkId: () => 'simnet',
  });
  assert.deepStrictEqual(Object.keys(r), ['ok', 'utxos']);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.utxos, legacyOut);
  assert.deepStrictEqual(legacyArgs, [ADDR, 'simnet']);
  assert.strictEqual(sharedCalls, 0);
  assert.strictEqual(JSON.stringify(r), JSON.stringify({ ok: true, utxos: legacyOut }));
});
await t('B2 facts:false / facts 非严格 true(\'true\'、1)在 handler 层都走旧路径(严格 === true; validator 另拒, 见 R3)', async () => {
  for (const f of [false, 'true', 1]) {
    let legacy = 0;
    const r = await handleGetAddressUtxos({
      cmd: { address: ADDR, facts: f }, getSharedRpc: async () => { throw new Error('不该被调'); },
      legacyGetAddressUtxos: async () => { legacy++; return []; }, getNetworkId: () => 'simnet',
    });
    assert.strictEqual(legacy, 1, `facts=${JSON.stringify(f)} 应走旧路径`);
    assert.deepStrictEqual(r, { ok: true, utxos: [] });
  }
});
await t('B3 没带 facts 却带了 outpoints/minAmount/maxAmount ⇒ facts_params_without_facts(拒绝静默回一个没有 spk/covenantId 的正常回复, F18)', async () => {
  for (const extra of [{ outpoints: [{ transactionId: txid(1), index: 0 }] }, { minAmount: '1' }, { maxAmount: '9' }]) {
    await rejectsWith(() => handleGetAddressUtxos({ cmd: { address: ADDR, ...extra }, getSharedRpc: async () => ({}), legacyGetAddressUtxos: async () => [], getNetworkId: () => 'simnet' }), 'facts_params_without_facts');
  }
});

// ══ 请求校验 ═════════════════════════════════════════════════════════════════════════════════════
await t('R1 outpoints 与 minAmount/maxAmount 互斥', () => {
  throwsWith(() => parseFactsRequest({ outpoints: [{ transactionId: txid(1), index: 0 }], minAmount: '1' }), 'facts_forms_exclusive');
  throwsWith(() => parseFactsRequest({ outpoints: [{ transactionId: txid(1), index: 0 }], maxAmount: '1' }), 'facts_forms_exclusive');
});
await t('R2 outpoints 形态校验: 空/超 8 项/非数组/坏 txid(大写、短、非 hex)/坏 index(负、小数、2^32、字符串)/重复 ⇒ 整条报错', () => {
  const ok = { transactionId: txid(1), index: 0 };
  const bad = [
    [], Array.from({ length: FACTS_OUTPOINTS_MAX + 1 }, (_, i) => ({ transactionId: txid(i + 1), index: 0 })), 'x', {},
    [{ ...ok, transactionId: txid(1).toUpperCase().replace(/[0-9]/g, 'A') }], [{ ...ok, transactionId: 'ab' }], [{ ...ok, transactionId: 'z'.repeat(64) }],
    [{ ...ok, index: -1 }], [{ ...ok, index: 1.5 }], [{ ...ok, index: 4294967296 }], [{ ...ok, index: '0' }], [{ ...ok, index: null }],
    [ok, ok], [null], [[]], [{}],
  ];
  for (const outpoints of bad) throwsWith(() => parseFactsRequest({ outpoints }), 'facts_invalid_outpoints');
  assert.strictEqual(parseFactsRequest({ outpoints: [ok, { transactionId: txid(2), index: 4294967295 }] }).outpoints.length, 2);
  assert.strictEqual(parseFactsRequest({ outpoints: Array.from({ length: FACTS_OUTPOINTS_MAX }, (_, i) => ({ transactionId: txid(i + 1), index: 0 })) }).outpoints.length, FACTS_OUTPOINTS_MAX);
});
await t('R2b list 形态校验: min/max 只收十进制字符串(拒 number、\'-1\'、\'1e3\'、\' 1\'、\'01\'、>2^64-1), min>max ⇒ 报错', () => {
  for (const bad of [5, '-1', '1e3', ' 1', '01', '1.5', '', '18446744073709551616', null]) {
    throwsWith(() => parseFactsRequest({ minAmount: bad }), 'facts_invalid_amount_bound');
    throwsWith(() => parseFactsRequest({ maxAmount: bad }), 'facts_invalid_amount_bound');
  }
  throwsWith(() => parseFactsRequest({ minAmount: '10', maxAmount: '9' }), 'facts_invalid_amount_bound');
  assert.deepStrictEqual(parseFactsRequest({ minAmount: '0', maxAmount: '18446744073709551615' }), { form: 'list', min: 0n, max: 18446744073709551615n });
  assert.deepStrictEqual(parseFactsRequest({}), { form: 'list', min: null, max: null });
});
await t('R3 validateCommandPayload(当前版): facts 只收 boolean(拒 \'true\'/1), minAmount/maxAmount 只收 string, outpoints 只收 array; 旧形状 {address} 仍合法; get_past_median_time 合法且无必填', () => {
  const v = (c) => validateCommandPayload({ ...c });
  assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR }).valid, true);
  assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: true }).valid, true);
  assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: true, outpoints: [{ transactionId: txid(1), index: 0 }] }).valid, true);
  assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: true, minAmount: '1', maxAmount: '2' }).valid, true);
  for (const f of ['true', 1, 0, null, {}]) assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: f }).valid, false, `facts=${JSON.stringify(f)} 应被拒`);
  for (const a of [5, 0, {}, []]) assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: true, minAmount: a }).valid, false);
  assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: true, outpoints: 'x' }).valid, false);
  assert.strictEqual(v({ type: 'get_address_utxos', address: ADDR, facts: true, outpoints: {} }).valid, false);
  assert.strictEqual(isValidCommandType('get_past_median_time'), true);
  assert.strictEqual(COMMAND_TYPES.GET_PAST_MEDIAN_TIME, 'get_past_median_time');
  assert.strictEqual(v({ type: 'get_past_median_time' }).valid, true);
});
await t('R4【真实旧版】基线 6f6f9901 的 commands.mjs: 对 R2 回 unknown command type(旧 relay 天然 fail-closed); 对带 facts/outpoints 的 get_address_utxos 静默放行(F18 的实证, 不是我写的假验证器)', async () => {
  const oldSrc = execFileSync('git', ['show', `${BASE_COMMIT}:kasia-relay/src/lib/commands.mjs`], { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.ok(!oldSrc.includes('GET_PAST_MEDIAN_TIME'), '基线里不该已有 R2(基线选错?)');
  const tmp = path.join(os.tmpdir(), `_j2_old_commands_${process.pid}_${Date.now()}.mjs`);
  fs.writeFileSync(tmp, oldSrc);
  try {
    const old = await import(pathToFileURL(tmp).href);
    const r2 = old.validateCommandPayload({ type: 'get_past_median_time' });
    assert.strictEqual(r2.valid, false);
    assert.match(r2.error, /unknown command type/);
    const f18 = old.validateCommandPayload({ type: 'get_address_utxos', address: ADDR, facts: true, outpoints: [{ transactionId: txid(1), index: 0 }], minAmount: '1' });
    assert.strictEqual(f18.valid, true, '旧 validator 对未知字段静默放行(这正是 E1 回声要防的事)');
  } finally { try { fs.unlinkSync(tmp); } catch {} }
});
await t('R5 authorize.mjs: get_past_median_time 与 get_address_utxos 都在 READONLY_ALLOWLIST(漏登记 ⇒ gate arm 后被静默拒)', () => {
  assert.ok(READONLY_ALLOWLIST.has('get_past_median_time'));
  assert.ok(READONLY_ALLOWLIST.has('get_address_utxos'));
});

// ══ 形态 O(outpoints): C1 用 ═════════════════════════════════════════════════════════════════════
const mixedEntries = () => [
  realEntry({ txidHex: txid(0xa1), index: 0, amount: 20000000n, covenantIdHex: COV_A }),                 // covenant P2SH
  realEntry({ txidHex: txid(0xa2), index: 1, amount: 95000000n, spkHex: P2PK_HEX }),                     // 普通 P2PK(fee 输入)
  realEntry({ txidHex: txid(0xa3), index: 2, amount: 20000000n, covenantIdHex: COV_B }),
];
await t('O1 found/missing 划分 + 请求顺序输出 + 回声字段(facts:true/factsVersion:1/form)+ 无 truncated + 每项含 scriptHex 与 covenantId 键', () => {
  const entries = mixedEntries();
  const req = parseFactsRequest({ outpoints: [{ transactionId: txid(0xa3), index: 2 }, { transactionId: txid(0xee), index: 0 }, { transactionId: txid(0xa1), index: 0 }] });
  const r = buildFactsResponse(req, entries);
  assert.deepStrictEqual(Object.keys(r), ['ok', 'facts', 'factsVersion', 'form', 'found', 'missing']);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.facts, true); assert.strictEqual(r.factsVersion, 1); assert.strictEqual(r.form, 'outpoints');
  assert.ok(!('truncated' in r));
  assert.deepStrictEqual(r.found.map((x) => x.outpoint), [{ transactionId: txid(0xa3), index: 2 }, { transactionId: txid(0xa1), index: 0 }]);
  assert.deepStrictEqual(r.missing, [{ transactionId: txid(0xee), index: 0 }]);
  assert.deepStrictEqual(r.found[0], { outpoint: { transactionId: txid(0xa3), index: 2 }, amount: '20000000', scriptPublicKey: { version: 0, scriptHex: SPK_HEX }, covenantId: COV_B });
  for (const it of r.found) { assert.strictEqual(typeof it.scriptPublicKey.scriptHex, 'string'); assert.ok(Object.prototype.hasOwnProperty.call(it, 'covenantId')); assert.strictEqual(typeof it.amount, 'string'); }
});
await t('O2 普通 P2PK 条目 ⇒ covenantId 键存在且为 null(不是缺键); covenant 条目 ⇒ 64 位小写 hex 字符串(Hash 已 String 化)', () => {
  const r = buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: txid(0xa2), index: 1 }, { transactionId: txid(0xa1), index: 0 }] }), mixedEntries());
  const plain = r.found.find((x) => x.outpoint.index === 1);
  assert.ok(Object.prototype.hasOwnProperty.call(plain, 'covenantId')); assert.strictEqual(plain.covenantId, null);
  assert.strictEqual(plain.scriptPublicKey.scriptHex, P2PK_HEX);
  const cov = r.found.find((x) => x.outpoint.index === 0);
  assert.strictEqual(cov.covenantId, COV_A); assert.match(cov.covenantId, /^[0-9a-f]{64}$/);
});
await t('O3【N1】地址上有 >FACTS_LIST_MAX 个 dust 时, 形态 O 仍取到目标 outpoint、无 truncated(列表形态才有截断)', () => {
  const dust = Array.from({ length: FACTS_LIST_MAX + 51 }, (_, i) => realEntry({ txidHex: txid(0x1000 + i), index: 0, amount: 1000n }));
  const target = realEntry({ txidHex: txid(0xbeef), index: 3, amount: 20000000n, covenantIdHex: COV_A });
  for (const seed of [1, 2, 3]) {
    const entries = shuffled([...dust, target], seed);
    const r = buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: txid(0xbeef), index: 3 }] }), entries);
    assert.strictEqual(r.found.length, 1); assert.strictEqual(r.missing.length, 0);
    assert.strictEqual(r.found[0].covenantId, COV_A); assert.ok(!('truncated' in r));
  }
  // 同一批条目在列表形态下确实被截断(说明"取列表判存在性"这条路会碰到上限——N1 为什么不能用它)
  const l = buildFactsResponse(parseFactsRequest({}), [...dust, target]);
  assert.strictEqual(l.utxos.length, FACTS_LIST_MAX); assert.strictEqual(l.truncated, true);
});
await t('O4 已被花掉(不在集合里)⇒ 进 missing, 不是报错也不是取"第一个同面值的": 同 spk 同面值但 outpoint 不同的条目不会被当成目标', () => {
  const lookalike = realEntry({ txidHex: txid(0xd0), index: 0, amount: 20000000n, covenantIdHex: COV_A });
  const r = buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: txid(0xd1), index: 0 }] }), [lookalike]);
  assert.strictEqual(r.found.length, 0); assert.deepStrictEqual(r.missing, [{ transactionId: txid(0xd1), index: 0 }]);
});
// 🔴 N-T1(NWT 9-0 审 4e34e9c9, 向量取自其 nwt-O5-killer-vector.txt): 形态 O 匹配键去掉 index(只按 txid)的变异在我原来的 33 项下【存活】——
//   所有夹具每个 txid 只有一个输出, "请求错的 index"从未被测。这是我 9-0 回执里"22 个变异全被抓到"那句话的反例。
await t('O5【N-T1, NWT 杀手向量】同一 txid 两个输出(index 0 = covenant, index 1 = 普通 P2PK): 请求 (txid,1) 必须回 index=1 那一项(covenantId null、spk = P2PK); 请求 (txid,2) 必须进 missing——outpoint 匹配必须含 index', () => {
  const T = txid(0xc0);
  const es = [
    realEntry({ txidHex: T, index: 0, amount: 20000000n, covenantIdHex: COV_A }),
    realEntry({ txidHex: T, index: 1, amount: 20000000n, spkHex: P2PK_HEX }),
  ];
  const r = buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: T, index: 1 }, { transactionId: T, index: 2 }] }), es);
  assert.strictEqual(r.found.length, 1);
  assert.strictEqual(r.found[0].outpoint.index, 1);
  assert.strictEqual(r.found[0].covenantId, null);
  assert.strictEqual(r.found[0].scriptPublicKey.scriptHex, P2PK_HEX);
  assert.deepStrictEqual(r.missing, [{ transactionId: T, index: 2 }]);
});
await t('O5b 同一 txid 两个输出同时请求(0 与 1): 各回各的(index 0 → covenant COV_A, index 1 → null), 按请求顺序; 请求顺序反过来结果顺序也跟着反(不是按条目顺序)', () => {
  const T = txid(0xc1);
  const es = [
    realEntry({ txidHex: T, index: 1, amount: 20000000n, spkHex: P2PK_HEX }),
    realEntry({ txidHex: T, index: 0, amount: 20000000n, covenantIdHex: COV_A }),
  ];
  const a = buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: T, index: 0 }, { transactionId: T, index: 1 }] }), es);
  assert.deepStrictEqual(a.found.map((x) => [x.outpoint.index, x.covenantId]), [[0, COV_A], [1, null]]);
  const b = buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: T, index: 1 }, { transactionId: T, index: 0 }] }), es);
  assert.deepStrictEqual(b.found.map((x) => [x.outpoint.index, x.covenantId]), [[1, null], [0, COV_A]]);
  assert.deepStrictEqual(a.missing, []);
});

// ══ 形态 L(list): fee 输入选取用 ════════════════════════════════════════════════════════════════
await t('L1【O1】250 dust + 50 可用、无 minAmount: 窗口含全部 50 个可用且排在最前(降序), truncated=true; 升序会把可用全部挤出去', () => {
  const usable = Array.from({ length: 50 }, (_, i) => realEntry({ txidHex: txid(0x2000 + i), index: 0, amount: BigInt(5000000 + i), spkHex: P2PK_HEX }));
  const dust = Array.from({ length: 250 }, (_, i) => realEntry({ txidHex: txid(0x3000 + i), index: 0, amount: 1000n, spkHex: P2PK_HEX }));
  const r = buildFactsResponse(parseFactsRequest({}), shuffled([...usable, ...dust], 7));
  assert.strictEqual(r.utxos.length, FACTS_LIST_MAX); assert.strictEqual(r.truncated, true);
  const head = r.utxos.slice(0, 50).map((u) => u.outpoint.transactionId);
  assert.deepStrictEqual(new Set(head), new Set(usable.map((_, i) => txid(0x2000 + i))), '前 50 项应恰为全部可用 UTXO');
  assert.ok(r.utxos.slice(0, 50).every((u) => BigInt(u.amount) >= 5000000n));
  const amts = r.utxos.map((u) => BigInt(u.amount));
  for (let i = 1; i < amts.length; i++) assert.ok(amts[i - 1] >= amts[i], `第 ${i} 项破坏降序`);
});
await t('L2 输出对输入顺序不敏感: 同一批条目 20 种打乱顺序 ⇒ JSON 字节相同(含同额 tiebreak: txid 字节序升序, 再 index 升序)', () => {
  const base = [
    ...Array.from({ length: 30 }, (_, i) => realEntry({ txidHex: txid(0x4000 + (i % 7)), index: i, amount: BigInt(1000 * (1 + (i % 4))), spkHex: P2PK_HEX })),
    realEntry({ txidHex: txid(0x4100), index: 0, amount: 2000n, covenantIdHex: COV_A }),
  ];
  const ref = JSON.stringify(buildFactsResponse(parseFactsRequest({}), base));
  for (let s = 1; s <= 20; s++) assert.strictEqual(JSON.stringify(buildFactsResponse(parseFactsRequest({}), shuffled(base, s))), ref, `seed ${s} 输出不同`);
  const r = JSON.parse(ref);
  for (let i = 1; i < r.utxos.length; i++) {
    const a = r.utxos[i - 1], b = r.utxos[i];
    if (a.amount === b.amount) {
      const ka = a.outpoint.transactionId + ':' + String(a.outpoint.index).padStart(10, '0'), kb = b.outpoint.transactionId + ':' + String(b.outpoint.index).padStart(10, '0');
      assert.ok(ka < kb, `同额 tiebreak 违序: ${ka} vs ${kb}`);
    }
  }
});
await t('L3 min/max 过滤在截断之前(用 BigInt 十进制字符串): min 去掉 dust 后 truncated=false; max 去掉大额; 边界值含等号', () => {
  const es = [
    ...Array.from({ length: 250 }, (_, i) => realEntry({ txidHex: txid(0x5000 + i), index: 0, amount: 1000n, spkHex: P2PK_HEX })),
    ...Array.from({ length: 50 }, (_, i) => realEntry({ txidHex: txid(0x5100 + i), index: 0, amount: BigInt(2000000 + i), spkHex: P2PK_HEX })),
    realEntry({ txidHex: txid(0x5200), index: 0, amount: 99000000n, spkHex: P2PK_HEX }),
  ];
  const a = buildFactsResponse(parseFactsRequest({ minAmount: '2000000' }), es);
  assert.strictEqual(a.utxos.length, 51); assert.strictEqual(a.truncated, false);
  const b = buildFactsResponse(parseFactsRequest({ minAmount: '2000000', maxAmount: '2000010' }), es);
  assert.deepStrictEqual(b.utxos.map((u) => u.amount), Array.from({ length: 11 }, (_, i) => String(2000010 - i)));
  const c = buildFactsResponse(parseFactsRequest({ minAmount: '1000', maxAmount: '1000' }), es);
  assert.strictEqual(c.utxos.length, 200); assert.strictEqual(c.truncated, true);   // 恰 250 个 1000
});
await t('L4 truncated 边界: 恰 200 项 ⇒ false; 201 项 ⇒ true 且只回 200 项', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => realEntry({ txidHex: txid(0x6000 + i), index: 0, amount: BigInt(1000 + i), spkHex: P2PK_HEX }));
  const a = buildFactsResponse(parseFactsRequest({}), mk(FACTS_LIST_MAX));
  assert.strictEqual(a.utxos.length, FACTS_LIST_MAX); assert.strictEqual(a.truncated, false);
  const b = buildFactsResponse(parseFactsRequest({}), mk(FACTS_LIST_MAX + 1));
  assert.strictEqual(b.utxos.length, FACTS_LIST_MAX); assert.strictEqual(b.truncated, true);
  assert.strictEqual(BigInt(b.utxos[FACTS_LIST_MAX - 1].amount), 1001n, '被截掉的应是最小的那个(1000)');
});
await t('L5 金额一律 BigInt: >2^53 的相邻值排序正确、输出字符串精确(Number 比较会错序/丢精度)', () => {
  const big = 9007199254740993n; // 2^53 + 1
  // 🔴 txid 顺序刻意与面值升序一致(较小面值 ⇒ 较小 txid): 若比较退化成 Number(2^53 与 2^53+1 相等), 平局会落到
  //   "txid 升序", 恰好把较小的排到前面 ⇒ 顺序错。若 txid 与面值降序一致, Number 比较的平局反而"碰巧"得出正确顺序,
  //   变异(Number 比较)就测不出来(第一版本测试正是这样漏掉了它)。
  const es = [big - 1n, big, big + 1n, 18446744073709551615n].map((amount, i) => realEntry({ txidHex: txid(0x7000 + i), index: 0, amount, spkHex: P2PK_HEX }));
  const r = buildFactsResponse(parseFactsRequest({}), shuffled(es, 3));
  assert.deepStrictEqual(r.utxos.map((u) => u.amount), ['18446744073709551615', '9007199254740994', '9007199254740993', '9007199254740992']);
  const c = buildFactsResponse(parseFactsRequest({ maxAmount: '9007199254740993' }), es);
  assert.deepStrictEqual(c.utxos.map((u) => u.amount), ['9007199254740993', '9007199254740992']);
});
await t('L6 列表形态的响应形状: 恒带 facts/factsVersion/form:list/truncated, 每项含 scriptHex 与 covenantId 键, 无 found/missing', () => {
  const r = buildFactsResponse(parseFactsRequest({}), mixedEntries());
  assert.deepStrictEqual(Object.keys(r), ['ok', 'facts', 'factsVersion', 'form', 'utxos', 'truncated']);
  assert.strictEqual(r.form, 'list'); assert.strictEqual(r.facts, true); assert.strictEqual(r.factsVersion, 1);
  for (const u of r.utxos) { assert.strictEqual(typeof u.scriptPublicKey.scriptHex, 'string'); assert.ok(Object.prototype.hasOwnProperty.call(u, 'covenantId')); }
});

// ══ M1 哨兵与夹具约束 ═════════════════════════════════════════════════════════════════════════════
await t('M1-a 真实 wasm 条目上 covenantId 的实况: 顶层恒 undefined, entry 上是原型 getter, `in` 对 covenant 与普通条目都为真(夹具与 NWT 探针一致)', () => {
  const plain = realEntry({ txidHex: txid(1) });
  const cov = realEntry({ txidHex: txid(2), covenantIdHex: COV_A });
  for (const e of [plain, cov]) { assert.strictEqual(e.covenantId, undefined); assert.ok('covenantId' in e.entry); }
  assert.strictEqual(plain.entry.covenantId, undefined);
  assert.strictEqual(cov.entry.covenantId.constructor.name, 'Hash');
  assert.strictEqual(String(cov.entry.covenantId), COV_A);
});
await t('M1-b 旧 wasm(entry 上没有 covenantId 键) ⇒ 两种形态都整条报错 covenant_id_field_missing, 不回 null', () => {
  const old = [oldWasmEntry({ txidHex: txid(0x81), index: 0 })];
  throwsWith(() => buildFactsResponse(parseFactsRequest({ outpoints: [{ transactionId: txid(0x81), index: 0 }] }), old), 'covenant_id_field_missing');
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), old), 'covenant_id_field_missing');
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [{ outpoint: { transactionId: txid(1), index: 0 }, amount: 1n, scriptPublicKey: { version: 0, script: SPK_HEX } }]), 'covenant_id_field_missing'); // 连 entry 都没有
});
await t('M1-c【变异对照】手写夹具把 covenantId 放顶层(entry 上没有)⇒ 生产读取报错而不是回 null(防"手写夹具绿、生产恒 null")', () => {
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [topLevelCovEntry({ txidHex: txid(0x91) })]), 'covenant_id_field_missing');
});
await t('M1-d 夹具约束: 普通对象夹具若在 entry 上显式写 covenantId: undefined(键存在)⇒ 视为无 covenant(null); 只省略键才会被哨兵拒', () => {
  const withKey = { outpoint: { transactionId: txid(0x92), index: 0 }, amount: 5n, scriptPublicKey: { version: 0, script: P2PK_HEX }, entry: { covenantId: undefined } };
  const r = buildFactsResponse(parseFactsRequest({}), [withKey]);
  assert.strictEqual(r.utxos[0].covenantId, null);
});
await t('M1-e covenantId 形状异常(非 64 位 hex)⇒ covenant_id_malformed; spk/outpoint/amount 读不出 ⇒ facts_entry_malformed(fail-closed, 不静默丢项)', () => {
  const mk = (cov) => ({ outpoint: { transactionId: txid(0x93), index: 0 }, amount: 5n, scriptPublicKey: { version: 0, script: P2PK_HEX }, entry: { covenantId: cov } });
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [mk('zz')]), 'covenant_id_malformed');
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [mk('AB'.repeat(32))]), 'covenant_id_malformed');
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [{ ...mk(undefined), amount: 'x' }]), 'facts_entry_malformed');
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [{ ...mk(undefined), outpoint: null }]), 'facts_entry_malformed');
  throwsWith(() => buildFactsResponse(parseFactsRequest({}), [{ ...mk(undefined), scriptPublicKey: { version: 0, script: 'nothex' } }]), 'facts_entry_malformed');
});

// ══ facts 路径 handler ════════════════════════════════════════════════════════════════════════════
await t('H1 facts:true: 只经注入的共享 rpc 调 getUtxosByAddresses([address]) 恰一次, 旧函数从未被调, 钱包 getNetworkId 从未被求值', async () => {
  const calls = [];
  const rpc = { getUtxosByAddresses: async (addrs) => { calls.push(addrs); return { entries: mixedEntries() }; } };
  let sharedCalls = 0, legacy = 0, netCalls = 0;
  const r = await handleGetAddressUtxos({
    cmd: { address: ADDR, facts: true, outpoints: [{ transactionId: txid(0xa1), index: 0 }] },
    getSharedRpc: async () => { sharedCalls++; return rpc; },
    legacyGetAddressUtxos: async () => { legacy++; return []; },
    getNetworkId: () => { netCalls++; return 'simnet'; },
  });
  assert.deepStrictEqual(calls, [[ADDR]]); assert.strictEqual(sharedCalls, 1); assert.strictEqual(legacy, 0); assert.strictEqual(netCalls, 0);
  assert.strictEqual(r.found.length, 1); assert.strictEqual(r.form, 'outpoints');
});
await t('H2 请求非法 ⇒ 在取共享 rpc 之前就失败(不占 RPC); 共享 rpc 取不到(超时/未连接)⇒ 错误原样上抛, 不回落旧路径', async () => {
  let shared = 0;
  await rejectsWith(() => handleGetAddressUtxos({ cmd: { address: ADDR, facts: true, outpoints: [] }, getSharedRpc: async () => { shared++; return {}; }, legacyGetAddressUtxos: async () => [], getNetworkId: () => 'x' }), 'facts_invalid_outpoints');
  assert.strictEqual(shared, 0);
  let legacy = 0;
  const boom = new Error('Shared RpcClient not ready after 8000ms');
  let err = null;
  try { await handleGetAddressUtxos({ cmd: { address: ADDR, facts: true }, getSharedRpc: async () => { throw boom; }, legacyGetAddressUtxos: async () => { legacy++; return []; }, getNetworkId: () => 'x' }); } catch (e) { err = e; }
  assert.strictEqual(err, boom); assert.strictEqual(legacy, 0, '不得回落到 per-call 旧路径');
});
await t('H3 getUtxosByAddresses 抛错 / 返回空 entries: 抛错上抛; 空集 ⇒ 形态 O 全部进 missing, 形态 L 回空 utxos(truncated=false)', async () => {
  const req = { address: ADDR, facts: true, outpoints: [{ transactionId: txid(1), index: 0 }] };
  let err = null;
  try { await handleGetAddressUtxos({ cmd: req, getSharedRpc: async () => ({ getUtxosByAddresses: async () => { throw new Error('rpc down'); } }), legacyGetAddressUtxos: async () => [], getNetworkId: () => 'x' }); } catch (e) { err = e; }
  assert.strictEqual(err && err.message, 'rpc down');
  const empty = { getUtxosByAddresses: async () => ({ entries: [] }) };
  const o = await handleGetAddressUtxos({ cmd: req, getSharedRpc: async () => empty, legacyGetAddressUtxos: async () => [], getNetworkId: () => 'x' });
  assert.deepStrictEqual(o.found, []); assert.deepStrictEqual(o.missing, [{ transactionId: txid(1), index: 0 }]);
  const l = await handleGetAddressUtxos({ cmd: { address: ADDR, facts: true }, getSharedRpc: async () => ({ getUtxosByAddresses: async () => ({}) }), legacyGetAddressUtxos: async () => [], getNetworkId: () => 'x' });
  assert.deepStrictEqual(l.utxos, []); assert.strictEqual(l.truncated, false);
});

// ══ R2 get_past_median_time ═════════════════════════════════════════════════════════════════════
await t('P1 只回恰好三个字段 {ok, pastMedianTimeMs, observedAtMs}; observedAtMs 在读回之后取; 不带任何节点标识/URL/daaScore/sink', async () => {
  const order = [];
  const rpc = { getBlockDagInfo: async () => { order.push('read'); return { pastMedianTime: 1758000000000, virtualDaaScore: '123', sink: 'ab'.repeat(32), networkName: 'simnet', url: 'ws://secret' }; } };
  const r = await handleGetPastMedianTime({ getSharedRpc: async () => rpc, nowMs: () => { order.push('now'); return 1758000000123; } });
  assert.deepStrictEqual(r, { ok: true, pastMedianTimeMs: 1758000000000, observedAtMs: 1758000000123 });
  assert.deepStrictEqual(Object.keys(r), ['ok', 'pastMedianTimeMs', 'observedAtMs']);
  assert.deepStrictEqual(order, ['read', 'now']);
});
await t('P2 pmt 不可用(0/负/NaN/undefined/字符串/小数/超安全整数)⇒ 抛 past_median_time_unavailable(fail-closed, 不回 ok:true); 共享 rpc 取不到 ⇒ 原样上抛', async () => {
  for (const bad of [0, -5, NaN, undefined, null, 'x', 1.5, 2 ** 60]) {
    await rejectsWith(() => handleGetPastMedianTime({ getSharedRpc: async () => ({ getBlockDagInfo: async () => ({ pastMedianTime: bad }) }) }), 'past_median_time_unavailable');
  }
  await rejectsWith(() => handleGetPastMedianTime({ getSharedRpc: async () => ({ getBlockDagInfo: async () => undefined }) }), 'past_median_time_unavailable');
  const boom = new Error('Shared RpcClient not ready after 8000ms');
  let err = null; try { await handleGetPastMedianTime({ getSharedRpc: async () => { throw boom; } }); } catch (e) { err = e; }
  assert.strictEqual(err, boom);
});

// ══ S-1(NWT 9-0 审): RPC 调用本身的截止时间 ═════════════════════════════════════════════════════════
// 用可注入的 rpcCallMs 把 5000ms 压到几十毫秒。"挂死"用 hungGuard 兜住: 变异去掉截止时间后, 测试是【红】而不是把整个进程卡住。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HUNG = Symbol('hung');
const hungGuard = async (p, ms = 1500) => { let tm; const g = new Promise((r) => { tm = setTimeout(() => r(HUNG), ms); }); try { return await Promise.race([p.then((v) => ({ v }), (e) => ({ e })), g]); } finally { clearTimeout(tm); } };
const neverSettles = () => new Promise(() => {});
const okCmd = { address: ADDR, facts: true };
const noLegacy = async () => { throw new Error('facts 路径不该走旧函数'); };

await t('T1 getUtxosByAddresses 永不返回 ⇒ 在 rpcCallMs 内以 facts_rpc_timeout 失败(不挂死); 耗时 ≈ 截止时间而不是 5s', async () => {
  const t0 = Date.now();
  const out = await hungGuard(handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => ({ getUtxosByAddresses: neverSettles }), legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 40 }));
  assert.notStrictEqual(out, HUNG, '挂死: 没有截止时间');
  assert.ok(out.e instanceof FactsError && out.e.code === 'facts_rpc_timeout', `期望 facts_rpc_timeout, 实际 ${out.e && out.e.code} ${out.e && out.e.message}`);
  assert.match(out.e.message, /getUtxosByAddresses/);
  const dt = Date.now() - t0;
  assert.ok(dt >= 30 && dt < 700, `耗时 ${dt}ms 应约等于 40ms`);
});
await t('T2 getBlockDagInfo 永不返回 ⇒ R2 同样以 facts_rpc_timeout 失败(不挂死)', async () => {
  const out = await hungGuard(handleGetPastMedianTime({ getSharedRpc: async () => ({ getBlockDagInfo: neverSettles }), rpcCallMs: 40 }));
  assert.notStrictEqual(out, HUNG, '挂死: R2 没有截止时间');
  assert.ok(out.e instanceof FactsError && out.e.code === 'facts_rpc_timeout', `期望 facts_rpc_timeout, 实际 ${out.e && out.e.code}`);
  assert.match(out.e.message, /getBlockDagInfo/);
});
await t('T3 截止时间之前返回 ⇒ 正常结果, 且【每个】定时器都被清掉(成功路径与失败路径都不漏定时器)', async () => {
  const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
  const live = new Set();
  globalThis.setTimeout = (fn, ms, ...a) => { const id = realST(fn, ms, ...a); live.add(id); return id; };
  globalThis.clearTimeout = (id) => { live.delete(id); return realCT(id); };
  try {
    const okRes = await handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => ({ getUtxosByAddresses: async () => ({ entries: mixedEntries() }) }), legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 60000 });
    assert.strictEqual(okRes.form, 'list');
    const pmt = await handleGetPastMedianTime({ getSharedRpc: async () => ({ getBlockDagInfo: async () => ({ pastMedianTime: 1758000000000 }) }), rpcCallMs: 60000 });
    assert.strictEqual(pmt.ok, true);
    let err = null;
    try { await handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => ({ getUtxosByAddresses: async () => { throw new Error('rpc down'); } }), legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 60000 }); } catch (e) { err = e; }
    assert.strictEqual(err && err.message, 'rpc down');
    try { await handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => ({ getUtxosByAddresses: neverSettles }), legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 20 }); } catch {}
  } finally { globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; }
  assert.strictEqual(live.size, 0, `有 ${live.size} 个定时器没被清掉`);
});
await t('T4 超时之后底层调用才晚到的 reject 不会变成 unhandledRejection(Promise.race 已订阅它)', async () => {
  let unhandled = 0;
  const h = () => { unhandled++; };
  process.on('unhandledRejection', h);
  try {
    const rpc = { getUtxosByAddresses: () => new Promise((_, rej) => setTimeout(() => rej(new Error('late boom')), 90)) };
    const out = await hungGuard(handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => rpc, legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 25 }));
    assert.ok(out.e && out.e.code === 'facts_rpc_timeout', `期望先超时, 实际 ${out.e && out.e.message}`);
    await sleep(250);                                   // 让那个晚到的 reject 真的发生
  } finally { process.off('unhandledRejection', h); }
  assert.strictEqual(unhandled, 0, `出现了 ${unhandled} 次 unhandledRejection`);
});
await t('T5 RPC 调用同步抛错 ⇒ 错误原样上抛(不是超时、不被吞); 超时错误是 FactsError, 其 message 带 facts_rpc_timeout 前缀(relay 外层 catch 回执 {error, phase:execution} 靠它)', async () => {
  const boom = new Error('sync boom');
  const out = await hungGuard(handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => ({ getUtxosByAddresses: () => { throw boom; } }), legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 40 }));
  assert.strictEqual(out.e, boom);
  const to = await hungGuard(handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => ({ getUtxosByAddresses: neverSettles }), legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x', rpcCallMs: 20 }));
  assert.match(to.e.message, /^facts_rpc_timeout: /);
});
await t('T6 默认预算(不注入 rpcCallMs)恰是 FACTS_RPC_CALL_MS: 一个 30ms 内返回的 rpc 不受影响(默认值不是 0/负数)', async () => {
  const r = await handleGetPastMedianTime({ getSharedRpc: async () => ({ getBlockDagInfo: async () => { await sleep(30); return { pastMedianTime: 1758000000000 }; } }) });
  assert.strictEqual(r.pastMedianTimeMs, 1758000000000);
});
// T6b(NWT 9-0 复核补测): T6 只测了 R2(handleGetPastMedianTime)的默认预算; handleGetAddressUtxos 的默认预算被改成 0 的变异
//   (NWT 的 S1-f)因此存活。两个 handler 各有自己的默认值, 必须各测一次(形态 O 与形态 L 都走同一条 withDeadline 调用, 各测一次更稳)。
await t('T6b 默认预算(不注入 rpcCallMs)对 handleGetAddressUtxos 同样是 FACTS_RPC_CALL_MS: 30ms 内返回的 rpc 在形态 L 与形态 O 都不受影响(默认值不是 0/负数)', async () => {
  const slow = { getUtxosByAddresses: async () => { await sleep(30); return { entries: mixedEntries() }; } };
  const l = await handleGetAddressUtxos({ cmd: okCmd, getSharedRpc: async () => slow, legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x' });
  assert.strictEqual(l.form, 'list');
  assert.strictEqual(l.utxos.length, 3);
  const o = await handleGetAddressUtxos({ cmd: { address: ADDR, facts: true, outpoints: [{ transactionId: txid(0xa1), index: 0 }] }, getSharedRpc: async () => slow, legacyGetAddressUtxos: noLegacy, getNetworkId: () => 'x' });
  assert.strictEqual(o.form, 'outpoints');
  assert.strictEqual(o.found.length, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
