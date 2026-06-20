// bshard-units-probe.mjs — J1 differential probe: locate the 13738 script-units source in PoolLeaf register.
// Local ground truth = compiled redeem BYTES (no local units metering; units ≈ 2× redeem bytes per the
// validateOutputState blake2b-over-redeem model, PoolLeaf.sil head note 2091B~4182u).
//
// Method: compile full PoolLeaf + per-entrypoint subset variants → diff redeem bytes per entry.
//   register_append's validateOutputState(leaf) blake2b's the WHOLE PoolLeaf redeem → register units ≈ 2×(full redeem).
//   So which entry's BYTECODE inflates the monolithic reveal is the lever (减 redeem).
import { compileSil } from '../src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../src/lib/pool-template-artifact.mjs';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LEAF = 'D:/kanet-testnet/kasia-console/src/lib/PoolLeaf.sil';
const src = readFileSync(LEAF, 'utf8');

// ── split PoolLeaf into preamble + 3 entry blocks + trailing close-brace, by the `// —— entry N:` markers ──
const E0 = src.indexOf('// —— entry 0:');
const E1 = src.indexOf('// —— entry 1:');
const E2 = src.indexOf('// —— entry 2:');
if (E0 < 0 || E1 < 0 || E2 < 0) throw new Error('entry markers not found');
const lastBrace = src.lastIndexOf('}');
const preamble = src.slice(0, E0);
const entry0 = src.slice(E0, E1);          // register_append
const entry1 = src.slice(E1, E2);          // fold (covenant)
const entry2 = src.slice(E2, lastBrace);   // seal_to_root
const close = '\n}\n';

// ── ctor: dummy values (size probe — bytes32 fixed 32B, ints small; values don't change bytecode size materially) ──
const z32 = { kind: 'array', data: Array(32).fill({ kind: 'byte', data: 0 }) };
const ci = (n) => ({ kind: 'int', data: n });
const CTOR = [
  z32, z32, ci(1), ci(4), z32, z32, ci(1), ci(1000), z32, z32, ci(0), ci(0), ci(0), ci(0),
];

function measure(label, body) {
  const dir = mkdtempSync(join(tmpdir(), 'leafprobe-'));
  const p = join(dir, 'V.sil');
  writeFileSync(p, body);
  try {
    const compiled = compileSil(p, CTOR);
    const a = extractTemplateArtifact(compiled);
    const redeem = compiled.script.length;
    const stateLen = a.encodedStateLen;
    console.log(`${label.padEnd(28)} redeem=${String(redeem).padStart(6)}B  ~units(2x)=${String(redeem * 2).padStart(6)}  prefix=${a.templatePrefixLen} state=${stateLen} suffix=${a.templateSuffixLen}`);
    return redeem;
  } catch (e) {
    console.log(`${label.padEnd(28)} COMPILE-FAIL: ${e.message.slice(0, 160)}`);
    return null;
  }
}

console.log('\n=== PoolLeaf differential units probe (redeem bytes; units ≈ 2× bytes) ===\n');
const full   = measure('full (reg+fold+seal)', preamble + entry0 + entry1 + entry2 + close);
const reg    = measure('reg-only', preamble + entry0 + close);
const regF   = measure('reg+fold', preamble + entry0 + entry1 + close);
const regS   = measure('reg+seal', preamble + entry0 + entry2 + close);

console.log('\n=== differential (per-entry bytecode contribution to monolithic reveal) ===');
if (full != null && reg != null) console.log(`register-only baseline  : ${reg}B`);
if (regF != null && reg != null) console.log(`+ fold(k=4) entry adds  : ${regF - reg}B  (${Math.round((regF-reg)/full*100)}% of full)`);
if (regS != null && reg != null) console.log(`+ seal entry adds       : ${regS - reg}B`);

// ── fan-in vs fold-bytecode curve (recompile full leaf with ctor max_fan_in = k; loop unroll is k-bound) ──
console.log('\n=== fan-in (k) vs full-leaf redeem (fold for-loop unroll bound = max_fan_in ctor) ===');
const REAL_LIVE_UNITS = 13738, REAL_LIVE_REDEEM = full; // first live data point @ k=4
const ratio = full ? REAL_LIVE_UNITS / full : null;     // empirical units/byte (real, not header 2× model)
for (const k of [2, 4, 8, 16]) {
  const ctorK = [...CTOR]; ctorK[3] = ci(k);
  const dir = mkdtempSync(join(tmpdir(), 'leafk-'));
  const p = join(dir, 'V.sil'); writeFileSync(p, preamble + entry0 + entry1 + entry2 + close);
  try {
    const c = compileSil(p, ctorK);
    const rb = c.script.length;
    const est = ratio ? Math.round(rb * ratio) : null;
    console.log(`k=${String(k).padStart(2)}  full-leaf redeem=${String(rb).padStart(5)}B  est-units(@${ratio?ratio.toFixed(2):'?'}/B)=${String(est).padStart(6)}  ${est!=null?(est<9999?'PASS<9999':'OVER 9999'):''}`);
  } catch (e) { console.log(`k=${k}  COMPILE-FAIL: ${e.message.slice(0,120)}`); }
}

// ── ps ticket size (register also validateOutputStateWithTemplate(ps) — confirm it's small, not the driver) ──
try {
  const psCompiled = compileSil('D:/kanet-testnet/kasia-console/src/lib/PoolSide_v08_shard.sil',
    [z32, ci(0), ci(1000), z32]);
  console.log(`\nps-ticket (PoolSide_v08_shard) redeem = ${psCompiled.script.length}B  (register hashes this ~2×; small ⟹ not the driver)`);
} catch (e) { console.log(`\nps-ticket compile fail: ${e.message.slice(0,120)}`); }

console.log('\n=== KEY FINDING ===');
console.log(`Header 2x units model BROKEN: live ${REAL_LIVE_UNITS}u for ${full}B redeem = ${ratio?ratio.toFixed(2):'?'}x/byte (header assumed 2x → 3.3x optimistic).`);
console.log(`fold entry = ${reg!=null?Math.round((regF-reg)/full*100):'?'}% of redeem = the lever. Kaspa limit 9999 units.`);
console.log(`register cost ∝ FULL leaf redeem (monolithic reveal: validateOutputState(leaf) blake2b whole redeem incl unused fold).`);
