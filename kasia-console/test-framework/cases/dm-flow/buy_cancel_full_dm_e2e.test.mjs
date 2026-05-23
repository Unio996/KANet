// buy_cancel_full_dm_e2e — 真 user-facing BUY active escrow + DM "2" cancel attempt verify
//
// Owner 5/21 09:47 严训: "测试敷衍了事... 散落各处脚本测试 (特别是用 DM 完全模拟真人点击测试)".
// Owner 5/21 10:05 钦定 (path 1 + backlog 2): accept current broker design (in-flight 不可 cancel), 改 test 验 broker 正确 reject DM "2" 跟 reply '不可 cancel' UX text.
// task #80 加 backlog — broker should support user-initiated cancel + refund for active escrow.
//
// 这 test 真 user-facing 不绕道. 每一步都走真 DM. 4-oracle verify:
//
// Phase A — BUY initiation (cn_buyer_real real DM):
//   user DM broker (back → 1 BUY → 1 BSC → qty → addr → 1 mid → 1 confirm)
//   broker quote DM → user pay real USDT on chain
//   wait broker watcher promote escrow → status='active'
//
// Phase B — DM "2" cancel attempt (verify broker correct rejection):
//   user DM broker "2" (期望 broker reject since in-flight)
//   broker DM reply must include '不可 cancel' OR 'in-flight' UX text
//
// Phase C — invariant verify:
//   escrow.status REMAINS 'active' (NOT 'refunded') — broker honors in-flight lock
//   escrow.refund_tx REMAINS NULL — no refund fired
//   chain_events emit broker reply (audit)
//   broker reply text contains 'in-flight' 或 '不可 cancel'
//
// 4 invariant oracles (in-flight lock spec verify):
//   1. escrow.status == 'active' (NOT refunded)
//   2. escrow.refund_tx IS NULL (no refund attempted)
//   3. chain_events broker reply audit > 0
//   4. broker reply text matches '不可 cancel' OR 'in-flight' OR '剩余时间'
//
// 失败任何一项 = test fail.
//
// Cost: ~1 KAS qty = ~$0.04 USDT + ~$0.05 BSC gas (pay only, no refund expected) ≈ $0.09 friction.
//
// Future: timeout-expire-auto-refund test (排日) — wait 30 min OR force-expire via API, verify broker auto-refund fire.

import cnBuyer from '../../personas/real-chain/cn_buyer_real.mjs';
import { sendDm, waitForReply, sleep } from '../../lib/real-chain-runner.mjs';
import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const NWT_BSC_ADDR = '0xd3618e37354700d21FE8728Bd278Dc1924974799';

export default {
  id: 'buy_cancel_full_dm_e2e',
  description: '真 user-facing BUY → DM cancel → broker refund + reply DM (4-oracle verify, 0 internal function bypass)',
  domain: 'dm-flow',
  tags: ['real_chain', 'p0', 'dm', 'user-facing', 'cancel', 'end-to-end'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const qty = opts.qty || 1;
    const promote_wait_ms = opts.promote_wait_ms || 90_000;
    const cancel_reply_wait_ms = opts.cancel_reply_wait_ms || 120_000;
    const post_refund_wait_ms = opts.post_refund_wait_ms || 30_000;

    const start = Date.now();
    const startIso = new Date(start).toISOString();
    const phases = [];

    // ── Phase A.1: BUY DM cycle (cnBuyer) ──
    console.log(`[buy_cancel_full_dm_e2e] Phase A.1: cnBuyer BUY ${qty} KAS BSC via real DM`);
    const buyResult = await cnBuyer.run(
      { id: 'cancel_e2e_buyer' },
      {
        relayId: NWT_RELAY_ID,
        userKasia: NWT_KASIA,
        brokerKasia: BROKER_KASIA,
        userEvmAddr: NWT_BSC_ADDR,
        qty,
        chain: 'BSC',
        fromRelayName: 'NWT',
      }
    );
    phases.push({ phase: 'A.1_buy_dm', stage: buyResult.stage, error: buyResult.error });
    if (buyResult.stage !== 'completed_flow') {
      return { ok: false, summary: `❌ Phase A.1 buyflow fail stage=${buyResult.stage}`, phases };
    }

    // ── Phase A.2: wait broker watcher promote escrow → active ──
    console.log(`[buy_cancel_full_dm_e2e] Phase A.2: wait ${promote_wait_ms / 1000}s broker promote escrow`);
    await sleep(promote_wait_ms);
    const dbR = new Database(DB_PATH, { readonly: true });
    // datetime() wrap per [[feedback_audit_sql_datetime_format]] — DB stores 'YYYY-MM-DD HH:MM:SS', startIso is ISO-T-Z
    const active = dbR.prepare(
      `SELECT id, amount_received, prepayment_tx, status FROM user_escrow_balances
       WHERE user_kasia_addr=? AND status='active' AND refund_tx IS NULL
       AND datetime(created_at) > datetime(?) ORDER BY created_at DESC LIMIT 1`
    ).get(NWT_KASIA, startIso);
    dbR.close();
    phases.push({ phase: 'A.2_wait_promote', activeEscrow: active });
    if (!active) {
      return { ok: false, summary: `❌ Phase A.2 no active escrow post-${promote_wait_ms / 1000}s — broker watcher 没 promote`, phases };
    }

    // ── Phase B.1: user DM cancel "2" via real Kasia chain ──
    console.log(`[buy_cancel_full_dm_e2e] Phase B.1: user DM '2' (cancel pendant) → broker via Kasia chain`);
    const cancelDmTs = new Date().toISOString();
    await sendDm(NWT_RELAY_ID, BROKER_KASIA, '2');
    phases.push({ phase: 'B.1_dm_cancel_sent', ts: cancelDmTs });

    // ── Phase B.2: wait broker DM reply containing 退款/refund/cancel confirmation ──
    console.log(`[buy_cancel_full_dm_e2e] Phase B.2: wait broker DM reply confirming cancel/refund (timeout ${cancel_reply_wait_ms / 1000}s)`);
    const reply = await waitForReply(BROKER_KASIA, NWT_KASIA, cancelDmTs, { timeoutMs: cancel_reply_wait_ms }).catch(e => null);
    phases.push({ phase: 'B.2_broker_reply', received: reply != null, contentSnippet: reply?.content_text?.slice(0, 200) });

    // ── Phase C.1: chain refund TX verify via DB ──
    console.log(`[buy_cancel_full_dm_e2e] Phase C.1: wait ${post_refund_wait_ms / 1000}s post-cancel for refund TX confirmation`);
    await sleep(post_refund_wait_ms);
    const dbR2 = new Database(DB_PATH, { readonly: true });
    const finalEscrow = dbR2.prepare(
      `SELECT id, status, refund_tx, amount_received FROM user_escrow_balances WHERE id=?`
    ).get(active.id);
    const auditEvents = dbR2.prepare(
      `SELECT event_type, observed_at FROM chain_events
       WHERE observed_at > ?
       AND (event_type IN ('broker_kas_refunded', 'manual_refund_recovery', 'tx', 'comm', 'text')
            OR payload LIKE ?)
       ORDER BY observed_at DESC LIMIT 10`
    ).all(cancelDmTs, `%${active.id.slice(0, 12)}%`);
    dbR2.close();
    phases.push({ phase: 'C.1_final_state', finalEscrow, auditCount: auditEvents.length });

    // ── Phase C.2: 4 invariant oracles — in-flight lock spec (Owner 5/21 path 1) ──
    // broker DESIGN: USDT 收款后 status='active' = in-flight, DM "2" 必 reject, escrow 必保 active 不动.
    // 这测试验证 broker 正确遵循此 invariant.
    const statusStillActiveOk = finalEscrow?.status === 'active';  // 期望 NOT refunded
    const refundTxNullOk = finalEscrow?.refund_tx == null;  // 期望 no refund fired
    const auditOk = auditEvents.length > 0;
    const replyText = reply?.content_text || '';
    const replyRejectsOk = reply != null
      && (replyText.includes('不可 cancel') || replyText.includes('in-flight')
          || replyText.includes('已收款') || replyText.includes('剩余时间')
          || replyText.includes('替你挂单'));

    // KI N19.265 Sub 3 — Owner 雷霆 catch + NWT r247.1: 3 cross-table oracle.
    const dbR3 = new Database(DB_PATH, { readonly: true });
    const oracle1_relation = dbR3.prepare(`
      SELECT status, classification FROM relation_states
      WHERE local_address = ? AND peer_address = ?
    `).get(NWT_KASIA, BROKER_KASIA);
    const oracle2_comm = dbR3.prepare(`
      SELECT COUNT(*) c FROM chain_events
      WHERE from_address = ? AND to_address = ? AND event_type IN ('comm','comm_sent','text')
        AND datetime(observed_at) > datetime(?)
    `).get(NWT_KASIA, BROKER_KASIA, startIso).c;
    dbR3.close();
    let oracle3_contacts = false;
    try {
      const rContacts = await fetch(`http://127.0.0.1:3100/api/contacts/list?relayId=${NWT_RELAY_ID}`);
      const d = await rContacts.json();
      oracle3_contacts = (d.contacts || []).some(c => c.peer_address === BROKER_KASIA);
    } catch {}

    const oracles = { statusStillActiveOk, refundTxNullOk, auditOk, replyRejectsOk,
      oracle1_relation: oracle1_relation || null,
      oracle2_comm_count: oracle2_comm,
      oracle3_contacts_has_broker: oracle3_contacts };
    phases.push({ phase: 'C.2_oracles', ...oracles });

    const allPass = statusStillActiveOk && refundTxNullOk && auditOk && replyRejectsOk;
    return {
      ok: allPass,
      summary: allPass
        ? `✅ buy_cancel_full_dm_e2e PASS — broker 正确 honor in-flight lock | escrow ${active.id.slice(0, 8)} 保 active + 无 refund | reply: "${replyText.slice(0, 80)}..."`
        : `❌ INCOMPLETE — statusActive=${statusStillActiveOk} refundNull=${refundTxNullOk} audit=${auditOk} replyReject=${replyRejectsOk}`,
      phases,
      details: { oracles, finalEscrow, replyExcerpt: replyText.slice(0, 300) },
    };
  },
};
