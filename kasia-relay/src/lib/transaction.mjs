// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R38 / DEVELOPER-GUIDE ch19
// 关键历史: Bug-Z23 (kasToSompi amount type number→string boundary coerce, J1 0ac4a571)
//          / R38 schema typeof spec (commands.mjs 4c503a9bb + relay.mjs 92bddaf3d)
// blast radius: kasToSompi boundary / sendKaspa / 跨 process type contract
// ════════════════════════════════════════════════════════════════
//
// Transaction building and submission via kaspa-wasm Generator + RPC
import * as kaspa from 'kaspa-wasm';
import { getApi } from './api.mjs';
import { getWallet } from './wallet.mjs';
import { waitForRpc } from '../rpc-listener.mjs';

const { Generator, Encoding, sompiToKaspaString, Address, PaymentOutput } = kaspa;
const Resolver = kaspa.Resolver || null;

const SOMPI_PER_KAS = 100000000n;
const MAX_DECIMAL_PLACES = 8;
const KASIA_MIN_AMOUNT = '0.2';
const FEE_RESERVE_BASE = 3000n;  // base fee for minimal TX (no payload)

// Dynamic fee reserve based on payload size.
// Kaspa charges ~1 sompi per byte of TX mass. Payload is hex-encoded (2 chars per byte).
// Empirical: 500-char message → ~500 bytes payload → ~5000 sompi fee.
// Formula: base + (payloadBytes * 10) with 2x safety margin.
function estimateFeeReserve(payloadHex) {
  if (!payloadHex) return FEE_RESERVE_BASE;
  const payloadBytes = BigInt(Math.ceil(payloadHex.length / 2));
  // 10 sompi per payload byte (empirical) × 2 safety margin + base
  const estimated = FEE_RESERVE_BASE + payloadBytes * 20n;
  // Cap at 1 KAS (100M sompi) — sanity limit
  return estimated < 100_000_000n ? estimated : 100_000_000n;
}

// Promise-based mutex to serialize sendKaspa() calls and prevent UTXO double-spend
let _sendLock = Promise.resolve();

// Track recently spent UTXOs — RPC getUtxosByAddresses only returns confirmed UTXOs,
// so a just-submitted TX's inputs still appear as "available". This set filters them out.
// Entries auto-expire after 30s (should be mined by then at 10 BPS).
const _pendingSpentUtxos = new Map(); // key = "txid:index" → expiry timestamp
function markUtxoSpent(entry) {
  const key = `${entry.entry?.transactionId || entry.transactionId || ''}:${entry.entry?.index ?? entry.index ?? 0}`;
  if (key === ':0') return; // safety: no valid outpoint
  _pendingSpentUtxos.set(key, Date.now() + 30000);
}
function filterPendingUtxos(entries) {
  const now = Date.now();
  // Clean expired entries
  for (const [k, exp] of _pendingSpentUtxos) { if (exp < now) _pendingSpentUtxos.delete(k); }
  if (_pendingSpentUtxos.size === 0) return entries;
  return entries.filter(e => {
    const key = `${e.entry?.transactionId || e.transactionId || ''}:${e.entry?.index ?? e.index ?? 0}`;
    return !_pendingSpentUtxos.has(key);
  });
}
function withSendLock(fn) {
  const prev = _sendLock;
  let resolve;
  _sendLock = new Promise(r => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function kasToSompi(amountStr) {
  // T-J1-2026-04-28 Bug-Z23 defensive coerce: caller 真传 number (broker-action-queue settler-router
  // post Layer 5 'transfer' canonical path) → 'amountStr.trim is not a function' TypeError. boundary
  // normalize cover all relay caller. 后续 regex /^\d+(\.\d+)?$/ 仍验 number→string 后 format
  // ('87.9' / '0.30000000000000004' float-trap), 不 mask 真错.
  const trimmed = String(amountStr).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Amount must be a valid decimal number');
  const parts = trimmed.split('.');
  const integerPart = parts[0];
  let fractionalPart = (parts[1] || '').padEnd(MAX_DECIMAL_PLACES, '0');
  if (fractionalPart.length > MAX_DECIMAL_PLACES) throw new Error(`Amount cannot have more than ${MAX_DECIMAL_PLACES} decimal places`);
  const sompi = BigInt(integerPart) * SOMPI_PER_KAS + BigInt(fractionalPart);
  if (sompi <= 0n) throw new Error('Amount must be greater than zero');
  return sompi;
}

export { KASIA_MIN_AMOUNT };

async function resolveRpcUrl() {
  // Priority: env var > console config > null (use resolver)
  if (process.env.KASPA_RPC_URL) return process.env.KASPA_RPC_URL;

  const consoleUrl = process.env.CONSOLE_URL;
  if (consoleUrl) {
    try {
      const res = await fetch(`${consoleUrl}/api/config/rpc-url`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const { url } = await res.json();
        if (url) { console.log(`[RPC] Using node from console: ${url}`); return url; }
      }
    } catch {}
  }
  return null;
}

export function sendKaspa(...args) {
  return withSendLock(() => _sendKaspaInner(...args));
}

async function _sendKaspaInner(to, amountSompi, priorityFee = 0n, payload, _isRetry = false) {
  const wallet = getWallet();
  const senderAddress = wallet.getAddress();
  const api = getApi(wallet.getNetworkId());
  const rpc = await waitForRpc();

  const submittedTxIds = [];
  try {
    const { isSynced } = await rpc.getServerInfo();
    if (!isSynced) throw new Error('RPC node is not synced');

    const { entries: rawEntries } = await rpc.getUtxosByAddresses([new Address(senderAddress)]);
    if (!rawEntries || rawEntries.length === 0) throw new Error('No UTXOs available');

    // Normalize: new kaspa-wasm returns amount as string, old as BigInt
    for (const e of rawEntries) { if (typeof e.amount === 'string') e.amount = BigInt(e.amount); }

    // Filter out UTXOs spent by recent pending TXs (RPC only returns confirmed UTXOs)
    const entries = filterPendingUtxos(rawEntries);
    if (entries.length === 0) throw new Error('No UTXOs available (all spent by pending TXs)');

    let selectedEntries = entries;
    let outputAmount = amountSompi;

    // Full-UTXO self-send mode: pick largest UTXO, send (value - fee) to self.
    // Single input + single output = zero change = near-zero KIP-9 storage mass.
    // Used for comm/card/broadcast (self-sends where the payload is what matters).
    // Fee scales with payload size — dynamic reserve prevents truncation.
    if (amountSompi === 0n && to === senderAddress) {
      const feeReserve = estimateFeeReserve(payload);
      entries.sort((a, b) => (a.amount < b.amount ? 1 : -1)); // descending
      const best = entries[0];
      if (best.amount < feeReserve * 2n) throw new Error(`UTXO too small for payload (need ~${sompiToKaspaString(feeReserve * 2n)} KAS, have ${sompiToKaspaString(best.amount)} KAS)`);
      selectedEntries = [best];
      outputAmount = BigInt(best.amount) - feeReserve;
    } else {
      // KIP-9 aware UTXO selection:
      //   storage_mass = C × (Σ(1/output) - Σ(1/input))⁺, C=10¹², limit=100,000
      //   Generator picks UTXOs in entry order. Small change → high mass → rejected.
      //   Strategy: ascending sort (preserve large UTXOs), find smallest KIP-9-safe single UTXO.
      //   If none safe alone, merge all (multiple inputs lower mass).
      const totalBalance = entries.reduce((sum, e) => sum + e.amount, 0n);
      if (totalBalance < amountSompi + FEE_RESERVE_BASE + priorityFee)
        throw new Error(`Insufficient balance: have ${sompiToKaspaString(totalBalance)} KAS, need ~${sompiToKaspaString(amountSompi + FEE_RESERVE_BASE + priorityFee)} KAS`);
      // Min safe single UTXO: change must be large enough for KIP-9.
      // For send S, single input I, change C=I-S: mass = 10¹² × (1/S + 1/C - 1/I)
      // Safe when change >= ~0.65 × send (empirically: 0.13 KAS for 0.2 KAS send)
      const minSafeUtxo = amountSompi + amountSompi * 65n / 100n + FEE_RESERVE_BASE;
      entries.sort((a, b) => (a.amount > b.amount ? 1 : -1)); // ascending
      const safeEntry = entries.find(e => e.amount >= minSafeUtxo);
      if (safeEntry) {
        selectedEntries = [safeEntry];
      }
      // else: use all entries — multiple inputs reduce mass, Generator handles the rest
    }

    const generator = new Generator({
      entries: selectedEntries,
      outputs: [new PaymentOutput(new Address(to), outputAmount)],
      priorityFee,
      changeAddress: new Address(senderAddress),
      networkId: wallet.getNetworkId(),
      ...(payload ? { payload: hexToBytes(payload) } : {}),
    });

    let pending, lastTxId = '';
    while ((pending = await generator.next())) {
      await pending.sign([wallet.getPrivateKey()]);
      const txId = await pending.submit(rpc);
      submittedTxIds.push(txId);
      lastTxId = txId;
    }

    if (!lastTxId) throw new Error('Transaction generation failed: no transactions produced');

    // Mark spent UTXOs so next sendKaspa call won't reuse them before RPC updates
    for (const e of selectedEntries) markUtxoSpent(e);

    const summary = generator.summary();
    return { txId: lastTxId, fee: sompiToKaspaString(summary.fees).toString() };
  } catch (error) {
    // Detect silent WS disconnect — trigger reconnect + retry once
    if (!submittedTxIds.length && !_isRetry) {
      const msg = String(error?.message || error || '');
      if (msg.includes('WebSocket is not connected') || msg.includes('WebSocket -> WebSocket')) {
        const { triggerReconnect } = await import('../rpc-listener.mjs');
        triggerReconnect('ws_error_in_sendkaspa');
        await new Promise(r => setTimeout(r, 2000));
        return _sendKaspaInner(to, amountSompi, priorityFee, payload, /* _isRetry= */ true);
      }
    }
    if (submittedTxIds.length > 0) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Transaction partially completed. ${submittedTxIds.length} tx(s) broadcast: [${submittedTxIds.join(', ')}]. Error: ${detail}`);
    }
    throw error;
  } finally {
    // shared RpcClient managed by rpc-listener — do NOT disconnect from transaction layer
  }
}

export async function sendKaspaByAmount(params) {
  if (!params.to) throw new Error('Recipient address (to) is required');
  if (!params.amount) throw new Error('Amount is required');
  // amount === 'self-full': full-UTXO self-send mode (zero change, near-zero KIP-9 mass)
  if (params.amount === 'self-full') {
    return sendKaspa(params.to, 0n, 0n, params.payload);
  }
  const amountSompi = kasToSompi(params.amount);
  return sendKaspa(params.to, amountSompi, BigInt(params.priorityFee || 0), params.payload);
}
