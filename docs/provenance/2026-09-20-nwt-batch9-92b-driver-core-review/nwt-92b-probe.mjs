// NWT 批9 9-2b(ii) 审: 对 5d4822af 的真实 proto-settlement-driver-core.mjs 做探针(纯桩依赖; 不连 relay / 节点 / 库)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const CON = 'D:/kanet-nwt-cand/kasia-console';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-92b-'));
process.env.DB_PATH = path.join(tmp, 'x.db'); process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64);
const core = await import(pathToFileURL(CON + '/src/lib/proto-settlement-driver-core.mjs').href);
const c1 = await import(pathToFileURL(CON + '/src/lib/proto-settlement-c1.mjs').href);
const out = [];

// ── P1: 报警名闭集是否覆盖 c1 grader 对每个 c1 错误码的输出(不覆盖 ⇒ makeAlerter 抛错 ⇒ advanceStep 的 catch 里抛出)
const src = fs.readFileSync(CON + '/src/lib/proto-settlement-c1.mjs', 'utf8');
const codes = [...new Set([...src.matchAll(/['"]([a-z][a-z0-9_]{5,60})['"]/g)].map((m) => m[1]))];
let checked = 0; const outside = new Set(); const seenEv = new Set();
for (const code of [...codes, 'facts_transport', 'timeout', 'ECONNRESET', undefined]) {
  for (const mk of [() => Object.assign(new Error('x ' + code), { code }), () => new Error(String(code)), () => Object.assign(new TypeError('t'), { code })]) {
    const g = c1.createTransportAlertGrader({ ticksToError: 3 });
    let r; try { r = g.onFailure(mk(), 1, 'k'); } catch (e) { outside.add('THROW:' + e.message.slice(0, 60)); continue; }
    checked++; seenEv.add(r.eventType); if (!Object.prototype.hasOwnProperty.call(core.SETTLEMENT_ALERTS, r.eventType)) outside.add(r.eventType);
  }
}
out.push(`P1 grader event names over ${checked} synthetic errors: distinct=[${[...seenEv].join(', ')}]  OUTSIDE closed set: ${JSON.stringify([...outside])}`);

// ── P2: 出口闸 / relay 拒绝在核心里的归类(是否静默重试)
const marketId = crypto.randomBytes(32).toString('hex');
async function driveWith(sendCmdImpl, label) {
  const alerts = [];
  const deps = {
    sendCmd: sendCmdImpl, relayId: 'r', alert: (n, s, p, l) => alerts.push(`${n}(${l})`),
    intents: { ensure: () => ({ status: 'pending', intent_key: 'k' }), active: () => null, get: () => ({}), mark: () => {} },
    driveIntent: async ({ buildAndBroadcast }) => { let le; try { const r = await buildAndBroadcast({ attempt: 1, intentKey: 'k' }); if (r && r.txId) return { txId: r.txId }; } catch (e) { le = e.message; } throw new Error(`settlement intent k exhausted 1 attempts: ${le}`); },
    pointers: () => ({}),
    prepare: async (step, o) => (o.phase === 'target' ? { targetAddress: 'kaspa:x' } : { expectedSpks: [], feeMinAmount: 1 }),
    verifyOnChain: async () => ({ chainParents: [], fee: { candidates: [] }, events: [] }),
    build: async () => ({ txJson: '{}', expectedTxid: 'aa', signInputIndices: [0] }),
    dependenciesLanded: async () => ({ ok: true }), checkLanded: async () => ({ landed: false }), markLanded: async () => {}, listWork: async () => ({}), minDepth: 10, now: () => Date.now(),
    log: { log() {} },
  };
  const d = core.createSettlementDriver(deps);
  let r; try { r = await d.advanceStep({ step: 'seal', subjectId: marketId, marketId }); } catch (e) { r = { threw: e.message.slice(0, 80) }; }
  out.push(`P2 ${label}: outcome=${JSON.stringify({ outcome: r.outcome, class: r.class, transient: r.transient, threw: r.threw })} alerts=[${alerts.join(', ')}]`);
}
await driveWith(async () => { throw new Error('sendProtoCommand: proto_settlement_intent_key_invalid — covenant_broadcast refused (settle: intent_key fails strict format)'); }, 'exit gate rejects the intent key (deterministic)');
await driveWith(async () => { throw new Error('sendProtoCommand: proto_settlement_driver_disabled — refused'); }, 'exit gate: settlement switch off');
await driveWith(async () => ({ ok: false, code: 'invalid_tx', error: 'relay rejected tx' }), 'relay replies ok:false code=invalid_tx');
await driveWith(async () => { throw new Error('IPC timeout 30000ms'); }, 'IPC timeout');
await driveWith(async () => ({ ok: true, txId: 'ab'.repeat(32) }), 'control: success');
// ── P3(修正笔核对): 多 tick 行为——同一个 driver 实例, 显式 tickId
async function multi(label, replies, keyMarket = marketId) {
  const alerts = []; let i = 0;
  const deps = {
    sendCmd: async () => { const r = replies[Math.min(i++, replies.length - 1)]; if (r instanceof Error) throw r; return r; }, relayId: 'r', alert: (n, s, p, l) => alerts.push(`${n}(${l},code=${p && p.code})`),
    intents: { ensure: () => ({ status: 'pending', intent_key: 'k' }), active: () => null, get: () => ({}), mark: () => {} },
    driveIntent: async ({ buildAndBroadcast }) => { let le; try { const r = await buildAndBroadcast({ attempt: 1, intentKey: 'k' }); if (r && r.txId) return { txId: r.txId }; } catch (e) { le = e.message; } throw new Error(`settlement intent k exhausted 1 attempts: ${le}`); },
    pointers: () => ({}), prepare: async (s, o) => (o.phase === 'target' ? { targetAddress: 'kaspa:x' } : { expectedSpks: [], feeMinAmount: 1 }),
    verifyOnChain: async () => ({ chainParents: [], fee: { candidates: [] }, events: [] }), build: async () => ({ txJson: '{}', expectedTxid: 'aa', signInputIndices: [0] }),
    dependenciesLanded: async () => ({ ok: true }), checkLanded: async () => ({ landed: false }), markLanded: async () => {}, listWork: async () => ({}), minDepth: 10, now: () => Date.now(), log: { log() {} },
  };
  const d = core.createSettlementDriver(deps); const per = [];
  for (let t = 1; t <= replies.length; t++) { const before = alerts.length; const r = await d.advanceStep({ step: 'seal', subjectId: keyMarket, marketId: keyMarket, tickId: t }); per.push(`t${t}:${r.outcome}${r.transient === false ? '/transient=false' : ''}${alerts.length > before ? '+ALERT' : ''}`); }
  out.push(`P3 ${label}: ${per.join(' ')}  alerts=[${alerts.join('; ')}]`);
}
const inv = { ok: false, code: 'invalid_tx', error: 'x' }, ok = { ok: true, txId: 'cd'.repeat(32) };
await multi('exit-gate refusal x2 ticks', [new Error('sendProtoCommand: proto_settlement_intent_key_invalid — refused'), new Error('sendProtoCommand: proto_settlement_intent_key_invalid — refused')]);
await multi('invalid_tx x5 ticks (want alert exactly once at t3)', [inv, inv, inv, inv, inv]);
await multi('invalid_tx x2 then success then invalid_tx x2 (success clears; no alert)', [inv, inv, ok, inv, inv]);
await multi('code changes each tick (recount; no alert)', [{ ok: false, code: 'a' }, { ok: false, code: 'b' }, { ok: false, code: 'a' }, { ok: false, code: 'b' }]);
await multi('no-code timeouts x3 (same bucket; alert at t3)', [new Error('IPC timeout'), new Error('IPC timeout'), new Error('IPC timeout')]);
console.log(out.join('\n'));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
process.exit(0);
