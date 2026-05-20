// broker-treasury-monitor.js — P2 multi-chain balance snapshot + imbalance alert
// NWT N19.6 + Owner 5/18 钦定 Exchange-OTC-broker 自主运营 #3 (broker 动态资产管理平衡)
//
// 设计:
// - 5min cron tick: snapshot 各链 USDT/USDC/KAS balance (broker Trader-B wallets)
// - 写 treasury_snapshot 表 (v122)
// - 阈值 alert: 写 chain_event 'treasury_alert' (broker 自治, Brain visible, 不 DM Owner)
// - read-only, 不动钱 (auto-rebalance 排日 Phase 2)
//
// vs broker-inventory-watcher.js: 后者是 BSC USDC 单一 auto-swap action, 本 service 是 multi-chain passive monitor.
// 两者并存 (single responsibility — one swaps, one monitors).

import { ethers } from 'ethers';
import { sqlite } from '../db/client.js';
import { withFallbackRpc } from './chains.js';
import { getConfig } from '../data/settings/configs.js';
import { decrypt } from './crypto.js';
import { getBalance as cexGetBalance } from './exchange-orders.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TICK_INTERVAL_MS = 5 * 60_000; // 5 min, stagger 2.5 min offset from market-seeder
const TICK_OFFSET_MS = 150_000;

// Token addrs (Across V3 5 chain coverage + base USDC). NWT N18.4 一致.
const TOKEN_REGISTRY = {
  bnb:      { USDT: '0x55d398326f99059fF775485246999027B3197955', USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  eth:      { USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  polygon:  { USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  arbitrum: { USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  optimism: { USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
  base:     { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }, // no native USDT on base
};

const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

// Alert thresholds — Phase 5-3 KI N19.68 migrate to config_entries DB (Owner runtime tune via UI)
// Defaults preserve original values. Floor: 任一链单 asset < $50 → alert. Imbalance: > $500 + < $50.
const FLOOR_USD_DEFAULT = 50;
const HIGH_THRESHOLD_USD_DEFAULT = 500;

let _tickInterval = null;
let _ticking = false;

async function _snapshotEvmBalance(chain, asset, tokenAddr, decimals, walletAddr) {
  return withFallbackRpc(chain, async (provider) => {
    const c = new ethers.Contract(tokenAddr, ERC20_BALANCE_ABI, provider);
    const balanceRaw = await c.balanceOf(walletAddr);
    const balanceHuman = parseFloat(ethers.formatUnits(balanceRaw, decimals));
    return { chain, asset, balance_raw: balanceRaw.toString(), balance_human: balanceHuman, source: 'rpc' };
  });
}

// Phase 5-2 Sub-2 KI 37 (NWT N19.70): CEX inventory snapshot 加入 5min tick.
async function _snapshotCexBalance(accountRow) {
  try {
    const apiKey = accountRow.api_key_encrypted ? decrypt(accountRow.api_key_encrypted) : null;
    const apiSecret = accountRow.api_secret_encrypted ? decrypt(accountRow.api_secret_encrypted) : null;
    const passphrase = accountRow.extra_encrypted ? (JSON.parse(decrypt(accountRow.extra_encrypted))?.passphrase || null) : null;
    if (!apiKey || !apiSecret) return [];
    const bal = await cexGetBalance({
      exchange: accountRow.exchange, apiKey, apiSecret, passphrase, baseUrl: accountRow.base_url,
    });
    if (bal.error || (bal.kas === null && bal.usdt === null)) return [];
    const rows = [];
    if (bal.kas !== null && bal.kas !== undefined) {
      rows.push({ chain: `cex:${accountRow.exchange}`, asset: 'KAS', balance_raw: String(bal.kas * 1e8), balance_human: bal.kas, source: 'cex_api' });
    }
    if (bal.usdt !== null && bal.usdt !== undefined) {
      rows.push({ chain: `cex:${accountRow.exchange}`, asset: 'USDT', balance_raw: String(bal.usdt * 1e6), balance_human: bal.usdt, source: 'cex_api' });
    }
    return rows;
  } catch (err) {
    console.warn(`[treasury-monitor] cex:${accountRow.exchange} balance fail: ${err.message}`);
    return [];
  }
}

async function _snapshotKaspaBalance(walletAddr) {
  // Console-internal API call (kaspa-ws-proxy via /api/relay/.../balance)
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/relay/${BROKER_RELAY_ID}/balance`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const kas = parseFloat(data.balance);
    return { chain: 'kaspa', asset: 'KAS', balance_raw: data.balance_raw || String(kas * 1e8), balance_human: kas, source: 'kaspad' };
  } catch (err) {
    console.warn(`[treasury-monitor] kaspa balance fetch fail: ${err.message}`);
    return null;
  }
}

async function _runSnapshot() {
  if (_ticking) return { ok: false, reason: 'tick_in_progress' };
  _ticking = true;
  try {
    const wallets = sqlite.prepare(
      'SELECT chain, address FROM agent_wallets WHERE relay_node_id = ?'
    ).all(BROKER_RELAY_ID);

    // J2 P0 fix 5/19 (Owner 5/19 "快!" 钦定): sequential RPC → Promise.all parallel.
    // 旧 sequential await EVM RPC × N chains × 2 assets → cumulative 30+ sec event loop block
    // (arbitrum/eth/optimism RPC timeout 各 5-10s + JsonRpcProvider retry 1s × N).
    // 修后 parallel: 单 worst chain 限速 ~5s, console event loop 不阻.
    const tasks = [];
    for (const w of wallets) {
      if (w.chain === 'kaspa' || w.chain === 'kaspad') {
        tasks.push(_snapshotKaspaBalance(w.address).catch(err => {
          console.warn(`[treasury-monitor] kaspa balance fail: ${err.message}`);
          return null;
        }));
        continue;
      }
      const tokens = TOKEN_REGISTRY[w.chain];
      if (!tokens) continue;
      for (const asset of ['USDT', 'USDC']) {
        if (!tokens[asset]) continue;
        tasks.push(_snapshotEvmBalance(w.chain, asset, tokens[asset], tokens.decimals, w.address).catch(err => {
          console.warn(`[treasury-monitor] ${w.chain}/${asset} balance fail: ${err.message}`);
          return null;
        }));
      }
    }
    // Phase 5-2 Sub-2: CEX inventory snapshot 加入 parallel batch
    const cexAccounts = sqlite.prepare('SELECT * FROM exchange_accounts').all();
    for (const acc of cexAccounts) {
      tasks.push(_snapshotCexBalance(acc));  // returns array, flatten below
    }
    const taskResults = await Promise.all(tasks);
    const snapshots = [];
    for (const r of taskResults) {
      if (r === null) continue;
      if (Array.isArray(r)) snapshots.push(...r);
      else snapshots.push(r);
    }

    // Persist snapshots
    const ins = sqlite.prepare(
      'INSERT INTO treasury_snapshot (relay_node_id, chain, asset, balance_raw, balance_human, source) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const tx = sqlite.transaction((items) => {
      for (const s of items) ins.run(BROKER_RELAY_ID, s.chain, s.asset, s.balance_raw, s.balance_human, s.source);
    });
    tx(snapshots);

    // Imbalance / floor alerts (per asset, cross-chain)
    const byAsset = {};
    for (const s of snapshots) {
      if (!byAsset[s.asset]) byAsset[s.asset] = [];
      byAsset[s.asset].push(s);
    }

    const FLOOR_USD = parseFloat(await getConfig('broker_treasury_floor_usd') || String(FLOOR_USD_DEFAULT));
    const HIGH_THRESHOLD_USD = parseFloat(await getConfig('broker_treasury_high_usd') || String(HIGH_THRESHOLD_USD_DEFAULT));
    // Phase 5-2 Sub-1 KI 36 (NWT N19.70): KAS pool alarm (KAS 之前 skip, broker 主 pool 没监控)
    const KAS_FLOOR = parseFloat(await getConfig('broker_kas_floor') || '5000');
    const KAS_HIGH = parseFloat(await getConfig('broker_kas_high') || '50000');
    const alerts = [];
    // KAS pool specific alarm (KAS native, USD scale 不通用)
    const kasSnap = snapshots.find(s => s.asset === 'KAS' && (s.chain === 'kaspa' || s.chain === 'kaspad'));
    if (kasSnap) {
      if (kasSnap.balance_human < KAS_FLOOR) {
        alerts.push({ type: 'kas_floor', asset: 'KAS', chain: kasSnap.chain, balance: kasSnap.balance_human, threshold: KAS_FLOOR });
      }
      if (kasSnap.balance_human > KAS_HIGH) {
        alerts.push({ type: 'kas_high', asset: 'KAS', chain: kasSnap.chain, balance: kasSnap.balance_human, threshold: KAS_HIGH });
      }
    }
    // Phase 5-2 Sub-2 KI 37: Bybit KAS accumulation alarm (积压 → Owner 周期 withdraw)
    const bybitKasAccum = parseFloat(await getConfig('bybit_kas_accumulation_alert') || '1000');
    const bybitKasSnap = snapshots.find(s => s.chain === 'cex:bybit' && s.asset === 'KAS');
    if (bybitKasSnap && bybitKasSnap.balance_human > bybitKasAccum) {
      alerts.push({ type: 'cex_kas_accum', cex: 'bybit', balance: bybitKasSnap.balance_human, threshold: bybitKasAccum });
    }
    for (const [asset, list] of Object.entries(byAsset)) {
      const low = list.filter(s => s.balance_human < FLOOR_USD && asset !== 'KAS'); // KAS native, different scale
      const high = list.filter(s => s.balance_human > HIGH_THRESHOLD_USD && asset !== 'KAS');
      if (low.length > 0) {
        alerts.push({ type: 'floor', asset, chains_low: low.map(s => `${s.chain}:${s.balance_human.toFixed(2)}`).join(', ') });
      }
      if (low.length > 0 && high.length > 0) {
        alerts.push({ type: 'imbalance', asset, low: low.map(s => s.chain).join(','), high: high.map(s => s.chain).join(',') });
      }
    }

    if (alerts.length > 0) {
      const { recordChainEvent } = await import('./chain-event.js');
      for (const a of alerts) {
        try {
          recordChainEvent({
            txid: `treasury_alert_${a.type}_${a.asset}_${Date.now()}`,
            eventType: 'treasury_alert',
            payload: JSON.stringify(a),
          });
        } catch (err) { /* audit best-effort */ }
      }
      console.warn(`[treasury-monitor] ${alerts.length} alert(s):`, JSON.stringify(alerts).slice(0, 300));
    }

    return { ok: true, snapshots: snapshots.length, alerts: alerts.length };
  } catch (err) {
    console.error(`[treasury-monitor] snapshot tick err: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    _ticking = false;
  }
}

export function startTreasuryMonitor() {
  if (_tickInterval) return;
  // Stagger: first tick at offset to avoid clashing with market-seeder
  setTimeout(() => {
    _runSnapshot().catch(() => {});
    _tickInterval = setInterval(() => _runSnapshot().catch(() => {}), TICK_INTERVAL_MS);
  }, TICK_OFFSET_MS);
  console.log(`[treasury-monitor] started — 5min snapshot, stagger 2.5min offset from market-seeder`);
}

export function stopTreasuryMonitor() {
  if (_tickInterval) clearInterval(_tickInterval);
  _tickInterval = null;
}

// 测试 / 内部访问
export const _internals = { _runSnapshot, TOKEN_REGISTRY, FLOOR_USD_DEFAULT, HIGH_THRESHOLD_USD_DEFAULT };
