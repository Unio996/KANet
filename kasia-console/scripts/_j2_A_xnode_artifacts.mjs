// J2 cross-node 1000 canonical artifacts 生成器(我域: canonical silverc 编, J1 零本地编).
//   genesis-mint ONE depth-10 PayoutShard(cov_id)→ 编 32 ShardLeaf redeem(各 distinct shard_pool_id, bake 同 payout_cov_id)
//   → 输出 JSON: J1 片 0-15 + J2 片 16-31. J1 用其半 redeem hex register(地址自动==canonical 无 stale 污染).
//   ⚠ post-deploy 跑(relay 须载 3dab28b3 depth-10 handler + b24389f1 wasm). 产 _xnode_artifacts.json.
import { compileSil, computePoolSideArtifact, ctorBytes32, ctorInt } from '../src/lib/pool-bshard-artifacts.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake2b } from '@noble/hashes/blake2b';
import { buildPoolMerkleTree } from '../src/services/pool-merkle-v06.mjs';
const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { ScriptBuilder, addressFromScriptPublicKey, PrivateKey } = W;
const xonly = (kp) => { const x = kp.xOnlyPublicKey ?? kp.toXOnlyPublicKey?.(); return (typeof x === 'string' ? x : x.toString()); };
const CONSOLE = 'http://127.0.0.1:3200', RELAY = 'eb5a5864-a8e0-4376-8f61-38108abb301f', NET = 'testnet-12';
const SILVERC = 'D:/silverscript/target/release/silverc.exe', z32 = '00'.repeat(32);
const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const SHARDS = Number(process.env.SHARDS || 32), SEAL = Number(process.env.SEAL || 32);   // 32 片 × seal_count 32 = 1024
const J1_SHARDS = [0, 15], J2_SHARDS = [16, 31];   // 片归属 [start,end]
const STAKE = BigInt(process.env.STAKE || '100000000'), MIN_BET = 100000;
const log = (m) => console.log(`[xnode ${new Date().toISOString().slice(11, 19)}] ${m}`);
const rc = async (cmd, t = 90000) => { const r = await fetch(`${CONSOLE}/api/relay/${RELAY}/send-command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(t) }); const j = await r.json(); if (!r.ok || j.ok === false) { const e = new Error(cmd.type); e.relayErr = j.error || JSON.stringify(j); throw e; } return j; };
const p2sh = (h) => addressFromScriptPublicKey(ScriptBuilder.fromScript(new Uint8Array(Buffer.from(h, 'hex'))).createPayToScriptHashScript(), NET).toString();
async function landed(txid, address, n = 25) { for (let i = 0; i < n; i++) { const j = await rc({ type: 'check_utxo_landed', address, txid }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; }
async function lockTo(addr, sompi) { const j = await rc({ type: 'transfer', target: addr, amount: Number(BigInt(sompi)) / 1e8 }); const tx = j.txId || j.txid; if (!tx || !await landed(tx, addr)) throw new Error(`lock fail: ${JSON.stringify(j).slice(0, 120)}`); return tx; }
const RELAY_ADDR = (await rc({ type: 'get_pubkey' })).address;

// committee poolMerkleRoot = 真 committee tree root(5 distinct canonical, 与 consolidate/settle 同套)。
// ⚠ baked 不可改: genesis PS 必 bake 真 cmRoot, 否则 close_attest 委员门 require(委员 ∈ poolMerkleRoot) 对 z32 必 BUST(z32-root bug 修)。
const W17 = () => Array.from({ length: 17 }, () => ctorInt(0));
const committee = Array.from({ length: 5 }, (_, i) => new PrivateKey((0xc0 + i).toString(16).repeat(32)));
const cPks = committee.map(priv => xonly(priv.toKeypair()));
const poolMerkleRoot = buildPoolMerkleTree(cPks).root.toString('hex');   // 真 committee root
const SEED = 20_000_000n;
const psCtor = [ctorBytes32(poolMerkleRoot), ctorInt(Number(SEED)), ctorInt(0), ctorBytes32(z32), ...W17()];
const psRedeem = Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), psCtor, SILVERC).script).toString('hex');
const genFund = await lockTo(RELAY_ADDR, SEED + 100_000_000n);
log('genesis-mint depth-10 PayoutShard (canonical, 聚合 sink)...');
const gj = await rc({ type: 'bshard_genesis_mint_payout', payoutshard: { redeem_hex: psRedeem, seedSompi: SEED.toString() }, inputs: { funding: { address: RELAY_ADDR, outpointTxid: genFund, index: 0 } }, outputs: { change_address: RELAY_ADDR } });
const PAYOUT_COV_ID = gj.payoutCovId, genTx = gj.txId || gj.txid;
if (!await landed(genTx, p2sh(psRedeem))) throw new Error('genesis PS no land');
log(`genesis PayoutShard LANDED cov_id=${PAYOUT_COV_ID} tx=${genTx}`);

// PoolSide ticket template(state-excluded, 全片同)
const market_id = Buffer.from(blake2b(Buffer.from(`xnode-1000-${genTx}`), { dkLen: 32 })).toString('hex');
const psArtifact = computePoolSideArtifact(POOL_SIDE_PATH(), [ctorBytes32('aa'.repeat(32)), ctorInt(0), ctorInt(Number(STAKE)), ctorBytes32('bb'.repeat(32))], SILVERC);
function POOL_SIDE_PATH() { return join(LIB, 'PoolSide_v08_shard.sil'); }

// 32 ShardLeaf redeem(各 distinct shard_pool_id, genesis state count=1 第一注 baked)
const shards = [];
for (let k = 0; k < SHARDS; k++) {
  const shardPoolId = Buffer.from(blake2b(Buffer.from(`${market_id}-shard-${k}`), { dkLen: 32 })).toString('hex');
  const st = { local_yes: Number(STAKE), local_no: 0, count: 1, pool_value: Number(STAKE) };
  const slCtor = [ctorBytes32(market_id), ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId), ctorInt(SEAL), ctorInt(MIN_BET), ctorBytes32(PAYOUT_COV_ID), ctorInt(st.local_yes), ctorInt(st.local_no), ctorInt(st.count), ctorInt(st.pool_value)];
  const slRedeem = Buffer.from(compileSil(join(LIB, 'ShardLeaf.sil'), slCtor, SILVERC).script).toString('hex');
  const owner = (k >= J1_SHARDS[0] && k <= J1_SHARDS[1]) ? 'J1' : 'J2';
  shards.push({ idx: k, owner, shardPoolId, genesisState: st, slRedeemHex: slRedeem, slAddr: p2sh(slRedeem) });
}
log(`编 ${SHARDS} ShardLeaf redeem(${SHARDS}B each~441), J1 片 ${J1_SHARDS.join('-')} / J2 片 ${J2_SHARDS.join('-')}`);

const artifacts = {
  market_id, payout_cov_id: PAYOUT_COV_ID, genesis_ps_tx: genTx, ps_redeem_hex: psRedeem, ps_addr: p2sh(psRedeem),
  genesis_root: poolMerkleRoot,   // 真 committee tree root(close_attest 委员门验)
  seal_count: SEAL, stake: STAKE.toString(), min_bet: MIN_BET,
  poolside: { ps_prefix_hex: psArtifact.templatePrefix.toString('hex'), ps_suffix_hex: psArtifact.templateSuffix.toString('hex'), ps_tmpl_hash: psArtifact.templateHashHex },
  shards,
};
const outPath = join(dirname(fileURLToPath(import.meta.url)), '_xnode_artifacts.json');
writeFileSync(outPath, JSON.stringify(artifacts, null, 2));
console.log(`\n✅ canonical artifacts 写出 ${outPath}`);
console.log(`   PAYOUT_COV_ID=${PAYOUT_COV_ID}\n   GENESIS_PS_TX=${genTx}\n   MARKET_ID=${market_id}`);
console.log(`   J1 片 0-15(给 J1): slRedeemHex + shardPoolId + poolside ps_prefix/suffix → J1 用 buildRegisterCommand register(零本地编, 地址==canonical)`);
console.log(`   J2 片 16-31(我自留 register)`);
console.log(`   J1 片 0 地址样例: ${shards[0].slAddr}`);
process.exit(0);
