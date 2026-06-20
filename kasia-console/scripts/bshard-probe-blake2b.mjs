// bshard-probe-blake2b.mjs — KANet-UI :3200 operator probe runner for the cost-model discriminator (2026-06-15).
//
// Runs J1's Blake2bProbe.sil (ba75e8cd) on chain to settle the 30× cost-model dispute (pure-∝-bytes vs fixed-per-blake2b).
// probe8 entrypoint does 8 raw blake2b of 64B (= merkle-climb depth-8 shape). DISCRIMINATOR BY OUTCOME:
//   • probe8 LANDS (accepted, units 8×128≈1024 < 9999) → pure-∝-bytes → merkle-climb CHEAP → claim doesn't need to ditch merkle.
//   • probe8 REJECTED ("script units exceeded: used≈8×3935≈31k") → fixed-per-blake2b → merkle-climb DISASTER → claim needs voucher.
// (This probe isolates RAW blake2b — register/seal use validateOutputState/WithTemplate = a separate cost site = probe-B.)

import { compileAndComputeP2SH, bytes32Expr } from '../src/lib/pool-p2sh.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBE_SIL = join(__dirname, '..', 'src', 'lib', 'Blake2bProbe.sil');
const CONSOLE_URL = 'http://127.0.0.1:3200';
const FUNDING_RELAY = process.env.BSHARD_E2E_TREASURY_RELAY || 'eb5a5864-a8e0-4376-8f61-38108abb301f'; // tester-1 clean
const NETWORK = 'testnet-12';
const KASPAD = process.env.BSHARD_KASPAD_URL || 'ws://192.168.1.106:17210';

async function relayCmd(relayId, cmd, t = 60000) {
  const res = await fetch(`${CONSOLE_URL}/api/relay/${relayId}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(t),
  });
  const j = await res.json();
  if (!res.ok || j.ok === false) throw new Error(`relay ${cmd.type} -> ${JSON.stringify(j)}`);
  return j;
}
const log = (m) => console.log(`[probe-blake2b ${new Date().toISOString().slice(11, 19)}] ${m}`);
// push-data hex: <=75B → OP_PUSHBYTES_n + data; <=255B → OP_PUSHDATA1(0x4c)+len+data
function pushData(buf) {
  const n = buf.length;
  if (n <= 75) return n.toString(16).padStart(2, '0') + buf.toString('hex');
  if (n <= 255) return '4c' + n.toString(16).padStart(2, '0') + buf.toString('hex');
  throw new Error(`pushData >255 not handled (${n})`);
}

async function main() {
  const kaspa = await import('kaspa-wasm');
  const { RpcClient, Encoding, Resolver, Transaction, TransactionOutput, Address, payToAddressScript, ScriptBuilder, addressFromScriptPublicKey } = kaspa;

  // 1. compile Blake2bProbe (ctor seed = 0x11×32) → redeem + P2SH addr
  const seed = '11'.repeat(32);
  const compiled = await compileAndComputeP2SH(PROBE_SIL, [bytes32Expr(seed)], 'Blake2bProbe', NETWORK);
  const redeemHex = compiled.redeemScript;
  const p2shAddr = compiled.p2shAddr;
  log(`Blake2bProbe P2SH: ${p2shAddr}  (redeem ${redeemHex.length / 2}B)`);

  // 2. fund the P2SH (tester-1 transfer, 5 KAS — large clean change)
  log('funding probe P2SH (tester-1, 5 KAS)...');
  const tr = await relayCmd(FUNDING_RELAY, { type: 'transfer', target: p2shAddr, amount: 5 });
  const fundTxid = tr.txId || tr.txid || tr.transactionId;
  if (!fundTxid) throw new Error(`fund: no txId ${JSON.stringify(tr)}`);
  log(`fund txid: ${fundTxid} — waiting to land...`);
  for (let i = 0; i < 30; i++) {
    const j = await relayCmd(FUNDING_RELAY, { type: 'check_utxo_landed', address: p2shAddr, txid: fundTxid }, 15000);
    if (j.landed || j.confirmed || j.found) { log('fund landed'); break; }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. connect kaspad RPC + fetch the funded UTXO
  const rpc = new RpcClient({ url: KASPAD, encoding: Encoding.Borsh, networkId: NETWORK });
  await rpc.connect();
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [p2shAddr] });
  const utxo = entries.find(e => e.outpoint.transactionId === fundTxid) || entries[0];
  if (!utxo) throw new Error('no UTXO at probe P2SH after funding');
  log(`probe UTXO: ${utxo.outpoint.transactionId}:${utxo.outpoint.index} amount=${utxo.amount}`);

  // 4. build probe8 spend: signatureScript = pushData(sib 32B) + OP_1(0x51) + pushData(redeem); output = back to a fresh change addr
  const changeAddr = (await relayCmd(FUNDING_RELAY, { type: 'get_pubkey' })).address;
  const sib = Buffer.from('22'.repeat(32), 'hex');
  const sigScriptHex = pushData(sib) + '51' + pushData(Buffer.from(redeemHex, 'hex')); // OP_1 = 0x51 (entry 1 = probe8)
  const out = new TransactionOutput(BigInt(utxo.amount) - 10000n, payToAddressScript(new Address(changeAddr)));
  const tx = new Transaction({
    version: 0,
    inputs: [{ previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, utxo }],
    outputs: [out], lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '',
  });

  // 5. submit → discriminate by outcome
  log('submitting probe8 (8 raw blake2b of 64B)...');
  try {
    const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
    log(`✅✅ probe8 ACCEPTED txid=${r.transactionId || r} → units 8-blake2b < 9999 → **PURE-∝-BYTES model** → raw blake2b ~128 → merkle-climb CHEAP → claim does NOT need to ditch merkle.`);
  } catch (e) {
    const msg = String(e.message || e);
    const m = msg.match(/used[=:]\s*(\d+)/i);
    log(`🔴 probe8 REJECTED: ${msg.slice(0, 160)}`);
    if (m) log(`→ used=${m[1]} for 8 raw blake2b → per-blake2b ≈ ${Math.round((Number(m[1]) - 200) / 8)} → **FIXED-PER-BLAKE2B model** → merkle-climb DISASTER → claim needs voucher/redesign.`);
  }
  await rpc.disconnect();
}

main().catch((e) => { console.error('[probe-blake2b] FAIL:', e.stack || e.message); process.exit(1); });
