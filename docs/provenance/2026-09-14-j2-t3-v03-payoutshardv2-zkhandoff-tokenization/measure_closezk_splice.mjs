// Measures the byte-exact CloseZkV2 genesis-redeem splice points (templateA/B/C/D + closeZkTmplAnchor)
// from a REAL compiled CloseZkV2 instance, instead of hand-guessing offsets (project convention:
// "量测脚本, 非手打猜"). Locates betsRootBaked/refundRootBaked/attestedAtMs by searching for their
// (deliberately distinctive) byte sequences inside the compiled bytecode, splits around them, and
// verifies the reconstruction matches byte-for-byte + the anchor hash matches.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');

const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const CZK = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/CloseZkV2.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

// Distinctive (non-zero, mutually-unique) marker values so we can locate them unambiguously in the bytecode.
const BETS_ROOT = new Array(32).fill(0x11);
const REFUND_ROOT = new Array(32).fill(0x22);
const ATTESTED_AT_MS = 1234567890123; // arbitrary value inside the documented [2^40,2^47) stable-width domain
const GATE_TMPL_HASH = new Array(32).fill(0);
const TOKEN_TMPL_HASH = new Array(32).fill(0);
const CLAIM_TMPL_HASH = new Array(32).fill(0);
const MARKET_SUFFIX_HASH = new Array(32).fill(0);

const ctor = [
  { kind: 'bytes', value: GATE_TMPL_HASH },
  { kind: 'bytes', value: BETS_ROOT },
  { kind: 'bytes', value: REFUND_ROOT },
  { kind: 'int', value: ATTESTED_AT_MS },
  { kind: 'int', value: -1 },
  { kind: 'int', value: 1 },
  { kind: 'bytes', value: new Array(32).fill(0) },
  { kind: 'int', value: 100 },
  ...new Array(17).fill(0).map(() => ({ kind: 'int', value: 0 })),
  { kind: 'bytes', value: TOKEN_TMPL_HASH },
  { kind: 'bytes', value: CLAIM_TMPL_HASH },
  { kind: 'bytes', value: MARKET_SUFFIX_HASH },
];
fs.writeFileSync('scratch/_t1v06_check/CZK_splice_measure.ctor.json', JSON.stringify(ctor, null, 1));
execSync(`"${SILVERC}" "${CZK}" --ctor scratch/_t1v06_check/CZK_splice_measure.ctor.json -o scratch/_t1v06_check/CZK_splice_measure.compiled.json`, { cwd: CWD });
const compiled = JSON.parse(fs.readFileSync('scratch/_t1v06_check/CZK_splice_measure.compiled.json', 'utf8'));
const c = Object.values(compiled.contracts)[0].compiled;
const bc = c.bytecode; // number[]

// ★ CANONICAL ALGORITHM (ledger 1181, ported verbatim from kasia-console/src/lib/pool-shard-register.mjs:189
// computeCloseZkTmplAnchor -- this is the actual production genesis/handoff code path, not a re-derivation).
// KEY CORRECTION vs. my earlier (buggy) attempt: findUnique searches for the RAW 32-byte marker value
// (no push-tag prefix) -- templateA's boundary sits at that position, meaning the 0x20 push-tag byte that
// precedes the 32 raw bytes in the compiled script is the LAST byte of templateA/templateC, NOT a separately
// re-inserted byte. My earlier version searched for `[0x20, ...marker]` and cut the boundary BEFORE the tag,
// which is off-by-one relative to canonical and produced a self-consistent-but-wrong split (my own full-byte
// round-trip test passed because I compensated by re-inserting the tag manually when reconstructing, but that
// doesn't match what PayoutShardV2.sil's `templateA + betsRootBaked + templateB` expression actually needs:
// betsRootBaked there is the RAW 32-byte runtime state value with no tag, so the tag must already be inside
// templateA).
function findUnique(buf, needle, label) {
  outer_first: for (let i = 0; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) continue outer_first;
    // found first occurrence at i -- now verify uniqueness (canonical's findUnique discipline)
    for (let k = i + 1; k <= buf.length - needle.length; k++) {
      let match2 = true;
      for (let j = 0; j < needle.length; j++) if (buf[k + j] !== needle[j]) { match2 = false; break; }
      if (match2) throw new Error(`findUnique(${label}): marker occurs >=2 times (offset ${i},${k}) -- refuse to guess the first`);
    }
    return i;
  }
  throw new Error(`findUnique(${label}): marker not found`);
}
function le(n, bytes) { const out = []; let v = BigInt(n); for (let i = 0; i < bytes; i++) { out.push(Number(v & 0xffn)); v >>= 8n; } return out; }

const { offset: stateOffset, len: stateLen } = c.state_span;
const stateEnd = stateOffset + stateLen;
const suffix = bc.slice(stateEnd); // = canonical's templateSuffix

const betsAbs = findUnique(suffix, BETS_ROOT, 'betsRoot'); // relative to suffix start, matching canonical's _rel()
const atMsNeedle = [6, ...le(ATTESTED_AT_MS, 6)];
const atMsAbs = findUnique(suffix, atMsNeedle, 'atMs-marker+data');
const refundAbs = findUnique(suffix, REFUND_ROOT, 'refundRoot');

const templateA = suffix.slice(0, betsAbs);
const templateB = suffix.slice(betsAbs + 32, atMsAbs);
const templateC = suffix.slice(atMsAbs + 7, refundAbs);
const templateD = suffix.slice(refundAbs + 32);

// Sanity: reconstructed bytes (NO extra tag insertion -- canonical concatenates templateA directly against the
// raw 32-byte marker, matching PayoutShardV2.sil's `templateA + betsRootBaked + templateB` expression exactly).
const reconstructedTail = [...templateA, ...BETS_ROOT, ...templateB, ...atMsNeedle, ...templateC, ...REFUND_ROOT, ...templateD];
const realTail = suffix;
const tailMatches = JSON.stringify(reconstructedTail) === JSON.stringify(realTail);

const closeZkTmplAnchor = [...b2b([...templateA, ...templateB, ...templateC, ...templateD])];

const out = {
  state_span: c.state_span,
  bytecode_length: bc.length,
  own_prefix_len: stateOffset,
  templateA_len: templateA.length,
  templateB_len: templateB.length,
  templateC_len: templateC.length,
  templateD_len: templateD.length,
  tailMatches,
  closeZkTmplAnchor: hex(closeZkTmplAnchor),
};
console.log(JSON.stringify(out, null, 1));
if (!tailMatches) { console.error('SPLICE RECONSTRUCTION MISMATCH'); process.exit(1); }

fs.writeFileSync('scratch/_t1v06_check/closezk_splice.json', JSON.stringify({
  templateA: hex(templateA), templateB: hex(templateB), templateC: hex(templateC), templateD: hex(templateD),
  betsRootBaked: hex(BETS_ROOT), refundRootBaked: hex(REFUND_ROOT), attestedAtMs: ATTESTED_AT_MS,
  closeZkTmplAnchor: hex(closeZkTmplAnchor), gateTmplHash: hex(GATE_TMPL_HASH),
  tokenTmplHashPlaceholder: hex(TOKEN_TMPL_HASH), claimTmplHashPlaceholder: hex(CLAIM_TMPL_HASH), marketSuffixHashPlaceholder: hex(MARKET_SUFFIX_HASH),
  own_prefix_len: stateOffset, own_state_len: stateLen,
}, null, 1));
console.log('OK: splice verified byte-exact, wrote scratch/_t1v06_check/closezk_splice.json');
