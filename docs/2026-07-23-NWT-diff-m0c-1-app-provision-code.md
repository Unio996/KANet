# M0c-1 app provision 落码（0bf4588a）— NWT diff 审 verdict

> **Status**: NWT diff 审 **GREEN**（2026-07-23）· arm 前提①（grant/envelope 非 stub）代码侧闭。
> **审对象**：commit `0bf4588a`（本地待审未 push）——grant registry（schema+migrate v190）+ 信封验证（app-envelope.mjs）+ provision（operator 离线）+ authorize.mjs 整合。
> **立场**：红队默认 refute。这是解 armed 的承重 money-path 授权闸代码，尤其逐字节核签名范围（我立身之本 MUST-FIX）+ verify-value-source。
> **判据**（Bettor 派 load-bearing）：①签的消息==全 canonical envelope 去 signature 逐字段 ②verify-value-source ③provision 场景A不可达 ④strict-reject 全信封 ⑤registry fresh 读吊销即时 ⑥relay 读通道选型。

---

## 六判据逐核：全 PASS

### ① 🔴 签名范围（立身之本 MUST-FIX）— 焊死 ✅✅
- `envelopeSigningMessage(env) = canonicalJson({ signature, ...unsigned })`（app-envelope.mjs:102-105）——剥 signature、canonical 化其余全部字段。签发端（provision/app SDK）与验证端共用同一定义。
- **strict-reject（step4）先于验签跑**：`ENVELOPE_FIELDS` 恰好 15 键（protocol/domain/version/app_key_id/grant_id/relay_id/network/intent_type/intent_version/intent/intent_digest/nonce/issued_at/expires_at/signature），env 键集必须**恰好匹配**（未知拒/缺字段拒/类型拒）。所以 canonical(全 env 去 sig) **恰好覆盖 14 个非签名字段全部**——nonce ✅ relay_id ✅ network ✅ grant_id ✅ expires_at ✅ intent ✅ 全在签名字节内。M-1.6 §5"任一字段变化签名失效"焊死：换 nonce 重放 / 跨 relay·network·grant 重放 / expiry 延期复用全被签名拒。
- **验签公钥来自权威 grant 行**（`grant.app_pubkey`，按 grant_id 查），非信封自报 → 攻击者不能供自己的 pubkey。且 `grant.app_key_id === env.app_key_id` 核对。✅
- 自测 §6-10：改 nonce/relay/network/expiry/grant_id 各验拒。✅

### ② verify-value-source — 焊死 ✅✅
- `checkIntentBindsCmd(env.intent, cmd)`：intent 键集**恰好等于** cmd 业务键集（`CMD_INFRA_FIELDS`={type,action,envelope,__origin,requestId} 排除），且逐键 `deepEq(intent[k], cmd[k])`。掉包（多带/少带字段）拒、值不符拒。**验的值（intent，digest 在签名内）== switch 执行消费的值（cmd）** 焊死——relay switch 消费 cmd，cmd==intent，intent 被签名绑定。这正是 memory `verify-value-source-checker-must-access-binding-at-decision-time` 那族的正解。✅
- intent_digest 自洽核（`intentDigestOf(env.intent) === env.intent_digest`）。✅

### ③ provision 场景A不可达 ✅
- `scripts/m0c1-grant-provision.mjs`：CLI（process.argv：gen-key/issue/revoke/list），better-sqlite3 直写 DB。**grep 零 http/fetch/listen/createServer/sendCommand/ipc**——零 HTTP 面 / 零 IPC 写 / 零新增 relay 命令 = 场景A（被攻陷应用）结构不可达。✅
- gen-key privkey 只 `console.log` 打印、**不落盘**，operator 带外交付 app；registry 只存 `app_pubkey`。✅
- 写入方静态可枚举 M1-5：schema 头注明"仅本脚本一处写，migrate 只建表零写行，任何 HTTP/IPC/daemon 写本表=diff 审打回"。✅

### ④ strict-reject 全信封 ✅
- step4 恰好字段集+恰好类型（见①）。`canonicalJson` 在场字段全序列化、**绝不静默剥除任何键**（undefined/非有限 number/不可序列化类型 throw）→ 两份语义不同载荷不可能产同 canonical 字节（反 unknown-field 碰撞，memory `feerules-hash-commit-unknown-field-collision`）。✅

### ⑤ registry fresh 读吊销即时 ✅
- `getGrantFresh`：连接复用（WAL reader）但**每次 `.prepare().get()` 是 auto-commit 新读事务 = 读最新已提交数据**（含另一进程 provision 的吊销写入），**零 grant 行缓存**。operator `revoke`（UPDATE revoked=1）提交后，relay 下条命令 getGrantFresh 读到 revoked=1 → `grant.revoked` 分支即拒，无启动缓存 staleness 窗。连接复用是优化，不破坏 query-level 新鲜度。✅ 自测 §6-11 吊销即时验拒。

### ⑥ relay 读通道选型（node:sqlite readOnly 直开 console.db）✅
- 零新 npm 依赖（node:sqlite 内建）/ 零 HTTP 面（无 self-fetch 反模式）/ 零 IPC 往返。✅
- **readOnly 焊死**：连接 `{ readOnly: true }` → relay 进程物理写不了 registry（M1-5 写仅 operator 脚本）= 防独立被攻陷 relay 自授权（防御纵深，乙路下 Console B-0 另说）。✅
- `grant_id TEXT PRIMARY KEY` → WHERE grant_id=? 走索引 O(log n)，非全表扫 → 每命令单行查轻量，WAL 不阻写，contention 可忽略（非 backup/VACUUM 重操作，memory `heavy-read-ops-on-live-wal-db` 不适用）。✅
- fail-closed：路径缺失/DB 打不开/表不存在/查询异常 → `{ok:false}` → 调用方 deny（M1-4）。✅

### 整合 + inert 本批 ✅
- authorize.mjs：`authorizeAppCommand` 接 `verifyAppEnvelope(cmd, {relayId, network})`（ctx 从 env 取）。**`GRANT_ENVELOPE_IMPLEMENTED=false` 保持** → 本批代码在位但 inert（`if(!GRANT_ENVELOPE_IMPLEMENTED) return deny` 双保险）。armed 焊死 intact：armed=on+flag=false → 模块加载 throw 拦（flag 置 true 留本 GREEN+实战后单独 commit）。✅
- allow 后 `deepFreeze(cmd)`（M1-6·防 gate→switch 间突变）；全链 try/catch → fail-closed deny（M1-4）。✅
- AuthResult=母卡§5 接口，callerId=service 身份（app_key_id）非端用户（§5.1 不读不信 payload 端用户标识）。✅
- schema DDL 单一真相源（migrate v190 + provision 共用防漂移）；时间列 INTEGER unix 秒（避 ISO 字典序坑，memory 引）；scope 列 NULL=未授权（缺维度最严，非不限）。✅
- 乙路 TCB 诚实：schema 头明标"抗场景A（app 伪造不了 operator grant）、不抗场景B（被攻陷 Console 改表自授权，需 R），禁称抗 Console"。不 overclaim。✅

---

## 4 note（arm 前置·全 fail-closed-safe·非 blocker）

- **N1 SCALAR_DIMENSIONS 硬编码字段图**（target/to_address/amount/marketId/branch/winner）：任何被 app-grant 的 money-path 命令，若其价值字段不在此图 → 得 intent==cmd 绑定但**不得 amount/payee scope**（M0c-1 粗粒度）。当前可授权的 transfer（target/amount）已覆盖。**precondition：细粒度/异名价值字段命令 app-grant 前必须 M0c-2 scope**（设计已明"细粒度 covenant 派生归 M0c-2"，一致）。
- **N2 node≥22.13**（node:sqlite 内建要求）：relay 若跑旧 node → `_require('node:sqlite')` throw → fail-closed deny（安全，但 app 路径全断）。**arm 前确认 relay node 版本**。
- **N3 env 三件**（M0C1_GRANT_DB_PATH / RELAY_NODE_ID / NETWORK）：未设则 fail-closed deny（安全，但 app 路径全断）。relay-manager fork 3 行设 DB path——**arm 前 live 验三 env 真到位**（否则 armed 后 app 命令全拒断网）。
- **N4 双 sqlite 库**：provision 用 better-sqlite3（写）+ relay 用 node:sqlite（读）同一 console.db WAL——标准 SQLite 文件格式跨库兼容，正常；记一笔 arm 前 live 双库读写往返自测一遍。

---

## 判据：GREEN

六判据全 PASS，立身之本签名范围 MUST-FIX 逐字段焊死，verify-value-source intent==cmd 精确绑定，provision 场景A 结构不可达，strict-reject/fresh 读/readOnly 全正确。4 note 均 arm 前置 deploy-precondition（全 fail-closed-safe，非代码错，非本 GREEN blocker）。**本批 inert（flag=false）不 live**。

**= arm 前提①（grant/envelope 非 stub）代码侧闭**。置 `GRANT_ENVELOPE_IMPLEMENTED=true` 前提：本 GREEN + 实战 harness（armed=on 真发：合法 allow / 越 scope 拒 / 吊销即时拒 / 伪签拒 / 掉包拒）+ N2/N3 arm 前 live 验。arm（armed=on 不可逆）留批F Owner 拍。

**关联**：`docs/2026-07-23-NWT-redteam-m0c-1-app-provision.md`（设计红队 verdict）、`docs/2026-07-23-m0c-1-app-provision-design.md` v0.2（审对象设计）、`docs/2026-07-23-NWT-redteam-m0c-2-scope-evaluator.md`（细粒度 scope 归 M0c-2·N1 关联）。
