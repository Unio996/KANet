> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-batch9-92b-driver-core-v0` 头 `383583eb`：`9021a378` 指针修复 + `383583eb` ops；一轮、只报 MUST）

# 批 9 · 9-2b(iii-2) 审（指针修复 + 四步 builder 入参装配 ops）—— NWT：**GREEN，无 MUST**

亲跑：ops 6/0、pointers 27/0、c1 45/0、**golden 12/0（字节不变）**、assembly 44/0、chain-checks 51/0、claim-draw 57/0。

- **指针修复 `9021a378`（动了已合主线的 9-1 D 笔代码）**：读 diff——`convert_to_claim` 意图挂 claim 主体（intent 模块的 `STEP_SUBJECT_TYPE`），指针原来按 `('market', marketId)` 找永远找不到，改为先按 market 找赢 claim 行、再按 `('claim', claimId)` 找 landed 意图。修复方向正确，也解释了 9-1 夹具把 convert 插成 market 主体导致自测看不见（我 9-1 审时的同类盲区：夹具形状与真实生产者形状不一致）。
- **ops 与 builder 一致 / 入参来源**（读全文）：市场行显式列（不 `SELECT *`）、私钥只以信封字符串原样交给 builder（解密 / 签名 / free 在 builder 内）、DB 只读、不含 withdraw / reclaim；claim 步骤的 `marketId` 由 `marketIdOfClaim(claimId)` 取，市场步骤由 `subjectId`（= 市场 id）；`close_commit` 的 `newWinningSide` 取自 DB 行、`newPayoutRootHex` / `expectedPoolValue` 经 `assertCloseCommitArgsFromDb` 另一条派生路径复核；每个 fee 候选各自 `withFeeParent` 补一次 fee 项；`pmtEvidence` 只传给 `close_commit`。
- **我的 11 个 ops 变异**（与 J2 的 10 个不同，专挑钱相关参数，`outputs.txt`）：**8 被抓**——fee 面值下限、pmt 门 deadline、`newWinningSide` 取反、ticket direction、payout 金额、KanetTokenClaim 目标地址金额、fee 候选不补 fee 父项、私钥信封取错市场。

## 记后续票（非 MUST）
1. **存活 o1：`absFeeCapSompi` 放宽 100 倍无测试红**；**存活 o2：找零脚本 `relayChangeScriptPublicKeyHex` 写成错误脚本无测试红**。两个都是"传给 builder 的钱相关参数没有断言"（离线端到端的假 relay 不做 fee / 找零校验）。**不判 MUST 的依据**：relay 端 `validateNetLoss` 用硬编码 `GLOBAL_ABS_FEE_CAP_SOMPI`、不读命令字段（`covenant-broadcast-relay.mjs` 头注与 `:160-171`），是独立兜底，最坏损失有界（fee 输入的面值量级）。建议补两条断言：ops 传给 builder 的 `absFeeCapSompi === loadFeeProfileCap(kind)`、构造出的交易找零输出脚本 == relay 收款脚本。
2. 存活 o10（seal 的"已确认下注数 == seal_count"检查去掉）：C1 的 leaf spk 断言是第二层，属冗余保护，不要求补。
3. `probeRefundFlip` 未实现（J2 已记票）：无它时 `rootClose_*_drift` 走 `settlement_chain_fact_drift` 报警而不是 ambiguous 挂起，每 tick 会重报——有报警、不会静默，可接受。

## 没做
- J2 自报的变异 10/10 未重跑；**整条链的节点共识验收是 9-4 simnet**（离线端到端只证明"能构造、C1 / 指针 / 记账 / 出口 S9 自洽"，J2 已如实写明）。毒化 fee 向量在 9-4 的同一个 simnet 节点上加（内存门由 KANet-UI 读）。
