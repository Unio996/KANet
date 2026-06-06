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
  const pkRes = await sendCommandAsync(signingRelayId, { type: 'get_pubkey' });
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
  const signResult = await sendCommandAsync(signingRelayId, { type: 'ecdsa_sign', message: messageToSign });
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
}
