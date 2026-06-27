// ════════════════════════════════════════════════════════════════
// cex-bridge.js — Phase 1 T2.3 — CEX 统一桥接 (Gate.io 优先 ship)
//
// Owner sediment:
//   5/8: "实际操作提币摩擦费用较高, 计提记账即可, 积累到一定量再提币"
//   5/9: "先打通!" Phase 1 ship 启动
//
// 复用现有: exchange-orders.js (placeOrder/getBalance/getOrder)
//          + crypto.js (decrypt) + EXCHANGE_REGISTRY (lib/exchange-registry.js)
//          + exchange_accounts 表 (5 row populated since 4/12, NWT r264 verified)
//
// 新加 5/9: getDepositAddr (查充值地址) + withdrawCex (Gate.io v4 verified Owner 5/8 id w95932470)
// 仅 wrap + Gate.io v4 endpoint reuse, 不动 exchange-orders.js logic.
//
// 其他 4 家 CEX (Bybit/Bitget/KuCoin/MEXC) 后续 add — Phase 1 仅 Gate.io.
// ════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { sqlite } from '../db/client.js';
import { decrypt } from './crypto.js';
import { EXCHANGE_REGISTRY } from '../lib/exchange-registry.js';
import { placeOrder, getBalance, getOrder } from './exchange-orders.js';

function sha512Hex(data) { return crypto.createHash('sha512').update(data).digest('hex'); }
function hmac512Hex(secret, data) { return crypto.createHmac('sha512', secret).update(data).digest('hex'); }

// chain 别名映射 (用户输入 trc20/bep20/erc20 等 → Gate.io 内部 TRX/BSC/ETH)
const CHAIN_ALIAS = {
  trx: 'TRX', trc20: 'TRX', tron: 'TRX',
  bsc: 'BSC', bep20: 'BSC', bnb: 'BSC',
  eth: 'ETH', erc20: 'ETH',
  kaspa: 'KAS', kas: 'KAS',
  sol: 'SOL', solana: 'SOL',
};
function normalizeChain(chain) {
  if (!chain) return null;
  return CHAIN_ALIAS[String(chain).toLowerCase()] || String(chain).toUpperCase();
}

/**
 * 按 cex id 拿 decrypted account (匹配 cex, 退而 default).
 * @param {string} cex - 'gateio' / 'mexc' / 'bybit' 等
 * @returns {object|null} { exchange, apiKey, apiSecret, extra, baseUrl, def }
 */
export function getCexAccount(cex) {
  const row = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ? LIMIT 1').get(cex)
    || sqlite.prepare('SELECT * FROM exchange_accounts WHERE is_default = 1 LIMIT 1').get();
  if (!row) return null;
  try {
    const apiKey = row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null;
    const apiSecret = row.api_secret_encrypted ? decrypt(row.api_secret_encrypted) : null;
    const extra = row.extra_encrypted ? JSON.parse(decrypt(row.extra_encrypted)) : {};
    const def = EXCHANGE_REGISTRY.find(e => e.id === row.exchange);
    return { exchange: row.exchange, apiKey, apiSecret, extra, baseUrl: row.base_url || def?.baseUrl, def };
  } catch { return null; }
}

/**
 * 查 CEX 充值地址.
 * Gate.io: GET /api/v4/wallet/deposit_address?currency={ASSET}
 * 返回 multichain_addresses[] 含 TRX/BSC/ETH 各链地址.
 * @param {object} p { cex='gateio', asset, chain? }
 * @returns {object} { ok, address, chain, error }
 */
export async function getDepositAddr({ cex = 'gateio', asset, chain }) {
  const account = getCexAccount(cex);
  if (!account) return { ok: false, error: `no exchange_accounts row for ${cex}` };
  if (account.exchange !== 'gateio') return { ok: false, error: `cex-bridge Phase 1 仅支持 gateio, 当前 ${account.exchange}` };

  const path = `/wallet/deposit_address?currency=${String(asset).toUpperCase()}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = sha512Hex('');
  const signStr = `GET\n/api/v4${path.split('?')[0]}\n${path.split('?')[1] || ''}\n${bodyHash}\n${ts}`;
  const sig = hmac512Hex(account.apiSecret, signStr);

  try {
    const res = await fetch(`${account.baseUrl}${path}`, {
      headers: { 'KEY': account.apiKey, 'SIGN': sig, 'Timestamp': ts },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data.label || data.message) return { ok: false, error: data.message || data.label, raw: data };
    if (chain && Array.isArray(data.multichain_addresses)) {
      const wantChain = normalizeChain(chain);
      const found = data.multichain_addresses.find(a => a.chain === wantChain);
      if (found) return { ok: true, address: found.address, chain: found.chain, raw: data };
      return { ok: false, error: `chain ${wantChain} 不在 Gate.io ${asset} multichain list`, raw: data };
    }
    return { ok: true, address: data.address, chain: null, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * CEX withdraw 链上 TX (Owner 5/8 verified Gate.io: id w95932470 work).
 * Gate.io: POST /api/v4/withdrawals
 * 注意: Gate.io 扣 user 总额 (含 fee), chain TX 发 net 量 (NWT r266: user-pay-fee 锁定).
 * @param {object} p { cex='gateio', asset, amount, toAddr, chain }
 * @returns {object} { ok, withdraw_id, txid?, error }
 */
export async function withdrawCex({ cex = 'gateio', asset, amount, toAddr, chain }) {
  const account = getCexAccount(cex);
  if (!account) return { ok: false, error: `no exchange_accounts row for ${cex}` };
  if (account.exchange !== 'gateio') return { ok: false, error: `cex-bridge Phase 1 仅支持 gateio, 当前 ${account.exchange}` };

  const gateChain = normalizeChain(chain);
  if (!gateChain) return { ok: false, error: 'chain 必填' };

  const path = '/withdrawals';
  const body = JSON.stringify({
    currency: String(asset).toUpperCase(),
    address: String(toAddr),
    amount: Number(amount).toFixed(8),
    chain: gateChain,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyHash = sha512Hex(body);
  const signStr = `POST\n/api/v4${path}\n\n${bodyHash}\n${ts}`;
  const sig = hmac512Hex(account.apiSecret, signStr);

  try {
    const res = await fetch(`${account.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'KEY': account.apiKey, 'SIGN': sig, 'Timestamp': ts },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.label || data.message) return { ok: false, error: data.message || data.label, raw: data };
    return { ok: true, withdraw_id: data.id, txid: data.txid || null, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 下 CEX 现货单 (wrap exchange-orders.js placeOrder).
 * @param {object} p { cex='gateio', side ('BUY'|'SELL'), qty, price }
 * @returns {object} { ok, orderId, status, executedQty, error }
 */
export async function placeCexOrder({ cex = 'gateio', side, qty, price }) {
  const account = getCexAccount(cex);
  if (!account?.def) return { ok: false, error: `no account/def for ${cex}` };
  return placeOrder({
    authStyle: account.def.authStyle,
    baseUrl: account.baseUrl,
    headerName: account.def.headerName,
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    extra: account.extra,
    symbol: account.def.kasPair,
    kasPair: account.def.kasPair,
    side: String(side).toUpperCase(),
    price,
    qty,
  });
}

/**
 * 查 CEX 单 status (T2.5 poll fill 必需).
 * Gate.io 算 executedQty = amount - left (ch14 陷阱 #37 已守).
 * @param {object} p { cex='gateio', orderId }
 * @returns {object} { orderId, status, filled, executedQty, error }
 */
export async function getCexOrder({ cex = 'gateio', orderId }) {
  const account = getCexAccount(cex);
  if (!account) return { orderId, status: 'unknown', filled: false, executedQty: 0, error: `no account for ${cex}` };
  return getOrder(account, orderId);
}

/**
 * 查 CEX 余额 (wrap exchange-orders.js getBalance).
 * @param {object} p { cex='gateio', asset? }
 * @returns {object} asset 指定时 {ok,asset,balance} 否则 {ok,kas,usdt}
 */
export async function getCexBalance({ cex = 'gateio', asset }) {
  const account = getCexAccount(cex);
  if (!account) return { ok: false, error: `no account for ${cex}` };
  const result = await getBalance({
    exchange: account.exchange,
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    passphrase: account.extra?.passphrase,
    baseUrl: account.baseUrl,
  });
  if (result.error) return { ok: false, error: result.error };
  const a = String(asset || '').toUpperCase();
  if (a === 'USDT') return { ok: true, asset: 'USDT', balance: result.usdt };
  if (a === 'KAS') return { ok: true, asset: 'KAS', balance: result.kas };
  return { ok: true, kas: result.kas, usdt: result.usdt };
}
