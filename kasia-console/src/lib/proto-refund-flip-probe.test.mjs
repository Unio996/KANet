// proto-refund-flip-probe.test.mjs — R-a / M5: probeRefundFlip 的纯决策(decideRefundFlipFromFacts)与"不得地址级"的反向臂 + evaluateRefundFlipTiming 边界。
// 判据三缺一不可(设计 v0.2 §3.5): ① 后继 = covenantId ∧ spk(version 0 + scriptHex)∧ 面值; ② 旧 outpoint 已花(missing); ③(check_utxo_landed 深度, IPC, 不在纯函数里)。
// 弱注入臂: 满足全部条件的基线上【只改一个字段】⇒ 必须翻成"未翻"(证明每个条件都承重, 不是被别的条件顶替)。
// Run: cd kasia-console && node src/lib/proto-refund-flip-probe.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_REFUND_FLIP_PROBE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_refund_flip_probe_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_REFUND_FLIP_PROBE_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { decideRefundFlipFromFacts } = await import('./proto-settlement-ops.mjs');
const { evaluateRefundFlipTiming, evaluateCloseCommitTiming, REFUND_FLIP_GRACE_MS, CLOSE_COMMIT_PMT_MARGIN_MS } = await import('./proto-close-commit-gate.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const H = (c) => c.repeat(64);
const COV = H('c1'), SPK = 'aa20' + H('5e') + '87', CONT = 20_000_000n;
const OLD = { transactionId: H('01'), index: 0 };
const succ = (over = {}) => ({ outpoint: { transactionId: H('02'), index: 0 }, amount: CONT, scriptPublicKey: { version: 0, scriptHex: SPK }, covenantId: COV, ...over });
const dust = (n) => ({ outpoint: { transactionId: H('d' + (n % 10)), index: n }, amount: CONT, scriptPublicKey: { version: 0, scriptHex: SPK }, covenantId: null });   // 攻击者向 closed=2 地址撒的、面值同为 CONT 的无 covenant 输出
const decide = ({ utxos = [succ()], truncated = false, found = [], missing = [OLD] } = {}) => decideRefundFlipFromFacts({ listRes: { utxos, truncated }, oldRes: { found, missing }, covId: COV, flippedSpkHex: SPK, contValue: CONT });

console.log('[test] ① 基线: 后继(covenantId ∧ spk ∧ 面值)∧ 旧 outpoint missing ⇒ flipped:');
{
  const r = decide(); ok(r.flipped === true && r.successor.outpoint.transactionId === H('02'), '三条件齐 ⇒ flipped, 后继 txid 取自 facts 读回的后继 outpoint.transactionId(NWT 落点 ①)');
  ok(decide({ utxos: [...Array.from({ length: 50 }, (_, i) => dust(i)), succ()] }).flipped === true, '被 50 个同面值 dust 包围仍找得到真后继(按 covenantId 认, 不按位置/数量)');
}
console.log('[test] ② 🔴 不得地址级: 只有 dust(无 covenant)在 closed=2 地址 ⇒ 未翻(攻击者撒 dust 不能把活市场打成"已翻"):');
{
  ok(decide({ utxos: [dust(1), dust(2), dust(3)] }).flipped === false, '只有无 covenant 的 dust ⇒ 未翻');
  ok(decide({ utxos: [dust(1)], found: [{ ...OLD }], missing: [] }).flipped === false, '只有 dust ∧ 旧 outpoint 未花 ⇒ 未翻');
  ok(decide({ utxos: [] }).reason === 'no_matching_successor', '空窗口 ⇒ 未翻(no_matching_successor)');
  ok(decide({ utxos: [dust(1)], truncated: true }).reason === 'no_matching_successor_window_truncated', '窗口被截断且无匹配 ⇒ 未翻并标 truncated(假阴性可见, 不会假阳性)');
}
console.log('[test] ③ 弱注入臂: 基线上只改一个字段 ⇒ 必须翻成"未翻":');
{
  const arms = {
    'covenantId=null(无 covenant 的 dust)': decide({ utxos: [succ({ covenantId: null })] }),
    'covenantId=别的 covenant': decide({ utxos: [succ({ covenantId: H('c2') })] }),
    'spk version=1': decide({ utxos: [succ({ scriptPublicKey: { version: 1, scriptHex: SPK } })] }),
    'spk scriptHex 不同(closed=1 或别的 spk)': decide({ utxos: [succ({ scriptPublicKey: { version: 0, scriptHex: 'aa20' + H('6f') + '87' } })] }),
    '面值不是 CONT(dust 面值)': decide({ utxos: [succ({ amount: 1000n })] }),
    '旧 outpoint 仍在(found 非空)': decide({ found: [{ ...OLD }], missing: [] }),
    '旧 outpoint 既不 found 也不 missing(响应不全)': decide({ missing: [] }),
  };
  for (const [k, r] of Object.entries(arms)) ok(r.flipped === false, `只改「${k}」⇒ 未翻(reason=${r.reason})`);
  ok(decide().flipped === true, '对照: 不改任何字段 ⇒ 仍是已翻(上面每条的"未翻"都来自那一个字段)');
}
console.log('[test] ④ evaluateRefundFlipTiming: 边界与"不复用 close 闸":');
{
  const DL = 1_790_000_000_000, lock = DL + REFUND_FLIP_GRACE_MS;
  ok(evaluateRefundFlipTiming({ pastMedianTimeMs: lock + CLOSE_COMMIT_PMT_MARGIN_MS - 1, deadlineMs: DL }).canSubmit === false, 'lock+30s−1ms ⇒ 不可提交');
  ok(evaluateRefundFlipTiming({ pastMedianTimeMs: lock + CLOSE_COMMIT_PMT_MARGIN_MS, deadlineMs: DL }).canSubmit === true, 'lock+30s ⇒ 可提交');
  ok(evaluateRefundFlipTiming({ pastMedianTimeMs: DL + 60_000, deadlineMs: DL }).canSubmit === false && evaluateCloseCommitTiming({ pastMedianTimeMs: DL + 60_000, deadlineMs: DL }).canSubmit === true, 'deadline+60s: close 闸放行、refund_flip 闸拒(两个闸不可互换)');
  ok(evaluateRefundFlipTiming({ pastMedianTimeMs: lock + 30_000, deadlineMs: DL }).lockTimeMs === lock, '返回 lockTimeMs = deadline+2h');
  for (const bad of [{ pastMedianTimeMs: 0, deadlineMs: DL }, { pastMedianTimeMs: NaN, deadlineMs: DL }, { pastMedianTimeMs: 1, deadlineMs: -1 }]) {
    let e = null; try { evaluateRefundFlipTiming(bad); } catch (x) { e = x; } ok(!!e, `非法入参 ${JSON.stringify(bad)} ⇒ 抛`);
  }
}
console.log(fails === 0 ? '\n✅✅ ALL PASS — refund_flip 探针纯决策(三缺一不可 + 弱注入臂)+ 时间闸边界' : `\n❌ ${fails} assertions failed`);
process.exitCode = fails === 0 ? 0 : 1;
