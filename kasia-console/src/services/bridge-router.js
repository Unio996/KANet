/**
 * bridge-router.js — Phase 2 β Sub #3.b + #3.b1
 * v0.1: NWT spec 63e6fb48 + 8fbe164f Polygon addr fix
 * v0.1.1: NWT spec 868a1925 LZ V2 extraOptions native gas drop
 *
 * KANet 价值结算原语跨链扩展: agent USDT/USDC bridge via Stargate V2 LayerZero (OFT).
 * 接 sendToken/quoteSend pool API. Taxi mode (oftCmd='0x') — direct transfer, no Bus batching.
 *
 * scope:
 *   - 5 EVM pool: BSC USDT/USDC + Polygon USDT + Arbitrum USDT + Optimism USDT + Base USDC
 *   - bridgeAsset({fromChain, toChain, asset, amount, recipient, relayId, slippagePct, nativeDropAmount, nativeDropTo, lzReceiveGas})
 *   - quoteBridge(...) 报价不执行
 *   - buildLzV2Options helper — LZ V2 OptionsType3 encoding (LZ_RECEIVE + optional NATIVE_DROP)
 *   - chain_events 入账 (bridge_initiated TX confirmed source, payload 含 nativeDrop fields)
 *
 * v0.2+ backlog:
 *   - Squid Router cross-asset / SOL/TRON Wormhole / LayerZero scan webhook listener
 *   - Avalanche/Ethereum pool / dest TX surfacing (bridge_completed)
 *
 * NO TX NO STATE CHANGE 铁律: source TX confirmed 才 record bridge_initiated.
 *
 * Source verify: Stargate V2 gitbook mainnet-contracts docs (J2 #330 triple WebFetch verify 5/13).
 * KI 第 6 次复刻 sediment (memory feedback_export_inventory_spec): mainnet contract address 必 verify against
 * external docs, NWT spec v0.1 Polygon USDT addr typo 已 J2 catch + fix 用 docs-verified value.
 */

import { ethers } from 'ethers';
import { decrypt } from './crypto.js';
import { EVM_RPC_URLS } from './chains.js';
import { sqlite } from '../db/client.js';
import { recordChainEvent } from './chain-event.js';

// ── Stargate V2 mainnet pool addresses + EIDs (J2 triple-verified against gitbook 5/13) ────────

const STARGATE_POOLS = {
  bnb:      { usdt: { pool: '0x138EB30f73BC423c6455C53df6D89CB01d9eBc63', decimals: 18 },
              usdc: { pool: '0x962Bd449E630b0d928f308Ce63f1A21F02576057', decimals: 18 } },
  polygon:  { usdt: { pool: '0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7', decimals: 6 } },
  arbitrum: { usdt: { pool: '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0', decimals: 6 } },
  optimism: { usdt: { pool: '0x19cFCE47eD54a88614648DC3f19A5980097007dD', decimals: 6 } },
  base:     { usdc: { pool: '0x27a16dc786820B16E5c9028b75B99F6f604b5d26', decimals: 6 } },
};

const STARGATE_EIDS = { bnb: 30102, polygon: 30109, arbitrum: 30110, optimism: 30111, base: 30184 };

const POOL_ABI = [
  // quoteSend(SendParam, payInLzToken) view → (nativeFee, lzTokenFee)
  'function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd), bool payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)',
  // sendToken(SendParam, MessagingFee, refundAddr) payable → (MessagingReceipt, OFTReceipt)
  'function sendToken((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd), (uint256 nativeFee, uint256 lzTokenFee), address refundAddress) payable returns (tuple(bytes32 guid, uint64 nonce, tuple(uint256 nativeFee, uint256 lzTokenFee) fee) receipt, tuple(uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)',
  // token() view → ERC20 address (for approval lookup)
  'function token() view returns (address)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// ── helpers ────────────────────────────────────────────────────────────────────

function _resolvePool(chain, asset) {
  const assetKey = String(asset).toLowerCase();
  const entry = STARGATE_POOLS[chain]?.[assetKey];
  if (!entry) {
    const available = Object.entries(STARGATE_POOLS)
      .flatMap(([c, ts]) => Object.keys(ts).map(t => `${c}/${t.toUpperCase()}`))
      .join(', ');
    return { error: `Stargate V2 ${chain}/${asset} pool not configured (v0.1 supports: ${available})` };
  }
  return entry;
}

function _addrToBytes32(addr) {
  // left-pad EVM address (20 bytes) to bytes32 — Stargate V2 SendParam.to format
  return ethers.zeroPadValue(ethers.getAddress(addr), 32);
}

function _getRelayWallet(relayId, chain) {
  return sqlite.prepare(
    `SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1`
  ).get(relayId, chain);
}

/**
 * Build LayerZero V2 OptionsType3 with LZ_RECEIVE gas + optional NATIVE_DROP.
 *
 * Encoding (J2 #332 docs triple-verified against LZ V2 OptionsBuilder.sol + ExecutorOptions.sol):
 *   0x0003                       — TYPE_3 header (uint16 BE)
 *   + 0x01 + 0x0011 + 0x01 + uint128(gas, 16 BE)              — LZ_RECEIVE (worker + size + type + payload)
 *   + 0x01 + 0x0031 + 0x02 + uint128(amount, 16 BE) + bytes32 — NATIVE_DROP (conditional, when amount > 0)
 *
 * Note: ExecutorOptions.encodeLzReceiveOption returns 16 bytes when _value=0 (gas only).
 * Our v0.1.1 doesn't pass _value (recipient receives native gas via NATIVE_DROP, not msg.value),
 * so LZ_RECEIVE option_size = 0x0011 (type 1B + gas 16B = 17B).
 *
 * @param {bigint} lzReceiveGas — gas for lzReceive on dest (Stargate V2 default 200000n)
 * @param {bigint} [nativeDropAmount=0n] — dest native amount in wei (e.g. 0.05 MATIC = 50000000000000000n)
 * @param {string} [nativeDropTo=null] — EVM recipient (0x...), required when nativeDropAmount > 0
 * @returns {string} 0x-prefixed hex
 */
export function buildLzV2Options(lzReceiveGas, nativeDropAmount = 0n, nativeDropTo = null) {
  const gasBytes = ethers.solidityPacked(['uint128'], [lzReceiveGas]);
  const parts = ['0x0003', '0x01', '0x0011', '0x01', gasBytes];
  if (nativeDropAmount > 0n) {
    if (!nativeDropTo) throw new Error('buildLzV2Options: nativeDropTo required when nativeDropAmount > 0');
    const amountBytes = ethers.solidityPacked(['uint128'], [nativeDropAmount]);
    const receiverBytes32 = _addrToBytes32(nativeDropTo);
    parts.push('0x01', '0x0031', '0x02', amountBytes, receiverBytes32);
  }
  return ethers.concat(parts);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Quote a Stargate V2 bridge (no execution).
 *
 * @param {Object} params
 * @param {string} params.fromChain — source chain ('bnb' / 'polygon' / 'arbitrum' / 'optimism' / 'base')
 * @param {string} params.toChain — destination chain (same set)
 * @param {string} params.asset — 'USDT' / 'USDC'
 * @param {number|string} params.amount — human-readable amount (e.g. 10)
 * @param {string} params.recipient — destination EVM address (will be bytes32-padded)
 * @param {number} [params.slippagePct=0.5] — min amount slippage (e.g. 0.5 = 0.5%)
 * @param {number|string} [params.nativeDropAmount=0] — dest native gas amount in human-readable decimal (e.g. 0.05 MATIC). Dest native is 18-decimal for all v0.1 chains (BNB/MATIC/ETH).
 * @param {string} [params.nativeDropTo=null] — EVM recipient of native drop, defaults to `recipient`
 * @param {number} [params.lzReceiveGas=200000] — gas for lzReceive on dest (Stargate V2 default 200000)
 * @returns {Promise<{ ok: true, nativeFee, lzTokenFee, amountLD, minAmountLD, dstEid, sendParam } | { ok: false, error }>}
 */
export async function quoteBridge({
  fromChain, toChain, asset, amount, recipient,
  slippagePct = 0.5,
  nativeDropAmount = 0,
  nativeDropTo = null,
  lzReceiveGas = 200000,
}) {
  const srcPool = _resolvePool(fromChain, asset);
  if (srcPool.error) return { ok: false, error: srcPool.error };
  const dstPool = _resolvePool(toChain, asset);
  if (dstPool.error) return { ok: false, error: dstPool.error };
  const dstEid = STARGATE_EIDS[toChain];
  if (!dstEid) return { ok: false, error: `Stargate V2 EID missing for ${toChain}` };
  const rpcUrl = EVM_RPC_URLS[fromChain];
  if (!rpcUrl) return { ok: false, error: `No RPC for ${fromChain}` };

  let provider;
  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    const pool = new ethers.Contract(srcPool.pool, POOL_ABI, provider);
    const amountLD = ethers.parseUnits(String(amount), srcPool.decimals);
    const minAmountLD = amountLD - (amountLD * BigInt(Math.floor(slippagePct * 100)) / 10000n);
    const dropWei = Number(nativeDropAmount) > 0
      ? ethers.parseUnits(String(nativeDropAmount), 18)
      : 0n;
    const extraOptions = buildLzV2Options(BigInt(lzReceiveGas), dropWei, nativeDropTo || recipient);
    const sendParam = {
      dstEid,
      to: _addrToBytes32(recipient),
      amountLD,
      minAmountLD,
      extraOptions,
      composeMsg: '0x',
      oftCmd: '0x',
    };
    const [nativeFee, lzTokenFee] = await pool.quoteSend(sendParam, false);
    return { ok: true, nativeFee, lzTokenFee, amountLD, minAmountLD, dstEid, sendParam };
  } catch (err) {
    return { ok: false, error: `quoteBridge failed: ${err.message}` };
  } finally {
    try { provider?.destroy?.(); } catch {}
  }
}

/**
 * Execute a Stargate V2 bridge transfer.
 *
 * Flow: lookup wallet → check balance → approve pool (if needed) → quote → sendToken with msg.value=nativeFee
 *       → record chain_event bridge_initiated.
 *
 * @param {Object} params — same shape as quoteBridge + relayId
 * @param {string} params.relayId — sender relay UUID (must own agent_wallets[fromChain] default)
 * @returns {Promise<{ ok: true, txHash, nativeFee, amountLD, minAmountLD, dstEid } | { ok: false, error }>}
 */
export async function bridgeAsset({
  fromChain, toChain, asset, amount, recipient, relayId,
  slippagePct = 0.5,
  nativeDropAmount = 0,
  nativeDropTo = null,
  lzReceiveGas = 200000,
}) {
  if (!relayId) return { ok: false, error: 'relayId required' };
  const srcPool = _resolvePool(fromChain, asset);
  if (srcPool.error) return { ok: false, error: srcPool.error };
  const wallet = _getRelayWallet(relayId, fromChain);
  if (!wallet?.privkey_encrypted) return { ok: false, error: `No ${fromChain} wallet for relay ${relayId.slice(0, 8)}` };

  const quote = await quoteBridge({
    fromChain, toChain, asset, amount, recipient, slippagePct,
    nativeDropAmount, nativeDropTo, lzReceiveGas,
  });
  if (!quote.ok) return quote;

  const rpcUrl = EVM_RPC_URLS[fromChain];
  let provider;
  try {
    const privateKey = decrypt(wallet.privkey_encrypted);
    provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const pool = new ethers.Contract(srcPool.pool, POOL_ABI, signer);

    // Resolve underlying ERC20 token from pool.token() — bridge needs ERC20 allowance on the pool
    const tokenAddr = await pool.token();
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);

    const balance = await token.balanceOf(signer.address);
    if (balance < quote.amountLD) {
      const have = ethers.formatUnits(balance, srcPool.decimals);
      const need = ethers.formatUnits(quote.amountLD, srcPool.decimals);
      return { ok: false, error: `${asset} insufficient on ${fromChain}: have ${have}, need ${need}` };
    }

    // Check native gas for nativeFee
    const nativeBalance = await provider.getBalance(signer.address);
    if (nativeBalance < quote.nativeFee) {
      const have = ethers.formatEther(nativeBalance);
      const need = ethers.formatEther(quote.nativeFee);
      return { ok: false, error: `Native gas insufficient on ${fromChain}: have ${have}, need ${need} (LayerZero fee)` };
    }

    // Approve pool to spend ERC20 (only if existing allowance insufficient)
    const allowance = await token.allowance(signer.address, srcPool.pool);
    if (allowance < quote.amountLD) {
      const approveTx = await token.approve(srcPool.pool, quote.amountLD);
      await approveTx.wait(1);
    }

    // Execute sendToken — taxi mode, msg.value = quote.nativeFee
    const messagingFee = { nativeFee: quote.nativeFee, lzTokenFee: quote.lzTokenFee };
    const tx = await pool.sendToken(quote.sendParam, messagingFee, signer.address, { value: quote.nativeFee });
    const receipt = await tx.wait(1);

    // chain_events: source TX confirmed → bridge_initiated row
    recordChainEvent({
      txid: tx.hash,
      eventType: 'bridge_initiated',
      fromAddress: signer.address,
      toAddress: recipient,
      observedBy: 'bridge-router',
      payload: {
        fromChain, toChain, asset,
        amount: String(amount),
        amountLD: String(quote.amountLD),
        minAmountLD: String(quote.minAmountLD),
        dstEid: quote.dstEid,
        nativeFee: String(quote.nativeFee),
        nativeDropAmount: String(nativeDropAmount || 0),
        nativeDropTo: nativeDropTo || recipient,
        lzReceiveGas,
        block: receipt?.blockNumber || null,
      },
    });

    console.log(`[bridge-router] ${amount} ${asset} ${fromChain}→${toChain} TX: ${tx.hash}`);
    return {
      ok: true,
      txHash: tx.hash,
      nativeFee: quote.nativeFee,
      amountLD: quote.amountLD,
      minAmountLD: quote.minAmountLD,
      dstEid: quote.dstEid,
    };
  } catch (err) {
    return { ok: false, error: `bridgeAsset failed: ${err.message}` };
  } finally {
    try { provider?.destroy?.(); } catch {}
  }
}
