process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const SIL_PATH = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/sil-v1/CommissionSplit.sil';

const spk37 = (n) => ({ kind: 'bytes', value: Array(37).fill(n & 0xff) });
const ctorInt = (n) => ({ kind: 'int', value: Number(n) });

function baseParams(overrides = {}) {
  const p = {
    role_count: ctorInt(3),
    role1_spk: spk37(0x11), role1_len: ctorInt(37), role1_amt: ctorInt(700_000_000),
    role2_spk: spk37(0x22), role2_len: ctorInt(37), role2_amt: ctorInt(50_000_000),
    role3_spk: spk37(0x33), role3_len: ctorInt(37), role3_amt: ctorInt(20_000_000),
    role4_spk: spk37(0), role4_len: ctorInt(0), role4_amt: ctorInt(0),
    role5_spk: spk37(0), role5_len: ctorInt(0), role5_amt: ctorInt(0),
    role6_spk: spk37(0), role6_len: ctorInt(0), role6_amt: ctorInt(0),
    role7_spk: spk37(0), role7_len: ctorInt(0), role7_amt: ctorInt(0),
    refund_spk: spk37(0x44), refund_len: ctorInt(37),
    deadline_ms: ctorInt(1234567890123),
    max_split_fee: ctorInt(40_000_000), max_refund_fee: ctorInt(10_000_000),
    rule_commit: { kind: 'bytes', value: Array(32).fill(0x55) },
    channel_chain_commitment: { kind: 'bytes', value: Array(32).fill(0x66) },
    order_nonce: { kind: 'bytes', value: Array(16).fill(0x77) },
  };
  return { ...p, ...overrides };
}
function toArr(p) {
  return [p.role_count, p.role1_spk, p.role1_len, p.role1_amt, p.role2_spk, p.role2_len, p.role2_amt,
    p.role3_spk, p.role3_len, p.role3_amt, p.role4_spk, p.role4_len, p.role4_amt, p.role5_spk, p.role5_len, p.role5_amt,
    p.role6_spk, p.role6_len, p.role6_amt, p.role7_spk, p.role7_len, p.role7_amt,
    p.refund_spk, p.refund_len, p.deadline_ms, p.max_split_fee, p.max_refund_fee,
    p.rule_commit, p.channel_chain_commitment, p.order_nonce];
}
function compileWith(overrides) {
  const params = baseParams(overrides);
  const compiled = compileSilV100(SIL_PATH, toArr(params), 'CommissionSplit');
  return Buffer.from(compiled.script);
}

const base = compileWith({});
console.log('base length:', base.length);

// Test role1_amt across a WIDE range of magnitudes, check TOTAL SCRIPT LENGTH changes or not
for (const v of [0, 1, 255, 65535, 16777215, 700_000_000, 4294967295n, 999999999999n, 9007199254740991n]) {
  const variant = compileWith({ role1_amt: ctorInt(v) });
  console.log('role1_amt =', v.toString(), '-> total script length:', variant.length, variant.length === base.length ? '(SAME as base)' : `(DIFFERENT, base=${base.length})`);
}

console.log('\n--- deadline_ms across wide range ---');
for (const v of [0, 1, 1234567890123, 9007199254740991n]) {
  const variant = compileWith({ deadline_ms: ctorInt(v) });
  console.log('deadline_ms =', v.toString(), '-> total script length:', variant.length, variant.length === base.length ? '(SAME)' : '(DIFFERENT)');
}

console.log('\n--- role_count across full valid range 1-7 ---');
for (const v of [1,2,3,4,5,6,7]) {
  const variant = compileWith({ role_count: ctorInt(v) });
  console.log('role_count =', v, '-> total script length:', variant.length, variant.length === base.length ? '(SAME)' : '(DIFFERENT)');
}
