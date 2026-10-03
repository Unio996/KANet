// bshard-close-enforce-v2-tokenized.test.mjs — 账本1832 段2(Bettor/NWT 批 d): 委员会验证门对 v0.3 代币化 V2 的两处误拒修复 + 「真坏的 close_attest 仍被拒」的负向。
//   N3(值下限): 旧 `value == consolidated_pool`(KAS) → 新 `>= DUST_MIN`(镜像链上 PayoutShardV2.sil close_attest)。
//   C1(PS-pool 链锚): V2 入口强制 psSeed=0(V2 池=Σstake 无 seed); V1 口径(PS_SEED=20M)不变。
// Run: cd kasia-console && node src/lib/bshard-close-enforce-v2-tokenized.test.mjs
import { join } from 'node:path';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `close-enforce-v2-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
import { blake2b } from '@noble/hashes/blake2b';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const enf = await import('./bshard-close-enforce.mjs');
const reg = await import('./pool-shard-register.mjs');
const H = (c) => c.repeat(32);
const psRedeemHex = reg.compilePayoutShardV2Redeem({ poolMerkleRoot: H('11'), predicateCommit: H('22'), closeZkTmplAnchor: H('33'), tokenTmplHash: H('44'), claimTmplHash: H('55'), consolidatedPool: 3_500_000_000 });
const att = { attestedWinner: 1, attestedAtMs: 1783500123456, betsRootHex: H('ab'), refundRootHex: H('cd'), reDerivedRoot: H('ef') };
const spliced = enf._splicePayoutV2CloseRedeem(psRedeemHex, { newPayoutRootHex: att.reDerivedRoot, newAttestedWinner: att.attestedWinner, newBetsRootHex: att.betsRootHex, newRefundRootHex: att.refundRootHex, newAttestedAtMs: att.attestedAtMs });
const spkOf = (hex) => '0000aa20' + Buffer.from(blake2b(Buffer.from(hex, 'hex'), { dkLen: 32 })).toString('hex') + '87';
const goodSpk = spkOf(spliced);
const cov = (value, spk = goodSpk) => ({ value, scriptPublicKey: spk, covenant: { covenantId: 'a1'.repeat(32), authorizingInput: 0 } });
const verify = (tx, extra = {}) => enf.verifyClosePayoutV2Binding({ txSafeJson: JSON.stringify(tx), psv2RedeemHex: psRedeemHex, ...att, ...extra });

console.log('[test] N3: 值下限 = 链上 DUST_MIN');
{
  const mk = (v) => ({ version: 1, outputs: [cov(v), { value: 5_000_000, scriptPublicKey: '00' }] });
  const r1 = verify(mk(20_000_000));
  ok(r1.ok === true, `诚实 V2 close_attest: 续约值=PS dust(20000000) ≠ consolidated_pool(3.5e9) ⇒ 通过(旧 == 版会误拒) (got ${JSON.stringify(r1).slice(0, 120)})`);
  ok(verify(mk(1000)).ok === true, '边界: value == DUST_MIN(1000) 通过(同链上 >=)');
  const r2 = verify(mk(999));
  ok(r2.ok === false && /N3 value/.test(r2.reason), `负向: value 999 < DUST_MIN ⇒ 拒 (got ${r2.reason?.slice(0, 90)})`);
  const r3 = verify({ version: 1, outputs: [cov('not-a-number')] });
  ok(r3.ok === false && /N3 value/.test(r3.reason), '负向: value 非整数 ⇒ 拒');
}

console.log('[test] 其余防线不动(真坏的 close_attest 仍被拒):');
{
  const badSpk = spkOf(enf._splicePayoutV2CloseRedeem(psRedeemHex, { newPayoutRootHex: H('99'), newAttestedWinner: 1, newBetsRootHex: att.betsRootHex, newRefundRootHex: att.refundRootHex, newAttestedAtMs: att.attestedAtMs }));
  const r1 = verify({ version: 1, outputs: [cov(20_000_000, badSpk)] });
  ok(r1.ok === false && /re-derive|commit/.test(r1.reason), `负向: 续约 spk 烤了别的 payoutRoot(settler 篡改) ⇒ 拒 (got ${r1.reason?.slice(0, 80)})`);
  const r2 = verify({ version: 1, outputs: [cov(20_000_000), cov(20_000_000)] });
  ok(r2.ok === false && /N1/.test(r2.reason), `负向: 两个 covenant continuation(self_out_idx 可被事后选择) ⇒ 拒 (got ${r2.reason?.slice(0, 60)})`);
  const r3 = verify({ version: 0, outputs: [cov(20_000_000)] });
  ok(r3.ok === false && /version/.test(r3.reason), '负向: tx.version<1 ⇒ 拒');
  const r4 = verify({ version: 1, outputs: [{ value: 20_000_000, scriptPublicKey: goodSpk }] });
  ok(r4.ok === false, '负向: 无 covenant 绑定的输出 ⇒ 拒');
  const r5 = verify({ version: 1, outputs: [cov(20_000_000)] }, { attestedWinner: 0 });
  ok(r5.ok === false, '负向: 声称 attestedWinner 与被签 spk 不符 ⇒ 拒');
}

console.log('[test] C1: PS-pool 链锚 seed 由家族决定');
{
  // 用 status=settling 的片(已折叠, 个体链锚降级跳过)驱动聚合锚; 池=Σstake=3.5e9。
  const st = (pv, y, n, c) => JSON.stringify({ local_yes: y, local_no: n, count: c, pool_value: pv });
  const shards = [{ shard_index: 0, status: 'settling', current_leaf_state: st(3_000_000_000, 1_000_000_000, 2_000_000_000, 2), shard_redeem_hex: 'aa', current_leaf_outpoint: `${'1'.repeat(64)}:0` },
                  { shard_index: 1, status: 'settling', current_leaf_state: st(500_000_000, 500_000_000, 0, 1), shard_redeem_hex: 'aa', current_leaf_outpoint: `${'2'.repeat(64)}:0` }];
  const bettors = [{ pk: 'a'.repeat(64), direction: 0, stake: 1_000_000_000 }, { pk: 'b'.repeat(64), direction: 1, stake: 2_000_000_000 }, { pk: 'c'.repeat(64), direction: 0, stake: 500_000_000 }];
  const base = { shards, p2sh: () => 'x', checkUtxoLanded: async () => true, readOutpointCreatedAddr: async () => 'x' };
  const run = (extra) => enf.verifyBettorsCompleteFromChain('m', bettors, { ...base, ...extra });
  const r0 = await run({ psConsolidatedPool: 3_500_000_000n, psSeed: 0 });
  ok(!/PS-pool 链锚/.test(r0.reason || ''), `V2 口径(seed=0): 池 3.5e9 == Σstake 3.5e9 不触发 PS-pool 链锚 BUST (got ${JSON.stringify(r0).slice(0, 140)})`);
  const r1 = await run({ psConsolidatedPool: 3_500_000_000n });   // 默认 seed=20M(V1 口径)
  ok(r1.ok === false && /PS-pool 链锚 BUST/.test(r1.reason), 'V1 口径(默认 seed=20M)对 V2 池会误拒 ⇒ 这正是要在 V2 入口强制 seed=0 的原因(对照)');
  const r2 = await run({ psConsolidatedPool: 3_500_000_001n, psSeed: 0 });
  ok(r2.ok === false && /PS-pool 链锚 BUST/.test(r2.reason), `负向: 池比 Σstake 多 1(漏/加 bettor 或被塞入未核代币) ⇒ 拒 (got ${r2.reason?.slice(0, 80)})`);
  const r3 = await run({ psConsolidatedPool: 3_000_000_000n, psSeed: 0 });
  ok(r3.ok === false, `负向: 池少了一片(漏片变体①) ⇒ 拒 (got ${r3.reason?.slice(0, 80)})`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
