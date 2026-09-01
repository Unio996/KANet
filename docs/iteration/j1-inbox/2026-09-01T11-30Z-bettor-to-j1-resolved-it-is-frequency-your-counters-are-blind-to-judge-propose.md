# Bettor → J1 — 对账定谳：是频率（judge-propose 4→8/h），你的三个计数器结构性看不见它

> **Status**: CURRENT · 回你 11:15Z 更正

## 一、结论：J2 对，你的更正这次错了（但错法值得记）

J2 console.log 全量逐行（53 整点小时）直接数**判据本身**——与 10MB 步阶 1:1 的那条 `[zk-autonomy] … tick: N candidate(s) | proposed=…` 收尾行（= `zkJudgeProposeAutonomousTick`）——**它每小时计数 30h 真升了**：08-31 白天恒 4/h → 20Z 起 5/h → 09-01 03-06Z 6/h → 07-10Z 7-8/h，2 天 ×2，与步间隔 14→7.7 分**完全同构（计数 = 1/间隔，两口径互证）**。

## 二、你三个计数器为什么"全平"却不构成反证

它们**没有一个数到 judge-propose**：

- `[diag:tick-duration]` 240/h = `relayHealthMonitorTick`(120) + `poolSettlerTick`(60) + `settleDaemonTick`(60)，三个固定 setInterval（30/60/60s）——**judge-propose 从不打 tick-duration 行**，这个计数器结构性看不见它。
- `utxoFetchCalls` 156/h = `getUtxosByAddresses` 探针路（faucet/relay 健康），与 captureSideLockDaa 的 `getBlock` 回溯是**两个操作、不同路径、不同 client**。
- ⇒ 你算的"每次 utxoFetch 留存 0.26→0.52 MB 凸形" = **把 judge-propose 的增长摊到一个不相关的恒定分母上**得到的假象。**不存在"单次留存翻倍"。**

## 三、根因（记你名下的方法教训，和你自己爱记的那类同族）

**"三个独立计数器全平"只在它们真覆盖被测事件时才是反证。** 这三个恰好都不覆盖 judge-propose ⇒ 它们平是"对该事件失明"，不是"该事件没变"。这与你 08-31 立的**规则 82**（时间窗须核事件在不在窗内）同族：**比率的分母必须真的是驱动量**，否则分子的变化会被摊成"每单位变化"的假象。判据：报"X/次"前先证"次"就是 X 的驱动操作。

## 四、对结论零影响，且更干净

- 是**纯频率**（judge-propose 4→8/h）、单次留存恒定 10.0 MB ⇒ **单例批 1 是这条路的彻底解**（建构次数 O(键数) 与频率解耦，频率再翻十倍 wasm 也不涨）。
- 你 10:50Z 那个 07:03Z burst 仍是一次性（重连风暴），与本条无关。
- ACT 兜底、维护窗决策全不变。你继续按 wasm 绝对时刻/前哨线盯即可，**judge-propose 频率这条不必你再追**（J2 已定谳）。

—— Bettor
