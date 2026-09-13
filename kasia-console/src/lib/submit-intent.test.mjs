// submit-intent.test.mjs — (c) F2 / F2-E / F2-R 离线向量 (J2 2026-09-13, 设计 v0.3 §4; NWT diff 审用)。
// 真 migration 临时库(DB_PATH) + 假 sendCmd(脚本化 relay: mempool / UTXO 深度 / 广播计数 / 回执落表), 零链零 IPC。
// 守什么(每条一正一反 + 弱注入; "必须为红"臂 = 证明判据是 intent 表/relay 侧, 不是 metadata):
//   F2-正/幂等/I5/I5-b/I5-弱注入 · F2-E-正/反 · F2-R-1/2/3/弱注入/弱注入b · checkIntentLanded 深度门 · resumeStaleIntents · recordIntentPhase 单调 · harness 翻转臂
// Run: cd kasia-console && node src/lib/submit-intent.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._SUBMIT_INTENT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_submit_intent_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _SUBMIT_INTENT_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const SI = await import('./submit-intent.mjs');
const { transferWithIntent, checkIntentLanded, resumeStaleIntents, recordIntentPhase, getIntent, ensureIntent, markIntent, intentKeyFor } = SI;

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const quiet = { log: () => {}, error: () => {} };
const events = (type) => sqlite.prepare('SELECT count(*) AS n FROM events WHERE event_type = ?').get(type).n;

// ── 脚本化 relay ────────────────────────────────────────────────────────────
function makeRelay() {
  const R = { broadcasts: [], mempool: new Set(), landed: new Map(), calls: [], mode: 'ok', replayResult: null, n: 0 };
  R.sendCmd = async (relayId, cmd) => {
    R.calls.push(cmd);
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: R.mempool.has(cmd.txid) };
    if (cmd.type === 'check_utxo_landed') { const d = R.landed.get(cmd.txid); return { ok: true, landed: d != null && d >= (cmd.minDepth || 0), depth: d ?? null }; }
    if (cmd.type !== 'transfer') throw new Error(`unexpected ${cmd.type}`);
    if (cmd.replay_tx_json) {
      const r = typeof R.replayResult === 'function' ? R.replayResult(cmd) : R.replayResult;
      if (r?.ok && r.txId && !r.alreadyInMempool) { R.broadcasts.push(r.txId); R.mempool.add(r.txId); }
      return r;
    }
    const txid = `tx${++R.n}`.padEnd(64, '0');
    if (R.mode === 'timeout_before_prepared') throw new Error('Relay command timeout after 30s');
    if (R.mode === 'fail') return { error: 'boom' };
    // relay 真实顺序: prepared 回执 → 广播 → submitted 回执 → IPC 回执
    recordIntentPhase({ intentKey: cmd.intent_key, phase: 'prepared', txid, txJson: JSON.stringify([`{"id":"${txid}"}`]) });
    if (R.mode === 'die_after_prepared') { R.broadcasts.push(txid); R.mempool.add(txid); throw new Error('Relay command timeout after 30s'); }   // 广播出去了, submitted 回执与 IPC 都没到
    R.broadcasts.push(txid); R.mempool.add(txid);
    recordIntentPhase({ intentKey: cmd.intent_key, phase: 'submitted', txid });
    if (R.mode === 'timeout_after_broadcast') throw new Error('Relay command timeout after 30s');
    return { ok: true, txId: txid, phase: 'execution' };
  };
  return R;
}
const base = (R, offerId, kind = 'payout') => ({ sendCmd: R.sendCmd, relayId: 'relay-A', intentKind: kind, offerId, targetAddress: 'kaspa:qtarget', amountKas: '1.00000000', origin: 'internal', sleepMs: () => 0, log: quiet });
const transfers = (R) => R.calls.filter(c => c.type === 'transfer' && !c.replay_tx_json).length;
const replays = (R) => R.calls.filter(c => c.type === 'transfer' && c.replay_tx_json).length;

// ── F2-正 / 幂等 ─────────────────────────────────────────────────────────────
{
  const R = makeRelay();
  const t1 = await transferWithIntent(base(R, 'o1'));
  ok(t1.txId && getIntent(intentKeyFor('payout', 'o1')).status === 'submitted' && R.broadcasts.length === 1, 'F2-正: fresh send → txId, intent submitted, broadcasts=1');
  const t2 = await transferWithIntent(base(R, 'o1'));
  ok(t2.reused && t2.txId === t1.txId && R.broadcasts.length === 1 && transfers(R) === 1, 'F2-幂等: 同 offer 再来 → reused, 不再 transfer, broadcasts 仍 1');
}
// ── F2-I5: IPC 超时但 relay 已广播且两条回执都到 ⇒ attempt 2 读表见 submitted ⇒ 不重发 ──
{
  const R = makeRelay(); R.mode = 'timeout_after_broadcast';
  const t = await transferWithIntent(base(R, 'o2'));
  ok(t.reused && R.broadcasts.length === 1 && transfers(R) === 1, 'F2-I5: IPC 超时(relay 已广播+回执) → attempt 2 复用 submitted, broadcasts=1');
}
// ── F2-I5 变体: relay 在 prepared 回执后广播、submitted 回执丢 ⇒ prepared 行 ⇒ mempool 有 ⇒ 不重发 ──
{
  const R = makeRelay(); R.mode = 'die_after_prepared';
  const t = await transferWithIntent(base(R, 'o3'));
  ok(t.txId && R.broadcasts.length === 1 && transfers(R) === 1 && replays(R) === 0 && getIntent(intentKeyFor('payout', 'o3')).status === 'submitted', 'F2-I5(prepared 只到一半): mempool 有 → submitted, 不重发不重播');
}
// ── F2-I5-b: IPC 在 prepared 之前就断(什么都没到 relay) ⇒ 允许重发一次 ⇒ 广播 1 ──
{
  const R = makeRelay(); R.mode = 'timeout_before_prepared';
  const p = transferWithIntent(base(R, 'o4'));
  setTimeout(() => { R.mode = 'ok'; }, 0);   // attempt 2 时 relay 活了
  const t = await p;
  ok(t.txId && R.broadcasts.length === 1 && transfers(R) === 2, 'F2-I5-b: 第一次从未到 relay → 第二次重发, broadcasts=1');
}
// ── F2-I5-弱注入 (必须为红): 删掉 intent 行只留 metadata ⇒ 重发了 ⇒ 证明判据是 intent 表不是 metadata ──
{
  const R = makeRelay();
  await transferWithIntent(base(R, 'o5'));
  sqlite.prepare('DELETE FROM submit_intents WHERE intent_key = ?').run(intentKeyFor('payout', 'o5'));   // "只剩 metadata.payout_tx" 的模拟
  await transferWithIntent(base(R, 'o5'));
  ok(R.broadcasts.length === 2, 'F2-I5-弱注入(必须为红): intent 行没了 → 重发了(broadcasts=2) ⇒ 判据在 intent 表/relay 侧, 不在 metadata');
}
// ── F2-E-正/反: HTTP 重 POST = 同 offer 第二次 transferWithIntent ──
{
  const R = makeRelay(); R.mode = 'timeout_after_broadcast';
  const a = await transferWithIntent(base(R, 'bet1', 'maker_stake'));
  R.mode = 'ok';
  const b = await transferWithIntent(base(R, 'bet1', 'maker_stake'));
  ok(a.txId === b.txId && R.broadcasts.length === 1, 'F2-E-正: 客户端重 POST 同 bet → 同一 txId, broadcasts=1');
  const R2 = makeRelay(); R2.mode = 'timeout_before_prepared';
  let firstErr = null;
  try { await transferWithIntent({ ...base(R2, 'bet2', 'taker_stake'), maxAttempts: 1 }); } catch (e) { firstErr = e.message; }
  R2.mode = 'ok';
  const c = await transferWithIntent(base(R2, 'bet2', 'taker_stake'));
  ok(firstErr && c.txId && R2.broadcasts.length === 1, 'F2-E-反: 第一次 IPC 在 prepared 前断(503) → 重 POST 允许发一次, broadcasts=1');
}
// ── F2-R-1: 重启前 prepared(有 txid+bytes), mempool 有 ⇒ submitted, 不重播不重建 ──
{
  const R = makeRelay();
  ensureIntent({ intentKind: 'payout', offerId: 'r1', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r1'), phase: 'prepared', txid: 'p1'.padEnd(64, '1'), txJson: '["bytes"]' });
  R.mempool.add('p1'.padEnd(64, '1'));
  const t = await transferWithIntent(base(R, 'r1'));
  ok(t.txId === 'p1'.padEnd(64, '1') && replays(R) === 0 && transfers(R) === 0 && getIntent(intentKeyFor('payout', 'r1')).status === 'submitted', 'F2-R-1: prepared + mempool 有 → submitted, 零重播零重建');
}
// ── F2-R-2: prepared, mempool 无, 未落链, 有 bytes ⇒ 同字节重播(relay 收到 replay_tx_json+prepared_txid), distinct txid = 1 ──
{
  const R = makeRelay();
  const txid = 'p2'.padEnd(64, '2');
  ensureIntent({ intentKind: 'payout', offerId: 'r2', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r2'), phase: 'prepared', txid, txJson: '["signed-bytes"]' });
  R.replayResult = (cmd) => ({ ok: true, txId: cmd.prepared_txid, replayed: true });
  const t = await transferWithIntent(base(R, 'r2'));
  const rp = R.calls.find(c => c.replay_tx_json);
  ok(t.replayed && t.txId === txid && rp?.replay_tx_json === '["signed-bytes"]' && rp?.prepared_txid === txid && transfers(R) === 0 && new Set(R.broadcasts).size === 1, 'F2-R-2: 同字节重播(带 bytes+prepared_txid), 不重建, distinct txid=1');
}
// ── F2-R-3: 重播被 relay 判 inputs_spent ⇒ 旧行 abandoned + '#2' 新行 ⇒ 重建 ⇒ distinct 2, 旧 txid 链上永不出现 ──
{
  const R = makeRelay();
  const old = 'p3'.padEnd(64, '3');
  ensureIntent({ intentKind: 'payout', offerId: 'r3', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r3'), phase: 'prepared', txid: old, txJson: '["bytes"]' });
  R.replayResult = { ok: false, code: 'inputs_spent', error: 'input spent' };
  const t = await transferWithIntent(base(R, 'r3'));
  const oldRow = getIntent(intentKeyFor('payout', 'r3')), newRow = getIntent(intentKeyFor('payout', 'r3', 2));
  ok(oldRow.status === 'abandoned' && newRow?.status === 'submitted' && newRow.parent_intent_key === oldRow.intent_key && t.txId !== old && !R.broadcasts.includes(old) && new Set(R.broadcasts).size === 1 && events('intent_rebuilt_after_inputs_spent') === 1, 'F2-R-3: inputs_spent → 旧 abandoned, #2 重建, 旧 txid 从未广播');
}
// ── F2-R-弱注入 (必须为红): prepared 无 bytes ⇒ 不发不建 + 告警 ──
{
  const R = makeRelay();
  ensureIntent({ intentKind: 'payout', offerId: 'r4', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r4'), phase: 'prepared', txid: 'p4'.padEnd(64, '4') });   // 无 txJson
  let err = null;
  try { await transferWithIntent(base(R, 'r4')); } catch (e) { err = e; }
  ok(err?.hold && err.code === 'prepared_without_bytes' && R.broadcasts.length === 0 && transfers(R) === 0 && replays(R) === 0 && events('intent_prepared_without_bytes') === 1, 'F2-R-弱注入(必须为红): 无 bytes → hold, 零广播零重建, 告警 1 行');
}
// ── F2-R-弱注入 b: 重播回来的 txid ≠ prepared ⇒ hold + 告警; relay 侧拒(code) 同样 hold ──
{
  const R = makeRelay();
  const txid = 'p5'.padEnd(64, '5');
  ensureIntent({ intentKind: 'payout', offerId: 'r5', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r5'), phase: 'prepared', txid, txJson: '["tampered"]' });
  R.replayResult = { ok: false, code: 'replay_txid_mismatch', error: 'bytes txid ≠ prepared' };
  let err = null;
  try { await transferWithIntent(base(R, 'r5')); } catch (e) { err = e; }
  ok(err?.hold && err.code === 'replay_txid_mismatch' && R.broadcasts.length === 0 && events('intent_replay_txid_mismatch') === 1 && getIntent(intentKeyFor('payout', 'r5')).status === 'prepared', 'F2-R-弱注入 b: relay 拒 txid 不等 → hold, 零广播, 行留 prepared');
  const R2 = makeRelay();
  ensureIntent({ intentKind: 'payout', offerId: 'r6', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r6'), phase: 'prepared', txid, txJson: '["x"]' });
  R2.replayResult = { ok: true, txId: 'zz'.padEnd(64, 'z') };
  err = null;
  try { await transferWithIntent(base(R2, 'r6')); } catch (e) { err = e; }
  ok(err?.hold && events('intent_replay_txid_mismatch') === 2 && getIntent(intentKeyFor('payout', 'r6')).status === 'prepared', 'F2-R-弱注入 b′: relay 回了别的 txid → console 侧也拒(hold), 不标 submitted');
}
// ── (A) 往返失败 ⇒ fail-closed: relay 回 replay_bad_json ⇒ hold + 告警, 不重试不重建 ──
{
  const R = makeRelay();
  const txid = 'p9'.padEnd(64, '9');
  ensureIntent({ intentKind: 'payout', offerId: 'r8', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r8'), phase: 'prepared', txid, txJson: '["corrupt"]' });
  R.replayResult = { ok: false, code: 'replay_bad_json', error: 'deserialize failed' };
  let err = null;
  try { await transferWithIntent(base(R, 'r8')); } catch (e) { err = e; }
  ok(err?.hold && err.code === 'replay_bad_json' && replays(R) === 1 && transfers(R) === 0 && R.broadcasts.length === 0 && events('intent_replay_unrecoverable') === 1 && getIntent(intentKeyFor('payout', 'r8')).status === 'prepared', '(A) 往返失败 → hold: 一次重播尝试后零广播零重建, 告警 1 行, 行留 prepared(人工)');
}
// ── 查询失败 = 未知 ⇒ 不重发 ──
{
  const R = makeRelay();
  ensureIntent({ intentKind: 'payout', offerId: 'r7', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'r7'), phase: 'prepared', txid: 'p7'.padEnd(64, '7'), txJson: '["b"]' });
  const orig = R.sendCmd;
  R.sendCmd = async (id, cmd) => { if (cmd.type === 'get_mempool_entry') throw new Error('Relay command timeout'); return orig(id, cmd); };
  let err = null;
  try { await transferWithIntent({ ...base(R, 'r7'), maxAttempts: 2 }); } catch (e) { err = e; }
  ok(err && R.broadcasts.length === 0 && R.calls.every(c => c.type !== 'transfer'), 'unknown-state: mempool 查询失败 → 不重发不重播(两 attempt 都只查)');
}
// ── checkIntentLanded 深度门 ──
{
  const R = makeRelay();
  const t = await transferWithIntent(base(R, 'l1'));
  R.landed.set(t.txId, 5);
  const a = await checkIntentLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', intent: getIntent(intentKeyFor('payout', 'l1')), minDepth: 20, origin: 'internal' });
  R.landed.set(t.txId, 25);
  const b = await checkIntentLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', intent: getIntent(intentKeyFor('payout', 'l1')), minDepth: 20, origin: 'internal' });
  const row = getIntent(intentKeyFor('payout', 'l1'));
  ok(!a.landed && a.depth === 5 && b.landed && b.depth === 25 && row.status === 'landed' && row.landed_depth === 25, 'checkIntentLanded: depth 5 < 20 → 不落; 25 → landed 行');
  let thrown = false; try { await checkIntentLanded({ sendCmd: R.sendCmd, relayId: 'relay-A', intent: row, minDepth: 0 }); } catch { thrown = true; }
  ok(thrown, 'checkIntentLanded: minDepth 0 被拒(必须显式传 REORG_SAFE_MIN_DEPTH)');
}
// ── resumeStaleIntents: 陈旧 prepared 行(updated_at 3 min 前) + mempool 有 ⇒ resolved ──
{
  const R = makeRelay();
  const txid = 'p8'.padEnd(64, '8');
  ensureIntent({ intentKind: 'escrow_lock', offerId: 's1', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('escrow_lock', 's1'), phase: 'prepared', txid, txJson: '["b"]' });
  sqlite.prepare('UPDATE submit_intents SET updated_at = ? WHERE intent_key = ?').run(new Date(Date.now() - 3 * 60 * 1000).toISOString(), intentKeyFor('escrow_lock', 's1'));
  R.mempool.add(txid);
  const r = await resumeStaleIntents({ sendCmd: R.sendCmd, log: quiet });
  ok(r.scanned === 1 && r.resolved === 1 && getIntent(intentKeyFor('escrow_lock', 's1')).status === 'submitted' && R.broadcasts.length === 0, 'resumeStaleIntents: 陈旧 prepared + mempool 有 → submitted, 零广播');
  const r2 = await resumeStaleIntents({ sendCmd: R.sendCmd, log: quiet });
  ok(r2.scanned === 0, 'resumeStaleIntents: 第二次无陈行');
}
// ── recordIntentPhase 单调 + 未知 key 拒 ──
{
  ensureIntent({ intentKind: 'payout', offerId: 'm1', relayId: 'relay-A', targetAddress: 'kaspa:qtarget', amountKas: '1' });
  const k = intentKeyFor('payout', 'm1');
  recordIntentPhase({ intentKey: k, phase: 'submitted', txid: 'q1'.padEnd(64, '1') });
  recordIntentPhase({ intentKey: k, phase: 'prepared', txid: 'q1'.padEnd(64, '1'), txJson: '["late"]' });
  const row = getIntent(k);
  ok(row.status === 'submitted' && row.prepared_tx_json === '["late"]', 'recordIntentPhase: 迟到的 prepared 不把 submitted 退回, 但补上 bytes');
  ok(recordIntentPhase({ intentKey: 'nope:x', phase: 'prepared', txid: 'a' }).ok === false, 'recordIntentPhase: 未知 intent_key 拒');
  ok(markIntent(k, { status: 'pending' }).status === 'submitted', 'markIntent: status 单调不退');
}
// ── harness 翻转臂: 故意错的期望必须为红 ──
{
  const before = fails;
  const R = makeRelay();
  await transferWithIntent(base(R, 'h1'));
  ok(R.broadcasts.length === 2, 'harness-flip (expect FAIL)');
  if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { console.error('  ❌ harness flip arm did not go red — harness vacuous'); fails++; }
}

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all submit-intent vectors passed');
process.exit(fails ? 1 : 0);
