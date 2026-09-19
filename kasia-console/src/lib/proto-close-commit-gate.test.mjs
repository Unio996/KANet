// proto-close-commit-gate.test.mjs — B4-2 根治: 判"能否提交 close_commit"读节点 pastMedianTime, 不用墙钟。
// 向量取自 2026-09-19 simnet 全链真实数据(docs/provenance/2026-09-19-j2-fullchain-simnet/): 第一次提交被节点 NotFinalized 拒绝时的
// pmt/deadline, 以及补挖后被接受时的 pmt/deadline。
// Run: cd kasia-console && node src/lib/proto-close-commit-gate.test.mjs
const G = await import('./proto-close-commit-gate.mjs');
const { evaluateCloseCommitTiming, readPastMedianTimeMs, checkCloseCommitTiming, CLOSE_COMMIT_PMT_MARGIN_MS, REFUND_FLIP_GRACE_MS } = G;

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const DEADLINE = 1789806762435; // 真实 simnet 全链的市场 deadline
const PMT_REJECTED = 1789727080378; // 第一次提交被节点 NotFinalized 拒绝时的 pastMedianTime
const PMT_ACCEPTED = 1789810741817; // 补挖后 close_commit 被接受时的 pastMedianTime

await t('真实向量(被节点拒): pmt 远落后 deadline ⇒ canSubmit=false, reason 说明 NotFinalized/可重试无状态变更', () => {
  const r = evaluateCloseCommitTiming({ pastMedianTimeMs: PMT_REJECTED, deadlineMs: DEADLINE });
  if (r.canSubmit) throw new Error('应该不可提交(节点真的以 NotFinalized 拒了)');
  if (!/NotFinalized/.test(r.reason) || !(r.pmtLeadMs < 0)) throw new Error(JSON.stringify(r));
});
await t('真实向量(被节点收): pmt 已超过 deadline(领先约 3,979,382ms≈66min) ⇒ canSubmit=true, sla=warn(≥1h 应报警)', () => {
  const r = evaluateCloseCommitTiming({ pastMedianTimeMs: PMT_ACCEPTED, deadlineMs: DEADLINE });
  if (!r.canSubmit || r.pmtLeadMs !== PMT_ACCEPTED - DEADLINE || r.sla !== 'warn') throw new Error(JSON.stringify(r));
});
await t('边界: pmt 恰好领先 margin-1ms ⇒ 不可提交; 恰好领先 margin ⇒ 可提交(节点是 lock_time < pmt 严格小于, 另留 30s 余量)', () => {
  if (evaluateCloseCommitTiming({ pastMedianTimeMs: DEADLINE + CLOSE_COMMIT_PMT_MARGIN_MS - 1, deadlineMs: DEADLINE }).canSubmit) throw new Error('margin-1 不该放行');
  if (!evaluateCloseCommitTiming({ pastMedianTimeMs: DEADLINE + CLOSE_COMMIT_PMT_MARGIN_MS, deadlineMs: DEADLINE }).canSubmit) throw new Error('margin 应该放行');
  if (evaluateCloseCommitTiming({ pastMedianTimeMs: DEADLINE, deadlineMs: DEADLINE }).canSubmit) throw new Error('pmt==deadline 不该放行(严格小于)');
});
await t('SLA 以 pmt 计: <1h ok / ≥1h warn / ≥2h(REFUND_FLIP_GRACE_MS=7,200,000) refund_flip_open(任何人可把 closed 0→2, close_commit 有被抢先风险)', () => {
  const s = (lead) => evaluateCloseCommitTiming({ pastMedianTimeMs: DEADLINE + lead, deadlineMs: DEADLINE }).sla;
  if (REFUND_FLIP_GRACE_MS !== 7_200_000) throw new Error('常量不对');
  if (s(120_000) !== 'ok' || s(3_599_999) !== 'ok' || s(3_600_000) !== 'warn' || s(7_199_999) !== 'warn' || s(7_200_000) !== 'refund_flip_open') throw new Error([s(120_000), s(3_599_999), s(3_600_000), s(7_199_999), s(7_200_000)].join(','));
});
await t('不用墙钟: 本机时钟(Date.now)与 pmt 差多大都不影响判断——同一 pmt 同一 deadline 结果恒定', () => {
  const orig = Date.now;
  try {
    const a = evaluateCloseCommitTiming({ pastMedianTimeMs: PMT_ACCEPTED, deadlineMs: DEADLINE });
    Date.now = () => 0; const b = evaluateCloseCommitTiming({ pastMedianTimeMs: PMT_ACCEPTED, deadlineMs: DEADLINE });
    Date.now = () => 9e15; const c = evaluateCloseCommitTiming({ pastMedianTimeMs: PMT_ACCEPTED, deadlineMs: DEADLINE });
    if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(c)) throw new Error('结果依赖了墙钟');
  } finally { Date.now = orig; }
});
await t('readPastMedianTimeMs / checkCloseCommitTiming(注入 rpc): 正常读取; 读取失败或 pmt 非法 ⇒ canSubmit=false(fail-closed, 不因读不到就放行)', async () => {
  const okRpc = { getBlockDagInfo: async () => ({ pastMedianTime: BigInt(PMT_ACCEPTED) }) };
  if ((await readPastMedianTimeMs(okRpc)) !== PMT_ACCEPTED) throw new Error('BigInt pmt 读取不对');
  const r1 = await checkCloseCommitTiming({ rpc: okRpc, deadlineMs: DEADLINE });
  if (!r1.canSubmit || r1.pastMedianTimeMs !== PMT_ACCEPTED) throw new Error(JSON.stringify(r1));
  for (const bad of [{ getBlockDagInfo: async () => { throw new Error('rpc down'); } }, { getBlockDagInfo: async () => ({}) }, { getBlockDagInfo: async () => ({ pastMedianTime: 0 }) }, { getBlockDagInfo: async () => ({ pastMedianTime: 'x' }) }]) {
    const r = await checkCloseCommitTiming({ rpc: bad, deadlineMs: DEADLINE });
    if (r.canSubmit) throw new Error('读不到 pmt 却放行了');
  }
});
await t('非法入参(deadline/pmt 非正数)⇒ throw', () => {
  for (const bad of [{ pastMedianTimeMs: 0, deadlineMs: DEADLINE }, { pastMedianTimeMs: PMT_ACCEPTED, deadlineMs: NaN }, { pastMedianTimeMs: -1, deadlineMs: DEADLINE }]) {
    let e = null; try { evaluateCloseCommitTiming(bad); } catch (x) { e = x; } if (!e) throw new Error('应该 throw');
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
