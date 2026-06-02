// v0.7.1 claim TX builder — full build+sign+submit, Bettor 本地跑 (key 不离手)
//
// Prereq: 两 UTXOs 已 funded per r276 (= 7b1a5996...:0 5e8 sompi, 22e0a69e...:0 1e8 sompi)
//
// 用法 (在 Bettor host 跑, kaspa-wasm 同节点访问 .105:17210):
//   POOL_BETTOR_PRIVKEY_HEX="<32B tester-1 privkey hex>" \
//   node scripts/build-v0_7_1-claim-tx.mjs
//
// 输出: scriptSig hex (per input) + 完整 signed TX hex + submit 结果.
// 不传 privkey 跑 = dry run (= 只算 shape + 验 addrs, 不签).

import * as kaspa from 'kaspa-wasm';
import { Buffer } from 'buffer';
import { computeWinningsPoolP2SH_v1, computeSideP2SH_v0_7_1 } from '../src/lib/pool-p2sh-v0_7_1.mjs';

const { Address, Transaction, TransactionOutput, ScriptPublicKey, RpcClient, Encoding,
        payToAddressScript, createInputSignature, SighashType } = kaspa;

// === Constants ===
const NETWORK_ID = 'testnet-12';
const TESTER_PK = 'e72d8e7ea88a53d6d11e71d91e2a149dc8d4dc45f501b1651953997d1c731667';
const KASPAD_URL = process.env.KASPAD_URL || 'ws://192.168.1.105:17210';

// Funded UTXOs — POOL_WP_OUTPOINT / POOL_PS_OUTPOINT env vars override defaults.
// After WinningsPool SS bump (r433 KIP-9 fix → WP redeem 207B → new P2SH addr), Bettor must
// re-fund NEW WP addr: kaspatest:pzhunh202xegmvue7vsghxsgsqrkhhzgafpua2pvn5pnd3es33rkqatvhmu8j
// PoolSide addr unchanged: kaspatest:przr3xjgw36dtv7ql0lz4hcrwa39de4qhtfnczcg9hrjtl8ee8yy5u2mn4zhn
const WP_OUTPOINT = process.env.POOL_WP_OUTPOINT || '7b1a599658976f36f91df6f07f21553eb48825e1a1bb0ec955a8468f83c95614:0';
const PS_OUTPOINT = process.env.POOL_PS_OUTPOINT || '22e0a69e80eb6a9f70a8fa7fc5277394f28527177ba3f5abdb21f8439ba33fa2:0';
const WP_AMOUNT = 500_000_000n;  // 5 KAS
const PS_AMOUNT = 100_000_000n;  // 1 KAS

// === Re-derive redeem scripts (deterministic from ctor) ===
const wp = await computeWinningsPoolP2SH_v1({
  outcome: 0, yesPool: 1_000_000_000, noPool: 500_000_000,
  brokerPk: TESTER_PK,
  marketCovenantId: '3333333333333333333333333333333333333333333333333333333333333333',
  network: NETWORK_ID,
});
const ps = await computeSideP2SH_v0_7_1({
  bettorPk: TESTER_PK,
  spineP2shHash: '4444444444444444444444444444444444444444444444444444444444444444',
  marketMetadataHash: '5555555555555555555555555555555555555555555555555555555555555555',
  direction: 0, deadline: 1900000000, network: NETWORK_ID,
});

console.log('addr verify:');
console.log('  WinningsPool:', wp.p2shAddr, '/ redeem', wp.redeemScript.length/2, 'B');
console.log('  PoolSide:    ', ps.p2shAddr, '/ redeem', ps.redeemScript.length/2, 'B');

// === Compute claim TX shape ===
const winnerStake = 100_000_000n;     // PS_AMOUNT
const yesPool = 1_000_000_000n;
const noPool  =   500_000_000n;
const totalPool = yesPool + noPool;
const winningPool = yesPool;
const share = winnerStake * totalPool / winningPool;
const poolShareTaken = share - winnerStake;
const newPool = WP_AMOUNT - poolShareTaken;
// Bettor r433 storage_mass catch: broker out 必 ≥ 2e6 sompi (KIP-9 cap)
const brokerFee = 5_000_000n;  // 0.05 KAS, KIP-9 mass safe
const minerFee = 50_000n;       // miner takes leftover from fee budget
const continuationValue = newPool - brokerFee - minerFee;  // 守 WP L83 上限 + ≥ WP L84 下限 (newPool - 1e8 = 450M-1e8 = 350M < 444.95M ✓)

console.log('claim TX shape:');
console.log('  in[0] WP:', WP_AMOUNT.toString(), 'sompi');
console.log('  in[1] PS:', PS_AMOUNT.toString(), 'sompi');
console.log('  out[0] bettor share P2PK:', share.toString());
console.log('  out[1] WP continuation P2SH:', continuationValue.toString());
console.log('  out[2] broker fee P2PK:', brokerFee.toString());
console.log('  Σ in - Σ out =', (WP_AMOUNT + PS_AMOUNT - share - continuationValue - brokerFee).toString(), 'real miner fee');

// === Construct unsigned TX ===
// bettor P2PK script: OP_DATA32 + 32B x-only PK + OP_CHECKSIG = 34 bytes (sigOpCount 1)
const pkBytes = Buffer.from(TESTER_PK, 'hex');
if (pkBytes.length !== 32) throw new Error('x-only PK must be 32B');
const bettorScript = new ScriptPublicKey(0, Buffer.concat([Buffer.from([0x20]), pkBytes, Buffer.from([0xac])]));
const wpP2shScript = payToAddressScript(new Address(wp.p2shAddr));
const psP2shScript = payToAddressScript(new Address(ps.p2shAddr));
const brokerScript = bettorScript;  // same key

function pushData(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const len = buf.length;
  if (len <= 75) return len.toString(16).padStart(2,'0') + buf.toString('hex');
  if (len <= 255) return '4c' + len.toString(16).padStart(2,'0') + buf.toString('hex');
  if (len <= 65535) {
    const lo = len & 0xff, hi = (len >> 8) & 0xff;
    return '4d' + lo.toString(16).padStart(2,'0') + hi.toString(16).padStart(2,'0') + buf.toString('hex');
  }
  throw new Error('push too large');
}
function intToLeBytes(n) {
  if (n === 0n) return Buffer.alloc(0);
  const bytes = [];
  let val = n;
  while (val > 0n) {
    bytes.push(Number(val & 0xffn));
    val >>= 8n;
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0x00);
  return Buffer.from(bytes);
}
function opNHex(n) {
  if (n === 0n) return '00';
  if (n >= 1n && n <= 16n) return (0x50 + Number(n)).toString(16).padStart(2,'0');
  return pushData(intToLeBytes(n));
}

const wpRedeemBytes = Buffer.from(wp.redeemScript, 'hex');
const psRedeemBytes = Buffer.from(ps.redeemScript, 'hex');

// Build unsigned TX (placeholder signature for in[1] for sighash compute)
const [wpTxid, wpVout] = WP_OUTPOINT.split(':');
const [psTxid, psVout] = PS_OUTPOINT.split(':');

const utxos = [
  { outpoint: { transactionId: wpTxid, index: Number(wpVout) }, amount: WP_AMOUNT, scriptPublicKey: wpP2shScript, blockDaaScore: 0n, isCoinbase: false },
  { outpoint: { transactionId: psTxid, index: Number(psVout) }, amount: PS_AMOUNT, scriptPublicKey: psP2shScript, blockDaaScore: 0n, isCoinbase: false },
];

const unsignedTx = new Transaction({
  version: 0,
  inputs: [
    { previousOutpoint: utxos[0].outpoint, signatureScript: '', sequence: 0n, sigOpCount: 0, utxo: utxos[0] },
    { previousOutpoint: utxos[1].outpoint, signatureScript: '', sequence: 0n, sigOpCount: 1, utxo: utxos[1] },
  ],
  outputs: [
    new TransactionOutput(share, bettorScript),
    new TransactionOutput(continuationValue, wpP2shScript),
    new TransactionOutput(brokerFee, brokerScript),
  ],
  lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
});

const privHex = process.env.POOL_BETTOR_PRIVKEY_HEX;
if (!privHex) {
  console.log('\nDRY RUN — POOL_BETTOR_PRIVKEY_HEX not set, skip sign+submit.');
  console.log('To sign+submit: POOL_BETTOR_PRIVKEY_HEX=<32B hex> node scripts/build-v0_7_1-claim-tx.mjs');
  process.exit(0);
}

// === Sign in[1] PoolSide with bettor key ===
let privKeyObj;
try { privKeyObj = new kaspa.PrivateKey(privHex); }
catch (e) { console.error('privkey parse fail:', e.message); process.exit(1); }

const bettorSigHex = createInputSignature(unsignedTx, 1, privKeyObj, SighashType.All);
console.log('\nbettor sig (66B push-encoded):', bettorSigHex);

// === Build scriptSigs ===
// in[0] WinningsPool.claim(int share):
//   WinningsPool 只 1 entry → silverc 单 entry NO selector (per TUTORIAL.md "Omits the selector for
//   contracts with a single entrypoint"). scriptSig = [push share] + push(redeem)
const wpScriptSig = opNHex(share) + pushData(wpRedeemBytes);
console.log('in[0] WP scriptSig:', wpScriptSig.length/2, 'B');

// in[1] PoolSide.claim_winner(sig, int winner, int yes, int no):
// PoolSide 3 entries (settled_via_spine=0, claim_winner=1, refund_market_cancelled=2) → selector 必须
// declaration order push: bettorSig, settlementWinner, totalYesPool, totalNoPool, then OP_1 (entry 1), then redeem
const psScriptSig =
  bettorSigHex +
  '00' +  // winner=0 = OP_0
  opNHex(yesPool) +
  opNHex(noPool) +
  '51' +  // OP_1 entry 1 selector (= claim_winner)
  pushData(psRedeemBytes);
console.log('in[1] PS scriptSig:', psScriptSig.length/2, 'B');

// === Build signed TX ===
const signedTx = new Transaction({
  version: 0,
  inputs: [
    { previousOutpoint: utxos[0].outpoint, signatureScript: wpScriptSig, sequence: 0n, sigOpCount: 0 },
    { previousOutpoint: utxos[1].outpoint, signatureScript: psScriptSig, sequence: 0n, sigOpCount: 1 },
  ],
  outputs: [
    new TransactionOutput(share, bettorScript),
    new TransactionOutput(continuationValue, wpP2shScript),
    new TransactionOutput(brokerFee, brokerScript),
  ],
  lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
});

console.log('\nsignedTx ready, attempting submit to', KASPAD_URL);

const rpc = new RpcClient({ url: KASPAD_URL, encoding: Encoding.Borsh, networkId: NETWORK_ID });
await rpc.connect();
try {
  const r = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
  console.log('\n✓ submit OK txid:', r.transactionId);
  console.log('verify: https://api-tn12.kaspa.org/transactions/' + r.transactionId);
} catch (e) {
  console.error('submit FAIL:', e.message);
  console.error('signedTx hex (for forensic):', JSON.stringify(signedTx, (k,v)=>typeof v==='bigint'?v.toString():v).slice(0, 500));
  process.exit(1);
} finally {
  await rpc.disconnect();
}
