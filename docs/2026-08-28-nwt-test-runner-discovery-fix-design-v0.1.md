# NWT — test-runner 发现盲区修法设计 v0.1（两案 + 影响面 + 活链风险 + 证据留法 · 给 Bettor 裁）

> **Status**: CURRENT
> 作者 NWT · 2026-08-28 · 派工 Bettor(B) · 承 J2 `docs/2026-07-28-test-runner-discovery-and-real-chain-marker-design.md`（A/B 分类逐个读过头部，非 grep）· **本稿零落码**（设计交裁）。

## 0. 一句话
`--all/--domain` 只发现 `cases/**/*.test.mjs`（`test.mjs:findCases`），**18 个非-`.test.mjs` 用例文件被静默漏扫**——其中 **1 个花真钱**（`g5-pilot-custodial-real-chain-smoke.mjs`，≤2 KAS/单笔）。让它们"可见"若不先上 skip 机制 = 真钱用例进无人值守 `--all`。**好消息：skip 机制已存在且 runner 已强制**（下）。

## 1. 承重事实（实核 2026-08-28）
- 🟢 **`skip_in_batch` 已被 runner 强制**：`scripts/test.mjs:168 if (isBatch && testCase.skip_in_batch)` ⇒ batch 模式跳过；`:116 --adversarial` 显式 override（"我明知在花真钱"闸，NWT 7c66dd00）。**⇒ 真钱用例只要带 `skip_in_batch` 就不会进 `--all`。机制在，缺的是【标记 + 强制每个真链用例都带】。**
- **18 个非-`.test.mjs`（glob-widen 影响面全集）**：`m0c1-gate/`×10（J2 已分类：1 真钱 g5 / 1 支持文件 harness.mjs / 8 隔离-安全）+ `agent-tunnel/_smoke_*`×3 + `predictions/pool/*`×4 + `predictions/dm-agent/soak_runner.mjs`×1。**后 8 个未按头部分类**（grep 是弱信号——J2 已证 `g5-real-chain-smoke-regression` 名字带 real-chain 却不碰真链，真花钱的是另一个 ⇒ **分类键只能是"跑起来碰到什么"，逐个读头**）。
- `harness.mjs` = 被 import 的支持文件、非用例；`_`-前缀 = 惯例助手/smoke。**它们不 `export default` 一个 case 对象**——这是区分"用例 vs 助手"的结构键。

## 2. 两案 + 影响面

| | **案 A：放宽 runner glob**（发现 `cases/**/*.mjs`）| **案 B：改名 class-A → `*.test.mjs`** |
|---|---|---|
| 影响面 | **18 个一次性全可见** | **恰好你改的那几个**（可控） |
| 真钱 g5 | 靠 `skip_in_batch` 挡（须先标）| 不改名它/或改名并标 `skip_in_batch` |
| 支持文件 harness.mjs | 🔴 **会被当 case 跑**（除非加排除）| 不改名 ⇒ 天然在外 ✓ |
| 8 个未分类 | 🔴 **一次全进 batch，活链风险未知** | 只改已读过头的 ✓ |
| 未来新用例 | ✅ 自动被发现 | 🔴 又得记得改名，否则再隐形 |
| 成本 | 一处 glob + **须加两条结构守卫** | 逐文件 `git mv`（history 保留）|

## 3. 我的建议（分两步，第一步承重，与 glob/rename 正交）

**① 先上（阻塞一切可见性变更）—— 把"运气"变"机制"**：
- (a) 给 `g5-pilot-custodial-real-chain-smoke.mjs`（及任何真钱/真链用例）加 `skip_in_batch: true`；
- (b) **lint 规则**：用例头部/`meta` 声明 `real_chain`（或撞到真链原语）⇒ **必须**带 `skip_in_batch`，否则 commit 挡（机械化 J2 flag 的"靠有人读了头才拦下"）。runner 强制已在（§1），只差"每个真链用例都戴上"这条闸。
- **这一步落地后，真钱用例即便可见也进不了 `--all`** ⇒ 可见性怎么改都安全。

**② 再改可见性 —— 我倾向【案 A + 两条结构守卫】而非纯改名**：
- 放宽 glob 到 `cases/**/*.mjs`，但 runner 加两守卫：**(i) 只收 `export default` 一个 case 对象的文件**（harness.mjs / 纯助手结构性排除，不靠改名）；**(ii) 跳过 `_`-前缀文件**（惯例助手/smoke）。
- 比纯改名(案 B)强在：**未来新用例自动被发现**（案 B 每次要记得改名，漏了又隐形——这正是今天的病根）；比裸放宽强在：**支持文件结构性排除**、不误跑。
- **前置**：开 glob 前，**8 个未分类逐个读头**（J2 那套，非 grep），真链者标 `skip_in_batch`。

## 4. 活链风险闸（不管选哪案）
- 开可见性**之前**：18 个全部完成头部分类 + 所有真链用例带 `skip_in_batch`（①-b lint 守）。
- `soak_runner.mjs`（长跑 soak）即便 `export default` 也应 `skip_in_batch`（不宜进 `--all`）。
- 真跑真链用例的唯一入口 = 显式 `--case=<path>` 或 `--adversarial`（"明知花钱"闸）。

## 5. 证据留法
- 现状：`logs/test-runs/<case>-latest.json`（🟡 覆盖式，只留最后一次，无历史——CLAUDE.md 已注）。
- 🔴 **真链用例例外**：真钱一跑，其证据（txid/花费额/护栏命中）**不该被下次覆盖**。建议真链用例的证据**追加式**落一条独立 durable 记录（或至少 txid 进 ledger），别用 `-latest` 覆盖。非真链回归用例维持 `-latest` 即可。

## 6. 给 Bettor 的裁点
1. **①（skip_in_batch 标记 + lint 强制）先做**——同意否？（我判：无条件先做，它把真钱风险从"运气"变"机制"，与 glob/rename 无关。）
2. **② 选 A（glob+两守卫，未来自动发现）还是 B（改名，逐个可控）**？（我倾向 A，理由 = 根治"新用例又隐形"；但 A 须先分类 8 个 + 加两守卫。）
3. 真链证据**追加式 durable**（§5）—— 采否？
