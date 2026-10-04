# J2 → Bettor · 段4 DONE：claim / refund_claim / escape_claim 代币化 + zk-prove-worker 主网阻断三防线（账本 1832 段4）
分支 `coord/j2-pm-settle-tokenize-20261004`，仅新增 commit（无 amend/rebase），未部署、未改环境、未碰主网（4752/3436 未动）。simnet 官方 kaspad 2.0.1 真共识。

## 1. 复用了什么 / 为何其余不能复用（第一原则）
- 复用：段3 的 v1.0.0 形+CovenantBinding+genesis 组机制、`bshard_genesis_mint_*` 生产 relay 命令、`closezk_v2_claim/escape_claim` 既有 relay 命令名与 dispatch、既有 `advanceZkContinuationAfterSpend`、既有 `reclaimBshardMakerBond` / `pool_refund_maker_unjoined_tx`、既有 `ensureGateTmplHashFresh`。
- 新增只在旧形无法表达处：旧 claim 构造器是未代币化的 KAS 形；新增 `_unlockClaimFamily`（三入口同形，一处实现）、`zk-token-claim-orchestrator.mjs`（A 探 selfCovId → 探池代币 → B 探 claimCovId → C 签发，因 tokOut 的 owner=新 claim 的 covenant id 只能先 probe 后建）、`computeKanetTokenClaimArtifact`。

## 2. 交付（commit：e5f1a572, 93123c9f, d9f420e9, 3eebcfe4 + 本报告提交）
1. relay：`unlockCloseZkV2Claim / EscapeClaim / EscapeTrigger / BshardRefundClaimV2` 全代币化（自续用 own_redeem_len 手写 AB11 状态拼接），新命令 `bshard_refund_claim_v2`。
2. console：`_claimOneMarket` 走 `runTokenClaim`；`settleDispatchTags()` 扩到 9 入口；rehearsal 门按当前合约重写（`gateTokenClaim`、zk_close 28 参 ctor）。
3. 段4 项4（主网阻断，账本 1835）：`zk-prove-guards.mjs` + worker 接线——
   - 出证前读 WSL MemAvailable，低于 `ZK_PROVE_MIN_FREE_MB`（默认 6144）则推迟（不 fail）；读不到 ⇒ fail-closed 推迟；
   - 出证失败自动重试：上限 `ZK_PROVE_MAX_ATTEMPTS`=3，指数退避 `ZK_PROVE_BACKOFF_BASE_SEC`=120s（封顶 1800s），超限才 failed；校验类/注资类失败不重试（会重复花钱）；
   - 预编译：默认跑 `target/release/host` 二进制，缺失/比源码旧则拒绝并提示；`scripts/zk-precompile-host.sh` 一次性预编译；`ZK_PROVE_HOST_MODE=cargo` 才走旧路径（仅开发机）；
   - memwatch 阈值 = 配置（worker 的 env 项；WSL 侧 watchdog 脚本阈值仍是 1200MB 硬编码的 seg3 provenance 脚本，不入库产品代码——主网需另行配置化，见 §6）。
   - **schema 变更**：迁移 v220，`zk_prove_jobs` 加 `attempts` / `next_attempt_at`（纯新增可空/有默认），`docs/DATABASE.md` 已同步。
4. `zk-close-dispatch.test` 漂移已修（`_markVerifiedForTest`）；dispatch-tag 测试扩 9 入口。

## 3. simnet 真共识证据（`docs/provenance/2026-10-04-j2-settle-tokenize-seg4/`）
- **全自治 e2e**（`seg4_e2e_autonomous_ticks.log.txt`）：开 tick 全链，建盘→下注→judge 提案→close_attest→handoff→真 Groth16 出证→zk_close 落链→**claim tick 自动领 idx0（partial）与 idx1（last）两笔上链**，全程无人手。注意：这是 simnet 里用 env 打开的 tick，不是主网 cron。
- claim partial/full、refund_claim、escape_trigger（早于 6h 的负向 + 诚实）、escape_claim 诚实 tx；负向 NA（金额篡改）/NB（代币 owner 错）/NC（自续篡改，harness 重签 fee 输入）各带 cli-debugger 行（`dbg_*.out.txt`）。
- **证据等级须如实**：① refund/escape 的起点是 harness 合成状态（用生产 `bshard_genesis_mint_payout`/`stake_chip` 命令铸 PS closed=2/closed=1 且 attestedAtMs=now−7h，因 simnet 等不了 6h）——合约与 builder 是真的，起点状态是造的；② 双领（ND）= relay 预检 + VM 级 debugger，**不是**共识级；③ V2 cancel_attest 流无自治路径，未覆盖。
- **维护者退出（项3）**：`reclaimBshardMakerBond` 生产编排对该盘 dryRun 回 `容器②证据未通过`（该盘 bettor 侧无 container② 证据，门按设计拒——该编排只对已走完 bettor 退款的盘有意义，本盘不适用，未能用它跑通）。合约路径 `PoolSpine_v07.refund_maker_unjoined`（deadline+7200s 后）经生产命令 `pool_refund_maker_unjoined_tx` 真共识：4 个负向（过早 lock_time=`Unsatisfied lock time`；输出给非 maker；费<MIN_FEE；费>MAX_FEE=`script ran, but verification failed`）全拒，诚实 tx `7e96294b…3d88` 过，spine UTXO 清空、maker 收 12999000000 sompi。run1/run2 日志保留作过程证据：run1 用墙钟+330s 判到点——**节点 tx.time 按 pastMedianTime，落后墙钟约 6 分钟**，全部"input not finalized"，负向无信息，作废；run2 费 100000 低于节点最低中继费（100 sompi/克×mass 4742=474200）被拒；run3 改费 1,000,000 通过。**含义**：合约 MIN_FEE=50000 低于主网中继下限，诚实路径的费必须按 mass 估，不能取合约下限（本仓既有 `computeMassAwareV07RefundFee` 应是做这件事的，我直接发命令没走它）。

## 4. 发现与须披露
- **我在段3 引入过回归**：`gateZkClose` 里一处注释吞掉了 `gateUtxoValueSompi, gateScriptHex` 两个参数；本段已修（93123c9f）并有测试覆盖。
- **KIP-9 存储质量**：5 个 0.2 KAS 新建输出被节点拒（mass 659134 > 500000）。现新建输出取 1 KAS（`ZK_CLAIM_OUT_VALUE_SOMPI` 可配）、fee 输入≈3.5 KAS、网络费 40M。**主网经济含义**：每次 claim 需 ≈3.5 KAS 的 fee 输入周转，输出面值是锁定成本，不是消耗；值得在主网费用预算里列项。
- 本段没有改动 covenant 合约本身（只改 builder/编排/门）。

## 5. 测试
lint 0 error；单测全绿：zk-prove-guards（含真 DB 的重试状态机）、zk-token-claim-orchestrator、own-redeem-len、pool-shard-settle-tokenized、bshard-close-enforce-v2-tokenized、zk-judge-propose-median-lag、propose-predicate-commit-anchor、committee-offset-derive、payoutshardv2-offset-tripwire、closezk-v2-*、zk-close-dispatch、fee-single-source、rehearsal 门 selftest 两个。

## 6. 余项（未做，老实列）
- refund 的门（`gateTokenClaim` 目前只覆盖 claim/escape 面）与 ticks 对 refund/escape 的自治调度未接线；
- WSL 侧 memwatch watchdog（1200MB 杀）是 provenance 里的脚本，主网需把它配置化并与 worker 的 6GB 推迟阈值并存（二者防不同事：推迟防开跑，watchdog 防宿主 OOM）；
- 预编译在 simnet 用的是 pm_e2e 工作树里已有的 host 二进制；主网需在部署时跑 `scripts/zk-precompile-host.sh` 并留 sha256；
- 本段 harness 对 `kasia-relay/src/lib/api.mjs` 的本地 patch 不入库（收尾 checkout 还原）。
