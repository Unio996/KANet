process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const SIL_PATH = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/sil-v1/CommissionSplit.sil';

const FIELD_ORDER = [
  'role_count',
  'role1_spk','role1_len','role1_amt', 'role2_spk','role2_len','role2_amt', 'role3_spk','role3_len','role3_amt',
  'role4_spk','role4_len','role4_amt', 'role5_spk','role5_len','role5_amt', 'role6_spk','role6_len','role6_amt',
  'role7_spk','role7_len','role7_amt',
  'refund_spk','refund_len',
  'deadline_ms','max_split_fee','max_refund_fee',
  'rule_commit','channel_chain_commitment','order_nonce',
];
const FIELD_KIND = {
  role1_spk:'bytes37', role2_spk:'bytes37', role3_spk:'bytes37', role4_spk:'bytes37', role5_spk:'bytes37', role6_spk:'bytes37', role7_spk:'bytes37', refund_spk:'bytes37',
  rule_commit:'bytes32', channel_chain_commitment:'bytes32', order_nonce:'bytes16',
};
// everything else not in FIELD_KIND is 'int'

function spkN(n, byteVal) { return { kind: 'bytes', value: Array(n).fill(byteVal & 0xff) }; }
function ctorInt(n) { return { kind: 'int', value: typeof n === 'bigint' ? Number(n) : n }; }

// sentinel A: each field's int value = a distinct-per-field, no-zero-byte-pattern number; bytes fields = distinct fill byte
function buildParams(seed) {
  const p = {};
  let counter = 1;
  for (const f of FIELD_ORDER) {
    const kind = FIELD_KIND[f] || 'int';
    if (kind === 'bytes37') { p[f] = spkN(37, seed + counter); counter++; }
    else if (kind === 'bytes32') { p[f] = spkN(32, seed + counter); counter++; }
    else if (kind === 'bytes16') { p[f] = spkN(16, seed + counter); counter++; }
    else {
      // distinct 8-byte-varied int: build from counter to avoid zero bytes in most positions
      const base = BigInt(seed) * 0x0101010101n + BigInt(counter) * 0x010101n + 0x0203040506070809n;
      const masked = base & 0x1FFFFFFFFFFFFFn; // keep within safe range, avoid sign issues
      p[f] = ctorInt(masked);
      counter++;
    }
  }
  return p;
}
function toArr(p) { return FIELD_ORDER.map(f => p[f]); }

function compileWith(p) {
  const compiled = compileSilV100(SIL_PATH, toArr(p), 'CommissionSplit');
  return Buffer.from(compiled.script);
}

const A = buildParams(0x10);
const B = buildParams(0x90);
const scriptA = compileWith(A);
const scriptB = compileWith(B);
console.log('scriptA length:', scriptA.length, 'scriptB length:', scriptB.length);

if (scriptA.length !== scriptB.length) {
  console.log('🔴 LENGTHS DIFFER — template approach needs re-think');
  process.exit(1);
}

// full diff
function diffRanges(a, b) {
  const ranges = [];
  let i = 0;
  while (i < a.length) {
    if (a[i] !== b[i]) {
      let j = i;
      while (j < a.length && a[j] !== b[j]) j++;
      ranges.push([i, j]);
      i = j;
    } else i++;
  }
  return ranges;
}
const ranges = diffRanges(scriptA, scriptB);
console.log('\nTotal diff ranges found:', ranges.length, '(expect one per ctor field that we set to a distinct value =', FIELD_ORDER.length, ')');
for (const [s, e] of ranges) console.log(`  [${s},${e}) length=${e - s}`);
