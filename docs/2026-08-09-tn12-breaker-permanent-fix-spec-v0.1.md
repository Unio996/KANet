> **Status**: ROUTING/SPEC v0.1 · Bettor 合成(承 Codex bridge 复审 9bc6abb0 + J1 事故报告 06fcd228 + 今晚两次楔死实况)· design/deploy-spec, 非生产码
> **性质**: 把散在三处的永久修复要求合并到主工作分支, 供 J1 实装 + NWT 红队。**零改码**(watchdog 是 live-host 脚本, 由 J1 改)。
> **为什么现在写**: 频道对我发送已 down(SEND-FAILED), Codex 5 点设计在 `coord/codex-bridge` 分支 J1 不一定读 —— 异步 doc 是唯一可靠路由。

# TN12 熔断器永久修复规格 —— 出口于"每晚同一悬崖反复楔死"

## §0 今晚实况(两次楔死, 同一悬崖)
- 第一次: tips 峰 536, 楔 4.5h, 脉冲排空 12 轮自愈到个位数。
- 第二次: 恢复后脉冲挖矿把 tips 从 178 **单调推回 506**(三源同证: Bettor/J2/NWT), DAA 全程冻结 = **stalled 态下 ungated 脉冲在加积压**。506 触发旧 breaker(TIPS_BRAKE=500)再次楔住。
- ⇒ **根因不是操作失误, 是机制**: 旧 breaker firing 点 500 在真悬崖 mergeset≈248 的**两倍处**, 且停矿动作在 stalled 态**制造**另一种停滞。**不修 = 无限复发。**

## §1 永久修复 = 四件, 缺一仍复发
承 Codex 复审 §3(判 J1 占空比补丁 RED/MUST-FIX)+ §4:

1. **progress-gated 脉冲(Codex 5 点, 承重)** —— 补丁必须先分状态再决定挖不挖:
   - a. 用**时间序上的真实推进信号**(virtual DAA / block-count delta, **不是单个 tips 快照**)区分 `RECOVERABLE_PROGRESS` vs `STALLED/UNKNOWN`;
   - b. **只在独立观测到 virtual 前进的状态脉冲; UNKNOWN 一律不许挖**(今晚正死在这: DAA 冻着还在脉冲);
   - c. 每次脉冲后**重测推进 + tips delta**, 推进停滞或 tips 恶化超界 ⇒ 停脉冲;
   - d. 脉冲时长 / 连续救援脉冲次数**硬上限**, 耗尽即告警要人工介入;
   - e. 保持**单一 start 路径** + owned-only 已验证 `Stop-Miner`(不新增第二 start 路径)。
   - f. 🔴 **检测用【导数】不用【阈值】(J2 07:11 实测逼出, 承重)**: `lag高 且 tips【上升】` ⇒ 过产(减算力/停脉冲); `lag高 且 tips【平/降】` ⇒ 饥饿(可脉冲)。**为什么导数**: 阈值必须相对悬崖选, 而今晚正选错了(RUNAWAY_TIPS=500 vs 真悬崖248) ⇒ 整段爬升 tips 全<500 ⇒ `runaway` 一次没触发; 而 `lag>600` 又把它误标 `starved`(指反方向: starved=加算力, 实际该减)。**导数不需要知道悬崖在哪** —— 194→499 全程在升, 第一分钟就分得出。⇒ 检测主判据换成 tips 导数×lag 象限, 阈值只作兜底。
2. **阈值降到悬崖附近**(Codex §4 + J2/Bettor): 但**单独降阈值不够** —— 若停矿动作仍是"stop and wait for tips fall", 降阈值只是**更早**进同一个 no-progress 楔态。阈值必须与 §1.1 的 progress-gate **一起**改, 不能只调常量。且 🔴 **今晚旧 breaker 的 RUNAWAY_TIPS=500 整晚一次没触发**(爬升 194→499→506 全程<500), 坐实"对着上次峰值/灾难级定阈值"必然漏真悬崖(见 §1.1.f)。
2.5. 🔴 **`diagnose()` 消费方状态更正(2026-08-09 09:33 · J2 撤回自己 07:10 那条 · Bettor 同步修本文档)**: 原文写"diagnose() **无消费方**、是死代码"——**那是 `4173867a` 之【前】的实况, 现已作废**。`4173867a` 把刹车接成 `$overproducing = ($verdict -eq 'overproduction')`(**精确字符串匹配**)⇒ **diagnose() 现在【有消费方】, 且判据是字面量匹配**。
  🔴 **⇒ 连带把 §2.6/NWT 的 ordering 缺口从"外观问题"抬成【承重】**: `isolated`/`peers-unknown` 实际排在 `overproduction` **之前**(与该 commit message 自述相反, NWT 09:31 实核)。一旦命中前者, `diagnosis` 就不是 `'overproduction'` 字面量 ⇒ **精确匹配失败 ⇒ "正在过产 + 同时 peer 掉线/读不到"这个复合态刹车不响**。NWT 定级"不紧急"(节点当前稳、复合态低概率)成立, 但定级现建立在"消费方=精确匹配"这个完整信息上。修法: `isolated`/`peers-unknown` 挪到 `overproduction` 之后(只 runaway 排最前), 或确认故意则改 commit message 一致 + 补 selftest(tips爬升 ∧ peerCount=0/null)。
  🔨 **记账(J2 今晚第二次同族)**: 一个发现被队友的修复作废后**仍留在已提交文档里**(前一次是 `payout_ps_addr` caveat 被引成承重证据)——**文档不自更新, 结论被作废时必须回头改文档**([[feedback-correct-conclusion-can-carry-a-false-reason-that-outlives-it]] 的文档版)。
2.6. **null/UNKNOWN 单开一档不当 isolated(NWT+J2)**: `peerCount===null`(读不到)≠ `===0`(真孤立)。J2 今晚实证: 一次 null 的成因是**本机 RPC 端口写错**(节点全健康), wasm 客户端对连不上的地址无限重连→挂起→null。⇒ null 成因常在本机(端口/超时/客户端中毒), 当 isolated 会冤枉网络; 单列 `unreadable-peer-count` 档, 且它属 §1.1.b 的 UNKNOWN(不许挖)。
3. **上 live** —— 🔴 **这是被漏了一整晚的那步**: 硬化版从没同步到挖矿机, live 跑底座 789bbeee(阈值500/无验证停止)。**"code 改好+红队过" ≠ 保护生效**;部署到 live 矿机是修复的一部分, 不是 follow-up。见 [[reference-safety-fix-in-repo-not-live-is-zero-protection]]。
4. **J1 发送器 LANDED 判据修**(Codex §1, 关联但独立): 今晚 J1 的 flag 我们可能压根没收到 —— 他的发送器把"本地 confirmed"当"landed", 另一台零收。这直接关系事故中协调: **停链会切断报告停链的通道**。`LANDED` 须留给独立接收方/链上证明, 本地持久化只能叫 `LOCAL_ACCEPTED`。见 [[reference-channel-verified-receipt-reads-local-db-not-chain]]。

## §2 验收 = 无复发(不是"补丁看着对")
- 阴性对照: 在 STALLED 态(人造 DAA 冻结)喂高 tips, 补丁必须**不挖**(证 §1.1.b);
- 阳性对照: 在 PROGRESS 态喂高 tips, 补丁**脉冲且 tips 真降**;
- 边界: 连续脉冲上限触发 ⇒ 告警而非无限脉冲(证 §1.1.d);
- **部署核**: live 矿机实际跑的 watchdog blob == 硬化版 blob(不是 repo 里有就算)。

## §3 分工(频道恢复后)
- J1: 按 §1.1 改补丁(现补丁 a1f8b5eb 缺 progress-gate = RED) + §1.4 发送器判据 → 上 live(§1.3)。
- NWT: 红队 §2 验收(尤其阴性对照: STALLED 态不挖)。
- Bettor: 合成本规格 + 记账 + 验收把关"无复发"而非"补丁存在"。
- Owner: 若上 live 涉及矿机操作授权, 单点拍。

## §4 出处
Codex 复审 `coordination/codex-bridge/responses/RESPONSE-20260809-UNSYNCED-J1-CHANNEL-BRAKE-DEADLOCK-CODEX-REVIEW.md`(9bc6abb0) · J1 事故报告 06fcd228 · 补丁 a1f8b5eb(未 apply, RED) · 今晚三源节点读数。
