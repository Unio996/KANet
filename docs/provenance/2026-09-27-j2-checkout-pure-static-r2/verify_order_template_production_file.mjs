process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const OT = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/checkout-static/order-template.js');

const CS_PATH = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/sil-v1/CommissionSplit.sil';
const CD_PATH = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/sil-v1/ChannelDeposit.sil';

function ctorInt(n) { return { kind: 'int', value: Number(n) }; }
function ctorBytes(arr) { return { kind: 'bytes', value: [...arr] }; }
const FIELD_ORDER = ['role_count',
  'role1_spk', 'role1_len', 'role1_amt', 'role2_spk', 'role2_len', 'role2_amt', 'role3_spk', 'role3_len', 'role3_amt',
  'role4_spk', 'role4_len', 'role4_amt', 'role5_spk', 'role5_len', 'role5_amt', 'role6_spk', 'role6_len', 'role6_amt',
  'role7_spk', 'role7_len', 'role7_amt', 'refund_spk', 'refund_len',
  'deadline_ms', 'max_split_fee', 'max_refund_fee', 'rule_commit', 'channel_chain_commitment', 'order_nonce'];
const BYTES_FIELDS = { role1_spk:37,role2_spk:37,role3_spk:37,role4_spk:37,role5_spk:37,role6_spk:37,role7_spk:37,refund_spk:37,rule_commit:32,channel_chain_commitment:32,order_nonce:16 };

function realCompileCS(p) {
  const ctorArr = FIELD_ORDER.map(name => BYTES_FIELDS[name] ? ctorBytes(p[name]) : ctorInt(p[name]));
  return Buffer.from(compileSilV100(CS_PATH, ctorArr, 'CommissionSplit').script);
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
  else { const rs = Buffer.from(crypto.getRandomValues(new Uint8Array(20))); const spk = kaspa.payToScriptHashScript(rs); addrObj = kaspa.addressFromScriptPublicKey(spk, net); }
  const spkObj = kaspa.payToAddressScript(new kaspa.Address(addrObj.toString()));
  const full = Buffer.concat([Buffer.from([spkObj.version & 0xff, (spkObj.version >> 8) & 0xff]), Buffer.from(spkObj.script, 'hex')]);
  const padded = Buffer.alloc(37, 0); full.copy(padded);
  return { padded, realLen: full.length };
}

let pass = 0, fail = 0;
const N = 260;
for (let i = 0; i < N; i++) {
  const roleCount = 1 + randInt(7);
  const p = { role_count: roleCount };
  for (let r = 1; r <= 7; r++) {
    if (r <= roleCount) { const s = randSpkBytes('testnet'); p[`role${r}_spk`] = s.padded; p[`role${r}_len`] = s.realLen; p[`role${r}_amt`] = randBigAmount(); }
    else { p[`role${r}_spk`] = Buffer.alloc(37, 0); p[`role${r}_len`] = 0n; p[`role${r}_amt`] = 0n; }
  }
  const rf = randSpkBytes('testnet');
  p.refund_spk = rf.padded; p.refund_len = rf.realLen;
  p.deadline_ms = BigInt(Date.now()) + BigInt(randInt(1e9));
  p.max_split_fee = randBigAmount(); p.max_refund_fee = randBigAmount();
  p.rule_commit = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  p.channel_chain_commitment = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  p.order_nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));

  const real = realCompileCS(p);
  const spliced = Buffer.from(OT.spliceCommissionSplitScript(p));
  if (real.equals(spliced)) pass++;
  else { fail++; console.log('FAIL CS vector', i); }
}
console.log(`CommissionSplit (production order-template.js): ${pass}/${N} PASS, ${fail} FAIL`);

// ChannelDeposit
let pass2 = 0, fail2 = 0;
const N2 = 60;
for (let i = 0; i < N2; i++) {
  const priv = new kaspa.PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
  const addr = priv.toPublicKey().toAddress('testnet');
  const spk = kaspa.payToAddressScript(new kaspa.Address(addr.toString()));
  const pkBytes = Buffer.from(spk.script, 'hex').subarray(1, 33);
  const feeChoices = [0, 1, 2000000, 9999999, 1000000000000, 9007199254740991];
  const fee = BigInt(feeChoices[randInt(feeChoices.length)]);
  const real = Buffer.from(compileSilV100(CD_PATH, [ctorBytes(pkBytes), ctorInt(Number(fee))], 'ChannelDeposit').script);
  const spliced = Buffer.from(OT.spliceChannelDepositScript({ depositor_pk: pkBytes, max_withdraw_fee: fee }));
  if (real.equals(spliced)) pass2++; else { fail2++; console.log('FAIL CD vector', i); }
}
console.log(`ChannelDeposit (production order-template.js): ${pass2}/${N2} PASS, ${fail2} FAIL`);

console.log(`\n=== TOTAL: ${pass + pass2}/${N + N2} PASS ===`);
process.exit((fail + fail2) > 0 ? 1 : 0);
