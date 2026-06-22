// bshard close_attest 自治-enforce voter daemon (Track B · production-trustless).
//
// 起因 (J2 verify-not-echo, 2026-06-22): bshard 命门③/④ enforce 现 driver-side/test-only — relay sign_input_for_settle
//   盲签 + enforceCommitteeSign 只 test driver/probe 调 → 恶意 settler 跳 enforce 直签任意 payoutRoot。
// 解 = 镜像 bettor-prediction-voter.js 的 handleTxSignReq (PB-S8-1 byzantine 防): 每委员 oracle 节点【自治】跑
//   enforceCloseAttest, 签前独立验 (命门①③④ + frozen_evidence 同源 + fix① 委员链锚 re-derive), PASS 才本节点 relay 签。
//   trust = honest-majority-of-委员节点; settler 远程伪造不了别节点 oracle 的 sig。
//   今天 x4kpq live: J1 :3300 手动 verify-then-sign = 本 daemon 的 proof-of-concept。
//
// 设计档: docs/2026-06-22-bshard-autonomous-enforce-daemon-design.md + docs/2026-06-22-bshard-enforce-in-daemon-interface.md
//
// ⚠ load-bearing 不变量 (Bettor 红队, daemon-在前不够 — §3 设计档):
//   (a) relay sign_input_for_settle (close_attest 类) 本地不可远程触发 (settler 远程够不到 relay)。
//   (b) 无 bypass: daemon 是本节点【唯一】call relay sign close_attest 的路, 且【每个】sign-request 必经 enforceCloseAttest。
//   → 这两条在 relay/console 层落 (本文件外); daemon 自身只保证它调的每个 sign 都先 enforce-PASS。
//
// 分工: J2 = 本 daemon 骨架 + transport + sig 收集 + (a)(b); J1 = enforceCloseAttest + verifyFrozenEvidence (lib).

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';

const TICK_MS = 30_000;   // 30s tick (close_attest 时效性 > 普通 vote; settler 等 quorum)
let timer = null, running = false;

// J1 的 enforceCloseAttest (lib, co-design). 未 ship 时回退到现有 enforceCommitteeSign placeholder (driver-side 逻辑同源, 单节点)。
async function loadEnforce() {
  try {
    const m = await import('../lib/bshard-close-enforce.mjs');
    if (typeof m.enforceCloseAttest === 'function') return m.enforceCloseAttest;
  } catch { /* J1 尚未 ship → placeholder */ }
  // placeholder: 复用 enforceCommitteeSign 的核心验 (命门①③④), 但【不自动签】(daemon 自己签)。返 {pass, verdict, reason}。
  const { enforceCommitteeSign } = await import('../lib/pool-shard-settle.mjs');
  return async function enforceCloseAttestPlaceholder(req, { rcOn, myRelayId }) {
    // ⚠ placeholder 复用 enforceCommitteeSign(它会顺便调 sign) — 仅作骨架 wiring 验, 真 enforce 待 J1 lib (含 frozen_evidence 同源 + fix① re-derive 零 caller committeePks)。
    const res = await enforceCommitteeSign({
      rcOn, committeeRelayId: myRelayId, txSafeJson: req.txSafeJson, claimedPayoutRoot: req.claimedPayoutRoot,
      predicate: req.predicate, psRedeemHex: req.psRedeemHex, p2sh: req._p2sh, frozenFields: req.proposed_evidence,
      bettors: req._bettors || [], feeBps: 0, feeParams: req._feeParams || null,
    });
    return { pass: !!res.ok, reason: res.reason, verdict: res.verdict, _signature: res.signature };
  };
}

export function startBshardCloseVoterCron() {
  if (timer) return;
  setTimeout(() => { bshardCloseVoterTick().catch(e => console.error('[bshard-close-voter] startup tick:', e.message)); }, 5_000);
  timer = setInterval(() => { bshardCloseVoterTick().catch(e => console.error('[bshard-close-voter] tick:', e.message)); }, TICK_MS);
  console.log(`[bshard-close-voter] cron started (${TICK_MS / 1000}s tick)`);
}
export function stopBshardCloseVoterCron() { if (timer) { clearInterval(timer); timer = null; } }

export async function bshardCloseVoterTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const voterRelays = sqlite.prepare(`SELECT id, name, address FROM relay_nodes WHERE is_oracle = 1`).all();
    if (!voterRelays.length) return { ok: true, voters: 0 };
    const enforceCloseAttest = await loadEnforce();
    let signed = 0, skipped = 0, refused = 0, errored = 0;
    // pending close-request: v0.7 市场 status='collecting_sigs' + metadata.bshard_close_request 存在 + deadline 内。
    const pending = sqlite.prepare(`
      SELECT id, metadata, pool_merkle_root, broker_pk, deadline_daa, resolution_rule_spec
      FROM pool_markets
      WHERE protocol_version = 'v0.7' AND protocol_status = 'collecting_sigs' AND metadata LIKE '%bshard_close_request%'
    `).all();
    for (const market of pending) {
      let req;
      try { req = JSON.parse(market.metadata || '{}').bshard_close_request; } catch { continue; }
      if (!req || !req.txSafeJson || !req.committee_pks) { skipped++; continue; }
      for (const voter of voterRelays) {
        const r = await processCloseRequest(voter, market, req, enforceCloseAttest);
        if (r.signed) signed++; else if (r.refused) refused++; else if (r.errored) errored++; else skipped++;
      }
    }
    if (signed || refused || errored) console.log(`[bshard-close-voter] tick: ${pending.length} pending | signed=${signed} refused=${refused} skipped=${skipped} errored=${errored}`);
    return { ok: true, pending: pending.length, signed, refused, skipped, errored };
  } finally { running = false; }
}

async function processCloseRequest(voter, market, req, enforceCloseAttest) {
  try {
    // 1. 本节点是该 close 的委员? get_pubkey 比 committee_pks。否则 not-my-business。
    let voterPk;
    try { voterPk = String((await sendCommandAsync(voter.id, { type: 'get_pubkey' }))?.x_only_pubkey || '').toLowerCase(); } catch { return { errored: true }; }
    if (!voterPk || voterPk.length !== 64) return { skipped: true };
    const committeePks = (req.committee_pks || []).map(p => String(p).toLowerCase());
    if (!committeePks.includes(voterPk)) return { skipped: true };   // 不是我这节点的委员

    // 2. 已签? (防双签, 同 handleTxSignReq pattern) — chain_events 'bshard_close_sig' from 本 voter for this market+payoutRoot.
    const already = sqlite.prepare(`
      SELECT id FROM chain_events WHERE event_type = 'bshard_close_sig' AND from_address = ?
        AND payload LIKE ? AND payload LIKE ? LIMIT 1
    `).get(voter.address, `%"market_id":"${market.id}"%`, `%"payout_root":"${req.claimedPayoutRoot}"%`);
    if (already) return { skipped: true };

    // 3. 自治 enforce: 全 PASS 才签 (J1 lib: 命门①③④ + frozen_evidence 同源 + fix① 委员链锚 re-derive 零 caller committeePks)。
    const rcOn = async (relayId, cmd, t = 90000) => await sendCommandAsync(relayId, cmd, t);
    const verdict = await enforceCloseAttest({ ...req, committee_pk: voterPk }, { rcOn, myRelayId: voter.id });
    if (!verdict?.pass) {
      // abstain-not-guess: 弃签不广播 (settler 偷不了; liveness 兜底 = quorum-timeout-refund 在 settler 侧)。
      return { refused: true, reason: verdict?.reason };
    }

    // 4. PASS → 本节点 relay 签 (placeholder 已签则复用其 sig; 真 enforceCloseAttest 不签, daemon 在此签)。
    let signature = verdict._signature;
    if (!signature) {
      const sj = await sendCommandAsync(voter.id, { type: 'sign_input_for_settle', tx_hex: req.txSafeJson, input_index: req.input_index ?? 0, safe_json: true });
      if (!sj?.signature) return { errored: true, reason: `sign_input_for_settle no sig: ${JSON.stringify(sj).slice(0, 80)}` };
      signature = sj.signature;
    }

    // 5. 写 sig 进 chain_events 'bshard_close_sig' (settler 收 ≥4 → submit close_attest)。
    const payload = JSON.stringify({ t: 'bshard_close_sig', market_id: market.id, committee_pk: voterPk, payout_root: req.claimedPayoutRoot, input_index: req.input_index ?? 0, idx: req.idx, siblings_hex: req.siblings_hex, signature, verdict: verdict.verdict });
    const synthTxid = `bshard_close_sig:${voter.id.slice(0, 8)}:${market.id.slice(-6)}:${String(req.claimedPayoutRoot).slice(0, 8)}`;
    sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, is_public) VALUES (?, ?, 'bshard_close_sig', ?, ?, 1)`)
      .run(synthTxid, voter.address, payload, voter.id);
    console.log(`[bshard-close-voter] ✅ ${voter.name} 自治 enforce PASS (verdict=${verdict.verdict}) → 签 close_attest market=${market.id.slice(-8)}`);
    return { signed: true };
  } catch (e) {
    return { errored: true, reason: e.message };
  }
}
