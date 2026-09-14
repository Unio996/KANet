// closezk-v2-mint-atms-width.test.mjs — regression guard for assertSixByteEncodable / T-CLOSEZK-ATMS-WIDTH
// (docs/2026-09-14-j2-closezkv2-attestedatms-encoding-width-ticket-v0.1.md, NWT 4f659405 定案②).
//
// 🔴 为什么不能用票面原提议的 2^40/2^40-1/2^47 三个边界向量测这条新断言(NWT 4f659405 独立验算发现的真实
// 缺口): 既有 [2^40,2^47) 数值闸(bshard-close-enforce.mjs _ATTESTED_AT_MS_MIN/MAX，
// bshard-close-enforce.psv2-read.test.mjs 已经覆盖过这条闸的回归，本文件不重复)整段严格落在 6 字节可
// 表示范围 [0, 2^48-1] 内部——用 2^40-1/2^47 测，真实调用链路(readPayoutShardV2AttestedState 先跑)会先
// 被那条既有闸拦下，永远轮不到 assertSixByteEncodable 自己的失败路径，测出来的是"旧闸没退化"，不是"新
// 断言真的会拦"。本文件绕过整条调用链，直接调 assertSixByteEncodable 本体 + 直接调 compileCloseZkV2Redeem
// (不经 readPayoutShardV2AttestedState，天然不会被旧闸截胡)，用 2^48-1(PASS)/2^48(FAIL)测新断言自己的
// 阈值——这两个数字才是 6 字节编码本身的真实边界，不是业务上"合理时间戳"的边界。
//
// closezk-v2-mint.mjs 顶层 import { sqlite } from '../db/client.js'，同既有 closezk-v2-mint.e2e.test.mjs
// 一样需要 DB_PATH 才能 import 不 throw——走标准 bootstrap 拿隔离临时库。
//
// Run: cd kasia-console && node src/lib/closezk-v2-mint-atms-width.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._ATMSWIDTH_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_atmswidth_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _ATMSWIDTH_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { assertSixByteEncodable, compileCloseZkV2Redeem } = await import('./closezk-v2-mint.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const SIX_BYTE_MAX = 2 ** 48 - 1;   // = 281474976710655, 6 字节无符号能表示的最大值
const SEVEN_BYTE_MIN = 2 ** 48;      // 编不进 6 字节, 需要第 7 字节

console.log('[test] assertSixByteEncodable 独立单测(不经任何业务调用链, 直接测这条断言自己的阈值):');
{
  let threw = null;
  try { assertSixByteEncodable(SIX_BYTE_MAX, 'attestedAtMs'); } catch (e) { threw = e; }
  ok(threw === null, `2^48-1(=${SIX_BYTE_MAX}, 6 字节可表示的最大值) 不 throw (got: ${threw?.message})`);
}
{
  let threw = null;
  try { assertSixByteEncodable(SEVEN_BYTE_MIN, 'attestedAtMs'); } catch (e) { threw = e; }
  ok(threw != null, `2^48(=${SEVEN_BYTE_MIN}, 编不进 6 字节) throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /attestedAtMs/.test(threw.message) && new RegExp(String(SEVEN_BYTE_MIN)).test(threw.message), `reason 含字段名 + 具体的值 (got: ${threw?.message})`);
}
{
  // sanity: 0 本身(6 字节能表示的最小值)也应该 PASS，不是这条断言意外把小值也拦了。
  let threw = null;
  try { assertSixByteEncodable(0, 'attestedAtMs'); } catch (e) { threw = e; }
  ok(threw === null, `0(6 字节可表示的最小值) 不 throw (got: ${threw?.message})`);
}

console.log('[test] compileCloseZkV2Redeem 接线核实(不经 readPayoutShardV2AttestedState, 直接调用天然绕开既有 [2^40,2^47) 数值闸——真的在测新断言, 不是重跑旧闸):');
const TTH = 'aa'.repeat(32), CTH = 'bb'.repeat(32), MSH = 'cc'.repeat(32), GATE = 'dd'.repeat(32);
const baseArgs = {
  gateTmplHash: GATE, betsRootBaked: 'ee'.repeat(32), refundRootBaked: 'ff'.repeat(32),
  attestedWinner: 0, consolidatedPool: 1000,
  tokenTmplHash: TTH, claimTmplHash: CTH, marketSuffixHash: MSH,
};
{
  // 正向: 2^48-1 是编码上合法的值(虽然远超业务上任何合理时间戳)，真编译应该成功，不因为宽度断言被拦。
  let threw = null, redeemHex = null;
  try { redeemHex = compileCloseZkV2Redeem({ ...baseArgs, attestedAtMs: SIX_BYTE_MAX }); } catch (e) { threw = e; }
  ok(threw === null, `attestedAtMs=2^48-1: 真编译成功, 不被宽度断言拦 (got: ${threw?.message})`);
  ok(typeof redeemHex === 'string' && redeemHex.length > 0, `真编译产出非空 redeem hex (len=${redeemHex?.length})`);
}
{
  // 负向: 2^48 编不进 6 字节, compileCloseZkV2Redeem 必须在真编译(silverc 子进程)之前就被 assertSixByteEncodable 拦下——
  // 不是"耗时几百 ms 真编译后才发现问题"，是"进函数体内几乎立即 throw"。
  const t0 = Date.now();
  let threw = null;
  try { compileCloseZkV2Redeem({ ...baseArgs, attestedAtMs: SEVEN_BYTE_MIN }); } catch (e) { threw = e; }
  const dt = Date.now() - t0;
  ok(threw != null, `attestedAtMs=2^48: throws, 不静默继续编译 (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /assertSixByteEncodable/.test(threw.message), `reason 指名是 assertSixByteEncodable 拦的, 不是下游某个更难读的 silverc/ctor 错误 (got: ${threw?.message})`);
  ok(dt < 50, `在真编译(通常 ~350-400ms, 见本 session 其它 silverc 调用计时)之前就 throw, 耗时=${dt}ms(<50ms 证明没走到子进程)`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
