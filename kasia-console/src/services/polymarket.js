/**
 * Polymarket Trading Service — 预测市场交易接口
 *
 * 通过 Polymarket CLOB API 在 Polygon 链上交易预测市场合约。
 * 使用 EIP-712 签名认证，USDC 结算。
 *
 * 交易流程：
 *   1. 创建 Polygon 钱包（复用 EVM 钱包生成）
 *   2. 充值 USDC 到 Polygon 钱包
 *   3. Approve USDC 给 Polymarket CTF Exchange 合约
 *   4. 通过 CLOB API 下限价单
 *
 * 数据来源：Gamma API（行情）+ CLOB API（交易）
 */
import { ethers } from 'ethers';
import { createHmac } from 'crypto';
import { sqlite } from '../db/client.js';
import { decrypt } from './crypto.js';

const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const POLYGON_RPC = 'https://polygon-bor-rpc.publicnode.com';
const CHAIN_ID = 137; // Polygon mainnet

// Polymarket CTF Exchange contract (for approvals)
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
// USDC on Polygon
const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_DECIMALS = 6;

const TIMEOUT = 10000;

/**
 * 获取 Agent 的 Polygon 钱包
 */
export function getPolygonWallet(relayNodeId) {
  const wallet = sqlite.prepare(
    "SELECT id, address, chain FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
  ).get(relayNodeId);
  return wallet;
}

/**
 * 获取 Polygon 钱包的 USDC 余额
 */
export async function getUsdcBalance(address) {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const usdc = new ethers.Contract(USDC_POLYGON, [
      'function balanceOf(address) view returns (uint256)'
    ], provider);
    const balance = await usdc.balanceOf(address);
    return parseFloat(ethers.formatUnits(balance, USDC_DECIMALS));
  } catch (e) {
    console.error('[polymarket] USDC balance error:', e.message);
    return null;
  }
}

/**
 * 创建 CLOB API 密钥（L2 认证）
 * 需要用钱包私钥签名一个注册消息
 */
export async function createApiKey(privateKey) {
  try {
    const { ClobClient } = await import('@polymarket/clob-client');
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    // SDK 要求 ethers v5 的 _signTypedData，ethers v6 用 signTypedData
    if (!wallet._signTypedData && wallet.signTypedData) {
      wallet._signTypedData = wallet.signTypedData.bind(wallet);
    }
    const client = new ClobClient(CLOB_BASE, CHAIN_ID, wallet);

    // 先尝试 derive（如果之前创建过），失败再 create
    let creds;
    try {
      creds = await client.createOrDeriveApiKey();
    } catch (e) {
      // fallback: 直接 create
      creds = await client.createApiKey();
    }

    const apiKey = creds?.apiKey || creds?.key;
    if (!apiKey) return { ok: false, error: 'API returned empty credentials' };
    return { ok: true, apiKey, secret: creds.secret, passphrase: creds.passphrase };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * CLOB API 签名请求头
 */
function clobHeaders(apiKey, secret, passphrase, method, path, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method + path + (body || '');
  const hmac = createHmac('sha256', Buffer.from(secret, 'base64'));
  hmac.update(message);
  const signature = hmac.digest('base64');

  return {
    'POLY_ADDRESS': apiKey,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
  };
}

/**
 * 获取市场详情（含 CLOB token IDs）
 */
export async function getMarketDetails(conditionId) {
  try {
    const res = await fetch(`${GAMMA_BASE}/markets?conditionId=${conditionId}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'KANet/1.0' },
    });
    if (!res.ok) return null;
    const markets = await res.json();
    return markets[0] || null;
  } catch { return null; }
}

/**
 * 获取订单簿
 */
export async function getOrderBook(tokenId) {
  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * 查询持仓
 */
export async function getPositions(apiKey, secret, passphrase) {
  const path = '/positions';
  const headers = clobHeaders(apiKey, secret, passphrase, 'GET', path);
  try {
    const res = await fetch(`${CLOB_BASE}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/**
 * 下单
 * @param {object} order - { tokenId, side: 'BUY'|'SELL', price: 0.01-0.99, size: number }
 */
export async function placeOrder(apiKey, secret, passphrase, order) {
  const path = '/order';
  const body = JSON.stringify({
    tokenID: order.tokenId,
    price: order.price.toString(),
    size: order.size.toString(),
    side: order.side,
    type: 'GTC', // Good Till Cancelled
  });

  const headers = clobHeaders(apiKey, secret, passphrase, 'POST', path, body);
  try {
    const res = await fetch(`${CLOB_BASE}${path}`, {
      method: 'POST', headers, body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, orderId: data.orderID || data.id, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 撤单
 */
export async function cancelOrder(apiKey, secret, passphrase, orderId) {
  const path = `/order/${orderId}`;
  const headers = clobHeaders(apiKey, secret, passphrase, 'DELETE', path);
  try {
    const res = await fetch(`${CLOB_BASE}${path}`, {
      method: 'DELETE', headers,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 检查 USDC Allowance（CTF Exchange 是否已授权）
 */
export async function checkAllowance(address) {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const usdc = new ethers.Contract(USDC_POLYGON, [
      'function allowance(address owner, address spender) view returns (uint256)'
    ], provider);
    const allowance = await usdc.allowance(address, CTF_EXCHANGE);
    const amount = parseFloat(ethers.formatUnits(allowance, USDC_DECIMALS));
    return { approved: amount > 0, allowance: amount };
  } catch (e) {
    console.error('[polymarket] allowance check error:', e.message);
    return { approved: false, allowance: 0, error: e.message };
  }
}

/**
 * Approve USDC 给 CTF Exchange（一次性操作，approve max uint256）
 * @param {string} privateKey — Agent 的 Polygon 钱包私钥
 * @returns {{ ok, txHash, error? }}
 */
export async function approveUsdc(privateKey) {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    const usdc = new ethers.Contract(USDC_POLYGON, [
      'function approve(address spender, uint256 amount) returns (bool)'
    ], wallet);
    const maxUint = ethers.MaxUint256;
    const tx = await usdc.approve(CTF_EXCHANGE, maxUint);
    console.log(`[polymarket] Approve TX sent: ${tx.hash}`);
    return { ok: true, txHash: tx.hash };
  } catch (e) {
    console.error('[polymarket] Approve error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * 检查 Approve TX 是否已确认
 */
export async function checkTxStatus(txHash) {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { confirmed: false, status: 'pending' };
    return {
      confirmed: true,
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
    };
  } catch (e) {
    return { confirmed: false, status: 'error', error: e.message };
  }
}

/**
 * 查活跃订单
 */
export async function getOpenOrders(apiKey, secret, passphrase) {
  const path = '/orders?state=LIVE';
  const headers = clobHeaders(apiKey, secret, passphrase, 'GET', path);
  try {
    const res = await fetch(`${CLOB_BASE}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}
