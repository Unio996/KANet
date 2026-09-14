// proto-register-append-witness.test.mjs — 决定性验证(账本1425/1431, 关闭 T-PROTO-ENTRY-WITNESS-
// ABI-UNVERIFIED 中 register_append 那部分)。
//
// 向量①: encodeRegisterAppendAction(用真实 kaspa-wasm ScriptBuilder)产出的字节, 与真实 D-019 pin
// (3ed973335b59269293564805cc2c58a14595ec03)的 cli-debugger 自己跑 function/args 模式内部构造出的
// active_sigscript 逐字节完全一致——后者是一次性用临时加一行 eprintln(未改任何编码逻辑, 见
// docs/provenance/2026-09-15-j2-register-append-entry-witness-abi-verification/debug-print.patch)
// 捕获的真实值, 冻结在同目录 real_action_from_debugger.hex, 不需要每次重新编译调试版二进制。
//
// 向量②: 用同一套编码器构造完整 sigScript(action+redeem), 通过 combineActionAndRedeem, 与手工拼接
// 结果一致(证明 fromScript 桥接语义符合预期)。
//
// 向量③(经 legitimate function/args 路径, 因为 cli-debugger 架构上无法测"raw signature_script_hex
// 直接喂给 active input"——见 README"发现"一节): 故意改 witness 里的 stake 但不改对应输出, 真实
// debugger 报 require 失败并给出精确行号/trace(fnargs_wrongstake.test.json 冻结在同目录)。这条不是
// 本测试文件自动跑的(依赖外部 cli-debugger.exe), 结果已冻结进 README, 此处只留指针注释。
//
// Run: cd kasia-console && node src/lib/proto-register-append-witness.test.mjs

import fs from 'node:fs';

const kaspa = await import('kaspa-wasm');
const { encodeRegisterAppendAction, combineActionAndRedeem, buildRegisterAppendSigScriptHex } = await import('./proto-register-append-witness.mjs');
const { compileSilV100 } = await import('./pool-bshard-artifacts.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const FIXTURE_DIR = '../docs/provenance/2026-09-15-j2-register-append-entry-witness-abi-verification';
function hexToBytes(h) { return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex'); }

const args = JSON.parse(fs.readFileSync(`${FIXTURE_DIR}/V-register_append-1.args.json`, 'utf8'));
const [side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, stakeInIdx, tok_out, tok_prefix, tok_suffix] = args;
const w = { side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, stakeInIdx, tok_out, tok_prefix, tok_suffix };

const refCtor = JSON.parse(fs.readFileSync(`${FIXTURE_DIR}/ShardLeaf_direct.reference.ctor.json`, 'utf8'));
const compiled = compileSilV100(`${FIXTURE_DIR}/ShardLeaf_direct.sil`, refCtor, 'ShardLeaf_direct');
const entryAbi = compiled._raw.contracts.ShardLeaf_direct.entries.register_append;

const realActionHex = fs.readFileSync(`${FIXTURE_DIR}/real_action_from_debugger.hex`, 'utf8').trim();

t('①(决定性)encodeRegisterAppendAction 与真实 cli-debugger 内部构造的 active_sigscript 逐字节一致', () => {
  const myActionHex = encodeRegisterAppendAction(kaspa, entryAbi, w);
  if (myActionHex.toLowerCase() !== realActionHex.toLowerCase()) {
    let i = 0; while (i < Math.min(myActionHex.length, realActionHex.length) && myActionHex[i].toLowerCase() === realActionHex[i].toLowerCase()) i++;
    throw new Error(`不一致, 首个差异在 hex 字符索引 ${i}`);
  }
});

t('② dispatch_tag 来自真实编译产物(不是硬编字面量), 且非空 4 字节 hex', () => {
  if (!/^[0-9a-f]{8}$/.test(entryAbi.dispatch_tag)) throw new Error(`dispatch_tag 形状不对: ${entryAbi.dispatch_tag}`);
});

t('③ combineActionAndRedeem(fromScript 桥接) 与"手工拼接 action+单独 addData(redeem)"结果一致', () => {
  const redeemHex = '0x' + Buffer.from(compiled.script).toString('hex');
  // 用同一份 compiled.script 作为 redeem(与① 用的是同一次编译产物, 保证自洽)
  const full = combineActionAndRedeem(kaspa, realActionHex, redeemHex);
  const manualB = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  manualB.addData(hexToBytes(redeemHex));
  const manualFull = realActionHex + manualB.drain();
  if (full.toLowerCase() !== manualFull.toLowerCase()) throw new Error('fromScript 桥接与手工拼接不一致');
});

t('④ buildRegisterAppendSigScriptHex(一步到位) 与分步调用(encode+combine)结果一致', () => {
  const redeemHex = '0x' + Buffer.from(compiled.script).toString('hex');
  const oneShot = buildRegisterAppendSigScriptHex(kaspa, entryAbi, w, redeemHex);
  const action = encodeRegisterAppendAction(kaspa, entryAbi, w);
  const twoStep = combineActionAndRedeem(kaspa, action, redeemHex);
  if (oneShot.toLowerCase() !== twoStep.toLowerCase()) throw new Error('一步到位与分步调用结果不一致');
});

t('⑤ 参数改变(stake+1) ⇒ 产出字节确实不同(防"改了参数但编码器没反应"这种更隐蔽的错)', () => {
  const a1 = encodeRegisterAppendAction(kaspa, entryAbi, w);
  const a2 = encodeRegisterAppendAction(kaspa, entryAbi, { ...w, stake: Number(stake) + 1 });
  if (a1 === a2) throw new Error('stake 变了但编码结果没变');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
