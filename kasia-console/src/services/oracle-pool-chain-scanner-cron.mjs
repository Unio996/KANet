// oracle-pool-chain-scanner-cron.mjs — Bettor r449 派工 (a):
// 定时刷新 oracle_pool_chain_view 保 chain_view 新鲜 (5min tick, 同 pool-market-settler 节奏).
// 不依赖 API endpoint 触发, 服务启动后自动跑.

import { scanAndDerivePool } from './oracle-pool-chain-scanner.mjs';

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_GRACE_MS = 60 * 1000;

let timer = null;
let running = false;

// 共享客户端(2026-08-30 J2 批 1, ../lib/kaspa-rpc-shared.mjs): 原每 5 min tick 两次 new RpcClient+disconnect = 构造器级泄漏 ~17 KB/次;
// 现两处都取同一共享实例, 不 disconnect; 断连类错误交 noteSharedRpcError 分类(同实例下次重连)。
async function _getCurrentDaa(rpcUrl, networkId) {
  const { getSharedRpc, noteSharedRpcError } = await import('../lib/kaspa-rpc-shared.mjs');
  const rpc = await getSharedRpc({ url: rpcUrl, networkId });
  try {
    const dag = await rpc.getBlockDagInfo();
    return Number(dag.virtualDaaScore);
  } catch (e) { await noteSharedRpcError(rpc, e); throw e; }
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

    const { getSharedRpc, noteSharedRpcError } = await import('../lib/kaspa-rpc-shared.mjs');
    const rpc = await getSharedRpc({ url: rpcUrl, networkId });
    try {
      const result = await scanAndDerivePool({ rpc, networkId, currentDaa });
      console.log(`[oracle-pool-scanner-cron] tick: snapshotDaa=${result.snapshotDaa} poolSize=${result.poolSize} merkleRoot=${result.merkleRoot.slice(0,12)} (scanned=${result.scanned}/valid=${result.valid}/rejected=${result.rejected}${result.fromCache ? ' cached' : ''})`);
      return { ok: true, ...result };
    } catch (e) { await noteSharedRpcError(rpc, e); throw e; }
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
