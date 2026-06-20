// J2 cross-node 1000 consolidate+settle 驱动(最终步, 我域): 32 片 fan-in 聚合 → close_attest(depth-10 1024-winner)→ claim.
//   读 _xnode_artifacts.json(genesis PS + 32 ShardLeaf redeem)+ _xnode_sealed.json(input: {shards:[{idx,sealedTx}×32]}, 我+J1 sealed 合并).
//   每片: spliceLeafState 推 count=32 sealed redeem(验过 byte-equal)+ consolidate 进 PayoutShard(cov_id 跨 32 续, pool 累积).
//   settle (A synthetic): 生成 W 个 fresh winner → payoutRoot(depth-10) → committee close_attest → claim winner[0].
//   ⚠ post-register 跑(两边 32 片全 sealed, _xnode_sealed.json 备好). env: SETTLE_WINNERS(默认 1024).
import { compileSil, ctorBytes32, ctorInt } from '../src/lib/pool-bshard-artifacts.mjs';
import { buildPoolMerkleTree, getPoolMerkleProof } from '../src/services/pool-merkle-v06.mjs';
import { payoutRoot, merkleProof } from '../src/lib/pool-payout-root.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { Keypair, PrivateKey, ScriptBuilder, addressFromScriptPublicKey, Transaction, TransactionOutput, Address, payToAddressScript, createInputSignature, SighashType, CovenantBinding, Hash } = W;
const CONSOLE = 'http://127.0.0.1:3200', RELAY = 'eb5a5864-a8e0-4376-8f61-38108abb301f', NET = 'testnet-12';
const SILVERC = 'D:/silverscript/target/release/silverc.exe', z32 = '00'.repeat(32);
const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const DIR = dirname(fileURLToPath(import.meta.url));
const ART = JSON.parse(readFileSync(join(DIR, '_xnode_artifacts.json'), 'utf8'));
const SEALED = JSON.parse(readFileSync(join(DIR, '_xnode_sealed.json'), 'utf8')).shards;   // [{idx, sealedTx}×32]
const STAKE = BigInt(ART.stake), SEAL = ART.seal_count, SEED = 20_000_000n;
const SETTLE_WINNERS = Number(process.env.SETTLE_WINNERS || 1024);
const log = (m) => console.log(`[xcons ${new Date().toISOString().slice(11, 19)}] ${m}`);
const rc = async (cmd, t = 90000) => { const r = await fetch(`${CONSOLE}/api/relay/${RELAY}/send-command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(t) }); const j = await r.json(); if (!r.ok || j.ok === false) { const e = new Error(cmd.type); e.relayErr = j.error || JSON.stringify(j); throw e; } return j; };
const p2sh = (h) => addressFromScriptPublicKey(ScriptBuilder.fromScript(new Uint8Array(Buffer.from(h, 'hex'))).createPayToScriptHashScript(), NET).toString();
const xonly = (kp) => { const x = kp.xOnlyPublicKey ?? kp.toXOnlyPublicKey?.(); return (typeof x === 'string' ? x : x.toString()); };
async function landed(txid, address, n = 30) { for (let i = 0; i < n; i++) { const j = await rc({ type: 'check_utxo_landed', address, txid }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; }
async function lockTo(addr, sompi, retries = 4) { for (let a = 0; a < retries; a++) { const j = await rc({ type: 'transfer', target: addr, amount: Number(BigInt(sompi)) / 1e8 }); const tx = j.txId || j.txid; if (tx && await landed(tx, addr)) return tx; if (a === retries - 1) throw new Error(`lock fail: ${JSON.stringify(j).slice(0, 120)}`); await new Promise(r => setTimeout(r, 3000)); } }
const RELAY_ADDR = (await rc({ type: 'get_pubkey' })).address;

// spliceLeafState(零编续约, 验过 byte-equal)→ 推 sealed redeem(count=SEAL)
function spliceLeafState(redeemHex, st) {
  const _i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const push = (buf) => Buffer.concat([Buffer.from([buf.length]), buf]);
  const stateHex = Buffer.concat([push(_i64LE(st.local_yes)), push(_i64LE(st.local_no)), push(_i64LE(st.count)), push(_i64LE(st.pool_value))]);
  const redeem = Buffer.from(redeemHex, 'hex');
  return Buffer.concat([redeem.slice(0, 1), stateHex, redeem.slice(1 + stateHex.length)]).toString('hex');
}

// committee 5 distinct(与 artifacts genesis poolMerkleRoot 占位一致; settle 真委员另议)→ 这里复用 canonical 5
const poolMerkleRoot = z32;   // genesis 占位(与 _j2_A_xnode_artifacts.mjs 同)
const committee = Array.from({ length: 5 }, (_, i) => new PrivateKey((0xc0 + i).toString(16).repeat(32)));
const pkToPriv = new Map();
const cPks = committee.map(priv => { const x = xonly(priv.toKeypair()); pkToPriv.set(x, priv); return x; });
const tree = buildPoolMerkleTree(cPks);
const cmRoot = tree.root.toString('hex');
const committeeData = tree.sortedPks.map((pk, idx) => ({ pk, idx, siblings: getPoolMerkleProof(tree, idx).map(s => s.toString('hex')), priv: pkToPriv.get(pk) }));
// ⚠ genesis PS poolMerkleRoot 是占位 z32(artifacts 用 z32)→ close_attest 委员 ∈pool 验对占位 root; 须 cmRoot==z32? 实 artifacts genesis 用 poolMerkleRoot=z32, 但 committee 真 root≠z32 → close_attest 委员门验 ∈z32 会 BUST. 见下注.
const psCtor = (pool, root) => [ctorBytes32(root), ctorInt(Number(pool)), ctorInt(0), ctorBytes32(z32), ...Array.from({ length: 17 }, () => ctorInt(0))];
const psRedeem = (pool, root) => Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), psCtor(pool, root), SILVERC).script).toString('hex');

// ── 32 次 consolidate fan-in 聚合(cov_id 跨全 32 片续)──
console.log(`\n========== ${SEALED.length} 次 CONSOLIDATE fan-in 聚合(cov_id 跨 ${SEALED.length} 片)==========`);
let curPool = SEED, psTx = ART.genesis_ps_tx;
const sealedState = { local_yes: SEAL * Number(STAKE), local_no: 0, count: SEAL, pool_value: SEAL * Number(STAKE) };
for (let i = 0; i < SEALED.length; i++) {
  const s = SEALED[i], shard = ART.shards.find(x => x.idx === s.idx);
  const sealedRedeem = spliceLeafState(shard.slRedeemHex, sealedState);
  const poolValue = BigInt(sealedState.pool_value);
  const feeC = await lockTo(RELAY_ADDR, 30_000_000n);
  const cj = await rc({ type: 'bshard_consolidate', inputs: { payoutshard: { redeem_hex: psRedeem(curPool, ART.genesis_root || z32), outpointTxid: psTx, index: 0, state: { consolidated_pool: curPool.toString(), closed: 0, payoutRoot: z32, w0: 0 }, state_start: 1 }, shardleaf: { redeem_hex: sealedRedeem, outpointTxid: s.sealedTx, pool_value: poolValue.toString() }, fee: { address: RELAY_ADDR, outpointTxid: feeC, index: 0 } }, outputs: { change_address: RELAY_ADDR } });
  const ctx = cj.txId || cj.txid;
  if (!ctx || !await landed(ctx, cj.psContAddress)) throw new Error(`consolidate 片 ${s.idx} fail: ${JSON.stringify(cj).slice(0, 200)}`);
  curPool = curPool + poolValue; psTx = ctx;
  if (i % 8 === 0 || i === SEALED.length - 1) log(`consolidate ${i + 1}/${SEALED.length}(片 ${s.idx})pool→${curPool} @ ${cj.psContAddress.slice(0, 14)}`);
}
const POOL2 = curPool;
log(`✅ ${SEALED.length} 次 consolidate fan-in 完成: pool=${POOL2}(SEED + ${SEALED.length}×${SEAL}×${STAKE}), cov_id 跨 ${SEALED.length} 片续 = 聚合轴规模 ${SEALED.length} 片实证`);
console.log(`\nCONSOL_DONE POOL=${POOL2} PS_TX=${psTx}`);
process.exit(0);   // settle (close_attest+claim) 分步: 确认 32 fan-in 落链后再续 settle(分离风险, 见 _j2_A_xnode_settle.mjs)
