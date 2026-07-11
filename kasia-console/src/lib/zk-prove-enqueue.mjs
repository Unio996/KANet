// zk-prove-enqueue.mjs — 缺件①(J1tn, Bettor 2026-07-07 18:53 派工, T2b 生产线本体最后三缺件之一)。
//
// close_attest_v2 落链 confirm 后调用: 直接 DB insert 进 zk_prove_jobs(既有幂等锁, migrate v180),
// 供 zk-prove-worker.mjs(缺件②, J2 已落地 commit 90c39ad4)轮询消费。
//
// 范围边界(跟缺件②的分工, J2 19:11 message): zk-prove-worker.mjs 只挡 fee_leaves "非空"这层最基础校验
// (它没有 driver 完整数据视角, 猜不到 winner 侧逐笔 payout 该是多少)。**完整 Σ(payoutLeaves)==consolidatedPool
// 守恒验证是本函数的职责**——用跟 guest 电路同一份公开确定性算法(computePariMutuelPayout, 单源
// pool-shard-settle.mjs, 非重发明)独立重算一遍, 在花 4 分钟 RISC0 proving 之前就拦住输入错误, 而不是让
// prove-worker 跑完才通过 assertPayoutLeavesConserved 发现。
//
// ✅ 范围声明更新(P4/D-008, 2026-07-09 已拍板, 取代下方旧口径不定案的记录): fee 政策 = 市场级
// market.broker_fee_pct(D-007 口径), 非旧协议固定常量口径(V1 committee-settle 专属, ZK 线不再直调,
// 见 pool-shard-settle.mjs 旁路封死注释)——单源函数 `deriveSettlementFeeLeaves`(pool-shard-settle.mjs)
// 已落地, 调用方(propose/委员 voter)各自独立
// 链读 consolidatedPool 后调用它产出 feeLeaves。本函数(enqueueZkProveJob)职责不变: 仍不内部派生
// feeLeaves, 只验证"调用方传入的 feeLeaves 加 winner payouts 精确 == consolidatedPool"(守恒把关,
// 跟"这个 feeLeaves 该怎么算"的政策问题解耦——那部分现在有了单源答案, 但答案的执行仍在 caller 侧)。

import { randomUUID } from 'node:crypto';
import { getSidesByShard } from './pool-bettor-sides-query.mjs';
import { canonicalBetOrder, computeBetsRoot } from './pool-payout-root.mjs';
import { computePariMutuelPayout } from './pool-shard-settle.mjs';
import { readPayoutShardV2AttestedState, _splicePayoutV2CloseRedeem } from './bshard-close-enforce.mjs';

/**
 * enqueueZkProveJob
 * @param {import('better-sqlite3').Database} db  依赖注入(同 getSidesByShard(shardId, db) 既有约定), 非硬编码
 *   import——生产调用方传真实 db/client.js 的 sqlite, 单元测试传 in-memory fixture。
 * @param {string} marketId  logical market id
 * @param {string} psRedeemHexPreAttest  close_attest_v2 广播前的 PayoutShardV2 continuation redeem(closed==0,
 *   propose 阶段那份——跟 submitCloseAttestV2 组 tx 时用的【同一份】redeem_hex, 见 bshard-close-voter.js req.closeInputs.payoutshard.redeem_hex)
 * @param {{newPayoutRootHex:string, newAttestedWinner:number, newBetsRootHex:string, newRefundRootHex:string, newAttestedAtMs:number}} attestValues
 *   跟广播时喂给委员签名的【同一份】witness 值(committee D2-V2 binding 已核实过——本函数不是重新信任这些值,
 *   而是走一遍跟 relay 相同的 splice+decode, 让 offset/结构性错位在这里先炸, 不会带着错值继续往下传)。
 * @param {Array<{pk:string, amount:string|number}>} feeLeaves  完整 fee-recipient leaves(调用方决定政策来源, 见上)。
 * @returns {{ok:boolean, jobId?:number|bigint, skipped?:string}}
 */
export function enqueueZkProveJob(db, marketId, psRedeemHexPreAttest, attestValues, feeLeaves) {
  // 幂等锁(唯一索引兜底, 这里提前查一遍给清楚原因, 不靠 catch 分辨"跳过"vs"真错误")。
  const existing = db.prepare(
    `SELECT id, status FROM zk_prove_jobs WHERE market_id = ? AND status IN ('pending','in_progress')`,
  ).get(marketId);
  if (existing) return { ok: true, skipped: `job ${existing.id} 已在 ${existing.status}, 幂等不重复 enqueue` };

  // verify-value-source: 本地重建落链后的 continuation redeem 再原样读回, 不是"信 attestValues 就是对的"——
  // splice/read 任一环节 offset 错位这里会先抛异常, 不会带着可疑值往下传。
  const landedRedeem = _splicePayoutV2CloseRedeem(psRedeemHexPreAttest, attestValues);
  const attested = readPayoutShardV2AttestedState(landedRedeem);

  const shards = db.prepare(
    'SELECT shard_market_id FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC',
  ).all(marketId);
  if (shards.length !== 1) {
    throw new Error(`enqueueZkProveJob: market ${marketId} 有 ${shards.length} 个 shard — ZK-native 目前只服务单片(同 zk-close-builder.mjs gatherOrderedBets 既有限定, 多片 fold 是 production 待办非本函数范围)`);
  }
  const rows = getSidesByShard(shards[0].shard_market_id, db);
  const ordered = canonicalBetOrder(rows);   // 链锚序(side_lock_daa ASC + side_lock_tx tiebreak), 非 id ASC(同 W2 委员侧口径)
  const bettors = ordered.map((r) => ({ pk: String(r.bettor_pk), stake: String(r.stake_amount), direction: Number(r.direction) }));

  // C1-同款 predict-then-verify(zk-close-builder.mjs 既有方法论复用): 用我自己 gather 的 bets 独立重算 betsRoot,
  // 必须 == 委员已 attest 的 betsRootHex, 否则说明 gather 序/shard 选择/DB 陈旧行任一环节有问题——不静默继续拿一个
  // 跟 guest 将要独立重算的 betsRoot 对不上的输入去跑 4 分钟 proving。
  const recomputedBetsRoot = computeBetsRoot(bettors).toString('hex');
  if (recomputedBetsRoot !== attested.betsRootHex) {
    throw new Error(`enqueueZkProveJob: 本地重算 betsRoot(${recomputedBetsRoot}) != 委员已 attest 的 betsRootHex(${attested.betsRootHex}) — gather 序/shard 选择/陈旧数据任一环节有误, 拒绝 enqueue`);
  }

  if (!Array.isArray(feeLeaves) || feeLeaves.length === 0) {
    throw new Error('enqueueZkProveJob: feeLeaves 为空 — §4硬门⑤禁 bps-fallback, 调用方必须显式提供完整 fee_leaves(哪怕零fee场景也要显式声明, 不能靠省略触发隐式 bps 路径)');
  }
  const pool = attested.consolidatedPool;
  const feeSompi = feeLeaves.reduce((s, l) => s + BigInt(l.amount), 0n);
  if (feeSompi > pool) {
    throw new Error(`enqueueZkProveJob: ΣfeeLeaves(${feeSompi}) > consolidatedPool(${pool}) — fee 配置异常(distributable 会变负), 拒绝 enqueue`);
  }

  const pm = computePariMutuelPayout({ bettors, winningDirection: attested.attestedWinner, poolTotalSompi: pool.toString(), feeLeaves });
  if (pm.degenerate) {
    return { ok: true, skipped: `degenerate(${pm.reason}) — 无赢家, 非 ZK-prove 场景, 调用方应走 escape_trigger/refund 路径而非 enqueue proving job` };
  }
  const sumLeaves = pm.payoutLeaves.reduce((s, l) => s + BigInt(l.amount), 0n);
  if (sumLeaves !== pool) {
    // computePariMutuelPayout 自身算法本该保证这个恒等式(dust 归 winners[0])——真触发说明重算跟它内部假设脱节,
    // fail-closed 而非默默继续(§4 硬门⑤ 核心意图: 4 分钟 proving 之前拦住, 不留给 prove-worker 才发现)。
    throw new Error(`enqueueZkProveJob: Σleaf(${sumLeaves}) != consolidatedPool(${pool}) — 独立重算不守恒, 拒绝 enqueue`);
  }

  const insert = db.prepare(`
    INSERT INTO zk_prove_jobs (market_id, status, ordered_bets_json, bets_root_hex, attested_winner, fee_leaves_json, pool_total_sompi)
    VALUES (?, 'pending', ?, ?, ?, ?, ?)
  `);
  try {
    const info = insert.run(marketId, JSON.stringify(bettors), attested.betsRootHex, attested.attestedWinner, JSON.stringify(feeLeaves), pool.toString());
    return { ok: true, jobId: info.lastInsertRowid };
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return { ok: true, skipped: 'UNIQUE 索引拦并发 enqueue(job 已存在)' };
    throw e;
  }
}

// 缺件④(J2 2026-07-11, docs/2026-07-11-zk-autonomy-fourth-piece-handoff-enqueue-retry-design.md,
// 7/9 原始"自治化三件"(a)的真身, scope-drift 补件——NWT+Bettor 双审 GREEN #gj8kzn.2/.3): attest 落链
// 时 _tryEnqueueZkProve 立即建 pending job, 但门① zk_handoff 目前仍人工, worker 轮询往往先于 handoff
// 落地判 job failed(zk-prove-worker.mjs:178 固定文案), 从无自动重试(job#7/#9 两市场实际复发)。
// 本函数在 writeZkContinuation(门① landed 确认后)成功调用之后触发, 把因这一具体 liveness 缺口失败的
// job 重置回 pending, 让 worker 下一 tick 正常捡起——不改 worker 的 fail-closed 检查本身。
//
// 只匹配 zk-prove-worker.mjs:178 那条固定错误子串(全代码库唯一来源, grep 已确认)——不 blanket-retry
// 所有 failed job: 真实数据错误(Σleaf 不守恒/fee_leaves 空等)不该被本机制悄悄吃掉, 需要人工看见。
const NO_CONTINUATION_ERROR_SUBSTR = '还没有 zk_continuation';

/**
 * retryZkProveJobAfterHandoffLanded
 * @param {import('better-sqlite3').Database} db
 * @param {string} marketId
 * @returns {{ok:boolean, retried?:boolean, jobId?:number|bigint, reason?:string}}
 */
export function retryZkProveJobAfterHandoffLanded(db, marketId) {
  const row = db.prepare(
    `SELECT id, error FROM zk_prove_jobs WHERE market_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`,
  ).get(marketId);
  if (!row) return { ok: true, retried: false, reason: 'no failed job for this market' };
  if (!String(row.error || '').includes(NO_CONTINUATION_ERROR_SUBSTR)) {
    return { ok: true, retried: false, reason: `failed job ${row.id} error 不匹配 liveness 缺口子串, 不自动重试(需人工看): ${row.error}` };
  }
  db.prepare(`UPDATE zk_prove_jobs SET status = 'pending', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id);
  // 审计留痕(NWT diff 审抓出设计 §2 步骤3 与实现落差, 已补——同 _writeZkCloseTickErrorEvent 既有模式,
  // 不新造 events 写法, try/catch 只影响记账不影响已经生效的 job 重置)。
  try {
    db.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'zk_prove_job_retried_after_handoff', 'zk-prove-enqueue.retryZkProveJobAfterHandoffLanded', 'info', ?, ?, datetime('now'))
    `).run(
      randomUUID(),
      `market=${marketId.slice(-8)} zk_prove_jobs id=${row.id} 因 zk_handoff-landed 重置回 pending(此前因 liveness 缺口 failed)`,
      JSON.stringify({ marketId, jobId: row.id, previousError: row.error }),
    );
  } catch (e) { /* audit-only, non-fatal — job reset above already committed */ }
  return { ok: true, retried: true, jobId: row.id };
}
