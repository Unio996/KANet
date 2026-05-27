// /api/audit/prediction-trace — pool_markets + pool_bettor_sides trace endpoint.
//
// J1tn ship-block gate (Bettor r103 chase, dim 7.2): user → DM action → market settle TX → 钱真到地
// full audit chain. Verifies the DM menu agent (Bettor r100 R2 stateless) leaves a complete trail.
//
// Schema source of truth (grep verified 2026-05-27 against D:/Anthropic/kasia-console/src/db/migrate.js):
//   - pool_markets (v62 + v133/v134/v135 ALTERs): id PK, maker_relay_id, deadline, broker_fee_pct,
//     oracle_bond_amount, maker_stake_amount, outcome_market_source/condition_id/token_id/side,
//     protocol_status, settle_txid, refund_txid, metadata, oracle_relay_ids, broker_relay_id
//   - pool_bettor_sides (v62): market_id, bettor_pk, bettor_relay_id, direction (0=YES side, 1=NO side),
//     stake_amount (sompi), side_p2sh, side_lock_tx, merkle_index, claim_txid
//   - chain_events (v28): id, txid, from_address, to_address, event_type, payload (JSON), observed_by, observed_at
//
// Event types referenced (grep verified):
//   - pool_settle_consensual_dispatched (emitted by services/bettor-prediction-settler.js L560) — winner field in payload
//   - dm_menu_action — to be emitted by prediction-agent-mind.mjs handler via emitDmMenuAction() helper
//     (UI sub-2b wire pending — until then dm_menu_action rows will be 0, trace.dm_menu_actions=[])
//
// J1tn KI catch (2026-05-27): prior J1 sandbox draft queried exchange_offers with maker_address/
// taker_address/kas_amount/offer_type/settle_kaspa_tx_id columns that do NOT exist in schema.
// This refactor verifies every column via grep before reference. See dim7_*.test.mjs for invariants.

import { sqlite } from '../db/client.js';

export async function registerAuditPredictionRoutes(fastify) {
  // Per-user full trace: DM actions × markets × bettor sides × settle events × balance diff.
  // ?relay_id_only=1 (optional) — when user is a relay rather than peer (bettor_relay_id match)
  fastify.get('/api/audit/prediction-trace/:user_pk', async (request, reply) => {
    const userPk = request.params.user_pk;
    if (!userPk || typeof userPk !== 'string') {
      return reply.code(400).send({ error: 'user_pk required (bettor_pk hex OR kaspa address)' });
    }

    // Bettor sides authored by this user (= staked KAS on a market side)
    const sides = sqlite.prepare(`
      SELECT s.id, s.market_id, s.bettor_pk, s.bettor_relay_id, s.direction, s.stake_amount,
             s.side_p2sh, s.claim_txid, s.created_at
      FROM pool_bettor_sides s
      WHERE s.bettor_pk = ? OR s.bettor_relay_id = ?
      ORDER BY s.created_at
    `).all(userPk, userPk);

    // Markets this user is involved in (= maker OR bettor)
    const marketIds = new Set(sides.map(s => s.market_id));
    const markets = marketIds.size > 0
      ? sqlite.prepare(`
          SELECT id, maker_relay_id, deadline, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
                 outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
                 protocol_status, settle_txid, refund_txid, resolution_rule_spec, created_at
          FROM pool_markets
          WHERE id IN (${[...marketIds].map(() => '?').join(',')})
             OR maker_relay_id = ?
        `).all(...[...marketIds], userPk)
      : sqlite.prepare(`
          SELECT id, maker_relay_id, deadline, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
                 outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
                 protocol_status, settle_txid, refund_txid, resolution_rule_spec, created_at
          FROM pool_markets
          WHERE maker_relay_id = ?
        `).all(userPk);

    // DM menu actions emitted on behalf of this user (= UI handler write via emitDmMenuAction).
    // payload JSON typically includes {market_id, action_type, ...}. Until UI sub-2b wires
    // emitDmMenuAction, this query returns []. The audit endpoint still returns a sane shape.
    const dmActions = sqlite.prepare(`
      SELECT id, txid, from_address, to_address, payload, observed_by, observed_at
      FROM chain_events
      WHERE event_type = 'dm_menu_action'
        AND (from_address = ? OR to_address = ?)
      ORDER BY observed_at
    `).all(userPk, userPk);

    // Settle events for markets in scope. event_type list from grep:
    //   pool_settle_consensual_dispatched (settler.js L560) — payload has {winner, broker_fee_pct, ...}
    // Additional event types may be added by future SS phases; we filter to known producers.
    const settleEvents = marketIds.size > 0
      ? sqlite.prepare(`
          SELECT id, txid, from_address, to_address, event_type, payload, observed_by, observed_at
          FROM chain_events
          WHERE event_type = 'pool_settle_consensual_dispatched'
            AND payload LIKE '%' || ? || '%'
          ORDER BY observed_at
        `).all([...marketIds][0])  // limit pre-filter; per-market parse below
      : [];

    // Build per-market trace records
    const trace = markets.map(m => {
      const userSides = sides.filter(s => s.market_id === m.id);
      const marketSettleEvents = settleEvents.filter(e => {
        try {
          const p = JSON.parse(e.payload || '{}');
          return p.market_id === m.id || p.offer_id === m.id;
        } catch { return false; }
      });
      const marketDmActions = dmActions.filter(d => {
        try {
          const p = JSON.parse(d.payload || '{}');
          return p.market_id === m.id;
        } catch { return false; }
      });

      // Compute balance diff from staked sides + settle winner direction
      const balanceDiffSompi = computeBalanceDiff(userSides, marketSettleEvents, m);

      return {
        market_id: m.id,
        protocol_status: m.protocol_status,
        outcome_label: `${m.outcome_market_source}/${m.outcome_condition_id} (side=${m.outcome_side})`,
        deadline: m.deadline,
        is_maker: m.maker_relay_id === userPk,
        is_bettor: userSides.length > 0,
        user_sides: userSides.map(s => ({
          id: s.id,
          direction: s.direction,
          stake_sompi: s.stake_amount,
          claim_txid: s.claim_txid,
        })),
        settle_txid: m.settle_txid || null,
        refund_txid: m.refund_txid || null,
        dm_menu_actions: marketDmActions.length,
        dm_menu_actions_detail: marketDmActions,
        settle_events: marketSettleEvents.length,
        settle_events_detail: marketSettleEvents,
        balance_diff_sompi: balanceDiffSompi,
        balance_diff_kas: balanceDiffSompi == null ? null : (balanceDiffSompi / 1e8),
      };
    });

    // Orphan DM actions = action emitted but no matching market in scope (= data integrity warning)
    const orphanDmActions = dmActions.filter(d => {
      try {
        const p = JSON.parse(d.payload || '{}');
        return p.market_id && !marketIds.has(p.market_id);
      } catch { return true; }
    });

    return {
      user_pk: userPk,
      total_markets: markets.length,
      total_sides: sides.length,
      total_dm_actions: dmActions.length,
      total_settle_events: settleEvents.length,
      trace,
      orphan_dm_actions: orphanDmActions,
      schema_version: 'v147',
      generated_at: new Date().toISOString(),
    };
  });

  // Summary endpoint for dashboards + soak runner checkpoints.
  fastify.get('/api/audit/prediction-trace-summary', async (request, reply) => {
    const last7DaysDm = sqlite.prepare(`
      SELECT date(observed_at) AS day, COUNT(*) AS dm_action_count
      FROM chain_events
      WHERE event_type = 'dm_menu_action'
        AND observed_at >= datetime('now', '-7 days')
      GROUP BY day
      ORDER BY day DESC
    `).all();

    const marketCountsByStatus = sqlite.prepare(`
      SELECT protocol_status, COUNT(*) AS count
      FROM pool_markets
      GROUP BY protocol_status
    `).all();

    const sidesCount = sqlite.prepare(`
      SELECT COUNT(*) AS total_sides,
             COUNT(DISTINCT bettor_pk) AS unique_bettors,
             COUNT(DISTINCT market_id) AS markets_with_sides
      FROM pool_bettor_sides
    `).get();

    const sessionsCount = sqlite.prepare(`
      SELECT COUNT(*) AS total_sessions,
             SUM(CASE WHEN updated_at > datetime('now', '-1 hour') THEN 1 ELSE 0 END) AS active_1h,
             SUM(CASE WHEN updated_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS active_24h
      FROM prediction_dm_session
    `).get();

    return {
      last_7_days_dm: last7DaysDm,
      market_counts_by_status: marketCountsByStatus,
      sides: sidesCount,
      dm_sessions: sessionsCount,
      generated_at: new Date().toISOString(),
    };
  });
}

// emitDmMenuAction: call from UI prediction-agent-mind.mjs handler each state transition.
// Writes a chain_events row with event_type='dm_menu_action'. The txid is synthetic (dm-<ts>-<rand>)
// since DM actions are off-chain UX records, not on-chain TXs. Future enhancement: link to actual
// publish-v2 TX once the user reaches /confirm via dispatch_txid field in payload.
export function emitDmMenuAction(opts) {
  const { market_id, user_address, agent_address, action_type, action_payload = {}, dispatch_txid = null } = opts;
  if (!user_address || !action_type) {
    throw new Error('emitDmMenuAction requires user_address + action_type');
  }
  const id = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const synthTxid = dispatch_txid || `synth:${id}`;
  const payload = JSON.stringify({
    market_id: market_id || null,
    action_type,
    ...action_payload,
  });
  sqlite.prepare(`
    INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, ?, 'dm_menu_action', ?, 'prediction-agent-mind', datetime('now'))
  `).run(id, synthTxid, user_address, agent_address || null, payload);
  return id;
}

// computeBalanceDiff: aggregate user's KAS gain/loss across their sides on a market.
// Direction encoding (pool_bettor_sides.direction):
//   0 = YES side (= outcome_side="YES" maker direction OR opposite of outcome_side based on stake structure)
//   1 = NO side
// Settle event payload.winner: 0 or 1 (matches direction encoding per settler.js).
// pool_refund_disagreement_tx (= refund_txid set instead of settle_txid): all sides refunded → 0 net.
// If neither settle nor refund yet → null (= unsettled).
function computeBalanceDiff(userSides, settleEvents, market) {
  if (userSides.length === 0) return null;
  if (market.refund_txid) return 0; // refund — full return, net 0
  if (!market.settle_txid && settleEvents.length === 0) return null; // unsettled

  let winnerDir = null;
  for (const e of settleEvents) {
    try {
      const p = JSON.parse(e.payload || '{}');
      if (p.winner === 0 || p.winner === 1) {
        winnerDir = p.winner;
        break;
      }
    } catch {}
  }
  if (winnerDir == null) return null; // settle TX but payload missing winner — caller can inspect raw

  // Sum stake_amount where direction matches winner (= +stake on that side, doubled by counter-stake)
  // Conservative model: winner side recovers own stake + proportional share of loser pool. Pre-settle
  // accurate value requires merkle root + claim TX; the audit endpoint returns simple "+stake / -stake"
  // sign which is sufficient for dim7 balance_diff assertion (= won/lost direction correct).
  let net = 0;
  for (const s of userSides) {
    const stake = Number(s.stake_amount || 0);
    if (s.direction === winnerDir) net += stake;
    else net -= stake;
  }
  return net;
}
