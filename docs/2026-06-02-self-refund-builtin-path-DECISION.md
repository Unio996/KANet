# 决议 — bettor 自取退款走 KANet 内置 path(覆盖 r487 外部钱包路)

> **性质**: Owner 直接 catch + 1-author 决议(无对抗讨论, 因方向显错需快速反向)
> **作者**: KANet-UI-tn(执行) | **日期**: 2026-06-02
> **触发源**: Owner 06-02 catch "不能用 kanet 系统自取吗?关键我们这里可以消息传递"
> **状态**: 🔒 **锁定(2026-06-02)** — Owner 直接 catch + 与 KANet 协议本意(Relay = 价值代理)一致, 反向 r487 错研究.

---

## 0. 一句话

bettor 失败市场的 PoolSide_v07 entry2 / refund_market_cancelled 自取退款, 走 **KANet bot → Console → Relay 内置签名+广播** 路径, **不引外部钱包(Kasware PSKT)**. r487 (Kasware/KDX 钱包兼容性研究 / 推 Kasware signPskt) **决议作废, 仅留作 future open-dApp 场景的参考**.

---

## 1. 反向理由

### 1.1 r487 错在哪
r487 假设 bettor 持私钥在外部钱包(Kasware/KDX)→ Console 构造 unsigned TX → bettor 用钱包 PSKT 签 → 广播. 这套路设计给 **任意 web2 用户带自己钱包过来用** 的 open-dApp 场景.

### 1.2 KANet 实际场景
- 每个 bettor 通过 tg-bot `/link` 已绑 `telegram_user_id ↔ kaspa_address`(`link_bindings` 表).
- **Relay 持 bettor 的 schnorr 签名 key**(KANet "消息+价值代理" 的协议本意, 见 CLAUDE.md "五大系统" + KANet-Positioning.md "Relay 是唯一链上出口").
- 现有 ext-pool register-v06/prep+confirm + side stake transfer 全程都走 Relay 签 KAS 转账, bettor 从没碰过外部钱包. 自取退款没理由突然要求 bettor 装 Kasware.
- **测试网公开演示阶段没有"外部钱包 web2 bettor"场景**(我 memory `project-endpoint-testnet-public-not-mainnet`).

### 1.3 协议角度
KANet ≠ open dApp. KANet 是 **AI Agent 用 Kaspa 信任链连接社交+市场的协议基础设施**, Agent/bot/Relay 三件套是一体的. 把 bettor 推到外部钱包 = 协议自废"消息+价值统一代理"的核心价值主张.

---

## 2. 决议路径

### 2.1 自取退款流程(实施)
1. bettor 在 tg-bot 点 "领取退款" 按钮 (= /refund <market_id> command).
2. bot → Console `POST /api/pool/market/:id/bettor/refund-claim` (新 endpoint, builder J2 已 ship 7132ddd `unlockPoolSpineRefundMakerUnjoined` 共用 byte-size mass-aware 模式).
3. Console 查 `link_bindings` 找 bettor 的 relay_id → 找 side_p2sh + side_redeem_script_hex.
4. Console → relay command `pool_refund_bettor_tx` (新 relay command).
5. relay 构造 PoolSide_v07 entry2 unlock TX (`tx.time>=deadline+refundGraceSeconds` 守 Bettor 7a41fa80 grace window), 签 bettor input, 广播.
6. relay 写 `pool_bettor_sides.claim_txid = refund_txid`, Console 写 `chain_event: bettor_refund_claimed`.
7. bot 反馈"已退款 ✓ TX:<txid> 链浏览器深链".

### 2.2 范围
- 适用: **PoolSide entry2 (refund_market_cancelled) 自取**.
- 适用: **PoolSpine refund_maker_unjoined 自取**(maker 视角同模式).
- 不适用: **settle_aggregate 的 winner 直付**(那是 settler 主动派发, 不需 winner 自取).

### 2.3 grace window 必守
Bettor 7a41fa80 修法 hardcode `refundGraceSeconds = 7200` (2h), settle TX 必先于 grace 满落链. 自取 builder 必 enforce: `now >= (deadline + refundGraceSeconds)` 才允许构造 unlock TX, 否则返 409 "wait grace window". 防 settle ↔ refund race.

---

## 3. r487 处理

- r487 broadcast 在 channel 仍可查, **不删** — 留作 future open-dApp 场景研究参考.
- 不实施 Kasware signPskt adapter (browser side).
- 不引 `window.kasware` 依赖.
- KDX drop 仍生效 (反正 deprecated, 跟本决议无关).

---

## 4. 下步动作

| Owner | 下一步 |
|---|---|
| J2 | builder 7132ddd 已 ship, 后续接入 Console refund-claim endpoint + relay command |
| KANet-UI | bot UI: "领取退款" 按钮 + grace window 倒计时 + 链浏览器深链 (= 替代 r487/2 的 Kasware adapter 工作量) |
| Bettor | 实证 e2e: thin-market cancel → grace 满 → bot 点退款 → 链上 refund_txid 落 → bot 反馈 |

---

## 5. 记账

- **r487 (Kasware/KDX PSKT 研究)**: 研究本身没错, 结论 (Kasware signPskt 可行) 也准, 但 **场景适配错** — 假设了 KANet 没有的"外部钱包 bettor"场景. Owner 一句"消息传递"点醒.
- **教训**: 研究前先 sanity-check 场景假设, **凡 bettor / oracle / maker 行动都默认走 KANet Relay**, 除非有明确"外部用户"需求.
