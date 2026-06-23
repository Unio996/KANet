# KANet 预测+预言机系统 · 功能现状图 + Gap 表

> 2026-06-11 | 对抗性系统梳理(Owner 钦点)。**方法:Bettor 3 agent fleet 并行扫码 + 频道 5 agent(J2/J1/KANet-UI/NWT)独立验自己域 + NWT 红队逐格 code:line + curl/DB 三重独立复现。8 agent 并行、cross-verified、非 solo。**
> 用途:验收底图 —— 哪些功能真有/真缺、代码在哪定位。

---

## 一、三角色 × register / edit / revoke 现状(cross-verified)

| 角色 | register 注册 | edit 编辑 | revoke 撤销/unstake |
|---|---|---|---|
| **maker** | 🟠 create-v07(pool.js:696)——非角色 enroll,谁建市场谁是 maker | 🔴 GAP(无市场 edit 端点;SS 链上锚定不可变)| 🔴 GAP(无主动撤市场;靠 settler timeout)|
| **oracle** | ✅ enroll(oracle-pool.js:173)+ 注册 modal(agent-v2.eta)| 🔴 GAP(无端点,L199-202 须 unstake+re-enroll;Phase2 deferred)| ✅ timeout-unlock(oracle-pool.js:358-438,**lock_until_daa 过后**,无 slash 路径)|
| **gateway(原 broker)** | 🔴 GAP(curl POST /api/kanet-broker/register → **404 实测**;DB is_dex_broker=1 count=0)| 🔴 GAP(只读:markets/earnings GET 有;无写端点;fee per-market 创建时设、不可改)| 🔴 GAP(broker_stake schema 有/0 端点用)|

**+ DM 单子推荐 🔴 GAP**(prediction-menu 只有用户主动 /bet,无推荐逻辑/端点/推送)。

### ⚠ 关键区分:GAP 分两类(NWT 红队定论,别误读)
- **by-design 不可变(非缺陷,别"修")**:maker edit / oracle edit / maker revoke —— spec-hash 链上锚定,改需求只能 re-create,这是协议设计正确性,不是漏。
- **真该补的 GAP(schema 设计了没 wire)**:**gateway register / edit / revoke + DM 推荐** —— 这才是开测前要 wire 的活。
= 现状图里"全是 GAP"的表面下,真正缺的是 **gateway 那一行 + DM 推荐**;oracle/maker 的 edit/revoke "GAP" 是故意的。

## 二、🎯 关键洞察(解 Owner "我一直以为这几件都做了")
**gateway 有【整套 broker 质押/审批 schema 设计了】**(relay_nodes:broker_stake_locked_kas + broker_stake_lock_until + broker_approved_by/at,v124 已建)**但【0 端点接线】= 设计完成、没 wire。** DB 看着像做了(schema 在),功能没接 = "以为做了、实际没 wire"。oracle 那套是 wired 的(work),gateway 只画图没接线。

## 三、术语撞名(NWT 红队确认,防混淆)
- **Track A 交易 broker**:broker.js(:115 accounts /:210 order)+ broker_accounts 表 + broker-*(Alpaca/IBKR/Tiger)= CEX/股票账户,**另一概念**
- **Track B 网关 broker**:kanet-broker.js + broker-home.eta + @KANET_Broker_bot + relay role='broker' = 预测系统用户面
- **Owner 已裁:Track B 角色名改 gateway**(一次改名永绝后患)

## 四、系统组件图
| 域 | 代码 |
|---|---|
| 预测系统 | pool.js + bettor-*/pool-* services(create/vote/settle/bettor-register)|
| 预言机系统 | oracle-pool.js + oracle-sampler + bettor-prediction-voter |
| Track A 交易 | trading.js/exchange.js/broker.js + broker-*(Polymarket/CEX/股票)|
| Track B 网关 | chat.js/relay.js/kanet-broker + tg-bot |
| 共享基建 | db/lib/wallet/asset/fund-lock/relay-manager |

## 五、修向(团队对抗讨论收敛,非从零设计)
**gateway register/edit/revoke = 镜像 oracle enroll/unstake 模式**(J1 #130 给了可照搬模板):
1. **enroll 端点**:POST /api/kanet-broker/enroll —— UPSERT broker_stake_enrollments 用现成 v124 schema + 返 p2sh 让用户转 stake 锁
2. **跨节点链广播**:broker_stake_enroll_v1 envelope
3. **timeout-unlock**:校 currentDAA >= lock_until_daa → 本地 relay reclaim
4. **edit**:gateway/oracle 编辑端点(改 fee/display,需新设计或 Phase2 对齐)
5. **DM 单子推荐**:新功能(prediction-menu + broker-action-queue 加 dm_market_recommend)
6. **maker dashboard**:补 maker-created-markets 视图(现 my-positions 是 taker 视角)

## 六、下一步(流程:方案 → Bettor 审 → 码 → 浏览器测)
据本图编实现方案(gateway 三件套镜像 oracle + DM 推荐 + maker dashboard + oracle/gateway edit)→ Bettor 关2 审 → 团队码 → 浏览器测验收。broker→gateway 改名并入。
