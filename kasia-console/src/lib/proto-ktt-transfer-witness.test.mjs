// proto-ktt-transfer-witness.test.mjs — 决定性验证(账本1436续): encodeKttTransferZeroOutAction 与真实
// D-019 pin cli-debugger 自己跑 KanetTestToken.transfer(next_states=[],witness=[],owner_input_idx=[3])
// 内部构造出的 active_sigscript 逐字节完全一致。捕获手法同 proto-register-append-witness.test.mjs
// (临时加一行 eprintln, 未改任何编码/执行逻辑, 验证后已还原, 见
// docs/provenance/2026-09-15-j2-ktt-transfer-witness-abi-verification/)。
// Run: cd kasia-console && node src/lib/proto-ktt-transfer-witness.test.mjs

import fs from 'node:fs';

const kaspa = await import('kaspa-wasm');
const { encodeKttTransferZeroOutAction, combineKttActionAndRedeem, buildKttTransferZeroOutSigScriptHex } = await import('./proto-ktt-transfer-witness.mjs');
const { compileSilV100 } = await import('./pool-bshard-artifacts.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const FIXTURE_DIR = '../docs/provenance/2026-09-15-j2-ktt-transfer-witness-abi-verification';
function hexToBytes(h) { return Buffer.from(h.startsWith('0x') ? h.slice(2) : h, 'hex'); }

const refCtor = JSON.parse(fs.readFileSync(`${FIXTURE_DIR}/ktt.reference.ctor.json`, 'utf8'));
const compiled = compileSilV100(`${FIXTURE_DIR}/KanetTestToken.sil`, refCtor, 'KanetTestToken');
const entryAbi = compiled._raw.contracts.KanetTestToken.entries.transfer;
const stateFieldCount = compiled._raw.contracts.KanetTestToken.runtime_state.fields.length;

const realActionHex = fs.readFileSync(`${FIXTURE_DIR}/real_action_from_debugger.hex`, 'utf8').trim();

t('①(决定性)encodeKttTransferZeroOutAction 与真实 cli-debugger 内部构造的 active_sigscript 逐字节一致', () => {
  const myActionHex = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [3]);
  if (myActionHex.toLowerCase() !== realActionHex.toLowerCase()) {
    let i = 0; while (i < Math.min(myActionHex.length, realActionHex.length) && myActionHex[i].toLowerCase() === realActionHex[i].toLowerCase()) i++;
    throw new Error(`不一致, 首个差异在 hex 字符索引 ${i}: mine=${myActionHex} real=${realActionHex}`);
  }
});

t('② State runtime_state.fields.length 真实读到 6(amount/owner/owner_scheme/borrow_scheme/borrow_guard/extension_commitment), 不是硬编字面量', () => {
  if (stateFieldCount !== 6) throw new Error(`期望 6, 实际 ${stateFieldCount}`);
});

t('③ dispatch_tag 来自真实编译产物, 非空4字节hex', () => {
  if (!/^[0-9a-f]{8}$/.test(entryAbi.dispatch_tag)) throw new Error(`dispatch_tag 形状不对: ${entryAbi.dispatch_tag}`);
});

t('④ combineKttActionAndRedeem(fromScript桥接) 与手工拼接一致', () => {
  const redeemHex = '0x' + Buffer.from(compiled.script).toString('hex');
  const full = combineKttActionAndRedeem(kaspa, realActionHex, redeemHex);
  const manualB = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  manualB.addData(hexToBytes(redeemHex));
  const manualFull = realActionHex + manualB.drain();
  if (full.toLowerCase() !== manualFull.toLowerCase()) throw new Error('fromScript 桥接与手工拼接不一致');
});

t('⑤ buildKttTransferZeroOutSigScriptHex(一步到位) 与分步调用结果一致', () => {
  const redeemHex = '0x' + Buffer.from(compiled.script).toString('hex');
  const oneShot = buildKttTransferZeroOutSigScriptHex(kaspa, entryAbi, stateFieldCount, [3], redeemHex);
  const action = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [3]);
  const twoStep = combineKttActionAndRedeem(kaspa, action, redeemHex);
  if (oneShot.toLowerCase() !== twoStep.toLowerCase()) throw new Error('一步到位与分步调用结果不一致');
});

t('⑥ ownerInputIdx 改变(如 [0] 而非 [3]) ⇒ 产出字节确实不同', () => {
  const a1 = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [3]);
  const a2 = encodeKttTransferZeroOutAction(kaspa, entryAbi, stateFieldCount, [0]);
  if (a1 === a2) throw new Error('owner_input_idx 变了但编码结果没变');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
