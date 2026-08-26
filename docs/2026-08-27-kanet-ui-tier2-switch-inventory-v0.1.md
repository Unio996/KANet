# §6-3 Tier-2 开关盘点 v0.1（只列不改·"禁用"要落在真实开关）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-27 · Bettor 派工 (VB-5) · **只盘点不改任何码/env**。(23)/(21)/Codex 指向"TN12 现网 Tier-2 禁用/实验-only"——本稿核实这"禁用"落在哪个真实开关。
> **证据纪律**: 每条带 `file:line` + 原始命令输出。**术语先分清**(三个"tier"别混, 下 §0)。

## §0 三个"tier"术语先分清（混淆是本题最大坑）
| 名 | 是什么 | 与 §6-3 Tier-2 结算的关系 |
|---|---|---|
| **§6-3 Tier-2 fair-exchange** | reactive-leg / watchtower 代广播 / claim 超时 NOT-BEFORE(C4-FINALITY)——跨/同链公平交换结算 | **本题对象**。🔴 **无实现**(下 §1) |
| **committed ZK 结算**(CloseZkV2 / zkNative / escape) | 铁律0.5 committed 架构; live-wired | **不是 Tier-2**。是 committed/Tier-1 结算, 有真开关且**现网启用**(下 §2) |
| **audit_mode='tier2'** | oracle 声誉信号(reputation dimension) | **不是结算路**。`bettor.js:2316` 明写 "audit_mode 是 oracle tier 维度 NOT settle path enum"(J1 #11 gap#2 已 WITHDRAW)。**勿当结算开关**(下 §3) |

## §1 §6-3 Tier-2 fair-exchange = 无码·无 covenant·无开关（结构性禁用）
- **无实现代码**: `grep -rln "reactive.leg|T_react|NOT.BEFORE|C4.FINALITY|reactiveLeg" kasia-console/src kasia-relay/src` = **空**。
- **无 watchtower 代广播实现**: `grep -rln "watchtower|best.of.n|bestOfN"` = **空**。
- **无 fair-exchange covenant**: `ls kasia-console/src/lib/*.sil` = CloseZkV2/PayoutShardV2/PoolLeaf/FoldNode/OracleStake_v1/probes —— **无 reactive/adaptor/fair-exchange .sil**。
- ⇒ 🔴 **§6-3 Tier-2 现网"禁用"是【结构性】的: 那条结算路根本没被建**(v0.15 CONDITIONAL DESIGN-LAYER CLOSE, impl HOLD, 真 covenant 未写)。**没有运行时开关可翻, 因为没有东西可翻。**
- ⇒ **① 哪些 env/flag/DB/常量决定 §6-3 Tier-2 激活**: **一个都没有**。它不激活是因为不存在, 不是因为某开关=off。
- ⇒ **④ fail-open 缺省**: 不适用(无代码路径)——这是最强的"fail-closed"(压根没门)。
- ⚠ **别把 §2 的 ZK 开关误当 §6-3 Tier-2 的开关**(最易犯的错): 翻掉 §2 的 ADMIN_ZK_* 会关掉 committed 结算(现网在用), **不是**关 Tier-2 fair-exchange(它本就不在)。

## §2 committed ZK 结算 track（真开关·现网启用·fail-closed）——不是 Tier-2, 但列清防混淆
| 开关 | 现网默认 | file:line | 缺失行为 | 读者 |
|---|---|---|---|---|
| `zk_native`(per-market, resolution_rule_spec JSON) | **false** | `pool.js:163` `let zkNative = false`; `:164` parse `.zk_native===true`(parse fail→false) | **fail-closed**(默认 false; `pool-shard-register.mjs:348` zkNative 无 anchor 即 throw) | `pool.js:163/164/1294/1346/1350/1567/1838`, `bshard-close-enforce.mjs:347/770`(_isV2Layout), `bshard-payout-family-coherence.mjs`(铸后不可变守卫) |
| `ZK_CLOSEZK_SIL_PATH`(env) | 由 kanet.env 给(路径) | `pool.js:171/178`, `bshard-close-transport.mjs:506/516` | **fail-closed**: 缺失即 `throw`(不接受硬编码 fallback) | 同左 + `pool-shard-register.mjs:206` |
| `ADMIN_ZK_CLOSE_V2_ENABLED` | **=1**(启用) | `kanet.env:20`; 读 `pool.js:1959` | **fail-closed**: `!== '1'` ⇒ 503 disabled(`:1960`) | `pool.js:1959` |
| `ADMIN_ZK_HANDOFF_V2_ENABLED` | **=1** | `kanet.env:18`; 读 `pool.js:1921` | **fail-closed**: `!== '1'` ⇒ 503(`:1922`) | `pool.js:1921` |
| `ADMIN_ZK_CLOSE_GATE_DEBUGGER_ENABLED` | **=1** | `kanet.env:19`; 读 `pool.js:2048` | **fail-closed**: `!== '1'` ⇒ 503(`:2049`) | `pool.js:2048` |
| `ADMIN_SECRET_ZK_CLOSE_BROADCAST` / `ADMIN_SECRET_ZK_STATE_PREP` | 设(secret) | `kanet.env:8/10` | admin-tier 鉴权(缺=拒) | admin-secret-tier 消费方 |
- **recovery 支(committed track 的, 不是 Tier-2)**: `closezk_v2_escape_trigger`(OP_1, closed 1→3 flag-flip, tx.time 阈值链上裁决, `relay.mjs:1068`)/ `closezk_v2_escape_claim`(OP_2, refundRoot merkle + nullifier, `relay.mjs:1077`)/ zk-autonomy-ticks(handoff/judge-propose cooldowns `zk-autonomy-ticks.mjs:233/345`)。这些是 committed ZK 的退款/恢复, **非 §6-3 Tier-2 fair-exchange recovery**。
- 🔴 **牙未武装**(接记忆 `reference-trustless-teeth-built-but-not-armed-voter-off`): committed 结算的 enforcement voter(`bettor-prediction-voter.js`, `PREDICTION_VOTER_TICK_SEC`)——结构在但武装态另说, 不在本盘点开关面(它决定"谁投票 enforce"不决定"Tier-2 路开不开")。

## §3 audit_mode='tier2'（声誉信号·非结算路·勿当开关）
- 是 oracle 审计记录的一个 enum 字段(`tier1/tier2/tier3/consensual`), `migrate.js:4202` `audit_mode TEXT NOT NULL`, 写在 `bettor.js:2311-2336` 的 oracle audit endpoint。
- 🔴 `bettor.js:2316` 原注: "audit_mode 是 oracle tier 维度 **NOT settle path enum**"(J1 #11 gap#2 WITHDRAW)。⇒ **它标 oracle 声誉档, 不控任何结算路; 把它当"Tier-2 结算开关"是错的**。

## §4 回答 Bettor 五问（汇总）
1. **哪些 env/flag/DB/常量决定 §6-3 Tier-2 激活**: **零个**——§6-3 Tier-2 fair-exchange 无实现(§1)。现有 ZK 开关(§2)属 committed track, audit_mode(§3)属声誉, **都不是** Tier-2 结算开关。
2. **现网默认值**: §6-3 Tier-2 = 不存在(默认=无); committed ZK = 启用(ADMIN_ZK_*=1, zk_native per-market 默认 false); audit_mode = 每条记录显式给(无默认, NOT NULL)。
3. **读者枚举**: §6-3 Tier-2 无读者(无码); committed ZK 读者见 §2 表(pool.js/bshard-close-enforce/bshard-payout-family-coherence/relay.mjs escape); audit_mode 读者 = bettor.js oracle audit 写入 + 声誉展示(不涉自动花钱)。**⚠ 教训(接 `reference-authorization-field-is-selection-key-of-auto-spend-tick-writing-it-arms`)**: 我逐个 grep 了 zk_native 的读者, 未见"写 zk_native 触发自动花钱 tick"的隐藏读者——zk_native 是**铸市场时**定、铸后不可变(family-coherence 守卫), 非运行时自动花钱选择键。
4. **fail-open 缺省**: §6-3 Tier-2 = 无门(最强 fail-closed); committed ZK 开关**全 fail-closed**(ADMIN_ZK_* `!=='1'`⇒503; ZK_CLOSEZK_SIL_PATH 缺⇒throw; zk_native 默认 false + 无 anchor⇒throw)。**无 fail-open 缺省**。
5. **"现网禁用/实验-only"最小改动**:
   - **对 §6-3 Tier-2**: **零改动**——已结构性不存在。要"实验-only"地建它 = Owner-gated 从零写 covenant(§6-3 impl HOLD), 不是翻开关。
   - **若真意是"把 committed ZK 结算也标实验-only/禁掉"**(不同决定, 须 Owner 明确): 最小改动 = kanet.env 把 `ADMIN_ZK_CLOSE_V2_ENABLED`/`ADMIN_ZK_HANDOFF_V2_ENABLED`/`ADMIN_ZK_CLOSE_GATE_DEBUGGER_ENABLED` 从 `1` 改非 `1`(端点即 503)——**但这会关掉现网在用的 committed 结算**, 是重大决定, 不在本盘点建议内, 仅列杠杆位置。
- 🔴 **本稿不改任何开关**; 只盘点。哪个"实验-only"该怎么落 = Owner 域。

## §5 一句话给 Owner（Bettor 精炼）
"§6-3 Tier-2(fair-exchange)现网禁用"**已经是事实且是结构性的**——那条结算路没被建(无码/无 covenant/无开关), 无需也无法"翻开关禁用"。真正 live 且有开关的是 **committed ZK 结算**(另一条 track, 现网 ADMIN_ZK_*=1 启用, 全 fail-closed), 别把它误当 Tier-2; 也别把 `audit_mode='tier2'`(声誉标)当结算开关。若 Owner 要的是"把 committed ZK 也标实验-only", 杠杆在 kanet.env 三个 ADMIN_ZK_*_ENABLED, 但那是关现网结算的重大决定。
