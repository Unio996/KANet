// drain-finality-safe-blocks.test.mjs — regression coverage for the spc_daa_index finality gate
// (NWT attack-surface review #o0056j MUST-FIX: reorg can invalidate a (daaScore, blockHash)
// binding written too early; the fix is to never write until the block is finality-safe).
// Run: node src/drain-finality-safe-blocks.test.mjs

import { drainFinalitySafeBlocks } from './rpc-listener.mjs';

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : '')); failed++; }
}

console.log('[drain-finality-safe-blocks.test] spc_daa_index finality gate');

// 1. Block at tip is never immediately safe (depth 0 < 50).
{
  const q = [{ hash: 'a', daaScore: 1000, timestamp_ms: 1 }];
  const out = drainFinalitySafeBlocks(q, /*maxSeen*/ 1000, /*depth*/ 50);
  assert('tip block not yet finality-safe', out.length === 0);
  assert('queue untouched', q.length === 1);
}

// 2. A block becomes safe only once tip has advanced >= finalityDepth past it.
{
  const q = [{ hash: 'a', daaScore: 1000, timestamp_ms: 1 }];
  let out = drainFinalitySafeBlocks(q, 1049, 50);
  assert('depth 49 still unsafe', out.length === 0);
  out = drainFinalitySafeBlocks(q, 1050, 50);
  assert('depth 50 exactly is safe (>= not >)', out.length === 1 && out[0].hash === 'a');
  assert('queue drained', q.length === 0);
}

// 3. FIFO order preserved across multiple finalized entries in one drain call.
{
  const q = [
    { hash: 'a', daaScore: 1000, timestamp_ms: 1 }, // depth 51 at tip=1051
    { hash: 'b', daaScore: 1001, timestamp_ms: 2 }, // depth 50 at tip=1051
    { hash: 'c', daaScore: 1049, timestamp_ms: 3 }, // depth 2 at tip=1051, still unsafe
  ];
  const out = drainFinalitySafeBlocks(q, 1051, 50);
  assert('two of three finalized (a,b)', out.length === 2 && out[0].hash === 'a' && out[1].hash === 'b');
  assert('c stays queued (only 2 deep)', q.length === 1 && q[0].hash === 'c');
}

// 4. The MUST-FIX scenario itself: a block that later gets reorg'd out never reaches the queue
// with a stale binding because the relay only calls this on isChainBlock===true blocks *at the
// time they're seen* — but if kaspad's isChainBlock view flips within the finality window, the
// block never leaves the queue with the old hash beyond what the design already accepts (shallow
// reorgs inside the depth window don't reach ingestSpcDaaBlock at all until 50-deep). This test
// documents that a block sitting in queue for < finalityDepth ticks is never drained regardless
// of how many newer blocks arrive in between (reorg-window blocks stay pending, never persisted).
{
  const q = [{ hash: 'reorg-candidate', daaScore: 1000, timestamp_ms: 1 }];
  for (let tip = 1001; tip < 1050; tip++) {
    const out = drainFinalitySafeBlocks(q, tip, 50);
    assert(`tip=${tip} still within reorg window, not drained`, out.length === 0, `drained early at tip=${tip}`);
  }
}

console.log(failed === 0 ? '\n[drain-finality-safe-blocks.test] ALL PASS' : `\n[drain-finality-safe-blocks.test] ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
