// zk-judge-propose-median-lag.test.mjs — 账本1832 段2(Bettor 批 c): judge+propose 候选门加墙钟缓冲(过去中位时间滞后), not-finalized 归为静默重试。
// Run: cd kasia-console && node src/lib/zk-judge-propose-median-lag.test.mjs
import { join } from 'node:path';
process.env.DB_PATH ||= join(process.env.TEMP || '/tmp', `judge-lag-${process.pid}.db`);
process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64);
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { judgeProposeTimeGateOpen, isNotFinalizedError } = await import('./zk-autonomy-ticks.mjs');
const D = 1_791_066_000;   // deadline (Unix s)
const LAG = 300_000;
ok(judgeProposeTimeGateOpen(D, D * 1000 + 6_000, LAG) === false, 'deadline+6s(旧门 DAA+60≈6s 就放行的时刻) ⇒ 新门关');
ok(judgeProposeTimeGateOpen(D, D * 1000 + 100_000, LAG) === false, 'deadline+100s(simnet 实测仍 not finalized) ⇒ 关');
ok(judgeProposeTimeGateOpen(D, D * 1000 + 270_000, LAG) === false, 'deadline+270s(simnet 实测刚好过, 但无余量) ⇒ 仍关(默认 300s 留余量)');
ok(judgeProposeTimeGateOpen(D, D * 1000 + LAG, LAG) === true, 'deadline+300s ⇒ 开');
ok(judgeProposeTimeGateOpen(null, Date.now(), LAG) === false && judgeProposeTimeGateOpen(0, Date.now(), LAG) === false && judgeProposeTimeGateOpen('x', Date.now(), LAG) === false, '无效 deadline ⇒ 关(fail-closed)');
ok(isNotFinalizedError('RPC Server (remote error) -> Rejected transaction x: ... input #0 is not finalized'), 'not finalized 文本 ⇒ 识别为可重试');
ok(!isNotFinalizedError('script ran, but verification failed') && !isNotFinalizedError(null), '其它拒绝(验证失败等) ⇒ 不吞, 仍走错误事件');
console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
