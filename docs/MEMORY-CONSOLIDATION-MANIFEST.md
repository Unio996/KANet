# Memory → KB 整合 Manifest (D-004 · 清单先行·分族门控·防知识层规则49)

> **Status**: CURRENT (2026-07-06 建·Bettor)
> **为什么**: 264 个 `.claude/memory/*.md` 碎片(框架 <200 行索引早 truncate) → 按族合并回 KB durable 家(D-004)。
> **Owner 硬门(2026-07-06)**: 禁一把梭(=知识层规则49)。清单先行 + 分族门控(每族 STOP) + 旧址同轮盖章 + 合并 commit 与标废 commit 分开。
> **KB git 化前置**: ✅ DONE(baseline `19a4155`·后续 un-stale 可考古 diff)。

---

## 流程 DoD(每族一批·缺一不算完)

1. **列全族清单** → 每条标去向: `MERGE→KB/<path>` / `KEEP(session-fact 保留 memory)` / `DROP(弃置+理由)`。禁"合并后对不上账"。
2. **合并** → durable 内容进 KB 目标文件(commit A)。
3. **旧址同轮盖章** → memory 原文件 + docs/ 对应旧址挂 `> SUPERSEDED-BY: KB/<path> (date)`(commit B·与 A 分开)。
4. **索引更新** → MEMORY.md 移除已合并条(缩回 <200 行索引限)。
5. **STOP 报告** → 本批去向表 + commit hash + "方向 accept ≠ 免门控"显式确认 → Owner/下批放行。

**验收计数(疗效·7/8 retro)**: 本周"炒陈饭事件数"(引用已废决策/重开已决议题)。此数不降 = KB 白建。

---

## 族索引(分批顺序·264 条)

| 族 | 主题 | 数量* | 合并目标 KB 区 | 批次 |
|---|---|---|---|---|
| **A** | 结算/DB-lag/daemon/phantom/claim/bshard | ~70 | `architecture/` settle 专章 + `invariants/` | 批2-4 |
| **B** | silverscript/covenant/cov_id/SS 原语 | ~39 | `architecture/` SS-capabilities | 批5 |
| **C(ZK)** | ZK/oracle-settle/UMA | 11(ZK 子) | `architecture/zk-track-c-verified-trustless-settle.md` | **批1(本批)** |
| **D** | 协调/Bettor 角色/审核/派工 | ~30 | `roles/` + `infrastructure/01-dev-coord` | 批6 |
| **E** | Owner 纪律/口径/测试网/用户面 | ~24 | `00-position/` + `roles/` | 批7 |
| **F** | TN12/挖矿/节点/relay/console 运维 | ~38 | `infrastructure/` | 批8 |
*grep 有重叠·精确归属在各批清单定。全量 264 主列表见文末附录。

---

## 🔴 批1: ZK-settle 子族(11 条)去向表(待 Owner 确认流程后执行)

> 合并目标: `KB/architecture/zk-track-c-verified-trustless-settle.md`(已存)+ 新增"ZK↔rolling 决策史"章。**去向仅提案·STOP 待确认再动手。**

| # | memory 文件 | 提案去向 | 理由 |
|---|---|---|---|
| 1 | `reference-zk-vs-rolling-shard-full-history-2026-07-06.md` | **MERGE→KB zk-track(决策史章)** | 今天新建的权威史·durable·应进 KB(DECISIONS.md D-001 存精简版·KB 存详版) |
| 2 | `reference-zk-terminology-three-tiers-conflated-in-docs.md` | **MERGE→KB zk-track(术语正名章)** | "ZK 标签三层混用"=今晚混乱源·durable 正名 |
| 3 | `reference-zk-decision-gate-closed-rolling.md` | **MERGE→KB zk-track(决策史章)** | ZK→rolling 决策门·durable |
| 4 | `project-zk-settle-e2e-core-proven-binding-blocked-oppick.md` | **MERGE→KB zk-track(blocker 章)** | OP_PICK blocker 技术实相·durable(J2 ZK 可行性核实要用) |
| 5 | `project-zk-settle-payout-toolchain-proven-design-locked.md` | **MERGE→KB zk-track(design-locked 章)** | ZK 地基设计·durable |
| 6 | `project-zk-interim-b-full-e2e-landed-pb73v.md` | **MERGE→KB zk-track(单片 LANDED 章)** | 单片 ZK e2e 实证·durable |
| 7 | `project-multishard-zk-settle-assembled-gp8hy.md` | **MERGE→KB zk-track(多片=committee-sig 章)** | 多片"ZK"实为 committee-sig 正名·durable |
| 8 | `project-phaseA-landed-and-zk-active-tn12.md` | **MERGE→KB zk-track(链上 active 章)** | OpZkPrecompile active·durable |
| 9 | `reference-zk-toolchain-fork-has-verifier-not-builder-port-953-sdk.md` | **MERGE→KB zk-track(工具链缺口章)** | verifier 有/builder 无·J2 可行性核实要用·durable |
| 10 | `feedback-owner-directed-zk-heed-architecture-over-tactical-debug.md` | **KEEP(feedback)** | 是 feedback 纪律(听架构方向)·非 ZK 技术事实·留 memory |
| 11 | `project-bot-ux-oneclick-landed-b-zk-fresh-ready.md` | **KEEP(session-fact)** | 名含 zk 但实为 bot UX 里程碑·非 ZK 技术·留 memory |

**批1 净效果**: 9 条 ZK 技术知识 → KB zk-track(单一 durable 家) + 2 条留 memory(feedback/session-fact)。合并后 KB zk-track = ZK 完整真相(史+术语+blocker+单片证+多片正名),彻底 resolve"ZK 在跑吗"这盘·配 DECISIONS.md D-001。

---

## STOP 点(批1·"方向 accept ≠ 免门控")

**待 Owner/团队确认**:① 上表去向流程对不对 ② 每族一 STOP、合并/标废 commit 分开 ③ 旧址同轮盖章。确认后我执行批1(合并→KB + 旧址盖章 + 索引更新),报 commit hash,再放批2。

---

## 📊 批1 执行记录(2026-07-06·Owner 放行)

### 计数 reconcile(条件一·265→264→265 对账·零丢失)
- **"265"(早期口径·D-003/004 讨论)** = 264 记忆条 + 1 `MEMORY.md`(索引本身非记忆条)。含索引 265·计数习惯差。
- **"264"(manifest 快照 `/tmp/_mem_all.txt`)** = 纯记忆条(不含索引)。
- **"265"(现在·纯记忆条)** = 快照后 **+1 新建**: `feedback-verify-background-process-exit-not-just-output.md`(J2 孤儿脚本教训·会话中活生生新增 = 增殖问题实证)。
- **三数钉死**: 含索引 266 / 纯记忆条 265 / manifest 快照时 264。**零静默丢失**·差异全有据。新条纳批2 族归属(候选族 F 运维/进程卫生)。

### 批1 双 commit(合并/标废分开·DoD)
- **commit A(合并·KB repo)**: `82adacb` — KB `architecture/zk-track-c` §9 un-stale(9.1 时间线/9.2 术语三层正名/9.3 待办)。
- **commit B(标废·主 repo)**: 见本次提交 — 9 MERGE memory 挂 `SUPERSEDED-BY→KB §9`(旧址同轮盖章) + manifest 批1 记录。
- **KEEP 2 条**未动(feedback-owner-directed-zk / bot-ux-oneclick·非 ZK 技术)。
- **防重述丢细节(Owner 提醒)**: §9 保留坐标(pb73v/gp8hy 市场码·OP_PICK bug 名·6/28-7/06 日期·13 轮 bisect·955=442+64+449·commit 82adacb),非概括化。

## 🔴 批2 开闸前置(Owner 条件二)
**全量 265 条族归属分配表**(每条至少一个族名·防落族缝静默丢失)**必须批2 前落地**。per-item disposition 仍按批做·但族归属先全锁。下一动作 = 出这张全量族归属表。

## 全量主列表附录
- 快照 264 条: `/tmp/_mem_all.txt`(临时)→ **族归属表落地时固化进本文附录**(批2 前置)。

---

## 全量族归属表(as-of 2026-07-06·265 纯记忆条·每条单一族·D-004 批2 前置)
> **as-of 锚**: 本表快照 265 条。此后新建 memory 进【delta 区】(下方)·每批 STOP 报告附 delta reconcile(固化 265→264→265 那次做法)。

### 族C · ZK (11 条)
- feedback-owner-directed-zk-heed-architecture-over-tactical-debug.md
- project-bot-ux-oneclick-landed-b-zk-fresh-ready.md
- project-multishard-zk-settle-assembled-gp8hy.md
- project-phaseA-landed-and-zk-active-tn12.md
- project-zk-interim-b-full-e2e-landed-pb73v.md
- project-zk-settle-e2e-core-proven-binding-blocked-oppick.md
- project-zk-settle-payout-toolchain-proven-design-locked.md
- reference-zk-decision-gate-closed-rolling.md
- reference-zk-terminology-three-tiers-conflated-in-docs.md
- reference-zk-toolchain-fork-has-verifier-not-builder-port-953-sdk.md
- reference-zk-vs-rolling-shard-full-history-2026-07-06.md

### 族B · SS/covenant (19 条)
- feedback-coverify-wasm-field-paths-must-live-test.md
- feedback-pszh-multiinput-falsestack-attribution.md
- feedback-silverc-build-must-be-pinned-cross-node.md
- feedback-ss-attack-review-verify-value-source.md
- feedback-ss-covenant-newstates-partial-field-forge-gap.md
- feedback-ss-ctor-param-change-equals-address-migration.md
- feedback-ss-entry-reorder-breaks-handler-selector.md
- project-covid-genesis-mechanism-vendored-wasm-blocker.md
- project-kip20-covenant-lineage-r7-rootfix.md
- project-num2bin-fix-compile-cache-next-steps.md
- reference-9999-is-free-tier-compute-budget.md
- reference-covenant-cov_id-genesis-mechanism.md
- reference-covenant-wasm-breaks-selffull-broadcast.md
- reference-silverc-byte32-no-ordering-comparison.md
- reference-silverc-oppick-offbyone-codegen-bug.md
- reference-silverscript-real-capabilities.md
- reference-silverscript-txtime-ms-lockfile-threshold.md
- reference-trust-essence-covenant-real-verdict-not-decentralized.md
- reference-verify-covenant-multiout-distribution-via-outputs-json.md

### 族A · 结算/oracle (86 条)
- feedback-custodial-tg-wallet-balance-encryption-warn.md
- feedback-daemon-liveness-vs-deploy-freshness.md
- feedback-pool-market-status-cancel-breaks-settler-refund.md
- feedback-recreatable-utxo-nullifier-defeatable.md
- feedback-scope-proven-landed-claims-precisely.md
- feedback-sil-changes-must-live-settle-test-node-acceptance.md
- feedback-verify-own-channel-send-landed-not-narrate.md
- feedback-verify-production-callpath-before-claiming-codebug.md
- project-31-settle-chunk-amount-binding-converged.md
- project-autobet-v06-to-v07-commingle-cure.md
- project-b-bot-v07-routing-landed.md
- project-b-infinite-betting-prep-confirm-landed.md
- project-broker-dm-dual-surface-seeder-supply.md
- project-broker-fee-crossnode-settle-breaker.md
- project-bshard-3axis-trueinfinite-1000-achieved.md
- project-bshard-A-fulllifecycle-stage1-closed.md
- project-bshard-D4-relay-gate-wiring.md
- project-bshard-aggregation-pivot-committee-sig.md
- project-bshard-enforce-driver-side-not-production-trustless-two-track.md
- project-bshard-enforce-driverside-testonly-gap.md
- project-bshard-infinite-betting-redemonstrated-post-afix-fy1yk.md
- project-bshard-m3-deploy-determinism-orchestration-gap.md
- project-bshard-menmen-cltv-settle-enforce-closed.md
- project-bshard-multishard-fold-fundamental-size-wall.md
- project-bshard-phaseA-autonomous-close-landed-ozzeu.md
- project-bshard-production-register-settle-wiring.md
- project-bshard-production-shape-018df29b-deploy-trackAB-closed.md
- project-bshard-register-size-solved-convert-split.md
- project-bshard-settler-0bet-misread-and-settle-evidence-reconcile.md
- project-bshard-trackB-2462l-ticketless-needs-real-register.md
- project-bshard-trackB-daemon-not-wired-e1.md
- project-bshard-unlimited-betting-impl.md
- project-cross-node-settle-pipeline-debug.md
- project-custodial-bet-shared-address-concurrent-spend-28.md
- project-d7-4of5-funded-settle-chain-verified.md
- project-dod1-samenode-settle-chain-verified.md
- project-dod14b-crossnode-committee-settle-chain-verified.md
- project-e2e-scaled-batch-oracle-correctness.md
- project-espn-demo-settle-loop-green.md
- project-espn-e2e-mechanism-proven-da4984ca.md
- project-fee-on-total-first-chain-settle-qr733.md
- project-first-realsource-crossnode-oracle-settle.md
- project-fullchain-crossnode-settle-chunk-ttl.md
- project-i18n-step1-landed.md
- project-i18n-step2-landed.md
- project-jepu1-settle-sighash-bug-finding.md
- project-lane1-oracle-maker-reward-recording.md
- project-lineE-espn-accuracy-N35-format-bug.md
- project-lv3rz-first-full-public-settlement-442-proven.md
- project-lv3rz-first-real-settlement-completed.md
- project-lv3rz-full-recovery-block-scan-methodology.md
- project-oracle-capability-staged-expansion-vision.md
- project-oracle-capability-staged-uma-backbone.md
- project-oracle-committee-liveness-apath-settle.md
- project-oracle-consensus-launders-poison-rulings.md
- project-oracle-core-live-judgeline-verdict.md
- project-oracle-derivevote-hash-not-question-P0.md
- project-oracle-expansion-next-priority-after-bshard.md
- project-oracle-hardening-4gate-consensus-nwt-design.md
- project-oracle-hardening-wave1-fourgate.md
- project-oracle-uma-mirror-supply-northstar.md
- project-oracle-yes-bias-p0-line-e.md
- project-q2-oracle-liveness-refund-rootcause.md
- project-q2-oracle-liveness-timing-settle-verified.md
- project-qi37q-interim-b-settled.md
- project-seeder-q2-canary-plan-banked.md
- project-settle-daemon-deployed-canary-green.md
- project-settler-daemon-platti-design-and-stale-grep-tooling.md
- project-task13-oracle-renewal-cron-landed.md
- project-tg-custodial-wallet-shipped-onchain-verified.md
- project-tg-custodial-wallet-shipped-smoke-green.md
- project-uma-polymarket-e2e-proven.md
- project-uma-rule-learning-oracle-textbook.md
- project-uma-wire-connected-polymarket-autosettle.md
- project-v07-bshard-economic-layer-not-implemented.md
- project-v07-cross-node-settle-stack-2026-06-09.md
- project-value-split-fee-live-settle-x4kpq.md
- project-w1-dod5-telegram-bot-autonomous-oracle-settle.md
- reference-bshard-settle-db-lag-vs-chain-tip-recovery.md
- reference-bshard-shard-capacity-desync-bug.md
- reference-chain-verify-via-relay-check-utxo-landed.md
- reference-consolidate-utxo-880-fix-outputs-empty-noop.md
- reference-landed-shallow-confirm-reorg-phantom-leaf.md
- reference-polymarket-realtime-mirror-component.md
- reference-refund-verify-chain-not-db-claim-field.md
- reference-relay-utxo-topology-faucet-mega-consolidate.md

### 族F · 运维 (34 条)
- cross-node-testing-critical-j1-separate-node.md
- feedback-commit-staged-and-deployed-not-committed.md
- feedback-cross-node-whole-repo-sync-not-cherry-pick.md
- feedback-monitor-tool-not-bash-background.md
- feedback-no-uncommitted-revert-in-shared-tree.md
- feedback-owner-design-rules-tn12.md
- feedback-relay-blindsign-taxonomy-key-auth-vs-condition-endorse.md
- feedback-shared-git-identity-worktree-thrash.md
- feedback-shared-tree-check-latest-alignment-before-adapting.md
- feedback-ship-triplet-commit-push-deploy.md
- feedback-verify-source-relay-not-display-name-multiagent.md
- kanet-tn12-runtime-facts.md
- project-8000-llama-scale-ceiling-and-levers.md
- project-cross-node-3-e2e.md
- project-crossnode-committee-liveness-blocker.md
- project-crossnode-cosmetic-committee-chain-derive-fix.md
- project-d4-relay-gate-design-converged.md
- project-p1-getblockatdaa-forward-deploy.md
- project-tg-bot-console-managed-single-owner.md
- reference-console-restart-stale-pidfile-orphan-trap.md
- reference-deploy-error-to-root-diagnostic-tells.md
- reference-kaspad-submit-blackhole-restart.md
- reference-kaspad-two-node-setup-ports.md
- reference-llama-console-startup-topology.md
- reference-nwt-tn-relay-id-and-send.md
- reference-relay-kaspad-url-in-db-not-env.md
- reference-relay-ws-connection-leak-storm.md
- reference-tg-bot-deploy-dir-gitignored-worktree-source-restart.md
- reference-tn10-internalcpu-mining-method.md
- reference-tn10-mining-rtx5090-stratum-difficulty-floor.md
- reference-tn10-toccata-ahead-of-network.md
- reference-tn12-mining-external-bridge-faucet-supply.md
- reference-tn12-node-mining-outage-recovery.md
- tn12-console-restart-procedure.md

### 族D · 协调/验证 (41 条)
- feedback-actually-send-to-channel-not-narrate.md
- feedback-ask-bettor-in-channel-not-bottleneck-user.md
- feedback-autonomous-decide-when-consensus-and-docs-align.md
- feedback-bettor-core-mission-four-pillars.md
- feedback-bettor-must-actively-drive-not-passively-wait.md
- feedback-bettor-never-touch-code-always-delegate.md
- feedback-bettor-role-design-coord-supervise-review-to-nwt.md
- feedback-bettor-too-chatty-less-coordination-noise.md
- feedback-broadcast-at-specific-names-not-team.md
- feedback-broadcast-fulltext-discipline.md
- feedback-broadcast-three-elements.md
- feedback-coordinator-poll-tight-be-responsive.md
- feedback-coordinator-stay-on-owner-mainline-not-test-grind.md
- feedback-coverify-checklist-multidimensional.md
- feedback-design-must-be-nailed-down-not-just-documented.md
- feedback-dm-ui-layout-frozen-review-gate.md
- feedback-escalation-check-local-mitigation-first.md
- feedback-internal-test-not-external-usage-and-check-existing-design.md
- feedback-mainline-design-review-before-any-action.md
- feedback-major-decisions-require-consensus-not-unilateral.md
- feedback-multiagent-shared-git-index-race-use-pathspec-commit.md
- feedback-no-db-hack-understand-design-first.md
- feedback-offchain-verify-not-onchain-feasible.md
- feedback-question-scope-before-deep-verification.md
- feedback-read-knowledge-base-before-design.md
- feedback-review-must-check-scope-inheritance-not-just-implementation.md
- feedback-review-removed-var-grep-whole-file-not-just-diff.md
- feedback-route-questions-to-bettor-not-user.md
- feedback-testnet-spend-bettor-decides-coin-plentiful.md
- feedback-verify-aggregate-before-escalating-from-single-log-line.md
- feedback-verify-artifact-provenance-before-inference.md
- feedback-verify-background-process-exit-not-just-output.md
- feedback-verify-full-data-chain-before-diagnosing.md
- feedback-verify-object-identity-before-approving-change.md
- feedback-verify-running-product-not-just-code-never-declare-done-on-grep.md
- feedback-verify-value-source-checker-must-access-binding-at-decision-time.md
- project-broadcast-880-wall-deepdive.md
- project-fee-model-adversarial-hardened-design.md
- project-owner-in-dev-channel-shipped.md
- reference-channel-read-for-catchup.md
- reference-dev-channel-firewall-config.md

### 族E · 纪律/口径/catchall (74 条)
- drive-cross-agent-debug-to-closure.md
- feedback-actively-chase-never-wait-for-reports.md
- feedback-big-1x-bytecode-separate-from-Nx-continuation.md
- feedback-check-memory-before-raising-new-direction-concern.md
- feedback-check-toolchain-primitives-before-workaround.md
- feedback-clamp-repeat-offender-at-pattern-level.md
- feedback-demand-reply-on-every-assignment.md
- feedback-doc-owner-adversarial-discipline.md
- feedback-dont-guess-display-bugs-check-code-data-chain.md
- feedback-dont-overcomplicate-obvious-fixes.md
- feedback-dont-relitigate-either-way-choices.md
- feedback-external-redteam-catches-homogeneous-blindspots.md
- feedback-failure-invariant-and-threshold-path-distinct.md
- feedback-fix-break-cycle-is-incomplete-migration-solve-with-mechanism.md
- feedback-fixture-must-mirror-production-inputs.md
- feedback-guan2-test-behavior-not-rendering.md
- feedback-lock-goal-no-drift-do-the-core.md
- feedback-measure-system-works-not-money.md
- feedback-milestone-not-finish-line.md
- feedback-never-menu-owner-not-at-terminal.md
- feedback-offline-test-must-use-real-schema-with-triggers.md
- feedback-one-tool-call-per-message.md
- feedback-own-slice-failure-mode-hypothesize-first.md
- feedback-owner-unify-latest-delete-old-modularize.md
- feedback-owner-wants-chinese-responses.md
- feedback-owner-wants-simple-direct-communication.md
- feedback-pool-honestcount-null-trap-pattern.md
- feedback-quantitative-task-ramp-not-direct.md
- feedback-question-premise-which-input-fails.md
- feedback-read-actual-code-not-assumed-canonical.md
- feedback-report-automation-progress-not-completion.md
- feedback-respect-hard-process-even-under-owner-p0.md
- feedback-scratch-scripts-to-scratch-dir-not-repo-root.md
- feedback-sompi-conversion-display-layer-not-signed-payload.md
- feedback-spend-units-must-be-probed-not-modeled.md
- feedback-sqlite-timestamp-format-mismatch-string-compare.md
- feedback-static-creation-field-not-current-chain-state.md
- feedback-test-with-throwaway-not-functional-entities.md
- feedback-testnet-no-legal-overcaution-content.md
- feedback-tool-call-must-be-real-invocation-not-text.md
- feedback-track-and-followup-own-work.md
- feedback-trial-ramp-must-validate-end-to-end.md
- feedback-user-copy-no-impl-jargon.md
- project-105-llm-herd-root-and-fix.md
- project-25-minpot-not-4of5-bug.md
- project-batch22-27a-forward-break-28-bond-verified.md
- project-binary-decomposition-charter.md
- project-broker-onboarding-skeleton-address-keyed.md
- project-broker-phase1-markets-tool-identity-blocker.md
- project-cascade-dod-achieved-fullstitch.md
- project-d12-natural-silent-forfeit-fee-fix.md
- project-data-three-role-actual-value-pattern.md
- project-dm-fsm-dual-path-pool-rewire.md
- project-dm-to-chain-fullauto-demo-closed-q2.md
- project-economic-split-real-northstar.md
- project-endpoint-testnet-public-not-mainnet.md
- project-external-agent-onboarding-recon.md
- project-fee-enforcement-v1-committee-v2-contract-introspection.md
- project-fee-model-spec-j2-implements.md
- project-gateC-d1-griefing-residuals.md
- project-interim-b-qi37q-reproducible-e2e-and-close-drive-playbook.md
- project-longpole-A-signature-run-complete.md
- project-midterm-automated-ops-test-pipeline.md
- project-northstar-pivot-economic-ui-scaffolding-frame.md
- project-p0-2-variable-stake-spec.md
- project-prediction-mechanism-loop-chain-verified.md
- project-public-testnet-dod-northstar.md
- project-public-testnet-launched-20260705.md
- project-shadow-accuracy-harness.md
- project-trackB-trust-minimized-not-trustless-twolayer.md
- project-two-layer-trust-model-prediction-market.md
- reference-sqlite-iso-timestamp-string-compare-trap.md
- reference-tg-bot-false-alive-diagnosis.md
- user-kanet-ui-tn-operator.md

## delta 区(as-of 之后新建·每批 STOP 附 reconcile)
- (空·as-of 快照即当前)
