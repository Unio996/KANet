// own-redeem-len.test.mjs — 账本1832: V-T-8 自续约「从 sigScript 第 0 字节切片」缺陷(账本1468/1469 同族)的回归守门。
//   ① 源码 tripwire: 每个读 `tx.inputs[this.activeInputIndex].sigScript` 做自续约的 .sil 必须用 own_redeem_len 定位 redeem 起点,
//      禁止 `slice(0, OWN_PREFIX_LEN)` 形(真实 sigScript = action 见证 ++ push(redeem), 字节 0 落在见证里)。已知未修清单(KNOWN_UNFIXED)显式列出、
//      不静默: 清单外出现即 FAIL; 清单内文件被修了而清单没删 ⇒ 也 FAIL(逼着维护清单)。
//   ② PayoutShardV2 / CloseZkV2 的 own_redeem_len 不动点收敛: 编译长度 == 烤入值; 传错值 fail-closed。
// Run: cd kasia-console && SILVERC_V100_PATH=... node src/lib/own-redeem-len.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `own-redeem-len-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const LIB = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };

// 已知仍是旧形的合约(本轮范围外, 账本1832 Owner 批的范围 = PayoutShardV2 + CloseZkV2; 其余在报件里列名)。
const KNOWN_UNFIXED = {
  'PayoutShard.sil': 'V1 委员会路径(本轮范围外)',
  'RootClaim.sil': 'proto-v0 线(不在 zk_native 结算路径; 需 RootClose/ShardLeaf_direct 模板链联动, 待 Bettor 定)',
};
console.log('[test] ① 源码 tripwire:');
for (const f of readdirSync(LIB).filter((n) => n.endsWith('.sil')).sort()) {
  const src = readFileSync(join(LIB, f), 'utf8');
  if (!/tx\.inputs\[this\.activeInputIndex\]\.sigScript/.test(src)) continue;
  const bad = /\.slice\(\s*0\s*,\s*OWN_PREFIX_LEN\s*\)/.test(src);
  const fixed = /own_redeem_len/.test(src) && !bad;
  if (KNOWN_UNFIXED[f]) ok(bad, `${f}: 已知未修(${KNOWN_UNFIXED[f]}) — 仍含 slice(0, OWN_PREFIX_LEN); 若已修请从 KNOWN_UNFIXED 删除`);
  else ok(fixed, `${f}: 自续约用 own_redeem_len 定位 redeem 起点, 无 slice(0, OWN_PREFIX_LEN)`);
}

console.log('[test] ② 收敛与 fail-closed:');
const reg = await import('./pool-shard-register.mjs');
const H = (c) => c.repeat(32);
const ps = { poolMerkleRoot: H('11'), predicateCommit: H('22'), closeZkTmplAnchor: H('33'), tokenTmplHash: H('44'), claimTmplHash: H('55') };
const conv = reg.convergePayoutShardV2OwnRedeemLen(ps);
ok(conv.script.length === conv.ownRedeemLen, `PayoutShardV2: 收敛值 ${conv.ownRedeemLen} == 编译长度 ${conv.script.length}`);
const hex = reg.compilePayoutShardV2Redeem({ ...ps, consolidatedPool: 3500000000, ownRedeemLen: conv.ownRedeemLen });
ok(hex.length / 2 === conv.ownRedeemLen, 'PayoutShardV2: consolidatedPool 取值变化不改变长度(state 定宽) ⇒ 同一 own_redeem_len 通用于整个市场生命周期');
let threw = null; try { reg.compilePayoutShardV2Redeem({ ...ps, consolidatedPool: 0, ownRedeemLen: conv.ownRedeemLen + 1 }); } catch (e) { threw = e; }
ok(threw && /fail-closed/.test(threw.message), `PayoutShardV2: 传错 ownRedeemLen(+1) ⇒ fail-closed(got: ${threw?.message?.slice(0, 80)})`);
threw = null; try { reg.compilePayoutShardV2Redeem({ ...ps, consolidatedPool: 0, ownRedeemLen: 0 }); } catch (e) { threw = e; }
ok(threw != null, 'PayoutShardV2: ownRedeemLen=0 ⇒ throw(不静默)');
const auto = reg.compilePayoutShardV2Redeem({ ...ps, consolidatedPool: 0 });
ok(auto.length / 2 === conv.ownRedeemLen, 'PayoutShardV2: 不传 ownRedeemLen ⇒ 现场收敛, 与显式传入一致');

const SIL = join(LIB, 'CloseZkV2.sil');
const g = reg.convergeCloseZkV2OwnRedeemLen(SIL, H('aa'), H('bb'), H('cc'));
const anchor = reg.computeCloseZkTmplAnchor(SIL, H('aa'), H('bb'), H('cc'));
ok(anchor.closeZkOwnRedeemLen === g, `CloseZkV2: computeCloseZkTmplAnchor 与 convergeCloseZkV2OwnRedeemLen 同值(${g}) — 模板内联了它, 两处必须一致`);
const { compileCloseZkV2Redeem } = await import('./closezk-v2-mint.mjs');
const real = compileCloseZkV2Redeem({ gateTmplHash: H('aa'), betsRootBaked: H('de'), refundRootBaked: H('ad'), attestedAtMs: 1783500123456, attestedWinner: 1, consolidatedPool: 3500000000, tokenTmplHash: H('bb'), claimTmplHash: H('cc') });
ok(real.length / 2 === g, `CloseZkV2: 真实市场值编译长度 ${real.length / 2} == own_redeem_len ${g}(对所有市场恒定)`);

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
