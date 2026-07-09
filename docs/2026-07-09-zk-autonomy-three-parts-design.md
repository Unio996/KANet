# ZK 自治化三件（landed-gated 持久化 / zk_close 自治 tick / claim 自治 tick）

> **Status**: DRAFT（Bettor 派工 #dfjcy6·待 Bettor+NWT 审·落码前不开任何开关）
> 依据：Owner 2026-07-09"部署 ZK 不等拍窗"钦定（D-001 增补）执行序 ③"zk_close 自治化（ZK_CLOSE_TICK=ON）"。前置：正式场市场5（tyr91，104.5KAS）三门全绿 claim landed，全程门①②③由 J2 手动驱动+每步 Bettor/NWT 盲算比对+确认令。本方案把这套人工把关翻译成机器把关，**不是简单去掉确认令**。

## 0. 今天人工把关 → 机器等价物（NWT #df... 明确要求的映射表，缺一不可）

| 今天靠人工挡住的点 | 谁在挡 | 机器等价替代（本方案要落的） |
|---|---|---|
| 门①/②/③ genesis/continuation 地址预期值 | Bettor 独立 ctor 路盲算 + NWT 独立 splice 复算，两路吻合才 GO | ①中新增：广播前自动跑一次独立 splice 重算，与 relay 返回的 `closeZkAddress` 断言相等，不等 throw 不广播（把"人盲算"降级为"人审计"，不是人把关的唯一防线） |
| mismatch hard-stop（P2 driver 撞过：relay 算的 continuation != 本地预览） | driver 脚本人工加的 assert | ①统一收进 `advanceZkContinuationAfterSpend` 调用前的强制 spk 原像断言（已有，今天两次真撞上救了场），自治 tick 必须复用同一断言函数，不允许自己重新手搓一遍 |
| Σleaf 守恒 / betsRoot 独立重算 | `enqueueZkProveJob` 内置校验（今天全程生效，未依赖人工） | 已是机器把关，本方案不用新增 |
| debugger 正则误判（今早 R-FAIL-regex bug） | 人工读 stdout 原文判断"实际 PASS" | 排非本方案范围（独立小卡，见 P4 收口时的 note），但**自治 tick 必须直接用 `gateZkClose` 返回的 `result.pass`（会继承这个 bug）**——**BLOCKING 前置**：自治 tick 上线前必须先修 `runCliDebugger` 正则，否则自治 tick 会在真实 PASS 时误判 fail 而拒绝推进（比今天更糟：今天是人读 stdout 兜底，tick 里没有人） |
| 委员独立复算 payoutRoot（P4 第四侧） | `enforceCloseAttestV2` 已经是链上机器把关（committee 签名阶段） | 已是机器把关，P4 今天刚补完，本方案复用 |
| propose winning_direction 判定 | 我读 `chain_get_block_at_daa` 手算奇偶后传参 | 现有 `bshard-settle-daemon.mjs judgeWinDir`（blockhash_parity 分支）已有同款逻辑，`_enforceCloseAttestCore` 委员侧也有独立判定——propose 侧目前**没有**自治触发，是本方案 (b) 要补的空 |

## 1. (a) landed-gated 持久化修复（BLOCKING 前置，(b)(c) 都依赖它）

**现状**：`buildZkHandoffRequestV2`（transport.mjs:505-511，门①）和 `dispatchUnlockZkClose`（zk-close-dispatch.mjs，门②）都是拿到 relay 广播 ack（`result.txId`）就直接调 `writeZkContinuation`/**完全不持久化**（门②这次更彻底，dispatchUnlockZkClose 干脆不写 DB，靠我手动调 `advanceZkContinuationAfterSpend` 补——今天 5R-2 和正式场两次money-entry 都撞上，全靠人工发现+手动修复）。

**修法**：两处统一改成 landed-gated（同 P2 escape driver 已验证的纪律）：
1. 广播后不立即持久化，改为 `check_utxo_landed`（minDepth=20）确认 + 链上实 UTXO 的 `scriptPubKey` 反推地址 == 本地 splice 推导地址（spk 原像断言，今天两次真救场的那道检查）双过，才调 `writeZkContinuation`/`advanceZkContinuationAfterSpend`。
2. 门②目前压根不调持久化函数——补上调用（用 `advanceZkContinuationAfterSpend`，`spentEntry: 'zk_close'`）。
3. 两处失败路径必须显式记录（`events` 表 + 频道级别 alert 挂钩，非本方案新造——复用 `bshard-settle-daemon.mjs` 已有的 `_writeZkCloseTickErrorEvent` 模式），不能像今天一样"広播成功但没人发现没持久化"全靠人工盯屏幕。

## 2. (b) ZK_CLOSE_TICK 自治化

**现状纠偏（诚实评估，非乐观估计）**：`bshard-settle-daemon.mjs` 里的 `_zkCloseCtx`（2026-07-06 写的，`ZK_CLOSE_TICK_ENABLED` 开关挂在它上面）是**过时骨架**，跟今天的真实实现有三处实质脱节，**不能只是把开关从 0 改成 1**：
1. `checkLanded` 用 `kaspa_tx_log` 表查——已知 indexer 完整性缺口（memory `reference-kaspa-tx-log-indexer-completeness-gap`），今天所有 driver 全部改用直连 RPC `getUtxosByAddresses`，这个 tick 骨架没跟上。
2. `reconcile` 不调用任何 `zk_continuation` 持久化函数，只写一个平行的 `zk_settle_evidence` 字段——上线会导致 tick 广播成功但 `zk_continuation.outpoint` 停留在旧值，下一步（claim）读到错的活 UTXO，直接卡死。
3. `scanReadyZkMarkets` 依赖 `protocol_status='zk_ready'` 这个手动标记——今天正式场市场5走的是普通 create→register→attest 流程，从未被打上这个标记，这条 tick 扫描规则今天全程扫不到 tyr91（也就是说，即便开关是 ON，今天这个市场也不会被它捡到）。

**方案**：不修补旧骨架，按今天真实驱动逻辑重写 `zkCloseTickV2`（新函数名，避免跟旧的语义混淆）：
- 扫描条件：`zk_continuation.proving.status='ready'`（今天真实用的判据，`gateZkClose`/`dispatchUnlockZkClose` 已经在读这个字段）且 `zk_continuation.exhausted` 不为 true。
- `checkLanded`：直连 RPC，同 (a)。
- 广播：`dispatchUnlockZkClose`（已是今天验证过的生产函数，零改动）。
- 落地判定 + 持久化：走 (a) 修好的 landed-gated 路径。
- **BLOCKING 前置（表格里标了）**：`gateZkClose`/debugger 正则 bug 必须先修，否则自治 tick 会在链上真的能过的场景里，因为工具误判直接跳过广播（fail-closed 本身没错，但今天靠人读 stdout 兜底纠正，tick 没有人）。

## 3. (c) claim 自治 tick（全新，今天不存在）

**现状**：门③ claim 全程由 J2 手写 driver 脚本手动为每个 winner/fee-recipient 逐个广播——没有任何自治扫描/触发机制。

**方案**：新 `claimAutonomousTick`：
- 扫描：`zk_continuation.proving.status='ready'` 且 `zk_continuation.redeemHex` 现读 `closed==2`（`parseCloseZkV2State`，已有）。
- 每个市场：`computePariMutuelPayout` 重算 `payoutLeaves`（单源，P4 已验证），逐个 leaf 检查对应 nullifier bit 是否已置位（未领的才广播）。
- 复用今天的 `buildClaimWitness`/`buildClaimCommand`（零改动，今天全程验证过）。
- 落地判定 + 持久化：走 (a)。
- **权限边界**：只领已经在 payoutLeaves 里的 leaf（pk 由委员共识的 bettors 集合派生，非 tick 自己决定谁该拿钱）——不新增任何"谁该收钱"的判断逻辑，纯执行层。

## 4. 排序 + 验收

序：(a) 先修（阻塞 b/c）→ debugger 正则 bug 修（阻塞 b/c 的 BLOCKING 前置）→ (b)(c) 可并行落码 → 每个开关默认 OFF，offline test 全绿 + 至少一次真实市场手动触发验证等价机器把关生效，才允许 Bettor/NWT 双签开 ON。
验收：offline test 覆盖表格中每一行"机器等价物"的存在性断言（不是只测试 happy path）；开 ON 后第一个真实市场，J2 仍手动逐步核对（不因为自治就停止链验），确认自治产出与手动驱动历史数据一致。
