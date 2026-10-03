// pool-shard-settle-tokenized.test.mjs — 账本1829/1832 段1: consolidateAllShards({tokenized:true}) 编排的单测(rc/db/transfer/landed 全 stub, 不碰链)。
//   真链证据(simnet 官方 kaspad 2.0.1 共识)见 docs/provenance/2026-10-04-j2-settle-tokenize-seg1/; 本测只钉【命令形状与跟踪逻辑】:
//   ① 第1片: bshard_consolidate_v2, tok_out.amount = 0 + pool_value, 无 ps_token, 见证带 dispatch tag / tok 模板;
//   ② 第2片: 带 ps_token(= 上一笔 tok_out = `${tx1}:1`), tok_out.amount = 累计; PS 输入 state.consolidated_pool 递增, 输入 outpoint 跟踪上一笔 PS 续约;
//   ③ 空片(pool_value=0)跳过; 缺 current_token_outpoint ⇒ fail-closed throw; 缺 leaf_cov_id ⇒ throw;
//   ④ resume 场景: PS 名下代币地址上必须恰 1 笔 UTXO, 0/2 笔都 fail-closed。
// Run: cd kasia-console && node src/lib/pool-shard-settle-tokenized.test.mjs
import { join } from 'node:path';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `settle-tok-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const reg = await import('./pool-shard-register.mjs');
const { computeKttTokenArtifact } = await import('./pool-bshard-artifacts.mjs');
const { consolidateAllShards } = await import('./pool-shard-settle.mjs');
const H = (c) => c.repeat(32);
const PS_COV = 'a1'.repeat(32), LEAF_COV0 = 'b0'.repeat(32), LEAF_COV1 = 'b1'.repeat(32), LEAF_COV2 = 'b2'.repeat(32);

const psRedeem = reg.compilePayoutShardV2Redeem({ poolMerkleRoot: H('11'), predicateCommit: H('22'), closeZkTmplAnchor: H('33'), tokenTmplHash: H('44'), claimTmplHash: H('55'), consolidatedPool: 0 });
const ps = { payout_redeem_hex: psRedeem, payout_ps_outpoint: `${'ee'.repeat(32)}:0`, payout_cov_id: PS_COV };
const leafCommon = { marketIdHash: H('01'), psTmplHashHex: H('02'), shardPoolId: H('03'), sealCount: 2, payoutCovId: PS_COV, deadline: 1791066000, tokenTmplHash: H('44') };
const { ownRedeemLen } = reg.convergeShardLeafOwnRedeemLen({ ...leafCommon, state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 } });
const leafRedeemHex = reg.compileShardLeafRedeem({ ...leafCommon, localYes: 0, localNo: 0, count: 0, poolValue: 0, ownRedeemLen });
const mkShard = (idx, pool, covId, tokOp) => ({
  shard_index: idx, shard_market_id: `m-s${idx}`, logical_market_id: 'L', status: 'sealed', shard_redeem_hex: leafRedeemHex,
  current_leaf_state: JSON.stringify({ local_yes: pool, local_no: 0, count: 1, pool_value: pool }), current_leaf_outpoint: `${String(idx + 1).repeat(64).slice(0, 64)}:0`,
  current_token_outpoint: tokOp, leaf_cov_id: covId,
});
const mkDb = (rows) => ({ prepare: (sql) => ({ all: () => rows.slice(), run: () => ({}), get: () => undefined }) });
const calls = [];
let txn = 0;
const mkEnv = (rows, getUtxos = null) => {
  calls.length = 0; txn = 0;
  return { db: mkDb(rows), logicalMarketId: 'L', payoutShard: ps, relayAddr: 'kaspasim:fake', deadline: 1791066000, p2sh: (h) => `p2sh:${h.slice(0, 16)}`, getUtxos, tokenized: true,
    transfer: async () => String(++txn).padStart(64, 'f'), landed: async () => true,
    rc: async (cmd) => { calls.push(cmd); return { txId: String(calls.length).repeat(64).slice(0, 64), psContAddress: `ps:${calls.length}` }; } };
};

console.log('[test] ①② 两片串行: 第1片无 ps_token, 第2片带 ps_token=上一笔 tok_out');
{
  const rows = [mkShard(0, 3_000_000_000, LEAF_COV0, `${'c0'.repeat(32)}:2`), mkShard(1, 500_000_000, LEAF_COV1, `${'c1'.repeat(32)}:2`)];
  const res = await consolidateAllShards(mkEnv(rows));
  ok(calls.length === 2 && calls.every((c) => c.type === 'bshard_consolidate_v2'), `发出 2 笔 bshard_consolidate_v2 (got ${calls.map((c) => c.type)})`);
  const c0 = calls[0], c1 = calls[1];
  ok(!c0.inputs.ps_token, '第1片: 无 ps_token(PS 名下尚无代币)');
  ok(c0.inputs.shard_token.outpointTxid === 'c0'.repeat(32) && c0.inputs.shard_token.index === 2, '第1片: shard_token = market_shards.current_token_outpoint');
  ok(c0.witness.shard_amount === '3000000000', '第1片: witness.shard_amount = pool_value');
  ok(/^[0-9a-f]{8}$/.test(c0.witness.absorb_dispatch_tag_hex) && /^[0-9a-f]{8}$/.test(c0.witness.consolidate_dispatch_tag_hex), '见证带 absorb / consolidate_to_payout 的 4 字节 dispatch tag');
  ok(c0.outputs.tok_out.owner_cov_id_hex === PS_COV, 'tok_out.owner_cov_id_hex = PS cov_id(relay 预检用)');
  const expect0 = computeKttTokenArtifact({ amount: 3_000_000_000, ownerCovIdHex: PS_COV }).script.toString('hex');
  ok(c0.outputs.tok_out.redeem_hex === expect0, '第1片 tok_out = KTT(amount=0+3e9, owner=PS cov)');
  ok(c0.inputs.payoutshard.state.consolidated_pool === '0' && c0.inputs.payoutshard.outpointTxid === 'ee'.repeat(32), '第1片: PS 输入 = genesis, state.consolidated_pool=0');
  ok(c1.inputs.ps_token && c1.inputs.ps_token.outpointTxid === '1'.repeat(64) && c1.inputs.ps_token.index === 1, '第2片: ps_token = `${tx1}:1`(上一笔 tok_out, 固定 output 1)');
  const psTokExpect = computeKttTokenArtifact({ amount: 3_000_000_000, ownerCovIdHex: PS_COV }).script.toString('hex');
  ok(c1.inputs.ps_token.redeem_hex === psTokExpect, '第2片: ps_token redeem = KTT(amount=累计 3e9, owner=PS cov)');
  ok(c1.inputs.payoutshard.state.consolidated_pool === '3000000000' && c1.inputs.payoutshard.outpointTxid === '1'.repeat(64), '第2片: PS 输入 = 上一笔续约, state.consolidated_pool=3e9');
  const expect1 = computeKttTokenArtifact({ amount: 3_500_000_000, ownerCovIdHex: PS_COV }).script.toString('hex');
  ok(c1.outputs.tok_out.redeem_hex === expect1, '第2片 tok_out = KTT(amount=3e9+5e8, owner=PS cov)');
  ok(res.consolidatedPool === '3500000000' && res.consolidatedShards === 2 && res.psOutpoint === `${'2'.repeat(64)}:0`, `返回累计池/片数/最终 PS outpoint (got ${JSON.stringify({ p: res.consolidatedPool, n: res.consolidatedShards, o: res.psOutpoint?.slice(0, 8) })})`);
  const st = Buffer.from(res.redeemHex, 'hex').readBigInt64LE(2);
  ok(st === 3_500_000_000n, '返回 redeemHex 的 state.consolidated_pool 字段已 splice 为累计值');
}

console.log('[test] ③ 空片跳过 / fail-closed');
{
  const rows = [mkShard(0, 0, LEAF_COV0, null), mkShard(1, 700_000_000, LEAF_COV1, `${'c1'.repeat(32)}:2`)];
  const res = await consolidateAllShards(mkEnv(rows));
  ok(calls.length === 1 && res.consolidatedShards === 1 && res.consolidatedPool === '700000000', '空片(pool_value=0)跳过, 只 absorb 非空片');
  let threw = null; try { await consolidateAllShards(mkEnv([mkShard(0, 100, LEAF_COV0, null)])); } catch (e) { threw = e; }
  ok(threw && /current_token_outpoint/.test(threw.message), `缺 current_token_outpoint ⇒ throw (got: ${threw?.message?.slice(0, 70)})`);
  threw = null; try { await consolidateAllShards(mkEnv([mkShard(0, 100, null, `${'c0'.repeat(32)}:2`)])); } catch (e) { threw = e; }
  ok(threw && /leaf_cov_id/.test(threw.message), `缺 leaf_cov_id ⇒ throw (got: ${threw?.message?.slice(0, 70)})`);
}

console.log('[test] ④ resume: PS 名下代币地址上必须恰 1 笔');
{
  const rows = [mkShard(1, 500_000_000, LEAF_COV1, `${'c1'.repeat(32)}:2`)];
  const resume = { fromShardIdx: 1, psTx: '9'.repeat(64), psIdx: 0, pool: '3000000000' };
  const mk = (n) => async () => Array.from({ length: n }, (_, i) => ({ outpoint: { transactionId: String(i + 1).repeat(64), index: 1 }, amount: '60000000' }));
  for (const n of [0, 2]) {
    let threw = null; try { await consolidateAllShards({ ...mkEnv(rows, mk(n)), resume }); } catch (e) { threw = e; }
    ok(threw && /期望恰 1/.test(threw.message), `PS 名下代币 UTXO=${n} 笔 ⇒ fail-closed (got: ${threw?.message?.slice(0, 60)})`);
  }
  const res = await consolidateAllShards({ ...mkEnv(rows, mk(1)), resume });
  ok(calls[0].inputs.ps_token.outpointTxid === '1'.repeat(64) && calls[0].inputs.ps_token.index === 1, '恰 1 笔 ⇒ 用它做 ps_token');
  ok(res.consolidatedPool === '3500000000', 'resume 累计池 = 3e9 + 5e8');
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
