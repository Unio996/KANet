# KANet 架构整顿计划（散乱地图 + 收敛路线）2026-07-05

> **Status**: CURRENT（2026-07-07 KANet-UI 补记·D-004 文档硬门）— 多轮整顿计划，P0 项里 broker-fee 已修(c0b7170e)+win/loss 已修(#48)，**maker-fee 幽灵字段 bug 经 git log 核实仍未修**，P1-P3 收敛项(register 8→1/settle 统一/p2sh 版本收敛)均未见后续 commit，本文仍是当前有效的整顿路线图，未被取代。

> Owner 2026-07-05 钦定: "系统不强壮·程序散乱·没模块化·一个功能几个并行相似程序/几个接口·不统一·需根本梳理整顿" → "旧路必须删·不留多路多版本并行·彻底替换" → "**统一用最新链路和模块·一定要模块化·即插即用**"。
> 方法: 测绘(散乱地图)→ 排序(风险)→ 收敛(统一到最新 v0.7 模块·删旧·版本判断内部化=调用方即插即用不选版本)。
> 边界: 大工程多轮·7/5 launch 前做不完。launch 个别 critical bug 现修·根本整顿逐步收敛·不草率(#49 节奏)。钱路旧代码删前验死(无在途依赖)。

## 散乱地图（Explore 全库审计 2026-07-05·按风险）

### 🔴 第一类: 收益/费用/发奖 计算与显示（钱路·最高险）
- **broker fee 3 路径**: broker-fee-emit.mjs(链查·权威) / kanet-broker.js /earnings/:relay_id(旧读 phase2_broker_fee_sompi 幽灵) / /earnings-by-address(旧读 fee_payouts 幽灵·全库零写入)。**已修 c0b7170e**(两 endpoint 改调 computeMarketBrokerFee 单一链查源)。残: broker-fee-emit.mjs 仍自己一份逻辑 → 该并入 computeMarketBrokerFee(删第2份)。
- **🔴 maker fee(下一个·未修)**: kanet-maker.js 读 `phase2_maker_payout_sompi`(v0.6 settler 写·bshard 从没写)→ **bshard maker 收益显错/pending·跟 broker-fee 一模一样的坑**。修法同款: 链查 maker payout 单一源·删幽灵字段依赖。

### 🔴 第二类: phase2_* 幽灵字段族（v0.6 写·bshard 不写·显示层依赖→bshard 显错）
pool-market-settler.js:2287 一次写 11 个 phase2_*。bshard-settle-daemon.mjs:373 改写 settle_evidence 新结构(不写 phase2_*)。读取方依赖旧字段→bshard 显错:
- `phase2_winner` → my-positions 赢输判(#48 已修·改读 settle_evidence.winner_details)
- `phase2_broker_fee_sompi` → broker earnings(c0b7170e 已修·改链查)
- `phase2_maker_payout_sompi` → maker earnings(**未修·下一个**)
- 机制根治: lint 堵"读 phase2_*/幽灵字段不 fallback 链查"(#25 同族)。

### 🔴 第三类: settle 3 套并行 runner
pool-market-settler.js(~3000行·v0.5/v0.6) / pool-market-settler-v06.mjs(v0.6) / bshard-settle-daemon.mjs(~500行·v0.7 最新)。数据模式不同(phase2_* vs settle_evidence)→同 display 读不同字段。**收敛: 统一到 bshard-settle-daemon(最新)·v0.6 验死后删**。

### 🟠 第四类: register 8 endpoint + create 3 endpoint「版本地狱」
pool.js register×8(基础/v06 prep+confirm/v07 单步+prep+confirm/external prep+confirm)·create×3(基础/v06/v07)。调用方自己选版本→易选错。**收敛: 统一到最新 v07·1 个自适应模块(protocol_version 内部判)·调用方即插即用不选版本·删旧 endpoint**。

### 🟡 第五类: 不完整迁移残留
pool-merkle-v06 / pool-p2sh-v06+v07+v0_7_1+v08。版本散在专属文件。收敛到最新 + 删旧。

## 整顿路线（按 launch 紧迫度）

**P0 立即(launch·钱路显示·幽灵字段族)**:
- ✅ broker-fee(c0b7170e·两 endpoint 链查) — 残: broker-fee-emit.mjs 并入(删第2份)
- 🔴 **maker-fee**(同款 phantom bug·下一个必修·bshard maker 显错)
- ✅ win/loss(#48)
- lint 堵幽灵字段读(机制防复发)

**P1-P3 整顿(多轮·非 launch)**:
- register 8→1 自适应模块(即插即用)·删旧
- create 3→1·删旧
- settle: 统一 bshard·v0.6 settler 验死→删
- p2sh/merkle 版本收敛→删旧

## 模块化原则(Owner 即插即用)
一个功能 = 一个模块 + 一个接口。版本判断内部化(读 protocol_version 自动走对路)·调用方不选版本。旧版本验死后**删除**(非留并行)。新增功能只加一个模块·不 fork 并行实现。
