# KANet 底座模块化路线图 v0.1（首稿 · Bettor 主编 · 待对抗讨论）

> **Status**: DRAFT v0.1（2026-07-22 · Bettor）
> **流程锚**（Owner 终裁 2026-07-21 18:20Z，COORD-LEDGER 在案）：**本首稿 → 团队对抗性讨论（J1/J2/NWT 各域挑刺）→ 收敛稿交 Owner 磨合 → 方案钉死后 Bettor 安排分批执行。钉死前不动任何执行代码。**
> **范围**（Owner 钦定）：预测系统 + kas 兑换系统（exchange）两个应用与 KANet 底座分离；**抽离模式本身必须可复用**（两个应用用同一套方法），倒逼地基接口定义。
> **本卡性质**：设计文档，不改一行执行代码。

---

## 0. 总纲：不是发明新架构，是让代码回到立项定位

`docs/KANet-Positioning.md`（立项原文）已经把目标态写死了：

- 底座只提供**三原语**：安全通信 / 身份与发现 / 价值结算。"只建地基不造房子"。
- 通信规则：`Console → Relay: IPC（指令）`、`Relay → Console: HTTP（回报）`、**`外部系统 → KANet: HTTP API（接入）`**。
- 角色分工：Mind 决策不执行 / Console 传导不碰链 / Relay 唯一链上出口 / Scout 只读。
- 第一个示范 KAS Market Maker 当年就是按目标形态做的：**"完全独立的系统——自己的代码、自己的数据库、自己的 UI，通过 HTTP API 接入 KANet，不改一行 KANet 代码。"**

这几个月跑偏的不是定位，是实现：预测系统、exchange、做市、tg-bot 一个个长进了 Console 进程里。所以路线图的本质 = **把应用迁出底座，把底座收敛回三原语 + 运行时**，验收标准就用立项原文那句话：新应用接入 KANet，不改一行 KANet 代码。

---

## 1. 现状盘点（2026-07-22 四路代码实证，非印象）

### 1.1 跑偏的量化证据（债务都在 Console 单体）

| 证据 | 数字 | 出处 |
|---|---|---|
| Console `index.js` 接线中应用逻辑占比 | ≈85%（route ~45 个中应用类 ~25；daemon/tick ~50 个中应用类压倒性多数） | `kasia-console/src/index.js` |
| 直接持有 SQLite 句柄的文件 | **125 个**（`import { sqlite } from '../db/client.js'`） | `kasia-console/src/**` |
| 直接拿 relay IPC 句柄的文件 | **41 个**（import relay-manager） | 同上 |
| Relay IPC 命令表被应用污染 | 全表 ~50 命令，**通用原语仅 ~16 个**，其余 ~34 个是 bshard/pool/prediction 专用 | `kasia-relay/src/lib/commands.mjs` |
| 三系统协议处理混在单文件 + 环形依赖 | `trade-protocol-filter.js` 2873 行同时处理 `kanet_exchange_*`/`pool_*`/`oracle_*`，且 `exchange-machine.js` 反向 import 它 | `kasia-console/src/services/trade-protocol-filter.js` |
| V1 预测嫁接在 exchange 骨架上 | V1 settler 直接复用 `exchange_offers` 表 + `exchange-machine.transition`（预测↔exchange 隐性耦合） | `bettor-prediction-settler.js` |

### 1.2 没跑偏的部分（拆分的好消息，不要重造）

- **三原语核心实现干净内聚**：加解密全在 `kasia-relay/src/lib/crypto.mjs`；签名广播全在 relay（唯一持私钥进程，角色未破）；索引回报口全在 `ingest.js`。
- **跨进程四条边本来就是可拆边界**：Mind→Console（HTTP）、Adapter（HTTP :3000）、Scout→Console（HTTP ingest）、Relay→Console（HTTP 回报）。跑偏只发生在 Console 进程内部。
- **tg-bot 已是目标形态的实证**：独立进程、生产路径纯 HTTP（`/api/pool/*`、`/api/tg-wallet/*`），不碰 DB——预测系统自己的第一个消费者已经证明 API 契约可用。
- **bshard-settle-daemon 最接近可独立**：已有 `SETTLE_DAEMON_CONSOLE_BASE`/`RPC_URL`/`BSHARD_SETTLER_RELAY_ID` 等 env 化外部接口，待切断的只有三条内嵌耦合（共享 sqlite 句柄 / 直写 events 表 / 同 event loop）。

### 1.3 已有的三种抽离范式（先例实证，路线图只做选型规则，不发明第四种）

| 范式 | 先例 | 适用 |
|---|---|---|
| ① 纯函数组件包 + 物理副本 + lint 防漂移 | `@kanet/fee-split`（零 KANet 依赖、第三方 49 秒接入、`R-FEE-SPLIT-PKG-DRIFT` 焊死同源） | 无状态可复用算法（分账/校验/派生） |
| ② 独立进程/独立语言 + 自带 package + HTTP/产物交互 | kaspa-scout、kas-market-maker、zk-payout-guest（Rust）、tg-bot | 有自己生命周期/资源的完整应用 |
| ③ 同仓逻辑收敛（模块目录 + 单一权威入口 + 调用点 gate） | broker-state-authority、#28 三层（真相源/缓存视图/结算引擎） | 抽离前的中间态；暂不宜出进程的高危钱路 |

**选型规则（本路线图钉死）**：应用抽离一律走 **③→（接口化）→②** 的渐进路径；可独立复用的算法沉淀为 ①。禁止跳步直接微服务化。

### 1.4 底座保留资产清单（应用抽离时只能走接口消费，不准搬走）

- **表**：`fund_locks`、`chain_events`、`kaspa_tx_log`、`events`、`identities`/`conversations`/`messages`、`relation_states`、`relay_nodes`、`channels`/`broadcast_messages`、`config_entries`、`tx_records`、`reputation_summary`
- **能力**：relay 通用 IPC 原语（~16 个：handshake/send_message/send_broadcast/publish_card/transfer/custodial_transfer/split_utxo/consolidate_utxo/check_utxo_landed/get_address_utxos/ecdsa_sign/sign_input_for_settle/get_rpc_state/get_pubkey/chain_get_* 查询）、`/ingest/*` 回报口、chat/广播管道、fund-lock 服务、chain-event 记账、kaspa_tx_log indexer

---

## 2. 目标架构

```
┌────────────────────────────────────────────────────┐
│  应用层（各自独立模块/进程，同一套接入模式）           │
│  预测系统(bshard+oracle)  KAS兑换(exchange+seeder)   │
│  做市(kas-market-maker✓已独立)  tg-bot(✓已独立)      │
│  ...未来任何新应用                                   │
└───────────┬────────────────────────────────────────┘
            │ 底座 API 契约 v1（HTTP API + 事件订阅 + 白名单 IPC 扩展点）
┌───────────┴────────────────────────────────────────┐
│  KANet 底座（三原语 + 运行时）                        │
│  Console：传导/索引/API 网关（不含业务逻辑）           │
│  Relay：唯一链上出口（通用原语 + 应用命令注册机制）     │
│  Scout：只读观察   Mind/Adapter：决策与 AI 桥         │
│  底座表：fund_locks/chain_events/kaspa_tx_log/身份…  │
└────────────────────────────────────────────────────┘
```

关键接口设计决策（对抗讨论重点打这里）：

- **D1 数据库不拆库，先拆访问路径。** SQLite 单文件库物理拆分（应用自带库）风险大收益后置；本路线图内应用专属表仍留 console.db，但应用代码一律经**仓储层/HTTP API** 访问，禁止裸 `sqlite` 句柄。物理拆库留待应用独立进程化稳定后单独议。
- **D2 Relay IPC 命令表分层。** 通用原语（~16）为底座契约；~34 个 bshard/pool 专用命令改为**应用命令注册机制**（应用声明、relay 装载），而不是硬编码在 relay.mjs switch 里。结算签名仍全部经 relay，唯一链上出口角色不变。
- **D3 协议消息分发是底座原语。** 链上广播→本地索引的分发（现 trade-protocol-filter 的角色）收归底座，提供 handler 注册接口；exchange/pool/oracle 各自注册自己的协议 handler。
- **D4 V1 预测路径退役。** V1 嫁接在 exchange_offers/exchange-machine 上，是两个应用间的隐性耦合，不解开则两个都抽不干净。退役前提：bshard 对 V1 功能对等清单系统核对补齐（J2 提的历史债，#30/v0.6 恢复机制同族）。

---

## 3. 分批路线（每批可独立回退，每批完整审链：设计→NWT 红队→落码→diff 审→装载验证）

排序依据（四方共识已记账）："新应用马上要用的 + 事故率最高的"先行；exchange 半冻结低风险先练刀，预测系统真钱在跑后动。

### M0 边界冻结（薄批，止血优先）
- 产出：《底座 API 契约 v1》文档（三原语 HTTP API 面 + relay 通用 IPC 白名单 + §1.4 底座保留资产清单）+ **lint 卡点**：新增代码禁止在应用目录直连 `sqlite`/`relay-manager`（存量 125/41 处生成豁免基线，只减不增，lint 报数）。
- 验收：lint 上线且基线数字入库可追踪；不改任何执行代码。
- 意义：先让债务停止增长（机制化，不靠自觉——ANTI-PATTERNS 老教训）。

### M1 切开 trade-protocol-filter（三系统协议解绑）
- 2873 行拆为底座分发器 + exchange/pool/oracle 三个独立 handler；解开 exchange-machine 环形依赖。
- 验收：行为零变化（现有 exchange stress 12/12 + pool/oracle test domain 全绿回归）；三 handler 可独立测试。
- 🟠 非钱路结构重排（不改结算构造值），但因触结算消息管道，NWT 全量红队。

### M2 Exchange 抽离（练刀批，产出可复用 playbook）
- M2a：exchange 全部专属代码归拢 `apps/exchange/` 模块目录（范式③，纯移动+import 修正）；专属表清单标注（exchange_offers/exchange_accounts/mm_orders/trade_*/market_seeder_config/retail_dex_buy_publications）。
- M2b：裸 DB/relay 直连改走仓储层 + 底座 API；共享表（fund_locks/chain_events/kaspa_tx_log）全部走底座接口。
- M2c：独立进程化（自带启停，经底座 HTTP 接入）——视 M2b 后收益决定做不做，不强推。
- 产出：**《应用抽离 playbook v1》**（Owner 要求的可复用抽离模式，M4 直接复用）。
- 验收：seeder deposit-watcher/refund-worker 真实用户路径零退化（NWT d71ca8d0 MUST-FIX 项不可断）；OTC/exchange e2e 回归全绿。
- 前置澄清：V1 预测仍在借用 exchange-machine——M2 期间 exchange-machine 保留 V1 兼容面，待 M3 退役 V1 后再清。

### M3 预测系统内聚（🔴 钱路主批，分多子批）
- M3a：#28 P2 完成（真相源层模块化 + re-derive 纪律全状态推广——本来就是 #28 留给模块化阶段的工作，J1 域）。
- M3b：bshard vs V1 **功能对等清单系统核对**（J2 域；#30/v0.6 恢复机制缺口在此收口），补齐后 V1 退役方案单独出卡。
- M3c：结算 daemon 群独立进程化预备：切断共享 sqlite/直写 events/同 event-loop 三条耦合（bshard-settle-daemon 先行，已有 env 接口）。
- 每子批独立 NWT 红队；涉钱路项走 D-011 内部审核链（NWT 红队+互审→Bettor 判定驱动上线）。
- 硬约束：**live 盘不停、rolling 过渡不追加投入、ZK 主线（J2）优先级不被挤占**——M3 节奏服从这三条。

### M4 预测系统抽离（按 M2 playbook 执行）
- `apps/prediction/` 归拢 → 接口化 → daemon 独立进程化。tg-bot 的 `/api/pool/*` 契约冻结为对外 API 的一部分。
- 验收：tg-bot/UI 零改动可用；结算 e2e（含孤儿盘/重启穿越两个 85fit 场景）全绿；真金测试网下注-结算走一遍。

### M5 底座收尾与定位验收
- index.js 回归纯底座启动器；relay 命令注册机制替换硬编码 switch；IPC 白名单外命令全部迁入应用注册。
- **终验收（立项原文标准）**：写一个最小 demo 应用，只靠《底座 API 契约 v1》接入 KANet 完成"身份+通信+一笔结算"，**不改一行 KANet 代码**——fee-split 式冷启动计时公开验收。

---

## 4. 风险与不做清单

- **不一把梭**：任何"顺手把 X 也重写了"= 退回。每批只做本批清单。
- **不动 working 钱路**：M3 前预测结算代码零结构性改动（继续按 #28 既定 P 批推进）；抽离批只做"移动/接口化"，不做行为变更，行为变更单独出卡。
- **不物理拆库**（D1）、**不微服务化教条**（③→②渐进，收益不明的不出进程）。
- **NWT 带宽是全程瓶颈**（J1 已点破：一个窄模块吃一天全流程）——每批规模按"NWT 一个审查窗能吃下"切，宁多批勿大批。
- **回退方案**：M1/M2a/M4 纯结构批 git revert 即回；M2b/M3c 接口批保留旧路径 feature-flag 一个观察期后再删。
- **与公测运营/ZK 主线的火力配比**：留 Owner 磨合环节裁定（本稿默认：ZK(J2) 与 M3a(J1) 并行不抢占，M0-M2 用非钱路带宽推进）。

## 5. 对抗讨论问题清单（@J1 @J2 @NWT 各域至少打一条）

1. **J1**：D2 relay 命令注册机制会不会稀释"唯一链上出口"的审计面？真相源层（#28 P2）与 M3c 进程化的先后依赖你怎么排？
2. **J2**：M3b 功能对等清单的核对方法（逐命令？逐状态转移？）；V1 退役的用户面影响（存量 V1 offer 怎么收尾）；exchange-machine 的 V1 兼容面怎么切最小。
3. **NWT**：M1 协议分发器重排的攻击面变化（handler 注册=新的注入点？）；M0 lint 豁免基线机制会不会成为永久豁免的温床；每批审查窗规模上限你定。
4. **全员**：分批粒度、排序、以及"哪一批其实不必做"——删批比加批更欢迎。

---

**关联**：`docs/KANet-Positioning.md`（目标态原文）、`docs/2026-07-21-28-state-sync-architecture-full-design.md`（#28 全案，M3a 直接承接）、`docs/2026-06-22-modular-fee-split-component-spec.md` + `docs/2026-07-12-fee-split-phase3-package-notify-design.md`（范式①先例）、COORD-LEDGER 2026-07-21 尾部（Owner 终裁流程与范围）、memory `feedback-owner-unify-latest-delete-old-modularize`、`project-d011-owner-delegates-moneypath-signoff-to-bettor`。
