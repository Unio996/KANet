// utxo-fetch-allocation-probe.mjs — TEMPORARY diagnostic instrumentation (2026-08-10, Bettor
// approval #ntlj8t), observe-only, zero DB writes, zero behavior change.
//
// Purpose: 03:48Z-onward "irregular multi-GB Private commit, never touched, immediately released"
// mystery (dev-coord-testnet, KANet-UI/J2/J1/NWT/Bettor overnight session) — external/rss/V8 heap
// were all ruled out as the source, and console.log has no per-line signal that lines up with the
// spike timestamps (39 scattered getUtxosByAddresses call sites, none logs entries.length or a
// byte estimate). This patches RpcClient.prototype.getUtxosByAddresses ONCE at startup (not 39
// call-site edits) so every call, regardless of which of the 39 sites triggered it, logs its
// timing and result size — one log line should now line up with the next spike.
//
// REMOVAL CARD: delete this file + its two call sites (index.js import/call, and the
// wasmBufferBytesMB() export consumed by eventloop-lag-heartbeat.mjs) once the allocator is
// identified or this line of inquiry is abandoned. Not a fix, not permanent instrumentation.
import { RpcClient } from 'kaspa-wasm';
import * as kaspaWasmInternal from 'kaspa-wasm';

let _callCount = 0;
const _mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

export function installUtxoFetchProbe() {
  const orig = RpcClient.prototype.getUtxosByAddresses;
  if (orig.__probeInstalled) return; // idempotent — dedupe if called twice
  const patched = async function (...args) {
    const t0 = Date.now();
    const addrCount = Array.isArray(args[0]) ? args[0].length : 1;
    try {
      const result = await orig.apply(this, args);
      _callCount++;
      const n = result?.entries?.length ?? -1;
      // rough byte estimate: kaspa-wasm UtxoEntry objects carry amount/scriptPubKey/blockDaaScore/
      // outpoint — this is a guess at serialized size, not a measured one, labeled as such.
      const roughBytes = n >= 0 ? n * 200 : -1;
      console.log(`[utxo-fetch-probe] #${_callCount} at=${new Date(t0).toISOString()} ms=${Date.now() - t0} addrCount=${addrCount} entries=${n} roughBytesEst=${roughBytes >= 0 ? _mb(roughBytes) + 'MB' : 'n/a'}`);
      return result;
    } catch (e) {
      _callCount++;
      console.log(`[utxo-fetch-probe] #${_callCount} at=${new Date(t0).toISOString()} ms=${Date.now() - t0} addrCount=${addrCount} THREW: ${e.message}`);
      throw e;
    }
  };
  patched.__probeInstalled = true;
  RpcClient.prototype.getUtxosByAddresses = patched;
  console.log('[utxo-fetch-probe] installed (patches RpcClient.prototype.getUtxosByAddresses, all call sites covered)');
}

// Direct read of the wasm module's own linear memory size — the only unambiguous instrument for
// "is this wasm's own 4GB address-space ceiling" vs "some other OS/V8-level allocation" (J2/Codex
// both named this the required direct read; diag:heap-sample's external/rss are aggregates that
// cannot distinguish wasm linear memory from other ArrayBuffer-backed allocations).
// __wasm is wasm-bindgen's internal glue export (double-underscore = not public API, may break on
// a kaspa-wasm version bump — acceptable for a temporary diagnostic, not for permanent code).
export function wasmBufferBytesMB() {
  // J2 2026-08-10 #ntlj8t review: must NOT fail into a numeric value (0/-1) — a reader summing or
  // plotting this column would silently read "wasm memory is tiny/absent", the opposite of the
  // truth (unavailable-reading != small-value). Fails into a distinct non-numeric string instead.
  try {
    return `${_mb(kaspaWasmInternal.__wasm.memory.buffer.byteLength)}MB`;
  } catch (e) {
    return 'UNAVAILABLE'; // internal export shape changed or unavailable — doesn't crash, doesn't fake a number
  }
}

export function utxoFetchCallCount() {
  return _callCount;
}
