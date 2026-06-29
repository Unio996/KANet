# Owner 两主线设计 — broker 收益 DM + 首页 UX(设计先行·待 Owner 终裁)

**作者**: Bettor(协调/架构)· **日期**: 2026-06-28 · **状态**: 设计稿待 Owner 终裁 → 终裁后才派工实现
**原则**: 设计先行(Owner 2026-06-28 钦定)。本文档是架构产出,不是实现;实现走派工(J2/KANet-UI),我审码+验落链。

---

## 主线 ① broker 收益可见性 DM(Owner #1·核心)

### 目标(Owner 原话)
> "每个不同的 broker,和他相关的一笔收入到账,电报 DM 就能通知到他,这才有意思。"

### 机制链(端到端)
```
市场 settle/close
  → broker fee 输出在链上 LAND(真 TX,不是 DB 记账)
  → broker_fee_landed 事件(J2 broker-fee-emit.mjs 已建·b8bb2532)
  → 取 broker_address
  → 映射 broker 的电报 chat_id        ← 【设计命门,见下】
  → 主 bot 发 DM:"💰 你经手的市场「X」结算,你赚了 Y KAS"
```

### 🔴 设计命门:地址 → 电报 chat_id 映射(查实后的决策)
**现状(2026-06-28 查 DB 实证):**
- `broker_onboarding`(broker_address, bot_token_encrypted, bot_username, status…)→ **无 tg_user_id / chat_id**,且 **0 行**(还没人 onboard)。broker 自带 bot,我们不持其 chat_id。
- `tg_custodial_wallets`(tg_user_id ↔ kaspa_address)→ **托管/玩家用户有 地址↔tg_user_id 映射**。

**设计(分阶段,先覆盖能覆盖的):**
- **Phase 1(MVP·立刻可做)**: broker 收款地址 ∈ `tg_custodial_wallets.kaspa_address`(或玩家 /link 的地址)→ 查出 `tg_user_id` → 主 bot `sendMessage`。
  **覆盖面**: 所有"通过我们 bot 玩 + 收款到托管/已 link 地址"的 broker。这是 demo 能立刻跑通的真实闭环。
- **Phase 2**: `broker_onboarding` 加 `tg_user_id` 列(migrate),onboard 流程捕获 broker 的电报 → 覆盖"独立 onboard(自带 bot,不玩托管)"的 broker。

### 🔴 收益数值正确性(承重·复用已定铁律,不可退)
- **market-scoped 不 address-scoped**(教训:地址被挖矿 coinbase 污染,address-sum 出过 102,062,949 KAS 垃圾,真 fee=0.32)。
- earnings = 遍历该 broker 经手市场 → 各市场 settle/close TX → **parse outputs_json 找那个 broker-fee 输出**(match broker_addr + 预期 fee=brokerBps×pool)→ sum。
- broker_fee_landed 事件的 fee_sompi 必须来自**实际 LAND 的输出**,不是预估。

### DM 文案(草案)
```
💰 收益到账
你经手的市场「<title>」已结算
本笔 +<fee> KAS  ·  累计 <total> KAS / <n> 单
▸ /earnings 看明细
```

### 防重复
broker_fee_landed 去重键 = (settle_txid + market_id + broker_addr);每笔 fee 只 DM 一次(进程重启/事件重放不重发)。

### 跨节点 honest scope
`:3300` broker 市场不在 `:3200` 本地 `pool_markets` → 该节点 broker 在 `:3200` 查收益=0/缺。**标 honest,Phase 2 解。**

### 派工(Owner 终裁后)
| 切片 | owner | 我(Bettor)验 |
|---|---|---|
| broker_fee_landed 覆盖每笔 fee LAND(settler close 路径)+ 去重 | J2 | 审码 |
| 地址→tg_user_id 映射 + 主 bot DM 投递 + 文案 | KANet-UI | 审码 |
| 链验真 fee(predict-then-verify,x4kpq=0.32 对死)+ DM 实测落地 | — | Bettor 本职 |

### 🎯 "拿出来"——端到端 demo 路径设计(2026-06-28·送 NWT 审)
**Demo 目标(可演示的最小闭环):** 一个真实市场结算 → broker fee 真落链 → broker 电报收到「💰 你赚了 X KAS」。
**Demo 场景(具体):**
- broker_address = **Owner 托管地址 `qzhet…gzgdl`**(= tg_user 1437320734,有 DM 目标;系统现有 10 个托管钱包可作 broker)。
- 该市场有押注 → 到 deadline → 结算 → pari-mutuel fee skim → broker fee 输出落链 → broker_fee_landed 事件(J2 emit)→ poller(B1 修后,KANet-UI)→ DM 到 1437320734。

**前置(查实 2026-06-28):**
- broker_fee_landed 现 **0 条** → 必须一笔 **fresh** fee 落链才能触发(现有 settled 市场 broker ≠ Owner 地址 + backfill 抑制,不能复用)。
- fresh 市场要能 settle = 依赖 **NUM2BIN 8B fix live 生效**(J2/J1 settle 路,非 DM 层)。
- B1(DM 投递)修完。

**谁干(派工,Bettor 不碰执行):**
| 切片 | owner |
|---|---|
| 建+结算 demo 市场(broker=Owner 托管地址,走 8B settle) | J2(settle)+ J1(跨节点同证) |
| B1 修 + DM 投递 | KANet-UI(已派) |
| 链验 fee 真 LAND + DM 真到(predict-then-verify) | Bettor(④验落链) |

**待 NWT 审:** 此 demo 路径有没有漏?(backfill 抑制会不会挡 fresh 事件?fee skim 金额对不对?broker=Owner 自己当 broker 会不会有自押/自结算的怪边界?)

---

## 主线 ② 首页 UX(Owner #2)

### 现状(2026-06-28 查实)
KANet-UI 已 ship 新 /start(频道 07:23),bot 进程 14:22 重启 > messages.mjs 13:02 修改 → **新码已载,非部署陷阱**。
现版输出:`👋 KANet·你已就绪 / 📍 addr 托管·仅试玩 / 🔥 热门市场 Top5(bettors≥3)`。

### 🔴 设计差距(为什么你可能仍觉得"一模一样")
你要的"根本改变"是:**赛事聚合卡**(如「🇧🇷巴西赢2球 赔1.95×」)+ 信任卡 + 自解释按钮。
现版本质还是**市场标题列表**(伊朗/MicroStrategy…)+ 文案精简,**没有事件聚合卡的视觉重构**。这是设计层面的差距,不是接没接通的问题。
- J2 已 ship 赛事聚合卡后端 `GET /api/pool/markets/card_groups`(229e4122,带 leg_key/赔率/bettor_count/trust 字段)→ **后端已就位,前端卡片渲染未做**。

### 待终裁的产品决策(J1/J2 提出 → 我收敛 → 你拍)
1. **赛事卡空盘(0 bettor)显不显?** J1 指出"鸡生蛋":(A) 只显真人活跃市场 → 新盘永远 bootstrap 不进来。
2. **我的设计建议(混合):** 首页分两区 —
   - **🔥 热榜区**(社会证明·bettors≥3·真实热度)
   - **🆕 新盘区**(信任卡·诚实显人数·不假热度,让新盘能起步)
   demo 今天 (A) 5 真实市场够用;**新盘信任卡区放量前必做**。

### 派工(Owner 终裁后)
| 切片 | owner | 我验 |
|---|---|---|
| 赛事聚合卡前端渲染(用 card_groups 后端)+ 热榜/新盘双区 | KANet-UI | 审 UX + DM 实测 |

---

## ❓ 只有 Owner 能拍的两件事(终裁)
1. **broker DM**: Phase 1 MVP(先覆盖托管/已 link 地址的 broker,立刻能 demo)够不够先上?还是必须先把独立 onboard broker 也覆盖(Phase 2 migrate)?
2. **首页**: 现版(文案精简+热榜列表)是不是你要的?还是要上**赛事聚合卡视觉重设计**(后端已就位,差前端)?
