# Gateway (原 broker) Wiring 实现方案 — 链下 facilitator

> Owner 终裁 2026-06-11: gateway = **链下 facilitator**(守 KB roles/broker.md + products/03:56 "broker 0 链上动作"; roles_json/config 配置; **无链上 stake bond**, 不镜像 oracle)。
> KANet-UI lead 出方案 → Bettor 事先审(查别碰签名载荷/canonical) → 码 → Bettor 事后审 + 浏览器测。J2 fee realization 配合。
> 红队: NWT 逐项验(browser + code:line) / J1 :3300 跨节点验。

## 0. 现状(红队验证, 2026-06-11)

3 角色 × 3 操作 gap 表(NWT r56/r59 + J1 #129 + 我实测):
| | register | edit | revoke |
|---|---|---|---|
| oracle | ✅ enroll | 🔴 GAP(by-design unstake+re-enroll) | ✅ time-gated unlock |
| **gateway** | 🔴 GAP | 🔴 GAP | 🔴 GAP |
| maker | ✅ create-v07(建市即入场) | 🔴 GAP(spec hash 烤死) | 🔴 GAP(只 settler timeout) |

- gateway 三格全 GAP: curl POST /api/kanet-broker/register→404; DB broker relay=0; roles_json 0 WRITE 端点。
- v124 schema(broker_stake_locked_kas/lock_until/approved_by/referral_code)= 链上质押漂移废弃,**链下方向不 wire stake 列**。
- create-v07 L263: `broker_relay_id omitted → maker_relay_id` + broker_fee_pct default 0 = **②gap: user-facing 市场 broker 塌成 maker, fee=0**。

## 1. ① register / edit / revoke — 链下(roles_json/config)

gateway = relay 上的角色属性(roles_json), 无 stake。复用/扩展 relay.js role-update(L210-245, 已设 role + is_dex_broker)。

- **register**: relay 自助登记 = roles_json 加 "broker"(+ is_dex_broker=1 legacy 同步) + config(broker_fee_pct 默认 fee% + 收款址=relay 自带 address + DM 推荐开关)。约束: broker/oracle 互斥(Area 1.4, bettor.js:2153 已有校验, register 时复用)。
- **edit**: 改 config(fee% / DM 推荐设置 / 收款址)。display+config 层, 不碰签名载荷。
- **revoke**: roles_json 去 "broker" + is_dex_broker=0。无 unstake(无 stake)。
- **UI**: /broker→/gateway 一站式(register → config → 看名下市场+收入[已有 kanet-broker/markets+earnings GET] → revoke)。

## 2. ② broker-fee wiring + 跨节点根治(J1 #138 flag / NWT r62 / J2)

**核心跨节点问题(团队红队)**: 链下 register=roles_json **仅本地**(无跨节点广播, NWT grep 实证)。settler broker fee 地址 L1499-1505 用 `broker_relay_id → SELECT relay_nodes.address`, 查不到 **整个 dispatchPhase2 ABORT(settle BREAKER, 不只 fee 丢)**。跨节点(:3300 没这 gateway relay)→ settle 全停。

**根治(NWT r62, 现成 pattern)**: settler broker fee 输出镜像 bettor external 双路(L1517-1524):
- relay-bound: relay_nodes 查(本地)
- **external/跨节点: 查不到 → 从 `market.broker_pk` 派生地址(`new XOnlyPublicKey(broker_pk).toAddress(net)`, 同 L1522-1524)**。broker_pk 已签进 market signed payload(L180, P2PK 重构跨节点一致)→ 链下 register 跨节点 settle 也安全。
- = settle 收款址 anchor 到 **broker_pk(签名 market, 跨节点)**, 非 per-node roles_json/relay 查 → 解 J1 跨节点身份一致性担忧。

**wiring**:
- create-v07 设市场时: broker_relay_id = gateway relay + **broker_pk = gateway relay 的 x-only pk**(签进 payload → 跨节点)。
- user-facing 市场(seeder _kanetui_userface_seeder.cjs + bot 建市): 传 broker_relay_id = 指定 gateway + broker_fee_pct > 0(不留空塌 maker)。
- **settler 根治** = J2 域(他熟 settler): L1499-1505 加 broker_pk fallback。

## 3. ③ fee realization 验证(J2 配合)

建 fee>0 市场 → 实用户押 → settle → 确认 gateway 收款址(broker_pk 派生)实收 broker fee **落链**(same-node + 跨节点, broker 非本地节点也对)。

## 4. ④ broker DM 全链 exercise(Owner 钦定)

测试压铸走 broker DM, broker 角色实被 exercise。**待明确**: 预测语境 broker DM 流程 = gateway 给用户推荐市场(bettor.js /api/bettor/recommendations, r409)+ 引导押注? 还是走 broker-v3 DM? 这条 Bettor 审时定具体流程。

## 5. ⑤ broker → gateway 改名(Owner 早裁)

- docs + code 的 Track B broker 引用 → gateway(我 Track B 域)。注意区分 Track A 交易 broker(broker.js IBKR / products/01, 不改)。
- bot username @KANET_Broker_bot: Telegram 约束, 改 username 破 deep-link, testnet demo 倾向保留 username(角色文案/UI 改 gateway), Bettor 审时定。

## 6. 实现切片 + 验收

| 切片 | 内容 | 域 | browser 验收 |
|---|---|---|---|
| S1 | gateway register/edit/revoke 端点 + /gateway 一站式 UI | KANet-UI | 注册→配置→看→撤销跑通 + 真写 roles_json |
| S2 | broker-fee wiring(create-v07/seeder/bot 设 broker_relay_id+broker_pk) | KANet-UI | 市场真设 broker(非塌 maker) |
| S3 | settler broker_pk fallback 根治 | J2 | 跨节点 settle broker 非本地不 ABORT + fee 落链 |
| S4 | broker→gateway 改名 | KANet-UI | UI/docs 一致 |
| S5 | broker DM 全链 + fee realization e2e | KANet-UI+J2 | fee>0 市场 settle → gateway 收 fee 落链(跨节点) |

红队(NWT): 每格 EXISTS 必 browser+code:line 验, 无据降 GAP。跨节点(J1 :3300): S3/S5 跨节点 settle 验。

## 7. 待 Bettor 事先审定的设计点

1. ④ broker DM 全链具体流程(recommendation vs broker-v3 DM)?
2. ② 哪个 relay 当 user-facing 默认 gateway(新建专用 / 用现有)?
3. ⑤ bot username 改不改(Telegram deep-link 约束)?
4. DM 推荐配置具体 settings(给哪些用户/哪些单/频率)?
5. S3 settler 根治: broker_pk fallback 加在 J2 settler 域(确认 J2 接)。
