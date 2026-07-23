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
import { sendBroadcastChunked } from '../lib/pool-broadcast.mjs';

// Path A enroll-via-broadcast (J2-tn r301 5-agent 共识): scanAndDerivePool 当前读
// 本地 oracle_stake_enrollments 表 = 跨节点同 chain state 但表内容不同 → poolMerkleRoot 分歧.
// 路 A 修法: 每笔 enrollment 上链广播 `oracle_stake_enroll_v1` envelope, trade-protocol-filter
// 消费 → INSERT chain_events + UPSERT oracle_stake_enrollments source='chain_envelope'.
// 跨节点同 chain state 同 chain_events 同表内容 → poolMerkleRoot 收敛.
//
// 签名: staker_pk_x 自家 wallet 签 envelope (= 防伪造 enrollment). signing_relay_id 必须 IPC
// get_pubkey 返与 staker_pk_x 同值, 否则 endpoint reject.
async function _broadcastOracleStakeEnroll({ stakerPkX, lockUntilDaa, p2shAddr, signingRelayId }) {
  // 1. Verify signing relay's pubkey matches staker_pk_x (= owner sig 不能被代签).
  const pkRes = await sendCommandAsync(signingRelayId, { type: 'get_pubkey' }, undefined, 'legacy-unmigrated');
  const signerPk = String(pkRes?.x_only_pubkey || '').toLowerCase();
  if (!signerPk || signerPk.length !== 64) throw new Error(`signing relay get_pubkey invalid: ${signerPk}`);
  if (signerPk !== stakerPkX.toLowerCase()) {
    throw new Error(`signing_relay_id pubkey mismatch: signer=${signerPk.slice(0,12)} stakerPkX=${stakerPkX.slice(0,12)}`);
  }

  // J2-tn r337 (Bettor 6/5 终裁 C1 实施): envelope 扩 relay_address 字段 (= 跨节点 PK→address
  // 单一链源, settler 替代本地 relay_id 路 DM sign_req). Staker 签名 over JSON 含 address
  // → 防伪 address 冒充. NWT L12 lint 守.
  const relayRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(signingRelayId);
  const relayAddress = relayRow?.address;
  if (!relayAddress) throw new Error(`signing_relay_id ${signingRelayId.slice(0,8)} has no resolvable address in relay_nodes`);

  // 2. Build envelope (sig over JSON minus signature, mirror pool_market_published_v1 pattern).
  const unsignedPayload = {
    t: 'oracle_stake_enroll_v1',
    staker_pk_x: stakerPkX.toLowerCase(),
    lock_until_daa: lockUntilDaa,
    p2sh_addr: p2shAddr,
    relay_address: relayAddress,  // J2-tn r337: cross-node DM target
    enrolled_at: new Date().toISOString(),
  };
  const messageToSign = JSON.stringify(unsignedPayload);
  const signResult = await sendCommandAsync(signingRelayId, { type: 'ecdsa_sign', message: messageToSign }, undefined, 'legacy-unmigrated');
  const signature = signResult?.signature;
  if (!signature) throw new Error('ecdsa_sign returned empty');

  // 3. Chunked broadcast on kanet-prediction channel (= same channel as market/vote envelopes).
  const payloadStr = JSON.stringify({ ...unsignedPayload, signature });
  const bcastResult = await sendBroadcastChunked(signingRelayId, 'kanet-prediction', payloadStr);
  const txId = bcastResult?.txId;
  if (!txId) throw new Error(`broadcast no txId: ${JSON.stringify(bcastResult).slice(0, 200)}`);
  console.log(`[oracle-pool/broadcast] enroll staker=${stakerPkX.slice(0,12)} lock=${lockUntilDaa} txId=${txId.slice(0, 16)}...`);
  return { ok: true, txId };
}

// 问3 (a) withdraw broadcast (mirror enroll): staker-signed oracle_stake_withdraw_v1 envelope on kanet-prediction.
// EVERY node (incl this one) ingests it (trade-protocol-filter handleOracleStakeWithdraw) → sets active=0 in
// lockstep = the CROSS-NODE-CONVERGENT pool removal (NOT a node-local UPDATE = #22 active-flag divergence).
async function _broadcastOracleStakeWithdraw({ stakerPkX, signingRelayId }) {
  const pkRes = await sendCommandAsync(signingRelayId, { type: 'get_pubkey' }, undefined, 'legacy-unmigrated');
  const signerPk = String(pkRes?.x_only_pubkey || '').toLowerCase();
  if (!signerPk || signerPk.length !== 64) throw new Error(`signing relay get_pubkey invalid: ${signerPk}`);
  if (signerPk !== stakerPkX.toLowerCase()) {
    throw new Error(`signing_relay_id pubkey mismatch: signer=${signerPk.slice(0,12)} stakerPkX=${stakerPkX.slice(0,12)}`);
  }
  const unsignedPayload = {
    t: 'oracle_stake_withdraw_v1',
    staker_pk_x: stakerPkX.toLowerCase(),
    withdrawn_at: new Date().toISOString(),
  };
  const messageToSign = JSON.stringify(unsignedPayload);
  const signResult = await sendCommandAsync(signingRelayId, { type: 'ecdsa_sign', message: messageToSign }, undefined, 'legacy-unmigrated');
  const signature = signResult?.signature;
  if (!signature) throw new Error('ecdsa_sign returned empty');
  const payloadStr = JSON.stringify({ ...unsignedPayload, signature });
  const bcastResult = await sendBroadcastChunked(signingRelayId, 'kanet-prediction', payloadStr);
  const txId = bcastResult?.txId;
  if (!txId) throw new Error(`broadcast no txId: ${JSON.stringify(bcastResult).slice(0, 200)}`);
  console.log(`[oracle-pool/broadcast] withdraw staker=${stakerPkX.slice(0,12)} txId=${txId.slice(0, 16)}...`);
  return { ok: true, txId };
}

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
        const r = await sendCommandAsync(c.id, { type: 'get_pubkey' }, undefined, 'legacy-unmigrated');
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

    // J2-tn r390 (#21 B Bettor ③ APPROVE 04:32): 删 INSERT 写 oracle_pool_membership 废弃表
    // (= NWT canonical decision r315: oracle_stake_enrollments is identity canonical, membership
    // 是死表 v164 已清). seed endpoint 现路径: broadcast chain envelope (= path A r301)
    // → trade-protocol-filter handleOracleStakeEnroll ingest → oracle_stake_enrollments. seed
    // DB INSERT 是早期 v159 bootstrap 残留, 现 chain envelope 已是 canonical 入口, 此 DB
    // write 是 dead writer + 双写漂移源. 删 INSERT 保 endpoint shell (= broadcast 走原路).
    // Bettor 04:32 spec aligned with my 04:20 plan, 04:33 APPROVE.
    let inserted = 0;
    const errors = [];

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

  // GET /api/oracle-pool/merkle-root — current depth-8 blake2b root from active pool members.
  // DoD #1.1 (T2 sediment): KANet-UI calls before create-v06/v07 to fetch the "right now" root
  // so caller can pass it through. Decouples derive (= read DB) from verify (= TOCTOU in
  // ensurePoolSnapshot). For testnet zero-grinding 简单 path.
  fastify.get('/api/oracle-pool/merkle-root', async (request, reply) => {
    try {
      const { derivePoolMerkleRoot } = await import('../services/pool-market-settler-v06.mjs');
      const r = derivePoolMerkleRoot();
      return reply.send({ ok: true, pool_merkle_root: r.pool_merkle_root, pool_size: r.pool_size });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // POST /api/oracle-pool/enroll — DoD §2.2 J2 step [2]: 自助 oracle enrollment.
  // Body: { staker_pk_x: 64hex, lock_until_daa: int, source?: 'manual'|'chain_envelope' }.
  // Server: derive P2SH via OracleStake_v1.sil (= same ctor → same P2SH 跨节点同源), INSERT
  // oracle_stake_enrollments row (= 注册待 oracle transfer stake 到 P2SH addr). 后续 scanner
  // 扫该 addr UTXO verify stake 实际锁链上.
  //
  // 用法: oracle CLI/UI 调此 → 拿 p2sh_addr → 自家 wallet 转 ≥1 KAS 到 p2sh_addr 锁 lockUntilDaa
  // → 等 scanner verify → snapshotDaa 之后池中含此 oracle.
  fastify.post('/api/oracle-pool/enroll', async (request, reply) => {
    const b = request.body || {};
    if (typeof b.staker_pk_x !== 'string' || !/^[0-9a-fA-F]{64}$/.test(b.staker_pk_x)) {
      return reply.code(400).send({ ok: false, error: 'staker_pk_x must be 64 hex chars' });
    }
    const lockUntilDaa = parseInt(b.lock_until_daa, 10);
    if (!Number.isFinite(lockUntilDaa) || lockUntilDaa <= 0) {
      return reply.code(400).send({ ok: false, error: 'lock_until_daa must be positive integer' });
    }
    const stakerPkX = b.staker_pk_x.toLowerCase();
    const source = b.source === 'chain_envelope' ? 'chain_envelope' : 'manual';
    const network = process.env.KASPA_NETWORK || 'testnet-12';
    // Path A J2-tn r301: caller optionally provides signing_relay_id 用于 envelope 上链签名.
    // 不提供 = skip broadcast (= 与现有 manual 路径完全兼容, 已经存在 enrollments 借用 backfill 上链).
    const signingRelayId = typeof b.signing_relay_id === 'string' ? b.signing_relay_id : null;
    // skip_broadcast: testnet 默认 false (即 enroll 完自动广播). 显式 true 跳过仅本地 INSERT.
    const skipBroadcast = b.skip_broadcast === true;

    try {
      const { computeStakeP2SH_v1 } = await import('../lib/oracle-stake-v1.mjs');
      const { p2shAddr, redeemScript, p2shHash } = await computeStakeP2SH_v1({
        stakerPkX, lockUntilDaa, network,
      });
      // Existing enrollment idempotency: re-enroll same ctor returns same addr.
      const existing = sqlite.prepare('SELECT staker_pk_x, p2sh_addr, lock_until_daa FROM oracle_stake_enrollments WHERE staker_pk_x = ?').get(stakerPkX);
      if (existing) {
        if (existing.lock_until_daa !== lockUntilDaa) {
          return reply.code(409).send({
            ok: false,
            error: `enrollment exists with different lock_until_daa (existing=${existing.lock_until_daa}, requested=${lockUntilDaa}) — must unstake + re-enroll`,
          });
        }
        // Path A J2-tn r301: 'already_enrolled' 也广播 envelope (= backfill 用此重发, 同节点
        // INSERT 早写新增 envelope 不变 DB; 跨节点 ingest 收敛 enrollments 表 source=chain_envelope).
        let rebroadcastResult = null;
        if (signingRelayId && !skipBroadcast) {
          try {
            rebroadcastResult = await _broadcastOracleStakeEnroll({
              stakerPkX, lockUntilDaa, p2shAddr: existing.p2sh_addr, signingRelayId,
            });
          } catch (bcErr) {
            console.warn(`[oracle-pool/enroll] rebroadcast fail staker=${stakerPkX.slice(0,12)}: ${bcErr.message}`);
            rebroadcastResult = { ok: false, error: bcErr.message };
          }
        }
        return reply.send({
          ok: true,
          staker_pk_x: stakerPkX,
          lock_until_daa: lockUntilDaa,
          p2sh_addr: existing.p2sh_addr,
          p2sh_hash: p2shHash,
          status: 'already_enrolled',
          broadcast: rebroadcastResult,
        });
      }
      sqlite.prepare(`
        INSERT INTO oracle_stake_enrollments
          (staker_pk_x, lock_until_daa, p2sh_addr, p2sh_hash, redeem_script_hex, source, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(stakerPkX, lockUntilDaa, p2shAddr, p2shHash, redeemScript, source);

      // Path A: 上链广播 envelope (= 同节点 ingest no-op via UNIQUE, 跨节点 ingest 收敛).
      // Best-effort: 失败 log warn 不 fail enroll (= 本地 INSERT 已写, backfill 可重试).
      let broadcastResult = null;
      if (signingRelayId && !skipBroadcast) {
        try {
          broadcastResult = await _broadcastOracleStakeEnroll({
            stakerPkX, lockUntilDaa, p2shAddr, signingRelayId,
          });
        } catch (bcErr) {
          console.warn(`[oracle-pool/enroll] broadcast fail (local INSERT done, retry via backfill): ${bcErr.message}`);
          broadcastResult = { ok: false, error: bcErr.message };
        }
      }

      return reply.send({
        ok: true,
        staker_pk_x: stakerPkX,
        lock_until_daa: lockUntilDaa,
        p2sh_addr: p2shAddr,
        p2sh_hash: p2shHash,
        redeem_script_hex: redeemScript,
        source,
        status: 'enrolled',
        broadcast: broadcastResult,
        next_step: `transfer ≥1 KAS to ${p2shAddr} with lockTime=${lockUntilDaa}; scanner 后续 verify UTXO + 入池`,
      });
    } catch (e) {
      console.error(`[oracle-pool/enroll] fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `enroll fail: ${e.message}` });
    }
  });

  // POST /api/oracle-pool/withdraw — 问3 (a) (Bettor 2026-06-15 钦定·分阶段): RECORD-level oracle 撤出.
  // 押金当前 NOT chain-locked (oracle-pool L144; 真链锁 = Phase 2 / (b)). ∴ (a) = 记录级可见撤出:
  // enrollment 置 active=0 + 写可审计 chain_event, NO 真-UTXO unlock. 铁律守 + 冷却防 gaming.
  //   - 铁律【在岗不许退】: oracle 是【未决市场 committee 在岗】时禁撤 (否则委员中途跑路卡结算).
  //   - 冷却 24h: enroll 后 24h 内禁撤 (防 enroll→vote→秒退 操纵委员选拔).
  // ⚠ determinism follow-up: active flag 是 node-local; oracle 池(未来市场 snapshot)从 active enrollments
  //   派生 → 撤出须跨节点一致才不致未来市场池分歧. 在飞市场用【create 时冻结的 pool_snapshots】不受影响
  //   (determinism-safe). 跨节点收敛 = 广播 withdraw envelope (mirror enroll, 待 (a) 验收后补, 同 enroll
  //   的 chain_envelope 收敛路) — 现 (a) 本地记录级先闭 DoD 演示, 广播传播记 follow-up.
  // Body: { staker_pk_x: 64hex }
  fastify.post('/api/oracle-pool/withdraw', async (request, reply) => {
    const b = request.body || {};
    if (typeof b.staker_pk_x !== 'string' || !/^[0-9a-fA-F]{64}$/.test(b.staker_pk_x)) {
      return reply.code(400).send({ ok: false, error: 'staker_pk_x must be 64 hex chars' });
    }
    const stakerPkX = b.staker_pk_x.toLowerCase();
    try {
      const enr = sqlite.prepare('SELECT staker_pk_x, enrolled_at, active, relay_address FROM oracle_stake_enrollments WHERE staker_pk_x = ?').get(stakerPkX);
      if (!enr) return reply.code(404).send({ ok: false, error: 'no enrollment for this staker_pk_x' });
      if (!enr.active) return reply.send({ ok: true, staker_pk_x: stakerPkX, status: 'already_inactive' });

      // 铁律 在岗不许退: oracle 在未决市场 committee 在岗 → 禁撤.
      const onDuty = sqlite.prepare(`
        SELECT pc.market_id FROM pool_committee pc JOIN pool_markets m ON m.id = pc.market_id
        WHERE m.protocol_status IN ('pending_oracle_deposits','pending_bettors','verifying','collecting_sigs')
          AND lower(pc.committee_pks) LIKE ?
      `).all('%' + stakerPkX + '%');
      if (onDuty.length > 0) {
        return reply.code(409).send({ ok: false, error: `on-duty: committee member of ${onDuty.length} unsettled market(s) — cannot withdraw until they settle/refund`, on_duty_markets: onDuty.map(r => r.market_id) });
      }

      // 冷却 24h: enroll 后 24h 内禁撤.
      const COOLDOWN_MS = 24 * 3600 * 1000;
      const enrolledMs = enr.enrolled_at ? new Date(enr.enrolled_at).getTime() : 0;
      if (enrolledMs && (Date.now() - enrolledMs) < COOLDOWN_MS) {
        const remainHr = Math.ceil((COOLDOWN_MS - (Date.now() - enrolledMs)) / 3600000);
        return reply.code(409).send({ ok: false, error: `cooldown: enrolled <24h ago, ${remainHr}h remaining before withdraw allowed` });
      }

      // REAL withdrawal via the CROSS-NODE-CONVERGENT broadcast path (Bettor/NWT/KANet-UI consensus 2026-06-15):
      // broadcast a staker-signed oracle_stake_withdraw_v1 envelope → EVERY node ingests it
      // (trade-protocol-filter handleOracleStakeWithdraw) → sets active=0 in lockstep. This is the determinism-safe
      // pool removal — NOT a node-local UPDATE active=0 (which = #22 active-flag cross-node divergence: one node's
      // committee-sampling pool, scanAndDerivePool WHERE active=1, ≠ the other's → divergent root → zombie committee).
      // signing_relay_id REQUIRED: only the staking oracle's key can sign its own withdraw (verified in broadcast).
      const signingRelayId = typeof b.signing_relay_id === 'string' ? b.signing_relay_id : null;
      if (!signingRelayId) {
        return reply.code(400).send({ ok: false, error: 'signing_relay_id required: the staking oracle must sign the withdraw envelope so every node can verify + drop it from the pool in lockstep (cross-node convergence)' });
      }
      let broadcastResult;
      try {
        broadcastResult = await _broadcastOracleStakeWithdraw({ stakerPkX, signingRelayId });
      } catch (bcErr) {
        return reply.code(503).send({ ok: false, error: `withdraw broadcast fail: ${bcErr.message}` });
      }
      // active=0 + auditable chain_event are written by handleOracleStakeWithdraw on EVERY node (incl this one when
      // it ingests its own broadcast) — NO node-local UPDATE here, by design (determinism-safe).
      console.log(`[oracle-pool/withdraw] staker=${stakerPkX.slice(0, 12)} → withdraw broadcast txId=${broadcastResult.txId?.slice(0, 16)} (cross-node active=0 via ingest, NOT node-local)`);
      return reply.send({ ok: true, staker_pk_x: stakerPkX, status: 'withdraw_broadcast', txId: broadcastResult.txId, note: 'withdraw envelope broadcast; every node ingests → active=0 in lockstep (cross-node convergent, determinism-safe). real-UTXO unlock = Phase 2 (chain-locked stake).' });
    } catch (e) {
      console.error(`[oracle-pool/withdraw] fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `withdraw fail: ${e.message}` });
    }
  });

  // GET /api/oracle-pool/chain-snapshot?daa=X — DoD §2.2 J2 step [2]:
  // chain-derived oracle pool snapshot at given DAA (= NWT verifier cross-host diff endpoint).
  // 协议不变量: any 2 nodes should return SAME merkleRoot for same daa, given same chain state.
  // Mismatch → relay reject settle TX whose ctor poolMerkleRoot != derive(snapshotDaa).
  //
  // Lazy: scan + derive on first request per daa, cache via oracle_pool_chain_view.
  // Subsequent requests serve cached.
  fastify.get('/api/oracle-pool/chain-snapshot', async (request, reply) => {
    const requestedDaa = parseInt(request.query?.daa, 10);
    if (!Number.isFinite(requestedDaa) || requestedDaa <= 0) {
      // No daa specified → derive at currentDaa - FINALITY_N (= scan time).
      try {
        const { getWorkingRpc } = await import('../services/rpc-health.js');
        const { url: rpcUrl } = await getWorkingRpc();
        const { RpcClient, Encoding } = await import('kaspa-wasm');
        const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: process.env.KASPA_NETWORK || 'testnet-12' });
        await rpc.connect();
        let currentDaa;
        // Bettor r446 catch: kaspa-wasm 无 getCurrentBlockDaaScore/getCurrentDaaScore methods.
        // 改用 getBlockDagInfo().virtualDaaScore (= rpc-health.js L74 实证可用).
        try { const dag = await rpc.getBlockDagInfo(); currentDaa = Number(dag.virtualDaaScore); }
        catch (e) { throw new Error(`getBlockDagInfo fail: ${e.message}`); }
        finally { try { await rpc.disconnect(); } catch {} }
        if (!Number.isFinite(currentDaa)) throw new Error(`currentDaa not finite: ${currentDaa}`);
        // Re-connect for scan UTXO calls.
        const rpc2 = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: process.env.KASPA_NETWORK || 'testnet-12' });
        await rpc2.connect();
        try {
          const { scanAndDerivePool } = await import('../services/oracle-pool-chain-scanner.mjs');
          const result = await scanAndDerivePool({ rpc: rpc2, networkId: process.env.KASPA_NETWORK || 'testnet-12', currentDaa });
          return reply.send({ ok: true, ...result, currentDaa });
        } finally { try { await rpc2.disconnect(); } catch {} }
      } catch (e) {
        return reply.code(500).send({ ok: false, error: e.message });
      }
    }
    // Specific daa requested → check cache only (= scanner must've already scanned at that daa).
    const cached = sqlite.prepare(
      'SELECT snapshot_daa, leaves_json, merkle_root, pool_size, derived_at FROM oracle_pool_chain_view WHERE snapshot_daa = ?'
    ).get(requestedDaa);
    if (!cached) {
      return reply.code(404).send({
        ok: false,
        error: `no snapshot cached at daa=${requestedDaa} (= scanner must run scanAndDerivePool first)`,
      });
    }
    return reply.send({
      ok: true,
      snapshotDaa: cached.snapshot_daa,
      leaves: JSON.parse(cached.leaves_json),
      merkleRoot: cached.merkle_root,
      poolSize: cached.pool_size,
      derivedAt: cached.derived_at,
      fromCache: true,
    });
  });

  // GET /api/oracle-pool/state — current pool snapshot for UI/diagnostics.
  // J2-tn r350 (Owner 钦定 oracle-pool-source 单一源): 切访问器, 不再裸读 membership.
  // 真源 = chain_view (= scanAndDerivePool 写). UI/oracle-home 应改调 /chain-snapshot,
  // 此 endpoint 退役但保持 forward compat (= 返回 chain_view 内容 mapped 到原 schema).
  fastify.get('/api/oracle-pool/state', async (request, reply) => {
    const { getActivePool, resolveOracleAddress } = await import('../lib/oracle-pool-source.mjs');
    const pool = getActivePool();
    if (!pool || !pool.leaves) {
      return reply.send({ ok: true, total_members: 0, active_members: 0, total_active_stake_kas: '0.00000000', members: [] });
    }
    const members = pool.leaves.map(l => {
      const pk = String(l.pk_x || '').toLowerCase();
      const stakeKas = Number(l.stake_sompi || 0) / 1e8;
      return {
        relay_id: null,  // DEPRECATED field
        oracle_pk: pk,
        stake_locked_kas: stakeKas.toFixed(8),
        joined_at: null,
        active: 1,
        stake_unlock_requested_at: null,
        name: null,
        relay_address: resolveOracleAddress(pk),
      };
    });
    const totalStakeKas = members.reduce((s, m) => s + Number(m.stake_locked_kas || 0), 0);
    return reply.send({
      ok: true,
      total_members: members.length,
      active_members: members.length,
      total_active_stake_kas: totalStakeKas.toFixed(8),
      members,
      _note: 'r350 chain_view source. /chain-snapshot is canonical.',
    });
  });

  // POST /api/oracle-pool/timeout-unlock — DoD 问3 oracle 退出 (Bettor r365b + KANet-UI r641
  // 派工). Body: { staker_pk_x }. Pre-check: lock_until_daa <= current_daa (SS enforces via
  // timeout_unlock entry require, pre-check 防浪费 IPC roundtrip). Look up relay_id by
  // matching enrollment relay_address → relay_nodes. Compute to_address = staker P2PK. IPC
  // relay stake_unlock_tx → on chain self-unstake TX.
  fastify.post('/api/oracle-pool/timeout-unlock', async (request, reply) => {
    const b = request.body || {};
    const stakerPkX = typeof b.staker_pk_x === 'string' ? b.staker_pk_x.toLowerCase() : null;
    if (!stakerPkX || !/^[0-9a-fA-F]{64}$/.test(stakerPkX)) {
      return reply.code(400).send({ ok: false, error: 'staker_pk_x must be 64 hex chars' });
    }
    const enroll = sqlite.prepare('SELECT staker_pk_x, lock_until_daa, p2sh_addr, redeem_script_hex, relay_address, active FROM oracle_stake_enrollments WHERE staker_pk_x = ?').get(stakerPkX);
    if (!enroll) return reply.code(404).send({ ok: false, error: `no enrollment for staker_pk_x ${stakerPkX.slice(0,12)}..` });
    if (!enroll.active) return reply.code(409).send({ ok: false, error: 'enrollment not active (= already unlocked or never funded)' });
    if (!enroll.relay_address) return reply.code(409).send({ ok: false, error: 'enrollment missing relay_address (= chain_envelope ingest path 未完, 不知 to_address)' });
    // Check current DAA via RPC vs lock_until_daa.
    const network = process.env.KASPA_NETWORK || 'testnet-12';
    try {
      const { getWorkingRpc } = await import('../services/rpc-health.js');
      const { url: rpcUrl } = await getWorkingRpc();
      const { RpcClient, Encoding } = await import('kaspa-wasm');
      const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: network });
      await rpc.connect();
      let currentDaa;
      try {
        const dag = await rpc.getBlockDagInfo();
        currentDaa = Number(dag.virtualDaaScore);
      } finally { try { await rpc.disconnect(); } catch {} }
      if (!Number.isFinite(currentDaa)) {
        return reply.code(503).send({ ok: false, error: 'cannot fetch current DAA score' });
      }
      if (currentDaa < enroll.lock_until_daa) {
        return reply.code(409).send({
          ok: false,
          error: `lock period not expired: current DAA ${currentDaa} < lock_until_daa ${enroll.lock_until_daa} (= ${enroll.lock_until_daa - currentDaa} blocks remaining)`,
          current_daa: currentDaa,
          lock_until_daa: enroll.lock_until_daa,
          remaining_blocks: enroll.lock_until_daa - currentDaa,
        });
      }
    } catch (rpcErr) {
      return reply.code(503).send({ ok: false, error: `current DAA fetch fail: ${rpcErr.message}` });
    }

    // Find local relay by relay_address. Owner cannot unlock for someone else's stake.
    const relayRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE LOWER(address) = LOWER(?) LIMIT 1').get(enroll.relay_address);
    if (!relayRow?.id) {
      return reply.code(409).send({
        ok: false,
        error: `signing relay not local (enrollment relay_address=${enroll.relay_address.slice(0,30)}.. not in relay_nodes). Unlock must run on staker's own host.`,
      });
    }
    // IPC: relay signs + submits stake_unlock_tx.
    const lockTime = BigInt(enroll.lock_until_daa);  // SS contract reads lockTime as DAA score
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const submitResult = await sendCommandAsync(relayRow.id, {
        type: 'stake_unlock_tx',
        p2sh_address: enroll.p2sh_addr,
        redeem_script_hex: enroll.redeem_script_hex,
        to_address: enroll.relay_address,
        lock_time: lockTime.toString(),
      }, undefined, 'legacy-unmigrated');
      if (!submitResult?.ok || !submitResult.txId) {
        return reply.code(503).send({ ok: false, error: `relay stake_unlock submit fail: ${submitResult?.error || 'no txId'}` });
      }
      // Mark enrollment inactive so it's excluded from future committee VRF samples.
      sqlite.prepare('UPDATE oracle_stake_enrollments SET active = 0 WHERE staker_pk_x = ?').run(stakerPkX);
      return reply.send({
        ok: true,
        unlock_txid: submitResult.txId,
        staker_pk_x: stakerPkX,
        to_address: enroll.relay_address,
        amount_sompi: submitResult.amount || null,
        lock_until_daa: enroll.lock_until_daa,
        note: 'enrollment marked inactive; stake unlocked to relay_address on chain.',
      });
    } catch (ipcErr) {
      return reply.code(503).send({ ok: false, error: `IPC stake_unlock fail: ${ipcErr.message}` });
    }
  });

  // #42 house agent (2026-07-04, Owner head-priority-2 — 人机对抗玩法): read-only judgment endpoint.
  // qzdh7nar 域 = 出判断源; KANet-UI 域 = 拿这个结果去真下注(register-v07 prep→transfer→confirm)。
  //
  // 实测纠偏(2026-07-04): 原计划复用 #26 的 espnSportsJudge——但今天新造的 kanet_v07 世界杯盘(J2 create-v07
  // 管线)outcome_market_source='kanet_v07' 非 'polymarket'，且措辞是 G1 定的"advance"非"win"，espnSportsJudge
  // 的 appliesTo/WIN_RE 两处都对不上(实测 applies:false)。这些原生盘 resolution_rule_spec 本身已经是干净结构化
  // 数据(data_source_canonical=ESPN URL 直给 + resolution_predicate={metric,op,operand} 直给)，不需要 espnSportsJudge
  // 那套给嘈杂 polymarket 文本做的标题解析/球队名匹配。改直接复用 bshard-settle-daemon.mjs 的 judgeWinDir()——
  // 那就是【结算实际用的同一份判定逻辑】，house agent 的"预测"跟真结算永远同源，不会出现两边判不一样的尴尬分裂。
  // Pre-match prediction (2026-07-04, Bettor/KANet-UI co-verify #42): judgeWinDir only knows the
  // ACTUAL result (post-match) — a house agent needs a pre-match GUESS so it can actually be wrong
  // and be "beaten". Primary signal = the same ESPN summary URL's sportsbook odds (pickcenter),
  // available before kickoff — deliberately a DIFFERENT field/moment than judgeWinDir's post-match
  // read, so prediction and settlement never collapse into the same self-confirming source.
  // NOT parseEspnSummary (oracle-evidence-extractors.mjs) — that helper hard-gates on
  // status.type.completed===true (by design, for post-match judging), so it always returns null
  // pre-kickoff. Minimal standalone parse here instead of weakening that gate for an unrelated need.
  // FIFA World Ranking fallback (KANet-UI 2026-07-04, per Bettor 分工: qzdh7nar 赔率主 + 我 fallback).
  // 来源: FIFA/Coca-Cola Men's World Ranking 2026-06-11 官方更新(下次更新 2026-07-20, 本届赛事期间不变) -
  // https://inside.fifa.com/fifa-world-ranking/men + ESPN Top-50 复核(非猜, WebSearch 实查两源对齐)。
  // 只收 2026 世界杯16强 + 2个待定席位候选队(共19队), 非全量200+队排名表 — 够用即可, 别过度工程.
  // 排名数字越小=越强(FIFA 惯例); 用于 pickcenter 缺失/pick'em 时的 tiebreaker, 非首选信号(odds 优先).
  const FIFA_RANKING_JUN2026 = {
    ARG: 1, ESP: 2, FRA: 3, ENG: 4, POR: 5, BRA: 6, MAR: 7, BEL: 9, COL: 13,
    MEX: 14, USA: 17, SUI: 19, AUS: 27, EGY: 29, CAN: 30, NOR: 31, PAR: 41, CPV: 67, GHA: 73,
  };
  function predictByFifaRanking(homeAbbr, awayAbbr, operand) {
    const homeRank = FIFA_RANKING_JUN2026[String(homeAbbr).toUpperCase()];
    const awayRank = FIFA_RANKING_JUN2026[String(awayAbbr).toUpperCase()];
    if (homeRank == null || awayRank == null) return { verdict: 'ABSTAIN', reason: 'fifa_ranking_unknown_team' };
    if (homeRank === awayRank) return { verdict: 'ABSTAIN', reason: 'fifa_ranking_tie' };
    const favoredAbbr = homeRank < awayRank ? homeAbbr : awayAbbr; // 排名数字小 = 更强
    const predictedYes = String(favoredAbbr).toUpperCase() === String(operand).toUpperCase();
    return { verdict: predictedYes ? 'PREDICTED_YES' : 'PREDICTED_NO', favored: favoredAbbr, provider: 'fifa-ranking-2026-06-11-fallback' };
  }

  async function predictPreMatch(dataSourceUrl, operand) {
    let data;
    try {
      const raw = await (await fetch(dataSourceUrl, { signal: AbortSignal.timeout(15000) })).text();
      data = JSON.parse(raw);
    } catch (e) {
      return { verdict: 'ABSTAIN', reason: `fetch/parse fail: ${String(e?.message || e).slice(0, 120)}` };
    }
    const comp = data?.header?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');
    if (!home || !away) return { verdict: 'ABSTAIN', reason: 'no_competitors' };
    const pick = data?.pickcenter?.[0] || data?.odds?.[0];
    if (!pick) return predictByFifaRanking(home.team?.abbreviation, away.team?.abbreviation, operand);
    const homeFav = pick.homeTeamOdds?.favorite === true;
    const awayFav = pick.awayTeamOdds?.favorite === true;
    if (homeFav === awayFav) return predictByFifaRanking(home.team?.abbreviation, away.team?.abbreviation, operand); // pick'em / missing flags
    const favoredAbbr = homeFav ? home.team?.abbreviation : away.team?.abbreviation;
    if (!favoredAbbr) return predictByFifaRanking(home.team?.abbreviation, away.team?.abbreviation, operand);
    const predictedYes = String(favoredAbbr).toUpperCase() === String(operand).toUpperCase();
    return { verdict: predictedYes ? 'PREDICTED_YES' : 'PREDICTED_NO', favored: favoredAbbr, provider: pick.provider?.name || null };
  }

  fastify.get('/api/oracle-pool/house-judgment/:marketId', async (request, reply) => {
    const { marketId } = request.params;
    const market = sqlite.prepare(
      `SELECT id, category, outcome_market_source, outcome_condition_id, resolution_rule_spec FROM pool_markets WHERE id = ?`
    ).get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market_not_found' });

    let spec = {};
    try { spec = JSON.parse(market.resolution_rule_spec || '{}'); } catch {}

    const { judgeWinDir } = await import('../services/bshard-settle-daemon.mjs');
    try {
      const winDir = await judgeWinDir(market);   // 0 = YES, 1 = NO (同 settle daemon 的 value-mapping)
      return reply.send({
        ok: true,
        applies: true,
        market_id: marketId,
        verdict: winDir === 0 ? 'YES' : 'NO',       // 赛后真结果(结算同源) — 用于算 Agent 战绩，不是下注触发信号
        source: 'bshard-settle-daemon.judgeWinDir',
        title: spec.title || null,
      });
    } catch (e) {
      // judgeWinDir ABSTAIN(比赛没打完等)→ 落到赛前预测(下注真正用的信号)。
      if (spec.data_source_canonical && spec.resolution_predicate?.operand) {
        const pred = await predictPreMatch(spec.data_source_canonical, spec.resolution_predicate.operand);
        return reply.send({ ok: true, applies: true, market_id: marketId, verdict: pred.verdict, source: 'espn-pickcenter-odds', title: spec.title || null, ...pred });
      }
      return reply.send({ ok: true, applies: true, market_id: marketId, verdict: 'ABSTAIN', source: 'bshard-settle-daemon.judgeWinDir', reason: String(e?.message || e).slice(0, 160) });
    }
  });
}
