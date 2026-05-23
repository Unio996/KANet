/**
 * settler-router.js — Phase B v1.1 (J1, Owner 22:23 钦定 'KAS 参数化')
 *
 * 抽 sendAsset 单一接口, 路由到现有 settler (不重写):
 *   - 'kasia' settler → relay sendCommandAsync({ type: 'send_kas' })
 *   - 'evm' settler → evm-transfer.transferERC20 (BSC USDT / ETH USDT 已支持)
 *   - 'sol' / 'tron' settler → 留 v1.2 (sol-transfer / tron-transfer 已存在但 Phase B 不接)
 *
 * Phase A (NWT broker handler 参数化) 真用 sendAsset 替 hardcoded sendKas 调用,
 * v1.1 真 X↔Y 市场就此通.
 *
 * 不动现有 settler 实施 (evm-transfer 已 multi-chain, sendKas 真 work) — 只加路由层.
 */

import { getAsset } from './asset-registry.js';
import { sqlite } from '../db/client.js';
// R-NWT-2026-04-28 Layer 5: canonical command enum (Z21 Owner 88 KAS 真根因 fix).
import { COMMAND_TYPES } from '../../../kasia-relay/src/lib/commands.mjs';

/**
 * Send asset via the right settler.
 *
 * @param {Object} params
 * @param {string} params.asset — symbol (KAS / USDT)
 * @param {string} params.chain — chain (kaspa / bnb / eth)
 * @param {string} params.to — recipient address
 * @param {number} params.qty — amount in human-readable units
 * @param {string} params.relayId — relay UUID (must own a wallet on this chain)
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, error: string }>}
 */
export async function sendAsset({ asset, chain, to, qty, relayId }) {
  const meta = getAsset(asset, chain);
  if (!meta) {
    return { ok: false, error: `Unsupported asset ${asset}/${chain} (see asset-registry)` };
  }
  if (qty < meta.minQty) {
    return { ok: false, error: `qty ${qty} < min ${meta.minQty} for ${asset}/${chain}` };
  }
  if (!relayId) {
    return { ok: false, error: 'relayId required (sender must own wallet)' };
  }

  if (meta.settler === 'kasia') {
    // Native KAS via Kasia relay
    const { sendCommandAsync } = await import('./relay-manager.js');
    // Z21 fix: relay only supports 'transfer' (cmd.amount), not 'send_kas' (cmd.amount_kas).
    const r = await sendCommandAsync(relayId, { type: COMMAND_TYPES.TRANSFER, target: to, amount: qty });
    return r?.txId
      ? { ok: true, txHash: r.txId }
      : { ok: false, error: r?.error || 'transfer failed (no txId)' };
  }

  if (meta.settler === 'evm') {
    // EVM ERC20 (USDT BSC / USDT ETH) via existing evm-transfer
    const wallet = sqlite.prepare(
      `SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1`
    ).get(relayId, chain);
    if (!wallet?.privkey_encrypted) {
      return { ok: false, error: `No ${chain} wallet for relay ${relayId.slice(0, 8)}` };
    }
    const { transferERC20 } = await import('./evm-transfer.js');
    const r = await transferERC20(chain, wallet.privkey_encrypted, to, qty, asset);
    return r;
  }

  // sol / tron 留 v1.2 (sol-transfer / tron-transfer 已存在但 Phase B 不接 router)
  return { ok: false, error: `Settler ${meta.settler} 留 v1.2 (Phase B v1.1 仅 kasia + evm)` };
}

/**
 * Verify that sender (relayId) has a wallet capable of sending given asset.
 * Useful for Phase A broker handler pre-flight check.
 *
 * @param {string} relayId
 * @param {string} asset
 * @param {string} chain
 * @returns {boolean}
 */
export function canSendAsset(relayId, asset, chain) {
  const meta = getAsset(asset, chain);
  if (!meta) return false;
  if (meta.settler === 'kasia') {
    // Kaspa relay-level wallet (relay process owns kaspa addr)
    const r = sqlite.prepare(`SELECT id FROM relay_nodes WHERE id = ?`).get(relayId);
    return !!r;
  }
  if (meta.settler === 'evm') {
    const w = sqlite.prepare(
      `SELECT id FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1`
    ).get(relayId, chain);
    return !!w;
  }
  return false;
}
