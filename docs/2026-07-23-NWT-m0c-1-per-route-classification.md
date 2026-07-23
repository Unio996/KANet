# M0c-1 §9 逐 route 分类清单（NWT 二核穷尽·批C 标注权威输入）

> **Status**: NWT 二核穷尽 PASS（2026-07-23）· 批C KANet-UI 照本清单**逐 route** 标 origin（**非文件级**——pool.js 是活教训：文件级把 18 处零鉴权标成"有门"）。
> **来源**：J1 逐 route 可达性核（8 文件）+ NWT 独立核（chat.js + pool.js 全 20 处独立复验）。**方法**：每处 sendCommandAsync → 定位其 fastify route → 查该 route 有无 auth（verifyIngestRequest preHandler / checkAdminSecretTier / 无）。
> **三类 + 一个新类**：(a) 真 internal（非请求触发→origin=internal）/ (b) legacy-app 挂共享 secret（有门但场景A 可达=诚实残留挂里程碑）/ **🔴 零鉴权钱路端点（新类，比 (b) 宽=任意本机进程可达，判据=必收敛非诚实残留）** / 🟡 零鉴权非钱路（通信/公开，低危）。

---

## 🔴 零鉴权钱路端点（M0c-1 最高优先收敛面·必收敛）

### pool.js（NWT 独立核全 20 处·18 零鉴权）— 预测市场整个业务面裸奔

| route | auth | sendCommandAsync（命令） | 类 |
|---|---|---|---|
| `/api/pool/market/create` :530 | **无** | 经 helper :217/:241/:288（send_broadcast/get_pubkey/**ecdsa_sign**） | 🔴 零鉴权钱路 |
| `/api/pool/market/create-v06` :804 | **无** | 同上 helper | 🔴 |
| `/api/pool/market/create-v07` :1025 | **无** | 同上 helper（+:487 submit） | 🔴 |
| `/api/pool/market/:id/bettor/register-v07` :1429 | **无** | :1482/:1617（get_pubkey/**per_bet**） | 🔴 下注 |
| `/api/pool/market/:id/bettor/register-v07/prep` :1640 | **无** | helper | 🔴 |
| `/api/pool/market/:id/bettor/register-v07/confirm` :1679 | **无** | :1814（**sweep_per_bet**=钱路） | 🔴 |
| `/api/pool/market/:id/oracle/deposit` :2083 | **无** | helper | 🔴 |
| `/api/pool/market/:id/bettor/register` :2145 | **无** | helper | 🔴 下注 |
| `/register-external/prep`:2347 `/confirm`:2393 | **无** | helper | 🔴 |
| `/register-v06/prep`:2557 `/confirm`:2594 | **无** | helper | 🔴 |
| `/api/pool/market/:id/settle` :3887 | **无** | helper | 🔴 结算 |
| `/api/pool/market/:id/oracle/vote` :3912 | **无** | :3949/:3968/:3979（get_pubkey/**ecdsa_sign**/send_message） | 🔴 oracle 投票 |
| `/api/admin/pool/propose-close-v2` :1851 / `zk-handoff-v2` :1882 / `zk-close-v2` :1920 | **有**（admin tier） | :1968/:1978 | ✅ 唯二/三有门（admin） |
| `/api/pool/broker-fee-dm` :2746 | **有**（verifyIngestRequest :2747） | 无 sendCommandAsync（PII GET） | — |

**结论**：pool.js 唯一的 verifyIngestRequest（:2747）守的是 broker-fee-dm PII 端点，跟 20 处 sendCommandAsync **完全无关**；admin/pool/* zk 路由有 admin tier 门；**其余整个建市场/下注/oracle 投票/结算业务面零鉴权**。文件级标 (b) = 错。

### trading.js `/api/trade/mm-orders/:id/action`（:2221）
- auth：**无**（同文件 :2153 mm-orders 创建有 verifyIngestRequest，但 action route 无）。命令 :2470 type:transfer（做市交割发 KAS）。→ 🔴 零鉴权钱路。J1 判 app 面（KAS Market Maker 外部系统），收敛走 M0c-1 app 面授权（origin=app+envelope+grant）。

### relay.js
- `/api/relay/:id/send-command`（:1726）：**无**（全文件仅 :119 import-privkey 挂 verifyIngestRequest）。裸透传任意命令含全钱路。→ 🔴🔴 最严重（零门+任意命令，gate-arming 硬前置收敛）。
- `/api/relay/:id/transfer`（:494）：**无**。固定 transfer 提币。→ 🔴 零鉴权钱路（比 :1726 窄一档=固定语义非任意）。

---

## 🟡 零鉴权非钱路（低危·非收敛优先）— chat.js（NWT 独立核）

| route | auth | 命令 | 判 |
|---|---|---|---|
| `/api/chat/send` :214 | 无 | :250 send_broadcast | 🟡 通信非钱路（顶多 spam） |
| `/api/chat/confirm` :698 | 无 | :784 send_broadcast | 🟡 同上 |
| `/api/faucet/request` :614 | **零鉴权（isValidIngestSecret 只调不守·Bettor 二判精化）**——返回值仅切限速豁免，不带 secret 的公网请求照样发币 | :679 faucet KAS（10000 testnet KAS） | 🟡 **fully-public money-path**：faucet 功能即免费分发（要求 auth 反违用途），风险=Sybil 刷干（发自己那份 testnet KAS 非偷用户），安全靠**反刷控制**（每钱包1次+IP/设备24h3次+全局日帽50+relay余额封顶）非 auth。**不归零鉴权钱路收敛类**（不该加 auth）；归 origin=internal（Console 拥有固定命令决策）+公网触发特例，另立"faucet 反刷充分性"经济审 |

---

## ✅ 干净 (b)（挂共享 secret 守·文件级 (b) 标对）— J1 核

| 文件 | route/auth | 判 |
|---|---|---|
| `tg-wallet.js` | 3 路由全用 AUTH 常量（verifyIngestRequest），send:125 在守内 | ✅ (b) 坐实 |
| `escrow.js` | :59/:108/:138 create/lock/execute 全在 AUTH-gated 路由 | ✅ (b) 干净 |
| `admin.js` | :27 handshake 在 verifyIngestRequest 守路由（:18-27），且非钱路 | ✅ (b) 低危 |
| `discovery.js` | :388 handshake 被 scoped 全局 hook（:185-189）覆盖 | ✅ (b) |

---

## 🔶 单立卡（不进本次三分类）

- **oracle-pool.js**：`/withdraw`(:303)/`/enroll`/`/timeout-unlock` HTTP 层零 verifyIngestRequest，安全边界在下游签名验证层（`_broadcastOracleStakeWithdraw` 验签名者 pk==staker_pk_x）——J1 未 verify 该层严实度=**协议层 auth 完整性深查卡**（真校验=安全/没校验=真洞），性质非 origin 分类，另立。

---

## 二核结论

- **穷尽性 PASS**：9 (b)-候选文件 + relay/trading 零鉴权端点全逐 route 核完，无遗漏。
- **批C 标注规则**：KANet-UI 照本清单**逐 route** 标——(a) 内部 daemon（services/lib ~80 处，另 §4）origin=internal / 零鉴权钱路面（pool 18+trading+relay）= 收敛类（非直接标 (b) 诚实残留，必收敛，收敛后按 app/operator 定 origin）/ 干净 (b) = origin=legacy-app-unprotected 诚实残留挂里程碑 / 🟡 chat 通信非钱路 = 低危单独处置。
- **零鉴权钱路面严重性**：存量债非 M0c-1 引入；Console 127.0.0.1 localhost-only 双证=非公网火警；面最大（pool 整个业务面）=最高优先收敛，随 M0c-1 gate+迁移堵。

**关联**：`docs/2026-07-23-m0c-1-origin-migration-classification.md`（§9 母文件，本清单为其逐 route 精化版）。
