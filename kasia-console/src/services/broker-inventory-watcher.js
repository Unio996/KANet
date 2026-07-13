// broker-inventory-watcher.js — broker BSC USDC 真 auto-replenish swap (J2 #3 v1.1 自治库存)
// 真 trigger: broker BSC USDC < MIN_RESERVE → auto swap N USDT → ~N USDC (PancakeSwap V2)
// 真 design (Owner '丝滑 10 链' 钦定): broker 真自治, 真不 manual swap 每次 user 真买 USDC
// 真 spec gated by config flag (default off), 真 opt-in production

import { ethers } from 'ethers';
import { sqlite } from '../db/client.js';
import { swapUsdtToUsdc } from './broker-swap.js';

// Bettor #j5romh r766 身份迁移补全, env 缺失 fail-loud 拒启(死值兜底=定时雷, 见 kanet.env)。
const BROKER_RELAY_ID = process.env.BROKER_RELAY_ID;
if (!BROKER_RELAY_ID) {
  throw new Error('[broker-inventory-watcher] FATAL: BROKER_RELAY_ID env var not set (see kanet.env) — refusing to start with hardcoded dead relay id fallback');
}
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

// 真 config (gated, default off — opt-in via config table)
const DEFAULT_MIN_USDC_RESERVE = 1.0;     // 真 trigger 真 swap 真 below 1 USDC
const DEFAULT_REPLENISH_AMOUNT = 1.0;     // 真 swap 1 USDT → ~1 USDC each tick
const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000;  // 真 check 5min interval

let _provider = null;
let _ticking = false;

function _getProvider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(BSC_RPC);
  return _provider;
}

async function _getConfig() {
  // T-J2-2026-04-27: opt-in via configs table (default off)
  try {
    const { getConfig } = await import('../data/settings/configs.js');
    const enabled = await getConfig('broker_inventory_auto_replenish');
    const minReserve = parseFloat(await getConfig('broker_usdc_min_reserve') || DEFAULT_MIN_USDC_RESERVE);
    const amount = parseFloat(await getConfig('broker_usdc_replenish_amount') || DEFAULT_REPLENISH_AMOUNT);
    return { enabled: enabled === 'true', minReserve, amount };
  } catch {
    return { enabled: false, minReserve: DEFAULT_MIN_USDC_RESERVE, amount: DEFAULT_REPLENISH_AMOUNT };
  }
}

async function _checkAndReplenish() {
  if (_ticking) return;
  _ticking = true;
  try {
    const cfg = await _getConfig();
    if (!cfg.enabled) return;

    const wallet = sqlite.prepare(`SELECT address, privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
    if (!wallet?.privkey_encrypted) return;

    const usdc = new ethers.Contract(USDC_BSC, ERC20_ABI, _getProvider());
    const balance = parseFloat(ethers.formatUnits(await usdc.balanceOf(wallet.address), 18));

    if (balance >= cfg.minReserve) return; // 真足

    console.log(`[broker-inventory] BSC USDC ${balance.toFixed(6)} < ${cfg.minReserve} 真 auto-replenish swap ${cfg.amount} USDT`);
    const result = await swapUsdtToUsdc(wallet.privkey_encrypted, cfg.amount, 0.5);
    if (result.ok) {
      console.log(`[broker-inventory] ✓ auto-replenish tx ${result.txHash.slice(0,12)} +${result.usdcReceived.toFixed(6)} USDC`);
      // chain_event audit
      // T-J2-2026-04-30 Site D fix (RCA Owner 真测 R1 follow-up audit): EVM tx_hash 来自 ethers.js
      // tx.hash 是 '0x' + 64-hex = 66 chars. v83 trigger chain_events_txid_format_check 强制
      // length=64 + all hex → ABORT. Kaspa hash 64 chars 无前缀 ✓ pass; EVM hash 必 strip 0x.
      // 静默副作用: 每次 broker auto-replenish swap 真做了 (USDC 真到 broker 钱包), 但 audit
      // INSERT 失 → 状态机失明. fix: strip 0x 前缀 keep 64-hex.
      const crypto = await import('crypto');
      const cleanTxHash = String(result.txHash || '').replace(/^0x/i, '');
      sqlite.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
        VALUES (?, ?, ?, ?, 'broker_auto_replenish', ?, ?, datetime('now'))`)
        .run(crypto.randomUUID(), cleanTxHash, wallet.address, wallet.address,
          JSON.stringify({ swap_dex: 'pancakeswap_v2', from_balance: balance, swap_amount_usdt: cfg.amount, received_usdc: result.usdcReceived, reason: 'auto_replenish_below_min_reserve' }),
          'broker_inventory_watcher');
    } else {
      console.warn(`[broker-inventory] ✗ replenish fail: ${result.error}`);
    }
  } catch (err) {
    console.error(`[broker-inventory] tick err: ${err.message}`);
  } finally {
    _ticking = false;
  }
}

let _intervalId = null;
export function start(intervalMs = DEFAULT_TICK_INTERVAL_MS) {
  if (_intervalId) return;
  _intervalId = setInterval(_checkAndReplenish, intervalMs);
  console.log(`[broker-inventory] started (interval ${intervalMs}ms, check broker BSC USDC reserve)`);
  // 真 first tick 立即跑
  setTimeout(_checkAndReplenish, 5000);
}

export function stop() {
  if (_intervalId) clearInterval(_intervalId);
  _intervalId = null;
  if (_provider) { try { _provider.destroy?.(); } catch {} _provider = null; }
}

// 真 export for manual test / probe
export { _checkAndReplenish, _getConfig };
