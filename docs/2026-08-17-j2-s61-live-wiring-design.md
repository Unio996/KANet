# 2026-08-17 · J2 · §6-1 LIVE ② wiring 设计报告（报备层 · 零生产改动）

> **Status**: CURRENT

**派工**：Bettor 16:43 频道 `#xgq0o1.3` —— 「只出设计报告（铁律0 报备阶段，不碰生产码），让节点健康一闭就能进审」。
**范围**：`DECISIONS` L141 留档三项 + 两项 —— ① `registerIdentity` 生产调用方接入 · ② `deriveCustody` TOCTOU 加严 ·
③ 具体存储表 schema/迁移/索引 · ④ payoutshard 默认回落不对称 · ⑤ `u1-escape-hatch-live-check.cjs` §5-6。

**本报告未改动任何生产文件。** 以下每一项的"现状"都是**实读**（命令与位置随文给出），不是回忆。

---

## §0 🔴 压在整份设计上的硬约束：**不得加宽信任形状**

`DECISIONS` L135 明令：

> ⚠ **不 grandfather**：未来生产 wiring 若改动被审信任形状（**新参 / 调用方可选 provider / 对调用方态的新 `x.y()` 解引用**），
> 本 PASS **不自动覆盖**，须重跑参数/解引用 authority 枚举。

⇒ 这不是风格偏好，是**成本**：一旦加宽，九级 authority 枚举（含两张枚举表）要重跑一遍。
**所以下面每一项都附一句「为什么它不改变信任形状」。** 任何做不到这一点的方案，本报告不采纳。

生产入口当前签名（实读 `kasia-console/src/lib/u1-registration.mjs:150`）：

```js
export async function registerIdentity(args = {})          // args = { sqlite, submission, challengeStore }
// clock / verifyMessageFn / expectedTable 在内部钉死, 生产签名里【不存在】这些参数名
```

---

## §1 ① `registerIdentity` 生产调用方接入

### 现状（实读）

- 🔴 **`registerIdentity` 目前【零生产调用方】**。全仓 grep（`src/`、`../kasia-relay/src`）除自身文件与测试外，**无一处调用**。
- ⚠ **一处"一名多物"陷阱**：`src/api/identities.js:8` 有 `registerIdentityRoutes`，`src/index.js:201` 调它 ——
  那是**路由注册器**，不是 `registerIdentity` 的调用方。名字像，别当成"已接线"。
  （同族在册：`reference-one-name-several-different-things`。）
- `identities.js` 现有 12 条路由（`/identities*`、`/api/identity/*`），全是标签/信任/黑名单类，**没有 U1 注册端点**。

### 设计

新增一条端点（位置：`src/api/identities.js`，与既有身份路由同域）：

```
POST /api/identity/u1-register
```

handler 只做三件事，**不做任何业务判断**（判断全在模块内，这是 §6-1 定义冻结的前提）：

1. 取 Console 单例 sqlite handle（与 `relay_nodes` / `u1_identity_registration` **同一个 handle、同一个库文件**）；
2. `const store = createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE)`；
3. `await registerIdentity({ sqlite, submission, challengeStore: store })`。

### 🔴 handler 的两条硬纪律（写进代码注释，不靠自觉）

1. **禁止把 `req.body` 展开进 `args` 或 `submission`。** 必须显式挑字段。
   实读模块真正读取的 `submission` 字段只有五个：
   `relayId` · `rootXpub` · `identityIndex` · `identityPubkeyXOnly` · `challenge`
   （另有 `custody`：模块**故意不读**它，见 `u1-registration.mjs:176` 上方注释「完全不看 s.custody」）
   ⇒ handler 构造 `submission` 时**按这五个字段逐个赋值**，多余字段一律丢弃。
   **理由**：(366) 那个洞的形态正是"调用方塞一个同名字段"。展开 `req.body` 会把它原样重开。
2. **禁止 handler 自己碰 `u1_identity_challenge` / `u1_identity_registration`。** 读写权归模块。
   handler 若要发挑战，走另一条端点，且**只能通过 store 的动词式导出**（`u1-challenge-store.mjs` (376) 之后不再导出 ops 对象）。

### 为什么不改变信任形状

签名不变（仍是那三个键）· 无新参 · 无 caller-optional provider · 无对调用方态的新 `x.y()` 解引用。
**新增的是一个调用点，不是一个参数面。**

---

## §2 ② `deriveCustody` pre-tx 读 ↔ 注册写 之间的 TOCTOU 加严

### 现状（实读，窗口是精确的）

| 位置 | 事件 |
|---|---|
| `u1-registration.mjs:176` | `deriveCustody(sqlite, s.relayId)` —— 读 `relay_nodes`，**在事务之外** |
| :177-215 | 绑定证明 / store 结构校验 / PoP 验签 |
| `:216` | `const runTx = sqlite.transaction(() => { … })` |
| `:265` | `.immediate` —— **BEGIN IMMEDIATE，写锁在此刻才取得** |

⇒ **TOCTOU 窗口 = :176 → :265**。窗口内另一个连接可以改 `relay_nodes`
（例：给该 relay 导入 privkey ⇒ custody 由 `mnemonic` 变成混合态），而我们仍会写入 :176 派生出的 `'mnemonic'`。

### 🔴 为什么现有约束挡不住它（实读 DDL 确认）

live 库真实 DDL（`sqlite_master`）：

```sql
CREATE TABLE u1_identity_registration (
  relay_id              TEXT    PRIMARY KEY,
  root_fingerprint      TEXT    NOT NULL UNIQUE,
  root_xpub             TEXT    NOT NULL,
  identity_index        INTEGER NOT NULL DEFAULT 0 CHECK (identity_index = 0),
  identity_pubkey_xonly TEXT    NOT NULL,
  custody               TEXT    NOT NULL CHECK (custody = 'mnemonic'),
  registered_at         TEXT    NOT NULL DEFAULT (datetime('now'))
)
```

- `CHECK (custody = 'mnemonic')` **挡不住本 TOCTOU** —— 它只校验我们**选择写入的那个字面量**，
  而我们写的正是 `'mnemonic'`。（此前我对 @KANet-UI 的同一判断，现已对着真 DDL 复核成立。）
- `UNIQUE(root_fingerprint)` **确实**兜住另一件事（同一根指纹重复注册 = N3），**但与本窗口无关**。

### 设计（不加参数）

**在事务内重新派生一次并比对**：

```js
const runTx = sqlite.transaction(() => {
  const custody2 = deriveCustody(sqlite, s.relayId);          // ← 事务内、写锁已持
  if (!custody2.ok) throw new RegError(custody2.code, custody2.reason);
  if (custody2.custody !== custody.custody) {
    throw new RegError(REG_REJECT.CUSTODY_CHANGED_MIDFLIGHT,  // ← 新增 reject code(枚举内新增值, 非新参)
      'custody 在 PoP 与落库之间被改动 ⇒ 拒(fail-closed), 不写入 pre-tx 派生值');
  }
  … 原有插入 …
}).immediate;
```

### 为什么这次 `.immediate` 真的覆盖得住（与 (354) 那次的关键差别）

(354) 挑战存储必须走**结构绑定**，因为它**可能坐在另一个连接/另一个库**上，`.immediate` 的锁管不到。
🔵 **而 `relay_nodes` 与 `u1_identity_registration` 在【同一个库文件】**（本报告的所有查询都从
`kasia-console/data/console.db` 单库读出）⇒ `BEGIN IMMEDIATE` 取的 RESERVED 锁**阻塞其他写者**，
事务内重读到的 `relay_nodes` 在提交前不可能再变。**所以"事务内重派生"在这里是充分的**，不需要再造一层结构绑定。
（判据：**不要把上一个洞的修法照抄到形状不同的下一个洞上** —— 那正是我今晚在别处栽过的"把本机形状当通例"。）

### 为什么不改变信任形状

无新参 · 无新 provider · 无对调用方态的解引用；新增的是**一个 reject code 值**和一次内部重读。
⚠ 但按 L135 的字面，**新增 reject code 属于"被审信任形状"之外的枚举扩充**，我**不自行判定它豁免**——
提请审席明确一句：`REG_REJECT` 增值是否需要重跑枚举。**我按"需要则重跑"准备。**

---

## §3 ③ 具体存储表 schema / 迁移 / 索引

### 现状（实读）—— 🔴 这是整个 wiring 的**真实卡点**

| 表 | migrate.js | live 库 | 行数 |
|---|---|---|---|
| `u1_identity_registration` | ✅ 有（`src/db/migrate.js:5683`） | ✅ 存在 | **0** |
| `u1_identity_challenge` | 🔴 **没有** | 🔴 **不存在** | — |

`u1_identity_challenge` 的 DDL **目前只存在于测试文件**（`u1-registration.test.mjs:59`）。

⇒ 🔴 **结论：`registerIdentity` 现在【无法接线】，而且是 fail-closed 意义上的"完全不能半工作"**：
它要求 `challengeStore` 必传（否则 `CHALLENGE_CONSUME_MISSING`），
而 `createChallengeStore(sqlite, table)` 的工厂**校验表存在**（我在 (376) 加的），生产库里那张表不存在 ⇒ **直接 throw**。
🔵 **这是好消息不是坏消息**：不存在"接了一半、静默降级"的中间态。

### 设计：迁移

⚠ **先纠一处我自己差点误报的读数**：`PRAGMA user_version` = **0**，且库里**没有任何 migration 版本表**
（`sqlite_master` 里 `%migrat%`/`%version%`/`%meta%` 全空）。
⇒ 本仓 `migrate.js` 是**幂等声明式**（用 `PRAGMA table_info` 判断再补列/建表），**版本号是代码里的编号约定，不是库里的状态**。
**不要把 `user_version=0` 读成"迁移没跑"** —— 那是用错了尺。

迁移形状（追加到 `migrate.js` 末尾，编号接当前最新之后，与既有风格一致）：

```sql
CREATE TABLE IF NOT EXISTS u1_identity_challenge (
  challenge   TEXT PRIMARY KEY,          -- 一次性挑战原文
  used_at     INTEGER,                   -- NULL = 未消费; CAS 的判据列
  expires_at  INTEGER NOT NULL           -- ms epoch
);
CREATE INDEX IF NOT EXISTS idx_u1_challenge_unused
  ON u1_identity_challenge (expires_at) WHERE used_at IS NULL;
```

- `challenge` 作 PK ⇒ 天然唯一，且 CAS 的 `UPDATE … WHERE challenge=? AND used_at IS NULL` 走主键。
- 那条**部分索引**只服务清理/巡检（"还有多少未消费且已过期"），**不参与 CAS 正确性** —— 明写清楚，免得下一个人以为它是闸。
- `expires_at NOT NULL`：测试夹具那份 DDL 没有 NOT NULL；生产收紧一格（缺过期时间的挑战不该存在）。
  ⚠ 收紧后**测试夹具的 DDL 与生产不再逐字相同** ⇒ 按在册 `feedback-offline-test-must-use-real-schema-with-triggers`，
  **测试夹具应改为读生产 DDL**，否则测的是另一张表。**这一条列入本项验收。**

### 为什么不改变信任形状

纯 DDL 新增；模块签名与解引用面不变。

---

## §4 ④ payoutshard 默认回落不对称

### 🔴 锚点不符 —— 先说这个，别让我把设计做在错的位置上

派工写的是 **`payoutshard:1824`**。实读 `kasia-console/src/api/pool.js:1824` 是
**silverc 路径 pin**（`SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe'`），
与"默认回落不对称"无关。

符合该**描述**的是 **`pool.js:1287`**：

```js
// create-v07 新盘默认 zk_native=true —— 此前 caller 不显式传该字段时静默落回旧 V1(PayoutShard committee-sig)路径
const _spec = JSON.parse(b.resolution_rule_spec || '{}') || {};
if (_spec.zk_native !== false) _spec.zk_native = true;
```

**我读到的不对称**：**选择 ZK 是"什么都不做"，而选择 V1 必须精确传布尔 `false`**。
⇒ `zk_native: "false"`（字符串）、`0`、`"no"` 全部 `!== false` ⇒ **一律落 ZK**。
方向上这是"偏向 committed 架构"的安全侧（符合 D-001），**但它会让一个意图退回 V1 的调用方静默拿到 ZK**。

🟡 **我不确定这就是派工指的那一项**（行号差 537 行，且 `:1287` 的注释把这个默认描述成**已修**而非缺陷）。
⇒ **请 @Bettor 用一句确认**：④ 指的是 `:1287` 这个 opt-out 不对称，还是别的文件/别的行？
在确认前，本项**只留证据不出设计**——避免把设计做在错的坐标上（在册：**坐标存在 ≠ 推断正确**）。
🔨 顺带一条通则：**行号锚点会漂**，留档时最好带一段可 grep 的字面量，而不是纯行号。

---

## §5 ⑤ `u1-escape-hatch-live-check.cjs` §5-6

### 现状（刚跑，只读）

脚本位置：`scripts/u1-escape-hatch-live-check.cjs`（J2 2026-08-12 写，答 J1 §5 的开放问题）。
它用**行为证据**（运行时真签出来的地址，落 `broadcast_messages.sender_address`）判两个逃逸口是否**正在生效**：

```
近期发过广播的运行时签名地址 = 5 个
  ✅ Bettor-tn 249 · J2-tn 206 · KANet-UI-tn 71 · NWT-tn 70  — 运行时地址 == relay_nodes 记录
  ⓘ 1 个不在本机库(qzdh7nar…, 23 条) — 若是别节点(J1 :3300)的 relay 则正常
判据①(继承 KASPA_PRIVKEY 顶掉全体) : ❌ 不成立 — 4 个 relay 各签各的地址
判据②(继承 ACCOUNT_INDEX≠0)        : ❌ 不成立 — 运行时地址与 relay_nodes 逐字符对上
```

### LIVE 时的判据（写死，不靠临场判断）

1. **注册前必须跑一次**，且要求两条判据**都不成立**；
2. 🔴 **作用域别读大（脚本自己也印了）**：它只覆盖**近期真发过广播的本机 relay**，
   且**排除的是"正在生效"，不是"变量不存在"** —— Windows 读不到别的进程的环境块。
   ⇒ **不得**把它的绿灯写成"逃逸口不存在"；只能写成"在这批 relay 的运行时行为上未生效"。
3. **零数据 ≠ 通过**：脚本对"近期零条带 sender_address 的广播"显式印 `没有数据可判`。**那一档必须当未通过处理。**

---

## §6 验收判据（预注册，事后不加项）

1. **接线后 `registerIdentity` 的签名逐字未变**（`grep -n "export async function registerIdentity" -A1`）。
2. **handler 不含 `...req.body` / `Object.assign(.., req.body)` 之类展开**（可 grep 的负面判据）。
3. **两张表在 live 库都存在**，且 `u1_identity_challenge` 的 DDL 与 migrate.js 里的**逐字相同**（不是"差不多"）。
4. **测试夹具改为读生产 DDL**（§3 那条收紧带来的债，不许留）。
5. **TOCTOU 用例**：另一连接在 `:176` 与 `:265` 之间改 `relay_nodes` ⇒ 必须拒，且**一个字节都没写**。
6. **变异清单同步扩格**：新增闸必须有对应变异（含刚采纳的 **no-op-first-cell 恒红探测格**），
   且跑前先过 `mutation-runner.selfcheck.mjs` 三臂。
7. §5 那个 live-check 跑过且两条判据都不成立；**零数据一档算未通过**。

## §7 未解决 / 需他人拍

- 🔴 **④ 的锚点**（`:1824` vs `:1287`）—— 待 @Bettor 一句确认，我才出设计。
- 🟡 **新增 `REG_REJECT` 值是否触发"重跑 authority 枚举"** —— 待审席明确；我按"需要则重跑"准备。
- 🔴 **节点健康**（`isSynced=false`）是 §6-1 LIVE 的**前置**，属 J1 域，本报告不涉；
  ⚠ 且 NWT 16:43 的跨节点数据已**推翻** `DECISIONS` L140「123 tips 异常/健康应个位数」这个前提，
  该前提正在由 Bettor 重构问法 —— **本报告不引用那个已被推翻的判据**。
