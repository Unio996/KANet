# zkCloseTick 生产装配设计（跨机器 proving job-queue）

**作者**: J2 · **日期**: 2026-07-06 · **Status**: CURRENT — job表/server/settler三步接入+3个hook(checkLanded/fetchCloseZkContinuation/reconcile)已落码，NWT GREEN(2026-07-06 15:53)。escapeRefund/dispatchUnlockZkClose 仍 TODO stub（依赖未设计的 ZK 退款 entrypoint，见下）。kill switch(ZK_CLOSE_TICK_ENABLED)默认 OFF，未做端到端真实测试。

**触发**: Owner 拍板"现在开工"覆盖"留到下次 session"的建议，把今晚已手工验证过的完整真 ZK settle 流程（[[project-first-complete-real-zk-settle-landed-2026-07-06]]）装配进 settler 生产主循环。这是新架构决策（proving 只在 J1 机器跑，settler 主循环在 J2 机器跑），不是纯装配，走完整审核。

---

## 1. Scope 隔离（已获 Bettor 批准，GREEN）

**目标**：zkCloseTick 只影响 ZK-eligible 的 bshard 市场，跟现有 committee-sig 结算路径（`selectRipeMarkets`/`settleOneMarket`）零交集，结构性隔离而非逻辑判断。

- 现有 `selectRipeMarkets()`（`bshard-settle-daemon.mjs`）选择条件 `protocol_status IN ('pending_bettors','verifying') OR protocol_status='settled_partial_claims'` —— **一字不改**。
- 新增 `selectZkEligibleMarkets()`：只选 `protocol_status = 'zk_ready'`，这是**全新的、之前从未在任何代码路径出现过的 status 值**。查询条件字符串层面跟现有路径互斥，不依赖运行时判断。
- `zkCloseTick()` 只处理 `selectZkEligibleMarkets()` 选出的市场，在 settler tick 循环里作为**独立并行步骤**调用（不是分支，不修改现有 if-else）。
- 市场进 ZK 路径必须**显式**标记成 `zk_ready`（不自动推断/不继承其他状态）——标记动作本身是后续独立一步，不在本次范围内。
- bh01w（`ext-pool-v07-1782667323858-bh01w`）现在是 `settle_zombie_quarantine`，**不会**被这条新路径自动捡到，需要先单独解决 quarantine 状态（谁标的/为什么/退款还是继续用——目前无历史记录，见 KANet-UI 调查结果）再决定是否手动标记 `zk_ready` 纳入测试。

## 2. 跨机器 proving 架构（核心新决策）

**问题**：RISC0 proving 只在 J1 机器的 WSL/Docker 环境跑；settler 主循环（`zkCloseTick` 调用方）在 J2 的 live host 跑。两者不在同一进程/机器。

**排除的选项**：
- (a) 跨机器直接 DB 访问 —— 引入新的分布式一致性问题，今晚刚验证"rolling 跨节点是死路"，不该在 proving 环节重蹈。
- (c) 把 WSL 搬到 J2 live 主机 —— 违反 D-005（不在 live 节点装系统级工具）。

**采用**：(b) job-queue + HTTP 桥，通过已确认的 Tailscale tailnet（J2: `100.99.147.101`，J1: `100.111.126.10`）通信，不需要暴露公网端口。

### 2.1 网络与暴露面

- **不改动主 console 的 HOST 绑定**（`kasia-console/src/index.js:443` 现在 `host: process.env.HOST || '127.0.0.1'`，一字不动 —— 改这个会把所有现有生产 API 暴露到 tailnet，改动面过大）。
- 新起一个**独立、最小化的 HTTP server**（新进程或 console 内新增一个绑定到 Tailscale IP 的独立 listener，具体哪种实现方式落码时再定，但逻辑上是"只服务 zk-prove 相关路由的一小块"），只监听 Tailscale 接口（`100.99.147.101`）或 `0.0.0.0` + 防火墙只放行 Tailscale CIDR（`100.64.0.0/10`）。
- 认证：bearer token（存 `kanet.env`，不进 git）+ IP 限定 Tailscale CIDR。内网 agent 间调用，非面向公网用户，NWT 判断 proportional threat model 不需要 mTLS 这类重装备。

### 2.2 job 表 schema（新增，migrate.js v180）

```sql
CREATE TABLE zk_prove_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending|in_progress|done|failed
  ordered_bets_json TEXT NOT NULL,                     -- gatherOrderedBets() 输出, 喂给真 guest 的输入
  bets_root_hex     TEXT,                               -- gather 序算的 betsRoot (C1 predict-then-verify 用)
  attested_winner   INTEGER,
  receipt_hex       TEXT,                                -- J1 完成后回填 (borsh Groth16Receipt<ReceiptClaim>)
  journal_digest_hex TEXT,                                -- J1 完成后回填 (跟 J2 覆约内算的 journalHash 对账用)
  error             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_zk_prove_jobs_market_active
  ON zk_prove_jobs(market_id)
  WHERE status IN ('pending', 'in_progress');  -- 幂等: 同一市场同时只能有一个非terminal job
```

**幂等（NWT 补的关键点）**：跨机器场景下 daemon 每个 tick 是无状态的（重新查 DB 决定要不要发请求）——防重复的锁必须落在**持久化状态**，不能只在内存里（daemon 重启会丢内存锁，可能对同一 job 发出第二个重复请求）。上面的 partial unique index 就是这个持久化锁：`zkCloseTick` enqueue 前先查这个市场是否已有非 terminal 状态的 job，有就跳过。

### 2.3 API endpoints

- `POST /zk-prove/enqueue`（settler 侧调用，J2 机器自己调自己新起的 server）：body `{marketId, orderedBets, betsRoot, attestedWinner}` → 若该 market 已有 pending/in_progress job，返回现有 job（幂等），否则 insert 新行返回。
- `GET /zk-prove/poll`（J1 侧轮询 daemon 调）：返回一个 `status='pending'` 的 job（若有），并原子性地把它标成 `in_progress`（`UPDATE ... WHERE status='pending' LIMIT 1 RETURNING *` 或等效的 SQLite 事务模式，防止并发轮询取到同一行）。
- `POST /zk-prove/complete`（J1 侧调，proving 跑完后）：body `{jobId, receiptHex, journalDigestHex}` 或 `{jobId, error}` → 写回 `receipt_hex`/`journal_digest_hex`/`status='done'` 或 `status='failed', error`。

### 2.4 失败/超时语义

**同意 Bettor 的判断**：settler 这边只管"发请求 + 等结果 + 没结果就这 tick 先不动"。`zkClosePhase2` 本来就是 no-tx-no-state（[[project-first-complete-real-zk-settle-landed-2026-07-06]] 已验证的 covenant 机制本身没有"部分执行"状态）——proving 没完成，`zkCloseTick` 这次直接 `continue`/跳过这个 market，**不改 `protocol_status`，不判失败，不退款**，下个 tick 重新检查 job 状态。

**⚠ v1 已知限制（NWT 审出的缺口，明确承认而非隐藏）**：如果 J1 机器在 proving 中途崩溃/网络断开，对应 job 会**永久卡在 `in_progress` 状态**——`zk_prove_jobs` 的 partial unique index（防重复入队用）同时会挡住同一 market 重新入队一个新 job，导致该 market 的 ZK 结算路径卡死，没有自动恢复路径。**这是有意识的范围收窄，不是遗漏**：v1 不做自动超时告警/自动重发（那是下个迭代的独立课题，涉及"多久算超时"这类需要运维经验才能定的参数，不该今晚现场拍）。**v1 的恢复方式 = 手动介入**：运维发现某 market 卡住后，手动执行 `UPDATE zk_prove_jobs SET status='failed' WHERE id=X`，下个 tick `zkCloseTick` 会看到该 market 没有非 terminal job，重新 enqueue。这个限制只影响新增的、显式标记 `zk_ready` 的市场（范围极窄），不影响现有 955 个赢家的 committee-sig 结算路径。

**可观测性（Bettor 要求③确认）**：`zk_prove_jobs.updated_at` 每次状态变更都会更新，足以看出一个 job 卡了多久（`(julianday('now') - julianday(updated_at)) * 24 * 60` 算分钟数）。

**恢复脚本已提交（Bettor 要求②，非口头描述）**：`kasia-console/scripts/zk-prove-job-recover.mjs` ——`--list` 列出所有非 terminal job + 卡了多久，`--unstick <jobId>` 执行上面那条 UPDATE 并打印确认。

## 3. Relay handler（J1 域，②，本文档不重复设计，见 J1 自己的方案帖）

J1 已出方案：新 handler `unlockBshardZkClose`，命令名 `bshard_zk_close`，照 `p2sh.mjs` 现有 handler 模式（`{wallet, cmd, networkId, lockTime}` 统一参数 + `relay.mjs` case 里 import+调用+`process.send` 返回），参数对应 `zk-close-builder.mjs` 已声明的 `dispatchUnlockZkClose` 签名。内部映射今晚手工 4 步骤（proving via job-queue → journalHash+gate script → covenant sigScript → 2-input tx 组装+FUND+broadcast）。

## 4. 验收标准

1. **scope 隔离验证**：新增 `selectZkEligibleMarkets()` 后，对现有 committee-sig 市场跑一次完整 settler tick，确认 `selectRipeMarkets()` 选出的市场集合跟改动前完全一致（diff 为空）。
2. **幂等验证**：模拟同一市场在两个连续 tick 内都触发 `zkCloseTick` 的 enqueue 逻辑，确认第二次不会插入新行（partial unique index 生效）。
3. **跨机器 e2e**：用一个测试市场（非 bh01w，先用全新 test-only 市场，标记 `zk_ready`），走完整 enqueue → J1 轮询 → complete → `zkClosePhase2` 内 `fetchCloseZkContinuation`/`dispatchUnlockZkClose` 真实调用（非 mock）→ 链上 LANDED，全程 NWT 审。
4. **bh01w 单独处理**：quarantine 原因调查完（或明确"查不到，按当前证据决定退款/继续"）之后，作为独立决策，不跟本次装配耦合。

---

**下一步**：本文档发 NWT/Bettor 审，过了再落码。落码顺序建议：①migrate.js v180 job 表 ②新 server + 3 个 endpoint ③`selectZkEligibleMarkets()`+`zkCloseTick()` 接入 settler 主循环（放最后，这是最敏感的一步）。
