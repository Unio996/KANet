# §6-1 ⑥ 生产挑战签发口 · 设计稿 v0.1（只设计·给 Owner 批的材料·零落码）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-27 · Bettor 派工 (VB-4) · **只设计不写码**。用户面+身份路, 动码必须 Owner 批 —— 本稿是**给 Owner 批的材料**, 不是实现。**列利弊、不拍**。
> 🔴 **不改 §6-1 冻结定义**(D-012 §6-1 定义冻结 2026-08-17; DECISIONS.md D-012 2026-08-03 Owner 终裁; memory `project-d012-s6-1-definition-freeze`)。本稿只是**签发这一步的生产化**, receipt→state 授权语义/纯 nonce/isStoreBoundTo 绑定/⑦ 抢注边界**一律不动**。
> **现状**: ⑥ 只有 operator 手工 CLI(`kasia-console/scripts/u1-issue-challenge.mjs` 6233f61e/7d20a5f8)+ `u1-build-submission.mjs`; **无任何 HTTP 签发端点**(`api/identities.js` 只有 `POST /api/identity/u1-register`:263, 无 u1-challenge)。Track-A 注册路 E2E 六臂 GREEN(ledger (635)); ⑦ relay_id 抢注待 §10。
> **证据纪律**: 每条断言带 `file:line`。

## §0 边界（先钉死不做什么）
- **不改 §6-1 冻结**(上)。挑战仍是**纯 nonce**(`u1-issue-challenge.mjs:9,23` `randomBytes(32)`, v197 表只有 `(challenge, used_at, expires_at)` 无 relay_id, (527) 裁 (i))。
- **不解 ⑦ 抢注**(§10)。签发口生产化**不改变** ⑦ 暴露面; 本稿不得写"抢注已挡"。
- **不触 CAS/授权语义**: 消费 CAS 在注册侧(`u1-registration.mjs:274 consumeBoundChallenge`, `u1-challenge-store.mjs:49` `UPDATE...WHERE used_at IS NULL`), 本稿不动。
- **(527)(528) 现行裁定**: 自动签发口**不部署**、Track-A operator 驱动。⇒ 本稿从"手工"走向"生产化"**须 Owner 明批推翻/放宽 (527)**, 否则默认维持手工。这是本稿要 Owner 拍的核心。

## §1 形态（三选一·列利弊·不拍）
| 形态 | 是什么 | 利 | 弊 | 与 (527) 关系 |
|---|---|---|---|---|
| **A. console HTTP 端点** `POST /api/identity/u1-challenge` | 复用 fastify(同 `identities.js:263` register 端点位), 请求→签发一条 challenge 返回 | 可编程接入(外部程序自助)、与 register 端点同栈同鉴权体系 | 常驻可达=攻击面(限速/鉴权/审计全要); 违 (527)"不部署自动口" 除非 Owner 放宽 | **需 Owner 推翻 (527)** |
| **B. 常驻 CLI 服务** | issue 脚本包成 daemon/queue 消费 | 不开 HTTP 面; 可插审计 | 仍是"自动签发口"(违 (527)); 多一个常驻进程=多一个故障域(接 VB-2) | **需 Owner 推翻 (527)** |
| **C. 保持手工**(现状) | operator 每次手跑 `u1-issue-challenge.mjs --commit` | 零新攻击面; 合 (527); 已 E2E GREEN | 不可编程/不可规模化; operator 在环=人肉瓶颈 | **合 (527), 无需新批** |
- 🔵 **推荐决策法(非拍)**: 先答"⑥ 生产化服务哪条 Track"(D-012 §0 判据: 引 D-012 支持"让外部人注册"前先答 Track, 见 DECISIONS.md D-012)。Track-A(Owner 实例)→ C 够; Track-B(协议对外)→ A/B 但须 §10 抢注先解 + Owner 拍。

## §2 谁能要挑战 + 鉴权
- **现状**: operator 手跑, 无"谁能要"鉴权; 唯一前置 = `deriveCustody(sqlite, relayId)` 非 ok 即拒(`u1-issue-challenge.mjs:60`, 复用注册侧 N4-bis 谓词)——即"只给 custody=mnemonic 的本机 relay 签"。
- **选项(A/B 形态下)**:
  | 谁能要 | 鉴权 | 利弊 |
  |---|---|---|
  | 匿名 | 无 | 最开放; 但 challenge 是资源(§3)⇒ 必配强限速, 否则刷爆孤儿 |
  | 限某 relay/pubkey | 请求方证明控住某 pubkey(challenge-response 前置) | 收窄面; 但"要挑战"本身又需要一个挑战=鸡生蛋, 须另一层信任根 |
  | operator/admin | `checkAdminSecretTier`(`admin-secret-tier.mjs`, 同 `operator-settle.js` 模式)+ `ADMIN_IP_ALLOWLIST` | 与现有特权端点一致; 本质仍是"operator 驱动"只是走 HTTP=A 形态的最小放宽 |
- 🔴 **与冻结的关系**: 挑战纯 nonce 不绑 relay_id(§0), 所以"限某 relay"只能在**签发策略层**(谁能要)加, **不进 challenge 本体**(进了=改冻结)。

## §3 限速/防刷/防枚举（challenge 是资源）
- **枚举**: challenge 是 `randomBytes(32)`(`u1-issue-challenge.mjs:23`)= 256bit 不可枚举/不可预测 ⇒ **枚举攻击不适用**。
- **防刷(真风险)**: 无鉴权的签发口被刷 ⇒ 大量未消费 challenge = 孤儿堆积。现有 orphan 清理 `WHERE used_at IS NULL AND expires_at <= now`(`u1-issue-challenge.mjs:74`, (529) MUST-FIX)在**下次签发时**清, 不是主动 GC ⇒ 刷爆期表膨胀。**无现成 rate-limit 基建**(grep 未见 rateLimit 模块)⇒ 要新建。
- **选项**: per-IP 令牌桶 / per-relay 配额(限 custody 通过的 relay) / 全局并发上限(现幂等是**全表级**"一次一条活挑战" `u1-issue-challenge.mjs:⑤` ⇒ 天然限"同时只 1 条活", 但那是为 Track-A 单注册设计, 生产化多请求会撞)/ PoW 成本门。
- 🔴 **全表级幂等 vs 多请求**: 现脚本"存在活挑战就不签、返既有"(纯 nonce 无 relay_id 列所以只能全表级)。**A/B 形态多并发请求下这个粒度会串行化/互相拿到别人的 challenge** ⇒ 生产化**必须**重新设计幂等粒度(per-requester?), 但 per-requester 需要 challenge 绑 requester = **触冻结** ⇒ 死结, 归 §10/Owner。

## §4 challenge 存储/唯一性/CAS/过期（一律复用, 不改）
- **表**: `u1_identity_challenge`(`u1-challenge-store.mjs:24`), 列 `challenge TEXT PK, used_at INTEGER, expires_at INTEGER`(:29)。challenge 是 PK ⇒ 唯一性 DB 强制。
- **CAS 消费**: 在**注册侧**(`u1-registration.mjs:274`), `UPDATE...SET used_at=? WHERE challenge=? AND used_at IS NULL`(`u1-challenge-store.mjs:49`)。签发口**只 INSERT**, 不碰消费。
- **过期**: 签发写 `expires_at=now+ttl`(`u1-issue-challenge.mjs:12`); 注册侧判 `expiresAt<=now⇒CHALLENGE_EXPIRED`(PoP 前置 `u1-registration-pop.mjs:103` + 事务内 `u1-registration.mjs:269`, E2E 实测撞前置)。TTL 默认 5min, clamp 60s..60min(`u1-issue-challenge.mjs:32,40`)。
- 🔴 **CAS `.immediate` 作用域雷(接冻结实现)**: `.immediate` 只序列化**持身份表的那个连接**(`u1-challenge-store.mjs:6-7`, (370) 洞)。**若签发口用【另一个 DB 连接】INSERT、注册侧用【原连接】消费, 跨连接不被 `.immediate` 序列化** ⇒ 生产化端点**必须**与注册侧共用同一 handle(现脚本靠 `DB_PATH`+`client.js` 拿同一 handle, `u1-issue-challenge.mjs:44-49`)。端点化后要保证这条, 否则 CAS 保证塌。

## §5 与 u1-build-submission 契约不变（+ S10 envelope 预留位）
- submission 六字段 `{relayId, rootXpub, identityIndex, identityPubkeyXOnly, challenge, signature}`(runbook §4 步 2; `u1-build-submission.mjs`)。签发口**只产 challenge 一个字段的值**, 六字段契约/PoP 构造**不动**。
- **S10 预留**: 跨节点 pubkey 身份(memory `s10-crossnode-pubkey-identity`, `reference-kanet-cross-node-identity-is-pubkey-in-protocol`)——签发口设计**预留一个 envelope 位**(如返回体 `{challenge, expires_at, _s10_envelope?}`), 但**本稿不定义 S10 内容**(它待 §10)。只保证端点形态不阻断未来加 envelope。

## §6 审计日志（谁·何时·要了什么·被拒原因）
- **现状**: issue 脚本只打终端 report(`u1-issue-challenge.mjs` report 对象), **无持久审计**。
- **设计**: 每次签发/拒绝写一条审计(可复用 `events` 表, 同 chain_events/ingest 审计模式): 字段 = 请求方标识(IP/relay/admin)、时刻、结果(ISSUED/拒因如 deriveCustody code/rate-limited)、challenge 前缀(**不记全值**, 活 bearer, `u1-issue-challenge.mjs:22`)。拒因枚举 = deriveCustody 各 code(RELAY_UNKNOWN/CUSTODY_AMBIGUOUS/CUSTODY_NOT_MNEMONIC)+ rate-limited + expired-orphan-cleaned 计数。
- 🔴 challenge **消费前不进任何持久物**(审计只记前缀), 同 E2E 纪律。

## §7 失败面（签发 key 托管 / 泄露后果 / 接 VB-2）
- 🔵 **当前无"签发 key"**: challenge = 纯 `randomBytes(32)`(`u1-issue-challenge.mjs:23`), **不签名、无签发私钥** ⇒ "签发 key 泄露"当前 **N/A**。
- **若生产化加"签名 challenge"**(绑发行方/防伪)⇒ 引入一把签发 key ⇒ 托管问题: 放哪? 若放 console(同 `CONSOLE_ENCRYPTION_KEY` 域)⇒ **与 VB-2 的 32/32 relay key 同 db 同 key 同故障域**(`docs/2026-08-27-kanet-ui-watchtower-failure-domain-facts-v0.1.md`: 32/32 relay 私钥全在同一 console.db 同一 CONSOLE_ENCRYPTION_KEY)⇒ console.db/key 泄露 = 签发 key + 全 relay key 一锅端。**建议(若加签): 签发 key 独立托管, 不复用 CONSOLE_ENCRYPTION_KEY 域**。
- **challenge 泄露后果**: challenge 是活 bearer(`:22`), 但**单有 challenge 不够注册** —— 注册需配对的 PoP 签名(需 identity privkey)。⇒ 泄露 challenge 的危害 = **仅当攻击者同时能对目标 identity pubkey 签名**(即已控 identity key)才能盗注册; 否则泄露的 challenge 顶多被拿去做别人的合法注册的 nonce(而它一次性、消费即废)。**真失败面 = identity key(32/32 同 db)+ challenge, 不是 challenge 单独**。
- **DoS 面**: 见 §3(刷爆孤儿)。

## §8 给 Owner 的决策点（Bettor 精炼上报）
1. **⑥ 生产化属哪条 Track?**(D-012 §0 判据)—— Track-A → 维持手工(形态 C)已 GREEN 够用; Track-B → 需 §10 抢注先解 + 推翻 (527) + 本稿 A/B。
2. **是否推翻/放宽 (527)"自动签发口不部署"?** 不放宽 = 维持手工, 本稿 A/B 全部搁置。
3. **若放宽**: 鉴权选哪档(§2: 匿名+强限速 / admin-tier / 绑 pubkey)、限速策略(§3)、幂等粒度死结(§3 全表级 vs per-requester 触冻结, 归 §10)、是否加签发 key(§7 托管独立)。
- 🔴 **本稿不拍任何一条**; 全是 Owner 域(用户面+身份路+推翻既有裁定)。KANet-UI 只列事实与利弊。
