# G1 世界杯市场措辞 pre-flight + 赛程自动开盘设计（Bettor · 待 Owner+NWT 快审）

> **Status**: CURRENT（2026-07-07 KANet-UI 补记·D-004 文档硬门）— NWT 两轮红队(设计 CONDITIONAL GO → 落码 CONDITIONAL PASS)已过，核心修法已被 J2/Bettor 采纳落地，世界杯赛程(7/4-7/19)进行中，本文措辞模板/pre-flight gate 仍是当前实际使用的口径，未被取代。

> 硬门 G1 · 7/8 go/no-go 前落码。这是世界杯每一个盘的地基——措辞错一次 = 一批盘进 ABSTAIN / 争议。

## 1. 措辞模板（钦定一次·全程复用·禁止逐盘自由发挥）

### 1.1 每日淘汰赛标准盘
- **标题（中）**: 「{国家A} 能晋级下一轮吗?」
- **标题（英）**: "Will {A} advance to the next round?"
- **结算口径（写进盘的 description·对用户可见）**:
  > 以 {A} 是否晋级为准。90分钟战平→加时→点球大战，**点球晋级也算「是/YES」**。以赛事官方最终晋级结果为准。
- **命门**: 用「晋级/advance」**不用「获胜/win」**。点球大战里「谁赢了比赛」和「谁晋级」在口语上会被理解成不同答案（90分钟平局=没人"赢"但有人晋级）→ 用 win 必进 ABSTAIN。advance 是二元干净问题。
- **YES/NO 语义**: YES = {A} 晋级；NO = {A} 被淘汰。

### 1.2 冠军长线盘
- **标题**: 「{国家} 会夺得本届世界杯冠军吗?」/ "Will {team} win the World Cup?"
- deadline 统一 = 决赛结束后（7/19 + 判定缓冲）。剩 16 队各一个。
- 这里「win the World Cup」无歧义（夺冠是唯一明确终局），可用 win。

### 1.3 决赛/季军赛单场盘（NWT BLOCKING-1 修：这两场没有"下一轮"，advance 模板不成立）
- **决赛(7/19)**: 「{国家A} 会赢得决赛(夺冠)吗?」/ "Will {A} win the final?"（= 夺冠·win 唯一终局无歧义）
- **季军赛(7/18)**: 「{国家A} 会赢得季军赛吗?」/ "Will {A} win the 3rd place match?"（纯名次赛·两队已被淘汰·无"晋级"可言·win 是唯一终局）
- 这两类 **不套 §1.1 加时/点球"晋级也算 YES"语义**——它们本就是 win 句式（决赛/季军赛以最终赢家为准，含加时点球，赢者=YES）。

## 2. Pre-flight 清单（每盘创建前必过·核对记录落 DB）

创建 API 加一个 pre-flight gate，三项全绿才允许建盘，核对结果写 `pool_markets.metadata.preflight`（或新表 `market_preflight_checks`）:

1. **镜像源对齐（NWT BLOCKING-2 修：不是"逐字文本比对"·那会把我们故意 advance≠win 的每一盘都自锁拦下）**: 改为**逻辑等价核对**（机器可判·非字面文本）——比对三个属性相等：① 同一场次（matchId / 队伍对 / kickoff 时间一致）② 同一 resolution 事件源（都以官方晋级/赛果为准）③ **点球晋级归类一致**（我方"点球晋级算 YES"与镜像源判定规则映射相同）。存镜像源 conditionId + criteria 原文快照（供人工追溯，非机器逐字匹配）。⚠ 落码禁用字面 text-equals，否则 gate 第一天全红没人能建盘。
2. **deadline 充足**: `deadline ≥ 开球时间 + 4h`（90min + 加时30min + 点球 + 判定缓冲）。冠军盘 deadline ≥ 决赛结束。
3. **judge 时机参数**: 按 G7 扫描结论设 judge 延迟（避免"判太早"= ABSTAIN 正门；G7 给出 (b)类判太早的时间分布→推荐延迟值）。

**核对记录落 DB** = 可审计 + 出问题能追溯是哪一项没核对。

## 3. 赛程自动开盘

- **赛程配置**（schedule config）: 每场 {matchId, teamA, teamB, kickoffUtc, stage}。
  - 16强 7/4–7 · 1/4 决赛 7/9–11 · 半决赛 7/14–15 · 季军 7/18 · 决赛 7/19
- **模板按 stage 分支（NWT BLOCKING-1 修·cron 不能无差别套同一模板函数）**: `stage ∈ {16强,8强,4强}` → §1.1 advance 模板；`stage ∈ {决赛,季军赛}` → §1.3 win 模板。
- **占位符解析（NWT 澄清-1 修·淘汰赛下一轮队伍等上轮结果）**: config 里 8强及以后开赛前只能填占位（"胜者A vs 胜者B"）。**上一轮比赛 close/judge 后，由 close 联动逻辑（或 operator）把下一轮 config 的占位符替换成确定队名**，然后自动开盘 cron 才对该场生效。cron 开盘前必校验队伍字段非占位符，否则 skip + 告警（防插值出乱码/空值）。
- **自动开盘**: cron/daemon 在 `kickoff - T`（T=开赛前 24–48h）为队伍已确定的场次创建盘（过 pre-flight gate）。
- **自动封盘**: `deadline = kickoff + 4h`（读最新 config 的 kickoffUtc·非开盘快照）。
- **冠军盘**: 活动启动时一次性建 16 个（剩余队伍），deadline 决赛后。

## 4. Cap（挂 G3）

- 每盘创建带上限 `cap ≤ 900`（防 1024 payout 硬顶·最坏情况全员同向）。UI 满员提示「本场已满·下一场见」。详见 G3。
- **⚠ cap 卡的维度（NWT 澄清-2 修·关键）**: covenant 硬顶是 **winner 的 merkle 叶子数**（`merkle_index < 1024`·PayoutShard.sil），**不是"参与人数"**。若一个用户可对同场下**多笔**注（多笔=多个独立叶子），900 人×人均2笔=1800 会击穿 1024。∴ **cap 必须按"distinct bet(叶子)数"算·不是 distinct bettor 数**（除非同场同人同向强制单笔）。G3 落码前钉死这个维度。

## 5. 落码分工（先谈后做·本设计过审再落）

- **措辞模板 + description 生成**: KANet-UI（bot/UI 文案）
- **pre-flight gate + DB 落库 + 镜像源核对**: J2（结算侧·镜像源它熟）
- **赛程 config + 自动开/封盘 cron**: J2 或 KANet-UI（复用现有 seeder/daemon）
- **cap 参数**: Bettor 定值（≤900）+ KANet-UI 满员接口
- **judge 延迟参数**: 待 G7 扫描结论（Bettor·7/6 前）

## 6. 禁区（Track B 公开材料纪律）
- 零 mainnet 表述进任何盘文案；"收益"类词带引号；不可判/主观题材一律不开盘（oracle board 章程）。
- 结算机制被问及不用"ZK 结算"指代 interim-B。
