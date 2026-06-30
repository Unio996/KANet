// oracle-pool-renewal-cron.mjs — oracle 质押锁 auto-renewal (task#13 Bettor 2026-06-30 钦定·28h urgency)
//
// 背景: oracle enrollment lock_until_daa 到期 → scanAndDerivePool 剔除 → pool_size=0 → create-v07 block 新盘.
// 解法: cron 监测 lock_until_daa - currentDaa < RENEWAL_THRESHOLD_DAA 时:
//   1. 删旧 enrollment 记录 (允许 re-insert 新 lock)
//   2. 计算新 P2SH (lock += NEW_LOCK_DURATION_DAA)
//   3. INSERT 新 enrollment + 广播 envelope (跨节点收敛)
//   4. relay 向新 P2SH 转 stake KAS
//
// 只对本节点控制的 relay (relay_address 在 relay_nodes 表) 自动续期.
// 外节点的 enrollment 到期 = warn 日志·手动续.

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';
import { sendBroadcastChunked } from '../lib/pool-broadcast.mjs';

const TICK_INTERVAL_MS = 60 * 60 * 1000;   // 1 hour
const STARTUP_GRACE_MS = 2 * 60 * 1000;    // 2 min (let scanner run first)
const RENEWAL_THRESHOLD_DAA = 3_000_000;   // ~3.5d at 10 BPS — trigger renewal before expiry
const NEW_LOCK_DURATION_DAA = 10_000_000;  // ~11.5d at 10 BPS — new lock length
const DEFAULT_STAKE_KAS = 2;               // KAS to send to new P2SH if amount_sompi not set

let timer = null;
let running = false;

async function _renewEnrollment({ stakerPkX, relayId, relayAddress, amountSompi, currentDaa }) {
  const { computeStakeP2SH_v1 } = await import('../lib/oracle-stake-v1.mjs');
  const network = process.env.KASPA_NETWORK || 'testnet-12';
  const newLockUntilDaa = currentDaa + NEW_LOCK_DURATION_DAA;

  // 1. Compute new P2SH with extended lock
  const { p2shAddr: newP2shAddr, redeemScript, p2shHash } = await computeStakeP2SH_v1({
    stakerPkX, lockUntilDaa: newLockUntilDaa, network,
  });

  // 2. DELETE old row — necessary because enroll API 409s on staker_pk_x with different lock_until_daa
  sqlite.prepare('DELETE FROM oracle_stake_enrollments WHERE staker_pk_x = ?').run(stakerPkX);

  // 3. INSERT new enrollment record
  sqlite.prepare(`
    INSERT INTO oracle_stake_enrollments
      (staker_pk_x, lock_until_daa, p2sh_addr, p2sh_hash, redeem_script_hex, source, active, relay_address)
    VALUES (?, ?, ?, ?, ?, 'chain_envelope', 1, ?)
  `).run(stakerPkX, newLockUntilDaa, newP2shAddr, p2shHash, redeemScript, relayAddress);

  // 4. Broadcast enrollment envelope (best-effort; local INSERT already valid)
  let broadcastTxId = null;
  try {
    const pkRes = await sendCommandAsync(relayId, { type: 'get_pubkey' });
    const signerPk = String(pkRes?.x_only_pubkey || '').toLowerCase();
    if (!signerPk || signerPk.length !== 64) throw new Error(`get_pubkey invalid: ${signerPk?.slice(0, 12)}`);
    if (signerPk !== stakerPkX.toLowerCase()) {
      throw new Error(`pubkey mismatch: relay=${signerPk.slice(0, 8)} enrollment=${stakerPkX.slice(0, 8)}`);
    }
    const unsignedPayload = {
      t: 'oracle_stake_enroll_v1',
      staker_pk_x: stakerPkX.toLowerCase(),
      lock_until_daa: newLockUntilDaa,
      p2sh_addr: newP2shAddr,
      relay_address: relayAddress,
      enrolled_at: new Date().toISOString(),
    };
    const signResult = await sendCommandAsync(relayId, { type: 'ecdsa_sign', message: JSON.stringify(unsignedPayload) });
    const signature = signResult?.signature;
    if (!signature) throw new Error('ecdsa_sign returned empty');
    const bcastResult = await sendBroadcastChunked(relayId, 'kanet-prediction', JSON.stringify({ ...unsignedPayload, signature }));
    broadcastTxId = bcastResult?.txId;
    if (!broadcastTxId) throw new Error(`broadcast no txId: ${JSON.stringify(bcastResult).slice(0, 100)}`);
  } catch (bcErr) {
    console.warn(`[oracle-renewal] broadcast fail staker=${stakerPkX.slice(0, 8)} relay=${relayId.slice(0, 8)}: ${bcErr.message} (local INSERT valid; renewal proceeds)`);
  }

  // 5. Transfer stake KAS to new P2SH from relay wallet
  const stakeKas = amountSompi ? (Number(amountSompi) / 1e8) : DEFAULT_STAKE_KAS;
  let transferTxId = null;
  try {
    const txRes = await sendCommandAsync(relayId, {
      type: 'transfer',
      target: newP2shAddr,
      amount: stakeKas.toFixed(8),
    });
    if (txRes?.error) throw new Error(String(txRes.error));
    if (!txRes) throw new Error('relay not running or no response');
    transferTxId = txRes?.txId;
  } catch (txErr) {
    console.warn(`[oracle-renewal] stake transfer fail staker=${stakerPkX.slice(0, 8)}: ${txErr.message}`);
  }

  return { newLockUntilDaa, newP2shAddr, broadcastTxId, transferTxId };
}

export async function oraclePoolRenewalTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const { getWorkingRpc } = await import('./rpc-health.js');
    const { url: rpcUrl } = await getWorkingRpc();
    const networkId = process.env.KASPA_NETWORK || 'testnet-12';
    const { RpcClient, Encoding } = await import('kaspa-wasm');
    const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId });
    await rpc.connect();
    let currentDaa;
    try {
      const dag = await rpc.getBlockDagInfo();
      currentDaa = Number(dag.virtualDaaScore);
    } finally {
      try { await rpc.disconnect(); } catch {}
    }
    if (!Number.isFinite(currentDaa)) {
      console.warn('[oracle-renewal] currentDaa not finite, skip');
      return { ok: false, error: 'currentDaa not finite' };
    }

    // Find active enrollments expiring within RENEWAL_THRESHOLD (includes already-expired ones)
    const expiring = sqlite.prepare(`
      SELECT e.staker_pk_x, e.lock_until_daa, e.amount_sompi, e.relay_address,
             r.id AS relay_id, r.name AS relay_name
      FROM oracle_stake_enrollments e
      LEFT JOIN relay_nodes r ON r.address = e.relay_address
      WHERE e.active = 1
        AND (CAST(e.lock_until_daa AS INTEGER) - ?) < ?
    `).all(currentDaa, RENEWAL_THRESHOLD_DAA);

    if (expiring.length === 0) {
      const minRemaining = sqlite.prepare(
        'SELECT MIN(CAST(lock_until_daa AS INTEGER) - ?) AS min_remaining FROM oracle_stake_enrollments WHERE active=1'
      ).get(currentDaa);
      console.log(`[oracle-renewal] tick: currentDaa=${currentDaa} no renewals needed (closest_expiry_in=${minRemaining?.min_remaining ?? 'N/A'} DAA)`);
      return { ok: true, renewed: 0 };
    }

    const local = expiring.filter(e => e.relay_id);
    const external = expiring.filter(e => !e.relay_id);

    if (external.length > 0) {
      console.warn(`[oracle-renewal] ${external.length} expiring enrollment(s) from EXTERNAL nodes (no controlling relay here) — manual renewal needed: ${external.map(e => e.staker_pk_x.slice(0, 12)).join(', ')}`);
    }

    if (local.length === 0) {
      console.log(`[oracle-renewal] tick: currentDaa=${currentDaa} no local enrollments to renew (${external.length} external)`);
      return { ok: true, renewed: 0, external: external.length };
    }

    console.log(`[oracle-renewal] tick: currentDaa=${currentDaa} renewing ${local.length} local enrollment(s)`);

    const results = [];
    for (const enr of local) {
      const daaRemaining = enr.lock_until_daa - currentDaa;
      try {
        console.log(`[oracle-renewal] renewing staker=${enr.staker_pk_x.slice(0, 12)} relay=${enr.relay_name}(${enr.relay_id.slice(0, 8)}) remaining=${daaRemaining} DAA`);
        const res = await _renewEnrollment({
          stakerPkX: enr.staker_pk_x,
          relayId: enr.relay_id,
          relayAddress: enr.relay_address,
          amountSompi: enr.amount_sompi,
          currentDaa,
        });
        console.log(`[oracle-renewal] renewed staker=${enr.staker_pk_x.slice(0, 12)} newLock=${res.newLockUntilDaa} broadcast=${res.broadcastTxId?.slice(0, 16) ?? 'FAIL'} transfer=${res.transferTxId?.slice(0, 16) ?? 'FAIL'}`);
        results.push({ stakerPkX: enr.staker_pk_x, ok: true, ...res });
      } catch (err) {
        console.error(`[oracle-renewal] renewal fail staker=${enr.staker_pk_x.slice(0, 12)}: ${err.message}`);
        results.push({ stakerPkX: enr.staker_pk_x, ok: false, error: err.message });
      }
    }

    const renewed = results.filter(r => r.ok).length;
    console.log(`[oracle-renewal] done: ${renewed}/${local.length} renewed (${external.length} external/skipped)`);
    return { ok: true, renewed, total: local.length, external: external.length, results };
  } catch (e) {
    console.error(`[oracle-renewal] tick fail: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

export function startOraclePoolRenewalCron() {
  if (timer) return;
  console.log('[oracle-renewal] started — 1h cron, auto-renew expiring oracle enrollments (threshold=3M DAA ≈3.5d, new_lock=10M DAA ≈11.5d).');
  setTimeout(() => {
    oraclePoolRenewalTick().catch(e => console.error('[oracle-renewal] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    oraclePoolRenewalTick().catch(e => console.error('[oracle-renewal] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopOraclePoolRenewalCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
