// J2 fee-payout — 价值分成 fee-recipient 实分发 (broker/oracle/node 各从 PS continuation 续约领).
//   接 _j2_c_settle 的 winner-claim 后: PS 在 winner-claim:self_out_idx 续约 (state w0=1, bit0=winner已领).
//   循环 payoutLeaves[1..6] (broker + 5 committee) 各 bshard_payout_claim → 真收钱 (value-split 钱实流).
// 用法: FROM_PS=<txid:idx> START_W0=1 node scripts/_j2_fee_payout.mjs <logical_market_id>
//   FROM_PS = winner-claim 后的 PS continuation outpoint; START_W0 = 该 PS 当前 nullifier word0 (winner 后=1).
import { compileSil, ctorBytes32, ctorInt } from '../src/lib/pool-bshard-artifacts.mjs';
import { buildPoolMerkleTree } from '../src/services/pool-merkle-v06.mjs';
import { computePariMutuelPayout, settlePayoutRoot, deriveFeeLeaves, computeMarketCommit, computePredicateCommit, FEE_CONFIG } from '../src/lib/pool-shard-settle.mjs';
import { loadCommittee } from '../src/services/pool-market-settler-v06.mjs';
import { merkleProof as payoutMerkleProof } from '../src/lib/pool-payout-root.mjs';
import { getActivePool } from '../src/lib/oracle-pool-source.mjs';
import Database from 'better-sqlite3';
const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { ScriptBuilder, addressFromScriptPublicKey, PublicKey } = W;
const CONSOLE = 'http://127.0.0.1:3200', GATEWAY = 'eb5a5864-a8e0-4376-8f61-38108abb301f', NET = 'testnet-12';
const SILVERC = 'D:/silverscript/target/release/silverc.exe', z32 = '00'.repeat(32);
const LM = process.argv[2];
if (!LM) { console.error('usage: FROM_PS=<txid:idx> START_W0=1 node scripts/_j2_fee_payout.mjs <logical_market_id>'); process.exit(1); }
const log = (m) => console.log(`[fee-payout ${new Date().toISOString().slice(11, 19)}] ${m}`);
const db = new Database('./data/console.db', { readonly: true });
const rc = async (cmd, t = 90000) => { const r = await fetch(`${CONSOLE}/api/relay/${GATEWAY}/send-command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(t) }); const j = await r.json(); if (!r.ok || j.ok === false) { const e = new Error(cmd.type); e.relayErr = j.error || JSON.stringify(j); throw e; } return j; };
const p2sh = (h) => addressFromScriptPublicKey(ScriptBuilder.fromScript(new Uint8Array(Buffer.from(h, 'hex'))).createPayToScriptHashScript(), NET).toString();
async function landed(txid, address, n = 30) { for (let i = 0; i < n; i++) { const j = await rc({ type: 'check_utxo_landed', address, txid }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; }
async function transfer(addr, sompi) { const j = await rc({ type: 'transfer', target: addr, amount: Number(BigInt(sompi)) / 1e8 }); const tx = j.txId || j.txid; if (tx && await landed(tx, addr)) return tx; throw new Error('transfer no land'); }
const RELAY_ADDR = (await rc({ type: 'get_pubkey' })).address;

const market = db.prepare('SELECT * FROM pool_markets WHERE id=?').get(LM);
const ps = db.prepare('SELECT * FROM payout_shards WHERE logical_market_id=?').get(LM);
const bettors = db.prepare("SELECT bettor_pk, direction, stake_amount FROM pool_bettor_sides WHERE market_id LIKE ?").all(LM + '%').map(b => ({ pk: b.bettor_pk, direction: Number(b.direction), stake: Number(b.stake_amount) }));
const POOL = BigInt(process.env.SETTLE_POOL || '2020000000');
const WIN = Number(process.env.WIN || 1);

// re-derive 完全同 settle: committee → feeLeaves → payoutLeaves → newPayoutRoot (必 == 链上 attested 83c00472).
const pinned = loadCommittee(LM);
if (!pinned?.committee_pks?.length) throw new Error('loadCommittee 无 committee_pks');
const feePoolSompi = bettors.reduce((s, b) => s + BigInt(b.stake), 0n);   // fee base = bettor pari-mutuel pool (= enforce 用同源), NOT consolidated_pool (含 maker/register 余).
const feeLeaves = deriveFeeLeaves({ poolSompi: feePoolSompi.toString(), feeConfig: FEE_CONFIG, brokerPk: String(market.broker_pk).toLowerCase(), introducerPk: market.introducer_pk || null, committeePks: pinned.committee_pks }).feeLeaves;
const pm = computePariMutuelPayout({ bettors, winningDirection: WIN, feeBps: 0, feeLeaves });
const payoutLeaves = pm.payoutLeaves;
const newPayoutRoot = settlePayoutRoot(payoutLeaves);
log(`payoutLeaves ${payoutLeaves.length} (winner[0] + ${feeLeaves.length} fee), re-derived payoutRoot=${newPayoutRoot.slice(0, 16)}`);
if (process.env.EXPECT_ROOT && newPayoutRoot !== process.env.EXPECT_ROOT) throw new Error(`payoutRoot ${newPayoutRoot.slice(0, 16)} != EXPECT ${process.env.EXPECT_ROOT.slice(0, 16)} — re-derive 不符 settle, 不可领`);

const predicate = process.env.PREDICATE_JSON ? JSON.parse(process.env.PREDICATE_JSON) : (market.resolution_rule_spec ? JSON.parse(market.resolution_rule_spec).resolution_predicate : null);
const _feeRec = { brokerPk: String(market.broker_pk).toLowerCase(), introducerPk: market.introducer_pk || null };
const claimPredCommit = predicate ? computeMarketCommit(predicate, _feeRec) : market.market_metadata_hash;
const closedRedeem = Buffer.from(compileSil('./src/lib/PayoutShard.sil', [ctorBytes32(market.pool_merkle_root), ctorBytes32(claimPredCommit), ctorInt(Number(POOL)), ctorInt(1), ctorBytes32(newPayoutRoot), ...Array.from({ length: 17 }, () => ctorInt(0))], SILVERC).script).toString('hex');

// ── state splice helpers (replicate relay p2sh.mjs _serializePayoutStateHex + _continuationAddress splice) ──
const STATE_START = 1, PAYOUTSHARD_STATE_LEN = 204, NW = 17;
const i64LE = (v) => { const b = Buffer.alloc(8); let n = BigInt(v); if (n < 0n) n = (1n << 64n) + n; for (let i = 0; i < 8; i++) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; };
const pushData = (buf) => { const len = buf.length; if (len <= 75) return len.toString(16).padStart(2, '0') + buf.toString('hex'); if (len <= 255) return '4c' + len.toString(16).padStart(2, '0') + buf.toString('hex'); const lo = (len & 0xff).toString(16).padStart(2, '0'), hi = ((len >> 8) & 0xff).toString(16).padStart(2, '0'); return '4d' + lo + hi + buf.toString('hex'); };
const serializeState = (s) => { let h = pushData(i64LE(s.consolidated_pool)) + pushData(i64LE(s.closed)) + pushData(Buffer.from(String(s.payoutRoot).replace(/^0x/, ''), 'hex')); for (let i = 0; i < NW; i++) h += pushData(i64LE(s['w' + i] ?? 0)); return h; };
const spliceRedeem = (redeemHex, stateHex) => { const r = Buffer.from(redeemHex, 'hex'), st = Buffer.from(stateHex, 'hex'); if (st.length !== PAYOUTSHARD_STATE_LEN) throw new Error(`state ser ${st.length}B != ${PAYOUTSHARD_STATE_LEN}`); return Buffer.concat([r.slice(0, STATE_START), st, r.slice(STATE_START + PAYOUTSHARD_STATE_LEN)]).toString('hex'); };

let [psTx, psIdx] = [process.env.FROM_PS.split(':')[0], Number(process.env.FROM_PS.split(':')[1] || 1)];
// 当前 PS state (winner-claim 后): consolidated_pool 已 -= winner; w0 bit0 set. 每 fee-claim 续减/续置位.
let curState = { consolidated_pool: (POOL - BigInt(payoutLeaves[0].amount)), closed: 1, payoutRoot: newPayoutRoot, w0: BigInt(process.env.START_W0 || '1') };
for (let i = 1; i < NW; i++) curState['w' + i] = 0n;
log(`fee-payout 从 PS ${psTx.slice(0, 14)}:${psIdx} (consolidated_pool=${(Number(curState.consolidated_pool) / 1e8).toFixed(3)}KAS, w0=${curState.w0}, winner 已领)；领 ${feeLeaves.length} fee-leaf...`);

const results = [];
for (let i = 1; i < payoutLeaves.length; i++) {
  const leaf = payoutLeaves[i];
  const ftype = feeLeaves[i - 1]?.type || 'fee';
  const recipientAddr = new PublicKey(leaf.pk).toAddress(NET).toString();
  let sibs = payoutMerkleProof(payoutLeaves, i).map(s => s.toString('hex')); while (sibs.length < 10) sibs.push(z32);
  // 输入 redeem = closedRedeem 把【当前 PS state】splice 进 stateStart (= 该 UTXO 真实地址 P2SH(spliced)).
  const inputRedeem = spliceRedeem(closedRedeem, serializeState(curState));
  const stateForCmd = { consolidated_pool: curState.consolidated_pool.toString(), closed: 1, payoutRoot: newPayoutRoot };
  for (let k = 0; k < NW; k++) stateForCmd['w' + k] = curState['w' + k].toString();
  const feeUtxo = await transfer(RELAY_ADDR, 30_000_000n);
  const clj = await rc({ type: 'bshard_payout_claim',
    inputs: { payoutshard: { redeem_hex: inputRedeem, outpointTxid: psTx, index: psIdx, state: stateForCmd, state_start: STATE_START }, fee: { address: RELAY_ADDR, outpointTxid: feeUtxo, index: 0 } },
    witness: { self_out_idx: 1, payout_out_idx: 0, bettor_pk: leaf.pk, payout: leaf.amount, merkle_index: i, siblings_hex: sibs },
    outputs: { payout: { address: recipientAddr, amountSompi: leaf.amount }, change_address: RELAY_ADDR } });
  const claimTx = clj.txId || clj.txid;
  if (!claimTx) throw new Error(`fee-leaf ${i} (${ftype}) claim 无 txId: ${JSON.stringify(clj).slice(0, 180)}`);
  const ok = await landed(claimTx, recipientAddr);
  if (!ok) throw new Error(`fee-leaf ${i} (${ftype}) claim 未确认: ${claimTx}`);
  log(`  ✅ fee-leaf[${i}] ${ftype} ${recipientAddr.slice(0, 18)} 实领 ${(Number(leaf.amount) / 1e8).toFixed(3)} KAS — claim ${claimTx.slice(0, 16)} LANDED`);
  results.push({ idx: i, type: ftype, pk: leaf.pk.slice(0, 12), addr: recipientAddr, amount: leaf.amount, claimTx });
  // PS 续约 → 下一 leaf 从此 continuation 领; consolidated_pool -= payout, nullifier bit i set.
  [psTx, psIdx] = [claimTx, 1];
  curState.consolidated_pool = curState.consolidated_pool - BigInt(leaf.amount);
  curState.w0 = curState.w0 + (1n << BigInt(i));
}
console.log('\n================= fee-payout VERDICT =================');
console.log(`✅✅✅ value-split fee 实分发: ${results.length} fee-recipient 各从 PS continuation 链上实领`);
for (const r of results) console.log(`   [${r.idx}] ${r.type.padEnd(10)} ${r.addr.slice(0, 20)} ${(Number(r.amount) / 1e8).toFixed(3)} KAS  claim=${r.claimTx}`);
console.log(`   final PS w0 nullifier=${curState.w0} (bits 0..${payoutLeaves.length - 1} 全 set = winner + 全 fee 已领)`);
console.log('=====================================================');
db.close();
process.exit(0);
