# §6-1 LIVE wiring② 就绪清单 — 节点一同步就能派实施, 不再找断点

> **Status**: CURRENT · J2 2026-08-27 · Bettor 派工(Codex 裁 (g) 甲/乙期间, D-012 落地直接相关)· **只读, 未改任何码/表**
> **口径**: 每项 = 现状 `[SRC file:line]` / 设计与 PASS 出处(ledger 编号 + doc)/ 落码差什么(一句)/ 依赖节点同步? / 依赖 §10 pubkey 锚定? / 谁的域。所有 file:line 与 DB 读数是 2026-08-27 本机 HEAD + live `console.db` 现查, 不是 8/17 记录的转述。
> 🔴 **先纠 Bettor 派工里的清单**: 派工写的「registerIdentity / payoutshard :1824 / u1-escape」是 DECISIONS 08-17 注记 L141 的旧三项;**DECISIONS L158(COORD-LEDGER (456))已更正**:`:1824` 早已修(2026-07-08 `_resolveZkNativeCtorExtras`)且属结算域, **从 §6-1 关键路径撤下**;真实项 = ①registerIdentity 接线 ②deriveCustody TOCTOU ③`u1_identity_challenge` 迁移 ⑤escape-hatch live-check(+ 后来挖出的 ⑥ 签发口 与 ⑦ relay_id 抢注面)。本文按更正后的清单写。

## §0 一句话

**8/17 那份"留档三项"今天已经不是断点**:③迁移(v197)、①handler、②TOCTOU 三项在 8/18 全部落码并入 live(表已在库、路由已注册、事务内重派生已在), 四方内审齐 + Codex route/TOCTOU ACCEPTED((510))。**现在真正卡住 §6-1 LIVE 的是两件更靠后的事**:⑥ **挑战签发口在生产里不存在**(`u1_identity_challenge` 零写入方 ⇒ 任何人都拿不到活挑战 ⇒ 注册路端到端走不通;而 (527)/(528) 裁定它是**北极星功能、当前 Track-A 保持 operator 驱动、不部署自动签发口**)与 ⑦ **relay_id 抢注面**(注册链无"请求方密钥 ↔ relay_id"绑定, 修法架构性非平凡, (487); 与 §10 pubkey 身份同题)。**两者都不依赖节点同步**——§6-1 注册路径零 RPC/零广播((468) grep 实核), 节点同步只影响"注册完之后的钱路"。⇒ 节点一同步, 可立刻派的是 **operator 驱动的 E2E 注册演练**(手工发一条挑战 + 一次真注册 + 事后 escape-hatch 复跑), 不是再写 wiring。

## §1 逐项

### ③ `u1_identity_challenge` 表迁移 — ✅ 已落, 已在 live
| 格 | 内容 |
|---|---|
| 现状 | `kasia-console/src/db/migrate.js:5696-5725` v197 `CREATE TABLE IF NOT EXISTS u1_identity_challenge(challenge PK, used_at, expires_at NOT NULL)`;live 库 `[DB]` 表在、**0 行**;`user_version=0` 是本仓幂等声明式约定, 不是"没跑"((456) 已纠) |
| 设计 / PASS | 设计 `docs/2026-08-17-j2-s61-live-wiring-design.md §3`;落码 commit `6efd8d4b`(8/18);PASS = (501)(502) Bettor 亲跑 7 PASS + 夹具改读生产 DDL、(504) 三方闭;DATABASE.md:855 已登记 |
| 落码差什么 | 无 |
| 依赖节点同步 | 否 |
| 依赖 §10 | 否 |
| 域 | J2 |

### ① `registerIdentity` 生产调用方接入 — ✅ 已落(路由在), ⚠ 但无人能拿到挑战 ⇒ 端到端未通(见 ⑥)
| 格 | 内容 |
|---|---|
| 现状 | `kasia-console/src/api/identities.js:263` `POST /api/identity/u1-register` → `:278 createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE)`(表缺即 503)→ `:287 registerIdentity({sqlite, submission, challengeStore})`;路由注册器 `index.js:201 registerIdentityRoutes`;handler 硬纪律(不透传调用方 challengeRecord / 不 Object.assign body)见 `:240-262` 注释。live 表 `u1_identity_registration` `[DB]` 0 行 |
| 设计 / PASS | 设计 §1;commit `43411464` + 崩溃修 `51449fbd`(8/18);内审 (505)(506)(507)(508)(509) 四席(J2/NWT 行为注入 4 PASS/Bettor/KANet-UI);Codex `7d8c57c4` route **FIXED IN SOURCE**((510)) |
| 落码差什么 | handler 本身无;**缺的是上游签发**(⑥)。(510) 剩两项测据(真 Fastify 证据 b0d87ef9 / ①-10 打印)为 Codex 复核项, 非源缺陷 |
| 依赖节点同步 | **否**——`u1-registration.mjs` import 面零 broadcast/relay/RPC((468) grep 实核) |
| 依赖 §10 | 间接:handler 认 `s.relayId` 为身份键(⑦) |
| 域 | J2 |

### ② `deriveCustody` pre-tx 读 ↔ 注册写 TOCTOU 加严 — ✅ 已落
| 格 | 内容 |
|---|---|
| 现状 | `kasia-console/src/lib/u1-registration.mjs:179` 事务外便宜预筛 `custodyPre`;`:227` **`.immediate` 事务内重派生 `custody2`**, `:243` INSERT 用事务内那次;`:232-236` 明写"不比对两次值"(ok 分支单值, 比对是永假分支);兜底 = v196 `CHECK(custody='mnemonic')` |
| 设计 / PASS | 设计 §2 + §9(NWT 红队两条更正已折入);commit `be0a85a3`(8/18);(506)(509)(510) Codex TOCTOU **ACCEPTED IN CODE** |
| 落码差什么 | 无 |
| 依赖节点同步 | 否 |
| 依赖 §10 | 否 |
| 域 | J2 |

### ④ payoutshard `:1824` 默认回落不对称 — ✅ 已撤出 §6-1 关键路径
| 格 | 内容 |
|---|---|
| 现状 | `pool.js:1828-1850` 已是 2026-07-08 修复版(`_resolveZkNativeCtorExtras` 两处调同一份);属结算域非 §6-1 身份 |
| 出处 | COORD-LEDGER (456) Bettor by-content 实核;DECISIONS L158 |
| 落码差什么 | 无(本项不在 §6-1) |
| 域 | J2(结算) |

### ⑤ `u1-escape-hatch-live-check.cjs` §5-6 — ✅ 脚本在库、判据写死、8/18 实跑过;LIVE 前须**再跑一次**
| 格 | 内容 |
|---|---|
| 现状 | `scripts/u1-escape-hatch-live-check.cjs`(3fa73bf6):只读 `broadcast_messages.sender_address`(>2026-08-11T12:00)对 `relay_nodes`, 判据①继承 PRIVKEY 顶掉全体 / ②ACCOUNT_INDEX≠0;"零数据 = 未通过"显式打印 |
| 设计 / PASS | 设计 §5(判据写死三条:注册前必跑 / 作用域只盖近期发过广播的本机 relay / 零数据当未通过);8/18 06:33 实跑 4 relay 全对上、两判据不成立(设计 §5 实跑记录);(509)(510) KANet-UI 审席 PASS |
| 落码差什么 | 无。**但它的证据有时效**:窗口是 `created_at > 2026-08-11T12:00` 的广播, 8/23 崩机 + 4 天频道静默后, **LIVE 前必须重跑**且要有新广播样本(节点未同步期间发不出广播 ⇒ 样本不新) |
| 依赖节点同步 | **是(间接)**——要有新鲜的运行时签名广播才有数据可判;IBD 期发不出 |
| 依赖 §10 | 否 |
| 域 | J2 跑 / KANet-UI 审 |

### ⑥ 🔴 挑战签发口 — ❌ 生产不存在, 且**裁定为北极星功能, 当前不部署**
| 格 | 内容 |
|---|---|
| 现状 | `u1-challenge-store.mjs` 只有 `createChallengeStore / isStoreBoundTo / readBoundChallenge / consumeBoundChallenge`(:31/:76/:106/:114), **无 issue**;全 `kasia-console/src`(非测试)**零** `INSERT INTO u1_identity_challenge`;`identities.js` 无 `u1-challenge` 路由。⇒ 生产里**没有任何路径能造出一条活挑战** ⇒ `registerIdentity` 必在 `CHALLENGE_UNKNOWN`/`CHALLENGE_CONSUME_*` 拒 ⇒ **① 端到端走不通**(这是 (527) NWT 点破的"意外人工闸") |
| 设计 / 裁定 | (527)+(528) 终裁:(i) 纯 nonce 当前安全充分;**自动签发口 = 北极星功能(外部自助)**;**Track-A 注册保持 operator 驱动(手工挑战, 如 E2E)**, **当前不部署自动签发口**;(529) Codex ACCEPTED-with-scope, 新 MUST-FIX = E2E harness 孤儿活挑战复用前修 |
| 落码差什么 | 当前阶段:**一条 operator 手工签发 runbook/脚本**(INSERT 一条带 expires_at 的 challenge, 事后 CAS 消费或过期清理)+ (529) 那条孤儿活挑战处理;北极星阶段:自动签发口(要求 relay-key-control 证明, 但 (528) 已认 attestation-at-issuance 关不住同机窗 ⇒ 方案未定) |
| 依赖节点同步 | 否 |
| 依赖 §10 | **是(部署闸绑死 §10)**——(527)(2) 「签发口【设计】继续;【部署】绑死 §10 之后」 |
| 域 | 设计 J2 / 红队 NWT / 裁定 Bettor / 部署随北极星 |

### ⑦ 🔴 relay_id 身份抢注面 — ❌ 未修, 与 §10 同题
| 格 | 内容 |
|---|---|
| 现状 | `u1-registration.mjs:125 deriveCustody` 只按 relayId 查 custody **类型**;`verifyRegistrationBinding` 只验提交方自身密钥内部一致;`REG_REJECT` 全表(`RELAY_UNKNOWN…CHALLENGE_EXPIRED`)**无** RELAY_NOT_OWNED 类值 ⇒ 攻击者自签一套密钥 + 填任一 custody=mnemonic 的 relayId 可永久抢占该主键 |
| 设计 / 裁定 | DECISIONS L159 + (484)(487):成立, 修法架构性非平凡;severity = 继承 console loopback 信任模型(同机今天已能 transfer/mnemonic-reveal, (528));§10 `docs/2026-08-18-…relay_id 锚定`(39110344, (512)(513) NWT 7/7 PASS, (515) Codex 收敛 relay_id 非跨节点身份)→ pivot 到 **§10 pubkey 身份 v1 设计 COMPLETE**(`docs/2026-08-19-s10-pubkey-identity-design.md` @847bcf22, Codex MSG-250 五项 CLOSED, register-only) |
| 落码差什么 | §10 实现层(真验证器跑 §6 的 1-13 负测 + 持久层)+ legacy relay_id/历史 pubkey 迁移 + rotate/revoke(均列未闭);**本项不是 wiring 补丁能修的**, 是身份锚从 relay_id 换成 pubkey |
| 依赖节点同步 | 否 |
| 依赖 §10 | **就是 §10** |
| 域 | 设计 Bettor(§10 主笔)/ J1 供数+第二实现 / J2 实现层(报备后) |

## §2 依赖矩阵(一眼判"节点同步后先派什么")

| 项 | 落码状态 | 需节点同步 | 需 §10 | 可立刻派 |
|---|---|---|---|---|
| ③ 迁移 | ✅ live | 否 | 否 | — |
| ① handler | ✅ live | 否 | 间接 | — |
| ② TOCTOU | ✅ live | 否 | 否 | — |
| ④ :1824 | ✅ 撤出 | — | — | — |
| ⑤ escape-hatch | ✅ 脚本 | **是**(要新广播样本) | 否 | 节点同步后**立刻重跑**(只读, 5 分钟) |
| ⑥ 签发口 | ❌ | 否 | **部署绑 §10** | 现在就能派:**operator 手工签发 runbook + E2E 一次真注册**(不部署自动口, 合 (528)) |
| ⑦ 抢注面 | ❌ | 否 | **= §10** | §10 实现层报备(独立卡) |
| (510) 剩两项测据 | Codex 复核项 | 否 | 否 | 等 Codex 触发(MSG-245 已 re-route) |

## §3 节点同步后的派工序(建议, 归 Bettor 排)
1. ⑤ 重跑 `node scripts/u1-escape-hatch-live-check.cjs`(需先有 ≥4 个本机 relay 的新广播;上线消息/回执正好供样本)。
2. ⑥ 当前阶段:写 `scripts/u1-challenge-issue-operator.cjs`(报备层设计一页:INSERT challenge + expires_at + 事后孤儿清理, 合 (529) MUST-FIX)→ NWT 审 → E2E:手工签发 1 条 → 一次真 `POST /api/identity/u1-register` → 核 `u1_identity_registration` 1 行 + challenge `used_at` 非空 + 第二次同挑战被 `CHALLENGE_ALREADY_USED` 拒。**这是 §6-1 LIVE 的第一条真实运行证据**, 不需要钱、不需要广播。
3. (510) 两项测据交 Codex 复核(非我方动作)。
4. ⑦/§10 实现层报备 = 独立卡, 不并进上面。

## §4 边界
- 未改码、未改表、未插入任何挑战;live 库两张 u1 表现为 0 行是**事实**, 不是"迁移没跑"。
- ⑤ 的 8/18 绿灯**不可复用**到 LIVE(样本窗已陈 + 崩机后进程全换);本文只记它的判据与上次读数。
- "①②③ 已落"说的是**代码在 live 进程里**(console 8/25 20:03Z 起的 PID 27412 含 8/18 commits, 且 migrate 已在库留下 v197 表);**不是**"已有生产注册发生"(0 行)。
