# 批9 9-2b (iii-2)：四步 builder 入参装配（ops）+ 整条链的离线端到端

> **Status**: CURRENT（设计 §5 / §6 / §8 / §11；分支 `coord/j2-batch9-92b-driver-core-v0`，基于 `9021a378`（指针 claim 主体修正））

- `lib/proto-settlement-ops.mjs`（新，只读 DB，不写任何表）：`prepare(step, {phase})`（target 地址 / 预期 spk / feeMinAmount / deadline / pointers）与 `build(step, ctx)`（seal / close_commit / convert_to_claim / claim_draw 四个真 builder 的全部入参装配；fee 逐候选真实构造 + 每个候选各补一次 `withFeeParent`；close_commit 走 `assertCloseCommitArgsFromDb` 闸；私钥只经信封交给 builder，驱动层不接触）。
- `lib/proto-settlement-ops.test.mjs`（新）：**离线端到端**——真 kaspa-wasm + 真编译 + 真 builder（genesis → append×2 → seal → close_commit → convert_to_claim → claim_draw）+ 真 store / 指针 / C1 / 意图状态机 / 核心，唯一假件 = 内存 UTXO 集 + 假 sendCmd（`check_utxo_landed` 要求该 txid 在【目标地址】上有输出才算 landed，所以 target 地址算错会让它永远不 landed）。断言：四步逐个真构造广播、intent_key 全过出口 S9、claim id 64 位 hex、每步 landed 后市场 / claim / 后续意图正确推进、终态 claim_txid/vout/claimed_at、终态后零动作、全程无 error 报警、私钥卫生扫描。
- `services/proto-settlement-driver.mjs`：仅注释文字更新（ops 已存在）。

测试末行：`test-last-line.txt`（ops 6/0，与 core 27 / store 14 / wiring 10 / pointers 27 / c1 45 / chain-checks 51 / assembly 44 / claim-draw 57 / IPC 33 全绿）；变异 `mutants=10 survivors=0`（`mutation-raw.txt`）；lint 见 `lint.txt`。

**这次离线端到端抓到的真缺陷（已单独提交 9021a378）**：9-1 指针模块按 `(market, marketId)` 找 convert_to_claim 意图，而该意图挂在 claim 主体下 ⇒ claim_draw 指针永远解析不出；9-1 夹具把 convert 意图插成 market 主体（生产里造不出的键）所以自测看不见。

**诚实边界 / 未做**：
1. 这证明"ops 装出的入参能让四个真 builder 构造成功、C1 / 指针 / 记账 / 出口全程自洽"；**不证明节点共识接受这些交易**、也不跑 relay 的固定面值 / 净亏 / 隐含手续费校验、不签 fee 输入（那是 relay 的事，9-4 simnet 真验）。
2. `probeRefundFlip` **没有实现**（RootClose.refund_flip 输出的 closed=2 state 字段我没有合约级依据，猜一个会造出错误的"没翻"结论）——核心对它是可选端口；缺它时 RootClose 被翻只会表现为 `rootClose_*_drift` 的 chain_fact_drift 报警（人工转），不会误判。记票。
3. `feeMinAmount` = 该步 fee profile 的 cap（保守：覆盖最坏 fee）；`inflightOutpoints` 恒为空（同一 tick 内单飞、且 fee 输入被上一笔在途花掉时 C1 会报 missing/drift）——都可在 9-4 观察后调。
4. 每 tick 重新 `import` ops（NWT 已记票）。
