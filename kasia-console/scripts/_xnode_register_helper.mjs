// cross-node register helper — J1 :3300(或任意节点)用 J2 canonical artifacts register 自己片范围(零本地编, 地址==canonical).
//   读 _xnode_artifacts.json(J2 产)→ 对归属本节点的片各 register×(seal_count-1)注 → sealed ShardLeaf.
//   env: RELAY(本节点 relay id), SHARD_START/SHARD_END(本节点片范围, J1=0/15), CONSOLE(本节点 console URL), WASM_PATH(本节点 kaspa-wasm js).
//   ⚠ register depth-无关(不碰 PayoutShard depth-10)→ 本节点 relay 不需 depth-10 handler, 但需 b24389f1 wasm(否则 self-full sub-dust register 撞 KIP-9).
import { buildRegisterWitness, buildRegisterCommand } from '../src/lib/pool-register-builder.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const W = await import(process.env.WASM_PATH || 'file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { Keypair, ScriptBuilder, addressFromScriptPublicKey } = W;
const CONSOLE = process.env.CONSOLE || 'http://127.0.0.1:3200', RELAY = process.env.RELAY, NET = 'testnet-12';
const SHARD_START = Number(process.env.SHARD_START ?? 0), SHARD_END = Number(process.env.SHARD_END ?? 15);
const ART = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '_xnode_artifacts.json'), 'utf8'));
const STAKE = BigInt(ART.stake), SEAL = ART.seal_count, TICKET_DUST = 20_000_000n;
if (!RELAY) throw new Error('env RELAY (本节点 relay id) 必需');
const log = (m) => console.log(`[xreg ${new Date().toISOString().slice(11, 19)}] ${m}`);
const rc = async (cmd, t = 90000) => { const r = await fetch(`${CONSOLE}/api/relay/${RELAY}/send-command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(t) }); const j = await r.json(); if (!r.ok || j.ok === false) { const e = new Error(cmd.type); e.relayErr = j.error || JSON.stringify(j); throw e; } return j; };
const p2sh = (h) => addressFromScriptPublicKey(ScriptBuilder.fromScript(new Uint8Array(Buffer.from(h, 'hex'))).createPayToScriptHashScript(), NET).toString();
const xonly = (kp) => { const x = kp.xOnlyPublicKey ?? kp.toXOnlyPublicKey?.(); return (typeof x === 'string' ? x : x.toString()); };
async function landed(txid, address, n = 25) { for (let i = 0; i < n; i++) { const j = await rc({ type: 'check_utxo_landed', address, txid }, 20000); if (j.landed || j.found) return true; await new Promise(r => setTimeout(r, 2000)); } return false; }
async function lockTo(addr, sompi, retries = 4) { for (let a = 0; a < retries; a++) { const j = await rc({ type: 'transfer', target: addr, amount: Number(BigInt(sompi)) / 1e8 }); const tx = j.txId || j.txid; if (tx && await landed(tx, addr)) return tx; if (a === retries - 1) throw new Error(`lock fail: ${JSON.stringify(j).slice(0, 120)}`); await new Promise(r => setTimeout(r, 3000)); } }
const RELAY_ADDR = (await rc({ type: 'get_pubkey' })).address;
const psArtifact = { templatePrefix: Buffer.from(ART.poolside.ps_prefix_hex, 'hex'), templateSuffix: Buffer.from(ART.poolside.ps_suffix_hex, 'hex'), templateHashHex: ART.poolside.ps_tmpl_hash };

// ShardLeaf 续约: redeem 随 state 变(splice), 本 helper compile 不了(零本地编 = 用 canonical redeem 推续约)。
// ∴ 用 ART.shards[k].slRedeemHex 作 genesis(count=1)redeem; 续约地址由 relay handler 自算(_continuationAddress), 我们只追 state + outpoint。
// register handler 用 cmd.inputs.leaf.redeem_hex(当前 state redeem)算地址 → 我们必须传【当前 state 的 redeem】。但零本地编下我们只有 genesis redeem。
// 解: register handler 的 leaf 地址 = p2sh(redeem)(_addressFromRedeem), 且续约 = _continuationAddress(redeem, newState)。
//   genesis redeem(count=1)→ 第一次 register 传 genesis redeem + current_state(count=1)→ 续约 count=2 地址。
//   第二次需 count=2 的 redeem = splice(genesis_redeem, count=2 state)。helper 本地 splice(纯字节, 非编译, 零 silverc):
function spliceLeafState(redeemHex, st) {
  // PoolLeaf state_layout: start=1, 4-field {local_yes,local_no,count,pool_value} = 36B (4×PUSH8+8). 纯字节替换, 非编译。
  const _i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const push = (buf) => Buffer.concat([Buffer.from([buf.length]), buf]);   // PUSH<len> + data(len≤75 直接 length byte)
  const stateHex = Buffer.concat([push(_i64LE(st.local_yes)), push(_i64LE(st.local_no)), push(_i64LE(st.count)), push(_i64LE(st.pool_value))]);
  const redeem = Buffer.from(redeemHex, 'hex');
  const start = 1, len = stateHex.length;
  return Buffer.concat([redeem.slice(0, start), stateHex, redeem.slice(start + len)]).toString('hex');
}

const bettors = [];   // (B) 真 bettor {idx,pk,addr}(public, settle payoutRoot 用; 本地存不进 git, 见 _xnode_ gitignore)
const myShards = ART.shards.filter(s => s.idx >= SHARD_START && s.idx <= SHARD_END);
log(`本节点 register 片 ${SHARD_START}-${SHARD_END}(${myShards.length} 片 × ${SEAL} 注), relay=${RELAY.slice(0, 8)}, market=${ART.market_id.slice(0, 12)}`);
// 周期 broadcaster defrag(NWT 880 nuance: 每注 funding 自转账碎片化 best → 2000+ tx 持续健康需周期 consolidate_utxo, 85eab4de force-all-input-sweep)。
let regCount = 0;
async function maybeDefrag() { if (++regCount % 40 === 0) { try { await rc({ type: 'consolidate_utxo' }, 60000); log(`broadcaster defrag @ reg ${regCount}(consolidate_utxo, 维持 best)`); } catch (e) { log(`defrag warn: ${String(e.relayErr || e.message).slice(0, 80)}`); } } }
const sealed = [];
for (const shard of myShards) {
  const k = shard.idx;
  let st = { ...shard.genesisState };
  let curRedeem = shard.slRedeemHex;   // genesis(count=1)
  let leafTx = await lockTo(p2sh(curRedeem), STAKE);   // lock genesis ShardLeaf(第一注 baked)
  for (let i = 1; i < SEAL; i++) {
    const bkp = Keypair.random();
    const b = { pk: xonly(bkp), side: 0 };
    bettors.push({ idx: k, pk: b.pk, addr: bkp.toAddress(NET).toString() });   // (B) 存真 bettor {pk,addr}(public 非私钥, settle payoutRoot 用)
    const newState = { local_yes: st.local_yes + Number(STAKE), local_no: st.local_no, count: st.count + 1, pool_value: st.pool_value + Number(STAKE), shardPoolId: shard.shardPoolId };
    const fundTx = await lockTo(RELAY_ADDR, STAKE + TICKET_DUST + 30_000_000n);
    const wit = buildRegisterWitness({ side: b.side, stake: STAKE, leafOutIdx: 0, psOutIdx: 1, bettorPk: b.pk, psArtifact });
    const cmd = buildRegisterCommand({ witness: wit, leafOutpointTxid: leafTx, leafRedeemHex: curRedeem, currentLeafState: st, bettorFunding: [{ outpointTxid: fundTx, address: RELAY_ADDR, index: 0 }], leafValueSompi: BigInt(st.pool_value), leafContinuationState: newState, ticketDustSompi: TICKET_DUST, shardPoolId: shard.shardPoolId, changeAddress: RELAY_ADDR });
    const rj = await rc(cmd); const rtx = rj.txId || rj.txid;
    const nextRedeem = spliceLeafState(shard.slRedeemHex, { local_yes: newState.local_yes, local_no: newState.local_no, count: newState.count, pool_value: newState.pool_value });
    if (!rtx || !await landed(rtx, p2sh(nextRedeem))) throw new Error(`片 ${k} register ${i + 1} no land: ${JSON.stringify(rj).slice(0, 150)}`);
    st = { local_yes: newState.local_yes, local_no: newState.local_no, count: newState.count, pool_value: newState.pool_value };
    curRedeem = nextRedeem; leafTx = rtx;
    await maybeDefrag();   // 每 40 注周期 broadcaster defrag(维持 best, 长 ramp 健康)
  }
  sealed.push({ idx: k, shardPoolId: shard.shardPoolId, sealedTx: leafTx, sealedRedeemHex: curRedeem, sealedAddr: p2sh(curRedeem), poolValue: st.pool_value });
  log(`片 ${k} sealed: count=${SEAL} pool=${st.pool_value} tx=${leafTx.slice(0, 10)} @ ${p2sh(curRedeem).slice(0, 16)}`);
}
// (B) 输出真 bettor {pk,addr}(public)→ 本地文件(settle payoutRoot 用; 不进 git)
const { writeFileSync } = await import('node:fs');
const bettorsPath = join(dirname(fileURLToPath(import.meta.url)), `_xnode_bettors_${SHARD_START}_${SHARD_END}.json`);
writeFileSync(bettorsPath, JSON.stringify({ range: [SHARD_START, SHARD_END], count: bettors.length, bettors }, null, 2));
console.log(`\n✅ 本节点片 ${SHARD_START}-${SHARD_END} 全 sealed. ${bettors.length} 真 bettor {pk,addr} 存 ${bettorsPath}`);
console.log('回报 J2 consolidate(sealed):');
console.log(JSON.stringify(sealed.map(s => ({ idx: s.idx, sealedTx: s.sealedTx, sealedAddr: s.sealedAddr, poolValue: s.poolValue })), null, 2));
process.exit(0);
