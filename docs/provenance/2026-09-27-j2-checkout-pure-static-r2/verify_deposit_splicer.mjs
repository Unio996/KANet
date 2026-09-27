process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const DEPOSIT_PATH = 'D:/kanet-tn12/scratch/_j2_wt_checkout_static/kasia-console/src/lib/sil-v1/ChannelDeposit.sil';

function realCompile(pkArr, fee) {
  const ctor = [{ kind: 'bytes', value: pkArr }, { kind: 'int', value: Number(fee) }];
  return Buffer.from(compileSilV100(DEPOSIT_PATH, ctor, 'ChannelDeposit').script);
}
const baseTemplate = realCompile(Array(32).fill(0), 0);
console.log('base template length:', baseTemplate.length);

function spliceDeposit(template, pkArr, fee) {
  const out = Buffer.from(template);
  Buffer.from(pkArr).copy(out, 2);
  const feeBuf = Buffer.alloc(8);
  feeBuf.writeBigUInt64LE(BigInt(fee));
  feeBuf.copy(out, 35);
  return out;
}

let pass = 0, fail = 0;
const N = 60;
for (let i = 0; i < N; i++) {
  const priv = new kaspa.PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
  const addr = priv.toPublicKey().toAddress('testnet');
  const spk = kaspa.payToAddressScript(new kaspa.Address(addr.toString()));
  const pkBytes = [...Buffer.from(spk.script, 'hex').subarray(1, 33)]; // x-only 32-byte pubkey (P2PK script = 0x20‖pk‖0xac)
  const feeChoices = [0, 1, 2000000, 9999999, 1000000000000, 9007199254740991];
  const fee = BigInt(feeChoices[Math.floor(Math.random() * feeChoices.length)]);
  const real = realCompile(pkBytes, fee);
  const spliced = spliceDeposit(baseTemplate, pkBytes, fee);
  if (real.equals(spliced)) pass++;
  else { fail++; console.log('FAIL', i, 'fee=', fee.toString()); }
}
console.log('\n=== ChannelDeposit template-splice parity: ' + pass + '/' + N + ' PASS, ' + fail + ' FAIL ===');
