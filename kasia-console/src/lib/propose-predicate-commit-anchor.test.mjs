// propose-predicate-commit-anchor.test.mjs — 账本1832 段2: 命门①(propose 前核 PS redeem 里烤的 predicate_commit)修陈的回归。
//   旧: 硬编码 redeem[642] + 拿 market_metadata_hash 比 ⇒ 对任何真实 V2 市场必 mismatch(simnet 官方 2.0.1 实测 propose 报「命门①mismatch」)。
//   新: 偏移 = committee-offset-derive 现算, 期望 = deriveMarketPredicateCommit(市场行)。
// Run: cd kasia-console && node src/lib/propose-predicate-commit-anchor.test.mjs
import { join } from 'node:path';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `pcommit-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { assertPredicateCommitBakedInPsRedeem } = await import('./bshard-close-transport.mjs');
const reg = await import('./pool-shard-register.mjs');
const H = (c) => c.repeat(32);
const PC = 'ab'.repeat(32);
const redeem = reg.compilePayoutShardV2Redeem({ poolMerkleRoot: H('11'), predicateCommit: PC, closeZkTmplAnchor: H('33'), tokenTmplHash: H('44'), claimTmplHash: H('55'), consolidatedPool: 0 });
let threw = null; try { assertPredicateCommitBakedInPsRedeem(PC, redeem); } catch (e) { threw = e; }
ok(threw === null, `真实 V2 redeem: 期望 predicate_commit == 烤入值 ⇒ 通过 (got ${threw?.message?.slice(0, 80)})`);
ok(redeem.slice(642 * 2, 674 * 2) !== PC, '对照: 旧偏移 redeem[642] 读到的不是 predicate_commit(旧检查对真实 V2 市场必 mismatch)');
threw = null; try { assertPredicateCommitBakedInPsRedeem('cd'.repeat(32), redeem); } catch (e) { threw = e; }
ok(threw && /命门①mismatch/.test(threw.message), '负向: 期望值 != 烤入值(换了市场/规则) ⇒ 拒');
ok((() => { try { assertPredicateCommitBakedInPsRedeem(null, redeem); return true; } catch { return false; } })(), '无期望值 ⇒ 不核(同旧行为)');
const tags = reg.settleDispatchTags();
ok(['consolidate_to_payout', 'absorb', 'zk_handoff', 'close_attest'].every((k) => /^[0-9a-f]{8}$/.test(tags[k])) && new Set(Object.values(tags)).size === 5 && /^[0-9a-f]{8}$/.test(tags.zk_close), 'settleDispatchTags: 5 个入口(含 zk_close)各有互异的 4 字节 dispatch tag');
console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
