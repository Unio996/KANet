// Oracle pool seed endpoint (Bettor r50 testnet 解锁): seed is_oracle relays into
// oracle_pool_membership with nominal stake. This unblocks v0.6 committee selection
// + settle e2e on testnet. NOT dispute-slash e2e — that needs chain-locked stake
// (= Phase 2 proper join+stake sub, Bettor r50 2/2 待 spec).
//
// 5 铁律:
// ① user-need: J1 r145 8-step e2e + UI Gap 2 批 2 dispute infra 都 block 在池空 (NWT r114)
// ② 必要: 池空 = v0.6 sample fail = path A live e2e impossible
// ③ 不重复: /api/oracles 是 READ; /api/oracle/announce 仅置 is_oracle flag 无 stake;
//   J2.1 v159 oracle_pool_membership 表无写入路径. 这填 explicit 缺口.
// ④ 充分理由: Bettor r50 2/2 explicit "出 seed 脚本/临时 endpoint" 钦定
// ⑤ 简单高效: 1 endpoint POST + 1 endpoint GET (state) + verifyIngestRequest 鉴权
//
// Bettor r50 explicit: testnet seed; stake 不上链 = 仅 selection+settle e2e 可测,
// dispute-slash e2e 须等 Phase 2 链上锁. 文档化在 response 里.

import { sqlite } from '../db/client.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { sendCommandAsync } from '../services/relay-manager.js';

export async function registerOraclePoolRoutes(fastify) {
  // POST /api/oracle-pool/seed — testnet bootstrap: add is_oracle relays to pool with nominal stake.
  // Body: { relay_ids?: [string], nominal_stake_kas?: number, dry_run?: boolean }
  //   - If relay_ids omitted: all relay_nodes WHERE is_oracle=1
  //   - Default nominal_stake_kas = 1 (= testnet nominal)
  //   - dry_run: returns what WOULD be inserted, no DB write
  fastify.post('/api/oracle-pool/seed', { preHandler: async (req, rep) => { await verifyIngestRequest(req, rep); } }, async (request, reply) => {
    const { relay_ids, nominal_stake_kas = 1, dry_run = false } = request.body || {};
    const stakeKas = Number(nominal_stake_kas);
    if (!Number.isFinite(stakeKas) || stakeKas <= 0) {
      return reply.code(400).send({ ok: false, error: 'nominal_stake_kas must be positive number' });
    }

    let candidates;
    if (Array.isArray(relay_ids) && relay_ids.length > 0) {
      const placeholders = relay_ids.map(() => '?').join(',');
      candidates = sqlite.prepare(
        `SELECT id, name, address FROM relay_nodes WHERE id IN (${placeholders})`
      ).all(...relay_ids);
    } else {
      candidates = sqlite.prepare(
        'SELECT id, name, address FROM relay_nodes WHERE is_oracle = 1'
      ).all();
    }

    if (candidates.length === 0) {
      return reply.code(400).send({ ok: false, error: 'no oracle candidates found (= no relay_nodes WHERE is_oracle=1; OR provided relay_ids empty)' });
    }

    // Resolve oracle_pk for each via relay get_pubkey IPC
    const resolved = [];
    const failures = [];
    for (const c of candidates) {
      try {
        const r = await sendCommandAsync(c.id, { type: 'get_pubkey' });
        const pk = r?.x_only_pubkey;
        if (!pk || pk.length !== 64) {
          failures.push({ relay_id: c.id, name: c.name, reason: `get_pubkey returned invalid pk: ${pk}` });
          continue;
        }
        resolved.push({ relay_id: c.id, name: c.name, oracle_pk: pk });
      } catch (e) {
        failures.push({ relay_id: c.id, name: c.name, reason: `get_pubkey IPC fail: ${e.message}` });
      }
    }

    if (dry_run) {
      return reply.send({
        ok: true,
        dry_run: true,
        nominal_stake_kas: stakeKas,
        would_insert: resolved.length,
        would_skip: failures.length,
        resolved,
        failures,
      });
    }

    const insertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO oracle_pool_membership
        (relay_id, oracle_pk, stake_locked_kas, joined_at, active)
      VALUES (?, ?, ?, COALESCE((SELECT joined_at FROM oracle_pool_membership WHERE relay_id = ?), CURRENT_TIMESTAMP), 1)
    `);
    let inserted = 0;
    const errors = [];
    for (const r of resolved) {
      try {
        insertStmt.run(r.relay_id, r.oracle_pk, stakeKas, r.relay_id);
        inserted += 1;
      } catch (e) {
        errors.push({ relay_id: r.relay_id, name: r.name, reason: e.message });
      }
    }

    return reply.send({
      ok: true,
      seeded: inserted,
      skipped_get_pubkey_fail: failures.length,
      skipped_insert_fail: errors.length,
      nominal_stake_kas: stakeKas,
      stake_anchor: 'testnet-seed-nominal',
      disclaimer: 'Stake NOT chain-locked. selection+settle e2e可测, dispute-slash e2e 待 Phase 2 chain-locked stake sub.',
      members: resolved,
      failures,
      insert_errors: errors,
    });
  });

  // GET /api/oracle-pool/state — current pool snapshot for UI/diagnostics
  fastify.get('/api/oracle-pool/state', async (request, reply) => {
    const rows = sqlite.prepare(`
      SELECT m.relay_id, m.oracle_pk, m.stake_locked_kas, m.joined_at, m.active,
             m.stake_unlock_requested_at, r.name
      FROM oracle_pool_membership m
      LEFT JOIN relay_nodes r ON r.id = m.relay_id
      ORDER BY m.stake_locked_kas DESC
    `).all();
    const activeRows = rows.filter(r => r.active === 1);
    const totalStakeKas = activeRows.reduce((s, r) => s + Number(r.stake_locked_kas || 0), 0);
    return reply.send({
      ok: true,
      total_members: rows.length,
      active_members: activeRows.length,
      total_active_stake_kas: totalStakeKas.toFixed(8),
      members: rows,
    });
  });
}
