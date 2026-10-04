// zk-token-claim-orchestrator.test.mjs — 账本1832 段4: claim 家族三阶段编排的单测(relay 全 stub, 不碰链)。真共识证据见 docs/provenance/2026-10-04-j2-settle-tokenize-seg4/。
// Run: cd kasia-console && node src/lib/zk-token-claim-orchestrator.test.mjs
import { join } from 'node:path';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `claim-orch-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { runTokenClaim, CLAIM_FAMILY, CLAIM_OUT_VALUE_SOMPI, claimFeeInputSompi } = await import('./zk-token-claim-orchestrator.mjs');
const art = await import('./pool-bshard-artifacts.mjs');
const SELF_COV = 'a1'.repeat(32), CLAIM_COV = 'c2'.repeat(32), PK = '07'.repeat(32), TTH = '44'.repeat(32);
const claimArt = art.computeKanetTokenClaimArtifact({ marketCovIdHex: SELF_COV, winnerPkHex: PK, amount: 100, tokenTmplHashHex: TTH });
const sibs = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0').repeat(32));
const mkRelay = (log, { utxoCount = 1 } = {}) => async (cmd) => {
  log.push(cmd);
  if (cmd.type === 'get_address_utxos') return { utxos: Array.from({ length: utxoCount }, (_, i) => ({ outpoint: { transactionId: String(i + 1).repeat(64), index: 1 }, amount: '40000000' })) };
  if (!cmd.outputs?.claim_out) return { probe: 'A', selfCovId: SELF_COV };
  if (!cmd.outputs?.tok_out) return { probe: 'B', selfCovId: SELF_COV, claimCovId: CLAIM_COV };
  return { txId: 'ab'.repeat(32), isLast: !cmd.outputs.remain_tok_out, selfContAddress: 'x', claimOutAddress: 'y', selfContRedeemHex: 'zz' };
};
const base = (relayCall, over = {}) => ({ kind: 'claim', self: { redeemHex: '6b00', txid: 'dd'.repeat(32), index: 0 }, pool: 1000n, bettorPk: PK, amount: 100n, merkleIndex: 3, siblingsHex: sibs, fee: { address: 'kaspasim:fee', txid: 'ee'.repeat(32), index: 0 },
  relayCall, p2sh: async (h) => `p2sh:${h.slice(0, 12)}`, tokenTmplHash: TTH, claimTmplHash: claimArt.templateHashHex, ...over });

console.log('[test] partial 领取: A→B→C 三阶段');
{
  const log = []; const r = await runTokenClaim(base(mkRelay(log)));
  const types = log.map((c) => c.type);
  ok(types.join(',') === 'closezk_v2_claim,get_address_utxos,closezk_v2_claim,closezk_v2_claim', `命令序: 阶段A → 探池代币 → 阶段B → 阶段C (got ${types})`);
  const [a, , b, c] = log;
  ok(a.witness && a.outputs && Object.keys(a.outputs).length === 0, '阶段A 带空 witness/outputs(relay 命令校验要求三字段齐全)');
  ok(b.outputs.claim_out.redeem_hex === claimArt.script.toString('hex') && !b.outputs.tok_out, '阶段B 给 claim_out 不给 tok_out');
  const tokOut = art.computeKttTokenArtifact({ amount: 100, ownerCovIdHex: CLAIM_COV });
  ok(c.outputs.tok_out.redeem_hex === tokOut.script.toString('hex') && c.outputs.tok_out.owner_cov_id_hex === CLAIM_COV, '阶段C tok_out = KTT(amount, owner=probe 回来的 claimCovId)');
  const remain = art.computeKttTokenArtifact({ amount: 900, ownerCovIdHex: SELF_COV });
  ok(c.outputs.remain_tok_out.redeem_hex === remain.script.toString('hex') && c.outputs.remain_tok_out.owner_cov_id_hex === SELF_COV, 'partial: remain_tok_out = KTT(pool−amount, owner=self cov)');
  ok(c.out_value_sompi === CLAIM_OUT_VALUE_SOMPI && CLAIM_OUT_VALUE_SOMPI >= 45_000_000, `新建输出面值 ${c.out_value_sompi} sompi(KIP-9 存储质量: 0.2 KAS×5 输出实测 659134 > 500000 被拒; 账本1850 精确公式硬下限 0.30 KAS ⇒ 497,620, 要求 ≥0.45 KAS 留 ≥20% 余量)`);
  ok(claimFeeInputSompi() >= 3 * CLAIM_OUT_VALUE_SOMPI, 'fee 输入需求 ≥ 3 个新建输出面值之和');
  ok(c.witness.dispatch_tag_hex === (await import('./pool-shard-register.mjs')).settleDispatchTags()[CLAIM_FAMILY.claim.tagKey] && c.witness.siblings_hex.length === 10, '见证: claim 的 dispatch tag + 10 siblings');
  ok(r.selfCovId === SELF_COV && r.witnessUsed === c.witness, '返回带 selfCovId / witnessUsed(供门③ debugger 用)');
}
console.log('[test] 最后一位(amount==pool): 无 remain');
{
  const log = []; await runTokenClaim(base(mkRelay(log), { amount: 1000n }));
  ok(!log.at(-1).outputs.remain_tok_out, 'last: 不带 remain_tok_out');
}
console.log('[test] kind 映射');
{
  const log = []; await runTokenClaim(base(mkRelay(log), { kind: 'escape_claim' })); ok(log[0].type === 'closezk_v2_escape_claim', 'escape_claim → closezk_v2_escape_claim');
  const log2 = []; await runTokenClaim(base(mkRelay(log2), { kind: 'refund_claim' })); ok(log2[0].type === 'bshard_refund_claim_v2', 'refund_claim → bshard_refund_claim_v2');
}
console.log('[test] fail-closed 守卫');
const thr = async (fn, re, l) => { try { await fn(); ok(false, l + ' 应 throw'); } catch (e) { ok(re.test(e.message), `${l}: ${e.message.slice(0, 80)}`); } };
await thr(() => runTokenClaim(base(mkRelay([]), { amount: 1001n })), /不在 \[1, pool=1000\]/, 'amount > pool');
await thr(() => runTokenClaim(base(mkRelay([]), { amount: 0n })), /不在 \[1/, 'amount = 0');
await thr(() => runTokenClaim(base(mkRelay([], { utxoCount: 0 }))), /有 0 笔 UTXO/, '池代币地址 0 笔');
await thr(() => runTokenClaim(base(mkRelay([], { utxoCount: 2 }))), /有 2 笔 UTXO/, '池代币地址 2 笔(不猜)');
await thr(() => runTokenClaim(base(mkRelay([]), { claimTmplHash: 'ff'.repeat(32) })), /模板 hash/, 'claim 模板 hash 与 env 不符');
await thr(() => runTokenClaim(base(mkRelay([]), { kind: 'nope' })), /未知 kind/, '未知 kind');
console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
