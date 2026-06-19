// oracle-pool-chain-scanner-cron.mjs — Bettor r449 派工 (a):
// 定时刷新 oracle_pool_chain_view 保 chain_view 新鲜 (5min tick, 同 pool-market-settler 节奏).
// 不依赖 API endpoint 触发, 服务启动后自动跑.

import { scanAndDerivePool } from './oracle-pool-chain-scanner.mjs';

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_GRACE_MS = 60 * 1000;

let timer = null;
let running = false;

async function _getCurrentDaa(rpcUrl, networkId) {
  const { RpcClient, Encoding } = await import('kaspa-wasm');
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId });
  await rpc.connect();
  try {
    const dag = await rpc.getBlockDagInfo();
    return Number(dag.virtualDaaScore);
  } finally {
    try { await rpc.disconnect(); } catch {}
  }
}

export async function oraclePoolScannerTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const { getWorkingRpc } = await import('./rpc-health.js');
    const { url: rpcUrl } = await getWorkingRpc();
    const networkId = process.env.KASPA_NETWORK || 'testnet-12';

    const currentDaa = await _getCurrentDaa(rpcUrl, networkId);
    if (!Number.isFinite(currentDaa)) {
      console.warn(`[oracle-pool-scanner-cron] currentDaa not finite: ${currentDaa}, skip tick`);
      return { ok: false, error: 'currentDaa not finite' };
    }

    const { RpcClient, Encoding } = await import('kaspa-wasm');
    const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId });
    await rpc.connect();
    try {
      const result = await scanAndDerivePool({ rpc, networkId, currentDaa });
      console.log(`[oracle-pool-scanner-cron] tick: snapshotDaa=${result.snapshotDaa} poolSize=${result.poolSize} merkleRoot=${result.merkleRoot.slice(0,12)} (scanned=${result.scanned}/valid=${result.valid}/rejected=${result.rejected}${result.fromCache ? ' cached' : ''})`);
      return { ok: true, ...result };
    } finally {
      try { await rpc.disconnect(); } catch {}
    }
  } catch (e) {
    console.error(`[oracle-pool-scanner-cron] tick fail: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

export function startOraclePoolScannerCron() {
  if (timer) return;
  console.log('[oracle-pool-scanner-cron] started — 5min cron, scan + derive chain_view (Bettor r449 活化质押池).');
  setTimeout(() => {
    oraclePoolScannerTick().catch(e => console.error('[oracle-pool-scanner-cron] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    oraclePoolScannerTick().catch(e => console.error('[oracle-pool-scanner-cron] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopOraclePoolScannerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
