# §6-1 Track-A · operator 手工挑战签发 + 一次真注册 E2E · runbook

> 🔴 **Track-A operator 驱动 · 不部署自动签发口 · 部署闸绑 §10**(COORD-LEDGER (527)(528) 终裁, Codex (529) ACCEPTED-with-scope)。本 runbook 里的"签发"是 operator 在本机手工跑一次脚本, 不是 HTTP 端点、不常驻、不进 cron。
> **Status**: DRAFT v0.3 · J2 2026-08-27 · Bettor 派工 (8) · NWT 审 v0.2 = PASS, v0.3 = 吸收 NWT 三条硬化 + Bettor 两句 · 报备层, **写完未在 live 跑**(脚本只在临时库自测, 见 §7)· 由 **KANet-UI(operator)** 执行 E2E
> 🔴 **"operator 手工签发"是【进程约定】不是【强制控制】**(NWT 裁): 跑脚本 = 文件系统能力事件(需 `console.db` 写权限), **不是 operator 身份认证事件**;脚本不认证 operator, 谁有同样 DB 写权限谁都能跑;它的权威 = console-loopback 文件访问, 与 ⑦/§10 同源 ⇒ **不许暗示"脚本签发 = operator 已授权"**。脚本入库 = 可发现: 把"手写 INSERT"变成现成工具, 不跨边界但**降低本地 actor 门槛**, loopback 信任内可接受, **北极星面前须重估**。
> 🔴 **常驻约束**: `u1-issue-challenge.mjs` **永不**接 HTTP route / cron / daemon;任何把它 wrap 成端点或定时任务的改动 = 自动签发口 = **§10-gated, 须先报备**。谁碰这个脚本先 `grep -rn "u1-issue-challenge" kasia-console/src scripts` 确认零引用(ANTI-PATTERNS 审查清单同句)。
> 🔴 **活 bearer**: challenge 在 `used_at` 置非空之前是**活 bearer token**——签发输出**不贴频道、不进持久证据**;消费后 inert, 证据里才记它的值。
> 🔵 连接是读写的(经 `DB_PATH` + `src/db/client.js`, M0a 合规);**dry-run 零写入由代码路径保证**(无 `--commit` 时不含任何 INSERT/DELETE), 不靠 readonly 标志。
> 🔴 **作用域(Bettor 钉死, 逐字)**: 挑战 = **纯 nonce**;`isStoreBoundTo` 绑的是 **sqlite ∧ table**, **不绑 relay_id / requester**;PoP 只证**控住被注册的那把 pubkey**, **不证有权用那个 relay_id**(`REG_REJECT` 无 `RELAY_NOT_OWNED`)。⇒ **E2E 跑通 = 「注册路 plumbing 在 operator 信任假设下端到端通」, ≠ 「§6-1 注册 LIVE-for-real」;⑦ relay_id 抢注面在本 E2E 里零信息, soundness 待 §10。** 本文任何地方**不得**写"第一条真实注册"这类会被读成 LIVE 的话;本 E2E 产出的证据自带这段作用域。
> **脚本**: `kasia-console/scripts/u1-issue-challenge.mjs`(⚠ 放在 kasia-console/scripts 而非根 scripts/: 它要 import `src/lib/u1-challenge-store.mjs` 与 `src/lib/u1-registration.mjs` 的生产谓词, 与 `checksigfromstack-e2e-*.mjs` 同位)。默认只读 dry-run, `--commit` 才写。

## §1 这一步证明什么、不证明什么
- **证明**: ①handler(`POST /api/identity/u1-register`)、②事务内托管重派生、③v197 挑战表, 在 live console 进程里**plumbing 端到端通一次**(operator 信任假设下): 一条挑战被签发 → 被 PoP 验过 → 被 CAS 消费 → 一行注册落库 → 同挑战二次被拒 → 过期 nonce 被拒。这是 §6-1 至今缺的**运行证据**(库里 0 行), **作用域见首段**。
- **不证明**: 自动签发口的安全性(不部署)、relay_id 抢注面已修(**未修**, = §10;§4 负测臂 (b) 会把它**测出来并记为现状 PASS = 缺陷可见**)、跨节点身份(北极星)、任何"LIVE-for-real"。
- **不碰**: 钱路、广播、节点、kaspad。注册路径零 RPC((468) grep 实核)⇒ **不依赖节点同步**, IBD 期可跑。

## §2 谁跑 · 前置
| 项 | 值 |
|---|---|
| operator | **KANet-UI**(执行 + 留证);J2 备询;NWT 审本 runbook 与两份证据 |
| 机器 / 进程 | 本机 console(PID 由 `Get-NetTCPConnection -LocalPort 3200` 现取), HEAD 含 8/18 commits(43411464/51449fbd/6efd8d4b/be0a85a3)—— 跑前 `git log --oneline -1` 记下 |
| 注册对象 | 本机一个 **custody=mnemonic-only** 的 relay(`deriveCustody` 会拒混合态/privkey-only)。建议 **J2test(8f104e2d)** 或 KANet-UI 自己的通信 relay;**不用** MiningRelay/Faucet(钱路 relay 不拿来做身份实验) |
| 身份钥 | 注册的 `identityPubkeyXOnly` = 该 relay 账户层 xpub `m/44'/111111'/0'`(`U1_ACCOUNT_PATH`)下 `0/0` 的 x-only 公钥 = **relay 自己的地址钥**(`kasia-relay/src/lib/wallet.mjs:39-48` 同一路径)⇒ 注册的就是它现在发消息用的那把钥, 非新造 |
| 跑前基线核 | `u1_identity_challenge` / `u1_identity_registration` / `u1_domain_assignment` 三表行数 = **0 / 0 / 现值**(2026-08-27 现查: 0 / 0 / ?)——前两张必须 0, 这是 §6 回滚"为什么可回滚"的前提;脚本 dry-run 会打印 `baseline_rows` |
| 时区 | 全部 epoch ms;`expires_at` 打印 ISO(Z) |

## §3 挑战签发(脚本行为, 与代码逐条对应)
| 步 | 脚本做什么 | 复用的生产谓词 |
|---|---|---|
| ① 表可用 | `createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE)`, 表缺即 throw | 与端点 503 同因同码 |
| ② relay 前置 | `deriveCustody(sqlite, relayId)` 非 ok 即拒(RELAY_UNKNOWN / CUSTODY_AMBIGUOUS / CUSTODY_NOT_MNEMONIC) | 注册端点同一谓词, 提前拒 |
| ③ 基线 | 打印三表行数 | — |
| ④ 孤儿清理 | `used_at IS NULL ∧ expires_at <= now` ⇒ dry-run 列出;`--commit` DELETE | (529) MUST-FIX: 活挑战复用前先清 |
| ⑤ 幂等 | 存在 `used_at IS NULL ∧ expires_at > now` ⇒ **不签, 返回既有**(>1 条打 warn) | ⚠ v197 表无 relay_id 列((527) 裁 (i) 纯 nonce)⇒ 幂等是**全表级**"一次一条活挑战", 不是 per-relay;Track-A 一次一注册, 粒度正好 |
| ⑥ 签发 | 32B 随机 hex, `expires_at = now + ttl`, 写锁内再核一次无活挑战再 INSERT | 过期**判据**同源于 `u1-registration.mjs` 事务内重读(`expiresAt <= now ⇒ CHALLENGE_EXPIRED`);**TTL 是签发策略参数**, 注册模块里没有 TTL 常量可引 ⇒ `--ttl-ms` 显式给(默认 10 min, 60s..60min 夹紧), **值待 NWT 定** |
| 输出 | `challenge` / `expires_at` / `next`(必须在何时前 POST) | 不打印任何密钥 |

## §4 E2E 三臂(预注册, 事后不加项)
0. **dry-run 先行**: `node scripts/u1-issue-challenge.mjs --relay <id>` ⇒ 期望 `WOULD-ISSUE`, `baseline_rows` 前两张 = 0, `orphans` = []。截图/留 JSON。
1. **签发 1 条**: 同命令 `--commit --json` ⇒ `ISSUED`, 记 `challenge`、`expires_at`。核 `SELECT COUNT(*) FROM u1_identity_challenge` = 1。
2. **构造 submission**(六字段 `relayId / rootXpub / identityIndex=0 / identityPubkeyXOnly / challenge / signature`):
   - `rootXpub` = 该 relay 助记词 → `XPrv(seed).deriveChild(44,true).deriveChild(111111,true).deriveChild(0,true).toXPub().intoString('kpub')`;
   - `identityPubkeyXOnly` = `deriveIdentityPubkey(rootXpub, 0)`(`u1-same-origin.mjs:89`);
   - `signature` = `signMessage({ message: popMessageHashHex(buildPopPayload({rootFingerprint: rootFingerprint(rootXpub), identityIndex:0, relayId, challenge})), privateKey: leaf(0/0) })`(`u1-registration-pop.mjs:46/:61`;与 NWT 行为测试 `u1-wiring-behavior-nwt.test.mjs:52-58` 同构)。
   - 🔴 **这一步要碰 relay 助记词**(console 进程的 `CONSOLE_ENCRYPTION_KEY` 解密)。helper 已写: **`kasia-console/scripts/u1-build-submission.mjs`**(commit 41b12a47, NWT 单审): `set -a; . ./kanet.env; set +a; cd kasia-console; node scripts/u1-build-submission.mjs --relay <id> --challenge <hex> --json`(dry-run 只打印六字段;`--commit` 写 `--out`, 默认 `scratch/u1-e2e/submission.json`)。它在进程内 decrypt → wallet.mjs 同路径派生 → 生产 PoP 谓词签 → `verifyRegistrationPop` 离线自证 → 白名单六字段输出;身份钥 == relay 地址钥反核不过即拒;**绝不打印/落盘助记词、私钥、xprv**。⚠ 输出含活 challenge ⇒ 只当场 POST, 不贴不存(首段 bearer 纪律)。
3. **真 POST**: `curl -s -X POST http://127.0.0.1:3200/api/identity/u1-register -H 'Content-Type: application/json' --data-binary @submission.json` ⇒ 期望 HTTP 200 `{ok:true, …}`。
4. **验收三臂(缺一不算过)**:
   - (a) `SELECT relay_id, identity_pubkey_xonly, custody FROM u1_identity_registration` = **1 行**, `custody='mnemonic'`, `identity_pubkey_xonly` == relay 地址的 x-only 公钥(`XOnlyPublicKey.fromAddress(relay.address)`);
   - (b) `SELECT used_at FROM u1_identity_challenge WHERE challenge=?` **非空**(CAS 消费过);
   - (c) **同一 submission 再 POST 一次** ⇒ HTTP 400, `code='CHALLENGE_ALREADY_USED'`(事务内重读 `usedAt` 非空 ⇒ 拒), 且 `u1_identity_registration` 仍 1 行。
5. **负测臂(live 上只跑这些, 与三臂一起, 缺一不算过)** —— 🔴 顺序: **先跑 (a), 再跑主臂 1-4**(脚本全表级幂等, 一次一条活挑战):
   - **(a) 过期 nonce ⇒ 拒**: `--commit --ttl-ms 60000`(脚本允许的最小值)签发一条 → **等 ≥ 61 s** → 用它构造 submission 并 POST ⇒ 期望 HTTP 400 `code='CHALLENGE_EXPIRED'`(注册侧事务内重读 `expiresAt <= now`, 与签发写的 `expires_at` 同一判据), `u1_identity_registration` **0 行**。⚠ **不要**用 `UPDATE expires_at` 手改活表造过期(在册禁手插 DB);用最小 TTL + 等待。这条过期挑战会在下一次 `--commit` 时作为孤儿被脚本清掉——那本身也是 ④ 的正向证据, 记下 `orphans_cleaned=1`。
   - **(b) 翻签 ⇒ `POP_FAILED`**: 主臂步 3 之前, 先把同一 submission 的 `signature` 翻一位 POST 一次 ⇒ HTTP 400 `POP_FAILED`, 且挑战**仍未消费**(`used_at` 为空; PoP 在事务外先拒, 不碰 CAS)——然后再用正确 signature 走主臂步 3。
   - **(c) 二次同挑战 ⇒ `CHALLENGE_ALREADY_USED`** = 主臂验收 (c), 不重复。
   - 🔴 **撤回 live 上的"同 nonce 换 relay_id"臂**(NWT 自纠): 它在 live 会真成功、造一个抢注形状的伪注册, 即便回滚也在 live 库留过痕。**这条边界改在临时库证明**(§7 第二组), live E2E 不做。

## §5 证据留档
- `scratch/u1-e2e-<date>/`: dry-run JSON、**issue JSON(只在挑战被消费之后才落盘/入证据——消费前它是活 bearer, 消费后 inert)**、submission.json(**不含密钥**;六字段中 `challenge` 同样只在消费后记)、三次 curl 的 HTTP 状态与 body、三条 SELECT 输出、`git log -1`、console PID。
- 一份 `docs/2026-08-2x-kanetui-u1-e2e-evidence.md`(operator 写), 逐臂贴原文;J2 复核、NWT 审。

## §6 回滚
- 操作: `DELETE FROM u1_identity_registration WHERE relay_id=?;` + `DELETE FROM u1_identity_challenge WHERE challenge=?;`(两行, 事务内)。
- **为什么可回滚**: 跑前基线两表 **0 行**(§2 核过)⇒ 本次 E2E 产生的就是这一行注册 + 一条挑战, 删掉即回到基线;注册路径**不广播、不动钱、不写别的表**(`u1-registration.mjs` 只 INSERT `u1_identity_registration` + UPDATE 挑战 `used_at`);无 chain_events、无 relay 状态变化。
- **什么时候不回滚**: 主臂三条全过 ⇒ **留着**(它是 plumbing 运行证据, 作用域见首段);回滚用于 ① 负测臂 (b) 的伪注册行(**必回滚**)② "中途失败留下半截"(例如 POST 200 但 (c) 不拒 ⇒ CAS 失守, 先留证再回滚)。
- 🔴 回滚后核: 两表行数回到 §2 基线(负测臂做完 = 0/0;主臂留证 = 1/1)。
- 🔴 回滚是手插 DB(在册禁)的例外形态: **只删本次 E2E 自己写的两行, 且必须在 NWT 看过证据之后**;不许顺手"清一下表"。

## §7 脚本自测 + 边界证明(J2 · 临时库 · 未碰 live 库)
**第一组 · 签发脚本四臂**(`scratch/_u1_issue_selftest.db`, relay_nodes 最小列 + v196/v197 逐字 DDL): A dry-run ⇒ `WOULD-ISSUE`, 列出 1 条过期孤儿、表不变;B 混合态 relay ⇒ `CUSTODY_AMBIGUOUS` 拒(exit 2);C `--commit` ⇒ `ISSUED` + 孤儿清 1;D 再 `--commit` ⇒ `EXISTING-LIVE-CHALLENGE` 幂等不签。
**第二组 · "nonce 不绑 relay_id"边界**(`scratch/_u1_nonce_not_bound_selftest.mjs`, 临时库跑**真迁移** `runMigrations()` + 生产 `registerIdentity`/`createChallengeStore`/`buildPopPayload`, 结果 `scratch/_u1_nonce_not_bound_result_20260827.txt`):
| 臂 | 提交 | 结果 | 读法 |
|---|---|---|---|
| 对照 | 身份 A 的钥 + `relayId=relay-A` | **PASS** | 仪器会绿(否则下面的 PASS 无归因) |
| 边界 1 | 身份 A(已注册)的钥 + `relayId=relay-B` | **REJECT `CONSTRAINT`**, 挑战未消费(回滚) | v196 UNIQUE(N3)⇒ **同一 pubkey 不得二次注册** ⇒ 抢注**不能**靠复用已注册的钥 |
| 被测(⑦) | **攻击者新钥 X** + `relayId=relay-B` | **PASS**, 落库 `relay_id=relay-B, pubkey=X` | **nonce 与 PoP 都不绑 relay_id 归属 ⇒ relay-B 被 X 抢占** = DECISIONS L159 / (487) 在运行时坐实, 不是推断 |
⇒ ⑦ 的精确形状: **需要一把未注册过的新钥 + 任一 custody=mnemonic 的 relay_id + 一条活挑战**;第三个条件就是本 runbook 要守的东西(活 bearer / 5 min TTL / 不部署自动签发口)。
🔴 **再精确一步(NWT 裁): ⑦ = first-squatter-wins on【未注册】relay_id** —— v196 UNIQUE 挡的是**同钥重复注册**, 挡不住**一把新钥抢先注册一个还没人注册的 relay_id**;**已注册的夺不走**(relay_id 是主键, 二次注册撞 CONSTRAINT);**§10(注册须证 relay 控制权)才关得住**。⇒ 本 E2E 给 J2-tn 注册这一行, 在 Track-A 语境里同时是"占坑"——它让 J2-tn 这个 relay_id 从此不可被别的钥抢注, 但这是副作用不是设计, 不许据此写"抢注已挡"。
**live 库上一次都没跑**(连 dry-run 都没跑; E2E 第 0 步的 dry-run 由 operator 跑)。

## §8 与既有裁定的关系 / 边界
- (527)(528): 自动签发口不部署、Track-A operator 驱动 —— 本 runbook 就是那个"手工挑战"。(529) MUST-FIX 孤儿活挑战 —— 脚本 ④。
- (510) 剩两项 Codex 测据(真 Fastify 证据 / ①-10 打印)与本 E2E 独立;E2E 通过后可作为第三份证据一并 route。
- §10 relay_id 抢注面**本 runbook 不解**(也解不了): E2E 注册的是本机自己的 relay, 由 operator 亲手签发挑战 ⇒ 抢注场景不出现;不得据此写"抢注已挡"。
- TTL 默认 10 min 是我拍的**待定值**;幂等粒度是全表级(schema 所限);两处请 NWT 明裁。
