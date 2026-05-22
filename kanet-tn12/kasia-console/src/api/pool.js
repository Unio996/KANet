// B2 v0.5 Sub 2b — Pool API endpoints (5 endpoints per Bettor r330 5-endpoint plan)
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md.

import { sqlite } from '../db/client.js';
import { computeSpineP2SH, computeSideP2SH } from '../lib/pool-p2sh.mjs';
import { buildSidesMerkleTree, getMerkleProof } from '../services/pool-merkle-builder.js';
import { sendCommandAsync, transferAndConfirm } from '../services/relay-manager.js';
import { createHash, randomUUID } from 'node:crypto';

function deriveXOnlyPubkey(address) {
  return import('kaspa-wasm').then(kaspa => {
    return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
  });
}

export async function registerPoolRoutes(fastify) {
  // POST /api/pool/market/create — maker creates market + locks stake
  fastify.post('/api/pool/market/create', async (request, reply) => {
    const b = request.body || {};
    const required = ['maker_relay_id', 'broker_relay_id', 'oracle_relay_ids', 'outcome_market_source', 'outcome_condition_id', 'outcome_token_id', 'outcome_side', 'outcome_end_date', 'resolution_rule_spec', 'maker_stake_kas', 'oracle_bond_kas', 'broker_fee_pct'];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || b[k] === '') return reply.code(400).send({ ok: false, error: `missing ${k}` });
    }

    if (!Array.isArray(b.oracle_relay_ids) || b.oracle_relay_ids.length !== 3) {
      return reply.code(400).send({ ok: false, error: 'oracle_relay_ids must be 3 unique relay ids (v0.5 3-of-3)' });
    }
    if (new Set(b.oracle_relay_ids).size !== 3) {
      return reply.code(400).send({ ok: false, error: 'oracle_relay_ids must be 3 unique' });
    }

    // Lookup addresses + derive pubkeys
    const makerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.maker_relay_id);
    const brokerRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.broker_relay_id);
    if (!makerRow?.address || !brokerRow?.address) return reply.code(400).send({ ok: false, error: 'maker or broker relay has no resolvable address' });
    const oracleRows = b.oracle_relay_ids.map(rid => {
      const r = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ? AND is_oracle = 1').get(rid);
      if (!r) throw new Error(`oracle relay ${rid.slice(0,8)} not registered as is_oracle=1`);
      return r;
    });

    const makerPk = await deriveXOnlyPubkey(makerRow.address);
    const brokerPk = await deriveXOnlyPubkey(brokerRow.address);
    const oraclePks = await Promise.all(oracleRows.map(r => deriveXOnlyPubkey(r.address)));

    // deadline + amounts
    const outcomeEndMs = new Date(b.outcome_end_date).getTime();
    if (!Number.isFinite(outcomeEndMs) || outcomeEndMs < Date.now() + 15 * 60_000) {
      return reply.code(400).send({ ok: false, error: 'outcome_end_date must be > now + 15 minutes' });
    }
    const deadline = Math.floor(outcomeEndMs / 1000);
    const minerFee = parseInt(b.miner_fee, 10) || 20_000;
    const brokerFeePct = parseInt(b.broker_fee_pct, 10);
    if (!Number.isFinite(brokerFeePct) || brokerFeePct < 0 || brokerFeePct >= 10000) {
      return reply.code(400).send({ ok: false, error: 'broker_fee_pct must be 0-9999 basis points' });
    }

    const makerStakeKas = parseFloat(b.maker_stake_kas);
    const oracleBondKas = parseFloat(b.oracle_bond_kas);
    if (!Number.isFinite(makerStakeKas) || makerStakeKas <= 0) return reply.code(400).send({ ok: false, error: 'maker_stake_kas must be positive' });
    if (!Number.isFinite(oracleBondKas) || oracleBondKas <= 0) return reply.code(400).send({ ok: false, error: 'oracle_bond_kas must be positive' });
    const makerStakeAmount = Math.round(makerStakeKas * 1e8);
    const oracleBondAmount = Math.round(oracleBondKas * 1e8);
    const makerStakeStr = (makerStakeAmount / 1e8).toFixed(8);

    // market_metadata_hash
    const metaInput = JSON.stringify({
      source: b.outcome_market_source,
      condition: b.outcome_condition_id,
      token: b.outcome_token_id,
      side: b.outcome_side,
      end: b.outcome_end_date,
      rule: b.resolution_rule_spec,
    });
    const marketMetadataHash = createHash('sha256').update(metaInput).digest('hex');

    // Compute spine P2SH
    const network = makerRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    let spineResult;
    try {
      spineResult = await computeSpineP2SH({
        makerPk, brokerPk, oraclePks,
        deadline, minerFee, brokerFeePct,
        oracleBondAmount, makerStakeAmount,
        marketMetadataHash,
        network,
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `spine SS compile fail: ${e.message}` });
    }

    // Maker relay locks stake → spine P2SH.
    // Bug 7 fix: transferAndConfirm verifies the UTXO actually landed (NO TX NO STATE CHANGE) +
    // surfaces the real transfer error (= not a generic "failed after 3 attempts").
    let spineTxId = null;
    try {
      const r = await transferAndConfirm(b.maker_relay_id, spineResult.p2shAddr, makerStakeStr);
      spineTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `maker stake lock failed: ${err.message} (spine_p2sh=${spineResult.p2shAddr})` });
    }

    // INSERT pool_markets row
    const marketId = 'ext-pool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    try {
      // Stash spine_redeem_script_hex in metadata at create time (= Phase 2c prerequisite per Bettor r348).
      // Required for settle/refund TX scriptSig assembly downstream (= P2SH unlock needs redeem script).
      const initialMetadata = JSON.stringify({
        spine_redeem_script_hex: spineResult.redeemScript,
      });

      sqlite.prepare(`INSERT INTO pool_markets (
        id, maker_relay_id, spine_p2sh, spine_lock_tx, market_metadata_hash,
        oracle1_pk, oracle2_pk, oracle3_pk, broker_pk,
        deadline, miner_fee, broker_fee_pct, oracle_bond_amount, maker_stake_amount,
        outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side, resolution_rule_spec,
        protocol_status, sides_merkle_root, oracle_relay_ids, broker_relay_id, metadata
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        marketId, b.maker_relay_id, spineResult.p2shAddr, spineTxId, marketMetadataHash,
        oraclePks[0], oraclePks[1], oraclePks[2], brokerPk,
        deadline, minerFee, brokerFeePct, oracleBondAmount, makerStakeAmount,
        b.outcome_market_source, b.outcome_condition_id, b.outcome_token_id, b.outcome_side, b.resolution_rule_spec,
        'pending_oracle_deposits', '', JSON.stringify(b.oracle_relay_ids), b.broker_relay_id, initialMetadata,
      );
    } catch (e) {
      console.error(`[pool/market/create] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail (spine TX done ${spineTxId}): ${e.message}` });
    }

    return reply.send({
      ok: true,
      market_id: marketId,
      spine_p2sh: spineResult.p2shAddr,
      spine_lock_tx: spineTxId,
      maker_stake_locked_kas: makerStakeAmount / 1e8,
      oracle_bond_required_kas: oracleBondAmount / 1e8,
      status: 'pending_oracle_deposits',
      next_step: '3 oracle relays must call POST /api/pool/market/' + marketId + '/oracle/deposit',
    });
  });

  // POST /api/pool/market/:id/oracle/deposit — oracle 自 locks bond to spine
  fastify.post('/api/pool/market/:id/oracle/deposit', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    if (!b.oracle_relay_id) return reply.code(400).send({ ok: false, error: 'oracle_relay_id required' });

    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_oracle_deposits') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, oracle deposits already closed` });
    }

    const oracleRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ? AND is_oracle = 1').get(b.oracle_relay_id);
    if (!oracleRow) return reply.code(400).send({ ok: false, error: 'oracle_relay_id not registered as is_oracle=1' });

    const oraclePk = await deriveXOnlyPubkey(oracleRow.address);
    const oraclePks = [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk];
    if (!oraclePks.includes(oraclePk)) {
      return reply.code(403).send({ ok: false, error: 'oracle_relay_id pubkey not in market oracle set' });
    }

    // Check if this oracle already deposited (= via chain_events 'pool_oracle_deposit')
    const existing = sqlite.prepare(`SELECT id FROM chain_events WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?`)
      .get(`%"market_id":"${marketId}","oracle_pk":"${oraclePk}"%`);
    if (existing) return reply.code(409).send({ ok: false, error: 'oracle already deposited' });

    const bondStr = (market.oracle_bond_amount / 1e8).toFixed(8);
    // Bug 7 fix: transferAndConfirm verifies the bond UTXO actually landed at the spine P2SH.
    let bondTxId = null;
    try {
      const r = await transferAndConfirm(b.oracle_relay_id, market.spine_p2sh, bondStr);
      bondTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `oracle bond lock failed: ${err.message}` });
    }

    // Record deposit chain_event
    const { randomUUID } = await import('node:crypto');
    const syntheticTxid = `pool_oracle_deposit:${marketId.slice(0,8)}:${oraclePk.slice(0,8)}:${Date.now()}`;
    sqlite.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?,?,'pool_oracle_deposit',?,?,?,'pool-api', CURRENT_TIMESTAMP)`).run(
      randomUUID(), syntheticTxid, oracleRow.address, market.spine_p2sh,
      JSON.stringify({ market_id: marketId, oracle_pk: oraclePk, deposit_tx: bondTxId, bond_amount: market.oracle_bond_amount }),
    );

    // Check if all 3 oracles deposited → transition to pending_bettors
    const depositedCount = sqlite.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='pool_oracle_deposit' AND payload LIKE ?`)
      .get(`%"market_id":"${marketId}"%`).c;
    if (depositedCount >= 3) {
      sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('pending_bettors', marketId);
    }

    return reply.send({
      ok: true,
      market_id: marketId,
      oracle_pk: oraclePk,
      deposit_tx: bondTxId,
      deposits_received: depositedCount,
      market_status: depositedCount >= 3 ? 'pending_bettors' : 'pending_oracle_deposits',
    });
  });

  // POST /api/pool/market/:id/bettor/register — bettor locks stake to own side P2SH
  fastify.post('/api/pool/market/:id/bettor/register', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    if (!b.bettor_relay_id || b.direction === undefined || !b.stake_kas) {
      return reply.code(400).send({ ok: false, error: 'bettor_relay_id, direction, stake_kas required' });
    }

    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, bettor registration closed` });
    }

    const bettorRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.bettor_relay_id);
    if (!bettorRow?.address) return reply.code(400).send({ ok: false, error: 'bettor relay not found' });

    const bettorPk = await deriveXOnlyPubkey(bettorRow.address);
    const direction = parseInt(b.direction, 10);
    if (direction !== 0 && direction !== 1) return reply.code(400).send({ ok: false, error: 'direction must be 0 (YES) or 1 (NO)' });
    const stakeAmount = Math.round(parseFloat(b.stake_kas) * 1e8);
    if (stakeAmount <= 0) return reply.code(400).send({ ok: false, error: 'stake_kas must be positive' });

    // Compute side P2SH
    const oraclePks = [market.oracle1_pk, market.oracle2_pk, market.oracle3_pk];
    const spineP2shHash = createHash('sha256').update(market.spine_p2sh).digest('hex');  // placeholder, production uses actual P2SH script hash
    const network = bettorRow.address.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';

    let sideResult;
    try {
      sideResult = await computeSideP2SH({
        bettorPk, spineP2shHash, oraclePks,
        marketMetadataHash: market.market_metadata_hash,
        direction, stakeAmount, deadline: market.deadline,
        network,
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `side SS compile fail: ${e.message}` });
    }

    // Lock stake to side P2SH.
    // Bug 7 fix: transferAndConfirm verifies the stake UTXO actually landed at the side P2SH.
    const stakeStr = (stakeAmount / 1e8).toFixed(8);
    let sideTxId = null;
    try {
      const r = await transferAndConfirm(b.bettor_relay_id, sideResult.p2shAddr, stakeStr);
      sideTxId = r.txId;
    } catch (err) {
      return reply.code(503).send({ ok: false, error: `bettor stake lock failed: ${err.message}` });
    }

    // Get current bettor count for merkle_index
    const merkleIndex = sqlite.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(marketId).c;

    try {
      sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(marketId, bettorPk, b.bettor_relay_id, direction, stakeAmount, sideResult.p2shAddr, sideTxId, merkleIndex, sideResult.redeemScript);
    } catch (e) {
      console.error(`[pool/bettor/register] DB insert fail: ${e.message}`);
      return reply.code(500).send({ ok: false, error: `DB insert fail (side TX done ${sideTxId}): ${e.message}` });
    }

    // Recompute Merkle root
    const bettors = sqlite.prepare('SELECT bettor_pk FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(b => b.bettor_pk));
    sqlite.prepare('UPDATE pool_markets SET sides_merkle_root = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(tree.root, marketId);

    return reply.send({
      ok: true,
      market_id: marketId,
      bettor_pk: bettorPk,
      side_p2sh: sideResult.p2shAddr,
      side_lock_tx: sideTxId,
      merkle_index: merkleIndex,
      sides_merkle_root: tree.root,
    });
  });

  // GET /api/pool/market/:id/sides_merkle — return Merkle root + tree
  fastify.get('/api/pool/market/:id/sides_merkle', async (request, reply) => {
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT id, sides_merkle_root FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });

    const bettors = sqlite.prepare('SELECT bettor_pk, direction, stake_amount, side_p2sh, merkle_index FROM pool_bettor_sides WHERE market_id = ? ORDER BY merkle_index').all(marketId);
    const tree = buildSidesMerkleTree(bettors.map(b => b.bettor_pk));

    return reply.send({
      ok: true,
      market_id: marketId,
      sides_merkle_root: tree.root,
      bettor_count: bettors.length,
      bettors,
    });
  });

  // POST /api/pool/market/:id/settle — trigger settlement (= oracle vote + spine settle TX)
  fastify.post('/api/pool/market/:id/settle', async (request, reply) => {
    const marketId = request.params.id;
    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'pending_bettors') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, not settle-ready` });
    }
    if (market.deadline > Math.floor(Date.now() / 1000)) {
      return reply.code(403).send({ ok: false, error: 'deadline not past yet' });
    }

    // Transition to verifying (= settler daemon picks up + triggers oracle vote)
    sqlite.prepare('UPDATE pool_markets SET protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('verifying', marketId);

    return reply.send({
      ok: true,
      market_id: marketId,
      status: 'verifying',
      next_step: 'pool-settler cron picks up market, triggers 3 oracle vote, then spine settle TX',
    });
  });

  // POST /api/pool/market/:id/oracle/vote — manual oracle vote with explicit outcome.
  // For Owner UAT + stress testing (= Scenario 4 disagreement needs controlled outcomes).
  // Production path is the voter daemon's LLM-derived auto-vote; this is the manual override.
  fastify.post('/api/pool/market/:id/oracle/vote', async (request, reply) => {
    const marketId = request.params.id;
    const b = request.body || {};
    if (!b.oracle_relay_id) return reply.code(400).send({ ok: false, error: 'oracle_relay_id required' });
    const outcome = (b.outcome || '').toUpperCase();
    if (outcome !== 'YES' && outcome !== 'NO' && outcome !== 'DISPUTE') {
      return reply.code(400).send({ ok: false, error: 'outcome must be YES, NO, or DISPUTE' });
    }

    const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId);
    if (!market) return reply.code(404).send({ ok: false, error: 'market not found' });
    if (market.protocol_status !== 'verifying') {
      return reply.code(409).send({ ok: false, error: `market status=${market.protocol_status}, not in 'verifying' (vote requires verifying state)` });
    }

    let oracleIds;
    try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
    if (!oracleIds.includes(b.oracle_relay_id)) {
      return reply.code(403).send({ ok: false, error: 'oracle_relay_id not in market oracle set' });
    }

    const oracleRow = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(b.oracle_relay_id);
    if (!oracleRow?.address) return reply.code(400).send({ ok: false, error: 'oracle relay has no resolvable address' });

    // Skip if already voted
    const existing = sqlite.prepare(`
      SELECT id FROM chain_events WHERE event_type = 'pool_oracle_vote'
        AND from_address = ? AND payload LIKE ? LIMIT 1
    `).get(oracleRow.address, `%"market_id":"${marketId}"%`);
    if (existing) return reply.code(409).send({ ok: false, error: 'this oracle already voted on this market' });

    // get oracle x-only pubkey via relay IPC
    let oraclePubkey;
    try {
      const pkResult = await sendCommandAsync(b.oracle_relay_id, { type: 'get_pubkey' });
      oraclePubkey = pkResult?.x_only_pubkey;
      if (!oraclePubkey || oraclePubkey.length !== 64) throw new Error(`get_pubkey invalid: ${oraclePubkey}`);
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `get_pubkey fail: ${e.message}` });
    }

    const unsignedPayload = {
      t: 'pool_oracle_vote_v1',
      market_id: marketId,
      voter_relay_id: b.oracle_relay_id,
      voter_pubkey: oraclePubkey,
      outcome,
      evidence_url: 'uat_manual_vote',
      evidence_hash: createHash('sha256').update(`uat_manual_vote:${outcome}`).digest('hex'),
      vote_timestamp: new Date().toISOString(),
    };
    let signature;
    try {
      const signResult = await sendCommandAsync(b.oracle_relay_id, { type: 'ecdsa_sign', message: JSON.stringify(unsignedPayload) });
      signature = signResult?.signature;
      if (!signature) throw new Error('ecdsa_sign returned empty');
    } catch (e) {
      return reply.code(503).send({ ok: false, error: `ecdsa_sign fail: ${e.message}` });
    }
    const votePayload = { ...unsignedPayload, signature };

    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (makerRow?.address) {
      try {
        await sendCommandAsync(b.oracle_relay_id, { type: 'send_message', target: makerRow.address, message: JSON.stringify(votePayload) });
      } catch { /* DM best-effort — chain_event is the source of truth for settler */ }
    }

    const syntheticTxid = `pool_oracle_vote:${b.oracle_relay_id.slice(0,8)}:${marketId.slice(0,12)}:${Date.now()}`;
    sqlite.prepare(`
      INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (?, ?, 'pool_oracle_vote', ?, ?, ?, 'uat-manual-vote', CURRENT_TIMESTAMP)
    `).run(randomUUID(), syntheticTxid, oracleRow.address, makerRow?.address || '', JSON.stringify(votePayload));

    const voteCount = sqlite.prepare(`
      SELECT COUNT(*) c FROM chain_events WHERE event_type = 'pool_oracle_vote' AND payload LIKE ?
    `).get(`%"market_id":"${marketId}"%`).c;

    return reply.send({
      ok: true,
      market_id: marketId,
      oracle_relay_id: b.oracle_relay_id,
      outcome,
      votes_recorded: voteCount,
      next_step: voteCount >= 3
        ? 'all 3 votes in — pool-settler cron will aggregate consensus + dispatch settle TX'
        : `${3 - voteCount} more oracle vote(s) needed`,
    });
  });
}
