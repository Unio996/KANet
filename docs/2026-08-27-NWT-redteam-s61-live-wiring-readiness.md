# NWT 红队 — §6-1 LIVE wiring② 就绪清单

> 作者 NWT · 2026-08-27 · 派工 Bettor · 被审 = `docs/2026-08-27-j2-s61-live-wiring-readiness.md`（f4f93a14）
> Bettor 点名攻击焦点：**「§10 未落地 = §6-1 授权根悬空 = 不能真 LIVE」这个形状对 operator 手工签发的 Track-A 路径是否也成立**（(527)(528) 裁 Track-A 保持 operator 驱动）。
> **总评**：清单扎实、把 ⑥ 部署绑 §10、⑦=§10 都显式标了，**没有低估 §10 的自动化路径**。但 Bettor 问的 Track-A 那格，答案是**一半一半、且清单的"第一条真实运行证据"措辞需要一个硬限定**——见下。

## 核到的两个承重代码事实（先钉死，答案建在这上面）`[SRC HEAD 复核]`

1. **挑战 = 纯 nonce，绑定的是【存储对象】不是【身份】**：`u1_identity_challenge`（migrate.js:5696）= `(challenge PK, used_at, expires_at)`，**不带 relay_id、不带 requester pubkey**。`isStoreBoundTo`（u1-challenge-store.mjs）核的是 `b.sqlite===expectedSqlite && b.table===expectedTable` —— 即"这个 store **对象**绑到本次 DB 事务域 ∧ 规范表"（防伪造 store 对象），**不是**"这条挑战绑到某 relay_id / 某 key"。⇒ **一条 nonce 一旦签发，谁拿到谁都能消费、绑给任意注册。**
2. **N8 PoP 证的是【控住被注册的 pubkey】，不是【有权拿那个 relay_id】**：`verifyRegistrationBinding` 验签公钥 = 申报的 identity pubkey 本身（PoP）；但 `deriveCustody(sqlite, relayId)`（u1-registration.mjs:125）**只按 relayId 查 custody 类型**，`REG_REJECT` 全表**无 `RELAY_NOT_OWNED`**。⇒ 攻击者自签一套自己的密钥（PoP 过，他确实控自己的钥）+ 填任一 `custody=mnemonic` 的 relayId + 消费一条 nonce ⇒ **把自己的 pubkey 注册成那个 relayId 的身份 = 抢注（⑦）**。**身份↔relay_id 之间零密码学所有权证明。**

## 对 Bettor 问题的回答：形状对 Track-A **成立于耐久/对抗意义，但不阻断一次受控 E2E demo**

分两层，别混：

### （甲）一次受控 E2E demo（清单 §3 步2）—— §10 **不是**前置，可以现在做 ✅
- Track-A operator 驱动 = **operator 既签发 nonce、又为注册方的 relay 控制权背书**。E2E 里 KANet-UI 注册一个**已知身份**到一个**已知 relay**、operator 全程控两端。这是受控单发，⑦ 的抢注面**在这个受控场景里不被触发**（没有敌意方来抢）。⇒ **产出"§6-1 注册路端到端跑通"这条 liveness/plumbing 证据，不需要 §10。** (527)(528) 的 scope 对。

### （乙）Track-A 作为**真实/外部身份的耐久注册路** —— 形状**成立**：§10 未落地 = 授权根悬空 ❌
- operator 驱动**没有关掉 ⑦**，只是**收窄了"谁拿到 nonce"**。而两个承重事实说明：nonce 不绑 relay_id、不绑 requester key；PoP 不证 relay 所有权。⇒ **operator 一旦把 nonce 发给一个"它没独立核过 relay 控制权"的方（或 nonce 被截获），⑦ 抢注立刻活。**
- ⇒ **operator 驱动 = 用【operator 的人工背书】替代 §10 的【密码学所有权证明】。这是一个信任假设（console-loopback 信任模型，(528)），不是一道关上的闸。** 授权根在密码学上**不成立**、靠 operator 兜——这正是"悬空、靠人撑"。§10（pubkey 身份锚：payload 自带 pubkey + 验签，身份↔控制权密码学绑）就是把这道人工背书换成机器闸的东西。
- **⇒ 形状成立**：真实/外部/对抗场景下，§10 未落地 ⇒ §6-1 注册授权根悬空 ⇒ **不能作为可信注册路 LIVE**。与自动化路径同因（⑦=§10），只是 Track-A 多了一层 operator 人肉兜、把"悬空"暂时撑住。

### 🔴 清单需要的一个硬限定（防"E2E 过 = §6-1 LIVE"被读歪）
清单 §3 步2 称第一条 E2E 为「§6-1 LIVE 的第一条真实运行证据」——**字面对（plumbing 跑通），但必须钉一个限定**：
- **E2E-demo-LIVE（管路跑通、operator 控两端）≠ 注册授权-sound（对真实身份安全）**。
- E2E **不触发也不检验 ⑦ 防御**（代码里就没有 ⑦ 防御）⇒ **E2E 过，对"能不能被抢注"零信息**。它是 liveness 测试不是 security 测试。
- ⇒ **禁止把"E2E 过"写进 ledger 读成"⑦ 已处理 / §6-1 注册 LIVE-for-real"**。ledger 措辞须是"注册路 plumbing 在 operator 信任假设下端到端跑通；授权 soundness（⑦）待 §10"。
- 🔵 **E2E 至少该加一条负测臂**（不需 §10、现在就能做）：证 (529) 的孤儿活挑战 MUST-FIX —— 同一条 nonce **第二次消费必被 `CHALLENGE_ALREADY_USED` 拒**（清单 §3 步2 已含"第二次同挑战被拒"，好）；**再加**：一条**过期** nonce 被拒 + 一条**别的 relay_id** 用同 nonce（证 nonce 不绑 relay_id 这个事实是显式的、被测到的，而不是隐藏假设）。这样 E2E 至少把"nonce 不绑 relay_id"这条从**隐藏前提**变成**被测到的已知边界**。

## 其余格逐条核（清单自纠 + 我复核）
- ✅ **Bettor 派工清单被 J2 正确纠**：DECISIONS L141 旧三项 → L158/(456) 更正；`:1824` 早修属结算域、撤出 §6-1（④ 格）。**J2 纠得对**（我核 DECISIONS L158 + (456) 口径一致）。
- ✅ ③迁移 / ①handler / ②TOCTOU 在 live（v197 表在库 0 行 / 路由注册 / 事务内重派生）—— 清单标"代码在 live 进程 ≠ 已有生产注册发生（0 行）"**是诚实的**，没把"码在库"读成"已 LIVE 运行"。
- ✅ ⑤ escape-hatch：清单标"8/18 绿灯不可复用到 LIVE（样本窗陈 + 崩机进程全换）、LIVE 前必重跑、需新广播样本（IBD 期发不出）"—— **诚实边界，采纳**。这条是唯一"依赖节点同步（间接）"的，对。
- ✅ ⑥ 部署绑 §10 / ⑦ = §10 —— **两格都显式标了 §10 依赖，没有低估自动化路径**。我上面（乙）补的是 Track-A 那层"operator 兜 ≠ 闸"的诚实口径。

## 交付判词
- **清单 = PASS（就绪判断准确、诚实边界清楚、§10 依赖没低估）。**
- **回 Bettor 问题**：形状对 Track-A **成立于耐久/对抗意义**（⑦ 抢注面在 operator 驱动下仍活、只被人工背书暂撑）；**但不阻断一次受控 E2E demo**（operator 控两端、产 plumbing 证据、§10 非前置）。
- **一个硬限定（须落 ledger）**：E2E-demo-LIVE ≠ 注册授权-sound；E2E 过对 ⑦ 零信息，禁读成"§6-1 注册 LIVE-for-real"或"⑦ 已处理"。授权 soundness 的闸是 §10，未动。
- **一个 E2E 增强建议（不阻塞、现在能做）**：加"过期 nonce 拒 / 同 nonce 换 relay_id"负测臂，把"nonce 不绑 relay_id"从隐藏前提变成被测边界。
- 待手工签发 runbook + 脚本（J2 写、不执行）到，我按"纯 nonce 单发 + 孤儿清理 + (529) MUST-FIX"再审那份。
