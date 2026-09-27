process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');

const SIL_PATH = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/sil-v1/CommissionSplit.sil';

// Known-correct field layout (verified via clean two-sentinel-set diff + byte-level magnitude probe)
const CS_FIELDS = [
  { name: 'role_count', kind: 'int', offset: 2 },
  { name: 'role1_spk', kind: 'bytes', offset: 11, len: 37 }, { name: 'role1_len', kind: 'int', offset: 49 }, { name: 'role1_amt', kind: 'int', offset: 58 },
  { name: 'role2_spk', kind: 'bytes', offset: 67, len: 37 }, { name: 'role2_len', kind: 'int', offset: 105 }, { name: 'role2_amt', kind: 'int', offset: 114 },
  { name: 'role3_spk', kind: 'bytes', offset: 123, len: 37 }, { name: 'role3_len', kind: 'int', offset: 161 }, { name: 'role3_amt', kind: 'int', offset: 170 },
  { name: 'role4_spk', kind: 'bytes', offset: 179, len: 37 }, { name: 'role4_len', kind: 'int', offset: 217 }, { name: 'role4_amt', kind: 'int', offset: 226 },
  { name: 'role5_spk', kind: 'bytes', offset: 235, len: 37 }, { name: 'role5_len', kind: 'int', offset: 273 }, { name: 'role5_amt', kind: 'int', offset: 282 },
  { name: 'role6_spk', kind: 'bytes', offset: 291, len: 37 }, { name: 'role6_len', kind: 'int', offset: 329 }, { name: 'role6_amt', kind: 'int', offset: 338 },
  { name: 'role7_spk', kind: 'bytes', offset: 347, len: 37 }, { name: 'role7_len', kind: 'int', offset: 385 }, { name: 'role7_amt', kind: 'int', offset: 394 },
  { name: 'refund_spk', kind: 'bytes', offset: 403, len: 37 }, { name: 'refund_len', kind: 'int', offset: 441 },
  { name: 'deadline_ms', kind: 'int', offset: 450 }, { name: 'max_split_fee', kind: 'int', offset: 459 }, { name: 'max_refund_fee', kind: 'int', offset: 468 },
  { name: 'rule_commit', kind: 'bytes', offset: 477, len: 32 }, { name: 'channel_chain_commitment', kind: 'bytes', offset: 510, len: 32 }, { name: 'order_nonce', kind: 'bytes', offset: 543, len: 16 },
];
const CS_TOTAL_LEN = 1747;
const CS_INT_DATA_LEN = 8;

function spkN(n, byteVal) { return Array(n).fill(byteVal & 0xff); }
function ctorInt(n) { return { kind: 'int', value: Number(n) }; }
function ctorBytes(arr) { return { kind: 'bytes', value: arr }; }

const FIELD_ORDER = ['role_count',
  'role1_spk', 'role1_len', 'role1_amt', 'role2_spk', 'role2_len', 'role2_amt', 'role3_spk', 'role3_len', 'role3_amt',
  'role4_spk', 'role4_len', 'role4_amt', 'role5_spk', 'role5_len', 'role5_amt', 'role6_spk', 'role6_len', 'role6_amt',
  'role7_spk', 'role7_len', 'role7_amt', 'refund_spk', 'refund_len',
  'deadline_ms', 'max_split_fee', 'max_refund_fee', 'rule_commit', 'channel_chain_commitment', 'order_nonce'];

function realCompile(paramsByName) {
  const ctorArr = FIELD_ORDER.map(name => {
    const v = paramsByName[name];
    const field = CS_FIELDS.find(f => f.name === name);
    return field.kind === 'bytes' ? ctorBytes(v) : ctorInt(v);
  });
  return Buffer.from(compileSilV100(SIL_PATH, ctorArr, 'CommissionSplit').script);
}

function buildBaseParams() {
  const p = { role_count: 7 };
  for (let i = 1; i <= 7; i++) { p[`role${i}_spk`] = spkN(37, 0); p[`role${i}_len`] = 0; p[`role${i}_amt`] = 0; }
  p.refund_spk = spkN(37, 0); p.refund_len = 0;
  p.deadline_ms = 0; p.max_split_fee = 0; p.max_refund_fee = 0;
  p.rule_commit = spkN(32, 0); p.channel_chain_commitment = spkN(32, 0); p.order_nonce = spkN(16, 0);
  return p;
}
const baseTemplate = realCompile(buildBaseParams());
console.log('base template length:', baseTemplate.length, 'expected:', CS_TOTAL_LEN, baseTemplate.length === CS_TOTAL_LEN ? 'OK' : 'MISMATCH');

function spliceCommissionSplit(template, paramsByName) {
  const out = Buffer.from(template);
  for (const f of CS_FIELDS) {
    const v = paramsByName[f.name];
    if (f.kind === 'bytes') {
      const buf = Buffer.from(v);
      if (buf.length !== f.len) throw new Error(f.name + ': expected ' + f.len + ' bytes, got ' + buf.length);
      buf.copy(out, f.offset);
    } else {
      const buf = Buffer.alloc(CS_INT_DATA_LEN);
      buf.writeBigUInt64LE(BigInt(v));
      buf.copy(out, f.offset);
    }
  }
  return out;
}

function randInt(max) { return Math.floor(Math.random() * max); }
function randBigAmount() {
  const choices = [0, 1, 255, 65535, randInt(1e9), randInt(1e12), 100000000, 2100000000000];
  return BigInt(choices[randInt(choices.length)]);
}
function randSpkBytes(net) {
  const priv = new kaspa.PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
  const pub = priv.toPublicKey();
  const kind = randInt(3);
  let addrObj;
  if (kind === 0) addrObj = pub.toAddress(net);
  else if (kind === 1) addrObj = pub.toAddressECDSA(net);
  else {
    const redeemScript = Buffer.from(crypto.getRandomValues(new Uint8Array(20)));
    const spk = kaspa.payToScriptHashScript(redeemScript);
    addrObj = kaspa.addressFromScriptPublicKey(spk, net);
  }
  const spkObj = kaspa.payToAddressScript(new kaspa.Address(addrObj.toString()));
  const full = Buffer.concat([Buffer.from([spkObj.version & 0xff, (spkObj.version >> 8) & 0xff]), Buffer.from(spkObj.script, 'hex')]);
  const padded = Buffer.alloc(37, 0);
  full.copy(padded);
  return { padded: [...padded], realLen: full.length };
}

let pass = 0, fail = 0;
const N = 220;
for (let i = 0; i < N; i++) {
  const roleCount = 1 + randInt(7);
  const p = { role_count: roleCount };
  for (let r = 1; r <= 7; r++) {
    if (r <= roleCount) {
      const s = randSpkBytes('testnet');
      p['role' + r + '_spk'] = s.padded; p['role' + r + '_len'] = s.realLen; p['role' + r + '_amt'] = randBigAmount();
    } else {
      p['role' + r + '_spk'] = spkN(37, 0); p['role' + r + '_len'] = 0n; p['role' + r + '_amt'] = 0n;
    }
  }
  const rf = randSpkBytes('testnet');
  p.refund_spk = rf.padded; p.refund_len = rf.realLen;
  p.deadline_ms = BigInt(Date.now()) + BigInt(randInt(1e9));
  p.max_split_fee = randBigAmount(); p.max_refund_fee = randBigAmount();
  p.rule_commit = [...crypto.getRandomValues(new Uint8Array(32))];
  p.channel_chain_commitment = [...crypto.getRandomValues(new Uint8Array(32))];
  p.order_nonce = [...crypto.getRandomValues(new Uint8Array(16))];

  const real = realCompile(p);
  const spliced = spliceCommissionSplit(baseTemplate, p);
  const match = real.equals(spliced);
  if (match) { pass++; }
  else {
    fail++;
    console.log('FAIL vector ' + i + ': role_count=' + roleCount, 'real.length=', real.length, 'spliced.length=', spliced.length);
    if (real.length === spliced.length) {
      for (let k = 0; k < real.length; k++) {
        if (real[k] !== spliced[k]) { console.log('  first diff at byte', k, 'real=', real[k], 'spliced=', spliced[k]); break; }
      }
    }
  }
}
console.log('\n=== CommissionSplit template-splice parity: ' + pass + '/' + N + ' PASS, ' + fail + ' FAIL ===');
