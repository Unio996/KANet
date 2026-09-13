// exchange-machine-kaspa-gate.test.mjs — (c) F1 kaspa 支付两段门 离线向量 (J2 2026-09-13, 设计 v0.3 §4 F1-正/反/弱注入/弱注入 b)。
// 真 migration 临时库(exchange-machine 模块顶层要 db) + 假 verifyFn + 假 sendCmd; 零链零 IPC。
// Run: cd kasia-console && node src/services/exchange-machine-kaspa-gate.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._F1_GATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_f1_gate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _F1_GATE_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { evaluateKaspaPaymentGate } = await import('./exchange-machine.js');
let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const MIN = 20, TX = 'ab'.repeat(32), TO = 'kaspa:qrecipient';
const verifyOk = async ({ txHash, expectedTo }) => ({ confirmed: true, confirmations: 1, required: 1, actualAmount: 10, recipient: expectedTo, sender: '', source: 'local_indexer' });
const verifyMismatch = async () => ({ confirmed: false, confirmations: 1, required: 1, actualAmount: 10, recipient: 'kaspa:qother', sender: '', error: 'Recipient mismatch', source: 'local_indexer' });
function relay(depthByRelay) {
  const calls = [];
  const sendCmd = async (relayId, cmd) => {
    calls.push({ relayId, cmd });
    const d = depthByRelay[relayId];
    if (d === 'down') throw new Error('Relay not running');
    if (d === 'timeout') throw new Error('Relay command timeout after 15s');
    return { ok: true, landed: d >= (cmd.minDepth || 0), depth: d };
  };
  return { sendCmd, calls };
}
const args = (v, r, ids) => ({ verifyFn: v, sendCmd: r.sendCmd, relayIds: ids, txHash: TX, expectedAmount: 10, expectedTo: TO, minDepth: MIN });

{ const r = relay({ A: 25 }); const vr = await evaluateKaspaPaymentGate(args(verifyOk, r, ['A']));
  ok(vr.confirmed && vr.landed && vr.confirmations === 25 && vr.required === MIN && vr.recipientOk && r.calls[0].cmd.type === 'check_utxo_landed' && r.calls[0].cmd.minDepth === MIN && r.calls[0].cmd.address === TO && r.calls[0].cmd.txid === TX, 'F1-正: 收款人/金额对 + depth 25 ≥ 20 → confirmed'); }
{ const r = relay({ A: 25 }); const vr = await evaluateKaspaPaymentGate(args(async () => ({ confirmed: false, confirmations: 0, required: 1, actualAmount: 0, recipient: '', sender: '', error: 'not found' }), r, ['A']));
  ok(!vr.confirmed && !vr.recipientOk && r.calls.length === 0, 'F1-反: 索引器无 → 不查深度, confirmed=false'); }
{ const r = relay({ A: MIN - 1 }); const vr = await evaluateKaspaPaymentGate(args(verifyOk, r, ['A']));
  ok(!vr.confirmed && vr.recipientOk && !vr.landed && vr.confirmations === MIN - 1, 'F1-弱注入: depth 19 → 仍 verifying(门读的是 relay 深度, 不是 vr.confirmations=1)'); }
{ const r = relay({ A: 25 }); const vr = await evaluateKaspaPaymentGate(args(verifyMismatch, r, ['A']));
  ok(!vr.confirmed && !vr.recipientOk && r.calls.length === 0, 'F1-弱注入 b: 收款人不对 → 两段都在读, 不查深度'); }
{ const r = relay({ A: 'down', B: 25 }); const vr = await evaluateKaspaPaymentGate(args(verifyOk, r, ['A', 'B']));
  ok(vr.confirmed && r.calls.length === 2 && r.calls[1].relayId === 'B', 'relay 兜底: A 未运行 → B 答'); }
{ const r = relay({ A: 'timeout', B: 25 }); const vr = await evaluateKaspaPaymentGate(args(verifyOk, r, ['A', 'B']));
  ok(!vr.confirmed && vr.recipientOk && r.calls.length === 1 && /landed check unavailable/.test(vr.error), '真错(超时)不换 relay → confirmed=false 留 verifying'); }
{ let thrown = false; try { await evaluateKaspaPaymentGate({ ...args(verifyOk, relay({ A: 25 }), ['A']), minDepth: 0 }); } catch { thrown = true; }
  ok(thrown, 'minDepth 0 被拒(必须 REORG_SAFE_MIN_DEPTH)'); }
{ const before = fails; const r = relay({ A: 1 }); const vr = await evaluateKaspaPaymentGate(args(verifyOk, r, ['A'])); ok(vr.confirmed === true, 'harness-flip (expect FAIL)');
  if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all F1 gate vectors passed');
process.exit(fails ? 1 : 0);
