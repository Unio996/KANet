# M0c-1 完整清单复核（别名8 + exchange + mind-manager）— NWT 穷尽分类 verdict

> **Status**: NWT 穷尽复核 PASS（2026-07-23）· 批C KANet-UI 照本清单逐 call 标 origin。
> **补** `docs/2026-07-23-NWT-m0c-1-per-route-classification.md`（§9 逐 route 清单）三处缺口：①别名 call 8 处（string-grep "sendCommandAsync(" 漏）②exchange 流 ③mind-manager。
> **方法**：grep 别名 import 点 → 定位每个别名 call 点 → 核命令 type + 触发源（daemon internal vs 请求 app）。

---

## 🔴 红队关键结论（先说最重要的）

**8 处别名 call 全是 `send_message`/`send_broadcast` 通信命令，无一钱路（无 transfer/ecdsa_sign/per_bet/sweep）。别名坑对 origin 标注穷尽性重要（string-grep 漏这 8 处 = 8 处无 origin tag），但不隐藏任何零鉴权钱路端点——最高危面（钱路）不在别名里。**

**exchange 流：exchange.js 6 处触链命令全 `send_broadcast`（协议公告），非钱路。真 KAS 钱路在 `exchange-machine.js:974 type:'transfer'`（daemon auto-deliver）。** exchange.js 路由本身只发通信，不直接触钱路。

---

## ① 别名 call 8 处穷尽 + 分类

| # | 位置 | 别名 | 命令 type | 触发源 | origin | 类 |
|---|---|---|---|---|---|---|
| 1 | `api/bettor.js:1666` | `sca` | send_message（DM maker） | 路由内（bettor panel） | app | 🟡 通信非钱路 |
| 2 | `api/exchange.js:600` | `sendCancelCmd` | send_broadcast（cancel_v1） | /exchange cancel 路由 | app | 🟡 通信非钱路 |
| 3 | `api/trading.js:2501` | `sendCmd` | send_broadcast（delivered） | /trade action 路由 | app | 🟡 通信非钱路 |
| 4 | `api/trading.js:2585` | `sendCmd` | send_broadcast（paid） | /trade action 路由 | app | 🟡 通信非钱路 |
| 5 | `services/bettor-prediction-settler.js:446` | `sca2` | send_message（maker DM） | settler daemon tick | **internal** | 🟡 通信 |
| 6 | `services/bettor-prediction-settler.js:450` | `sca2` | send_message（taker DM） | settler daemon tick | **internal** | 🟡 通信 |
| 7 | `services/exchange-machine.js:1020` | `sendCmd` | send_broadcast（delivered） | 状态机 daemon | **internal** | 🟡 通信 |
| 8 | `services/mind-manager.js:1080` | `sendCmd` | send_broadcast（timeout_v1） | mind-manager daemon 扫描循环 | **internal** | 🟡 通信 |

**穷尽性**：别名 import 点 grep（`sendCommandAsync as X` / 解构重命名）= 6 处（bettor/exchange/trading×2/exchange-machine/mind-manager）+ settler `sca2`（:444）= 别名名 `sca`/`sendCancelCmd`/`sendCmd`/`sca2`。逐名 call 点扫 = 8 call。**接位复扫的 8 对，我原 7 少算 settler 第 2 处（sca2:450 taker DM）**。
**分类**：4 app（bettor/exchange/trading×2·请求触发）+ 4 internal（settler×2/exchange-machine/mind-manager·daemon）。全通信低危——app 面走 M0c-2 粗 scope（通信-only）即可，internal daemon 放行。

## ② exchange 流分类（"25 路由" 澄清）

- **exchange.js**：28 route 定义，**6 处 sendCommandAsync/别名 call，全 `send_broadcast`**（:309/:492/:600/:656/:708/:797 = 协议公告 publish/accept/paid/delivered/cancel/timeout）。**无一钱路 transfer**。路由零鉴权（收敛类·J1 场景-A-facing maker/taker 已确认）。
- **exchange-machine.js（daemon 状态机）**：4 call = :615/:711/:1020 三处 send_broadcast（通信）+ **:974 `type:'transfer'`（KAS auto-deliver = 真钱路）**，origin=internal（daemon 执行，retry loop 内）。
- **EVM auto-pay**：走 `evm-transfer.js` 直连 web3（非 relay 命令，不经 gate，另属 EVM 私钥面）。

**收敛点（红队 note）**：exchange 的钱路（KAS transfer :974）origin=internal（daemon 执行·gate 放行 daemon），**但由零鉴权 exchange.js publish/accept 路由驱动**。场景-A 攻击面 = 攻击者经零鉴权路由注入伪 offer/accept → daemon 验证过后 auto-deliver KAS。**所以 exchange 收敛点在路由层**（publish/accept 加 origin=app+grant 授权 + 保留 exchange 自身 balance/reputation/verification 前置闸），**不是标那 6 处 send_broadcast 通信 call**。与 J1 收敛类判定一致，收敛落在路由授权非通信命令。

## ③ mind-manager:1080 分类

- `services/mind-manager.js:1080`（别名 `sendCmd`）：send_broadcast（kanet_timeout_v1 accountability），在 timeout 扫描 daemon 循环内（`elapsedMin >= timeout_minutes` → broadcast）→ **origin=internal（daemon）**，通信非钱路。低危。

---

## 标注指导（给 KANet-UI 批C）

1. **别名 8 处**：逐 call 标（表①的 origin 列）——4 app + 4 internal，全通信。**迁移 lint 必加别名检测**（`sendCommandAsync as X` / 解构重命名后的 call）——armed 前硬前置，否则 string-grep 漏这 8 处 = 漏标 = arm 后 fail-closed 拒断合法通信 or 漏 origin。
2. **exchange.js 6 send_broadcast**：origin=app（请求触发·通信），收敛落路由层授权（非通信 call 本身）。
3. **exchange-machine.js 4 call（含 :974 transfer 钱路）**：origin=internal（daemon）。:974 是钱路但 daemon 执行，场景-A 防御在上游路由授权 + exchange verification 前置闸。
4. **mind-manager:1080**：origin=internal（daemon），通信。

## 穷尽性判据

- 别名 import 点全 grep（4 别名名）→ 8 call 点全定位核 type/触发源。✅
- exchange.js + exchange-machine.js 全 sendCommandAsync/别名 call 逐个核。✅
- mind-manager 别名 call 核。✅
- **全 8 别名 + exchange 6 + mind 1 无一是新的零鉴权钱路端点**——per-route 清单 §9 的钱路收敛面（pool 18/trading/relay）不变，别名/exchange/mind 补的是通信面 + 一处 daemon-internal 钱路（exchange-machine:974，非新增零鉴权路由）。

**关联**：`docs/2026-07-23-NWT-m0c-1-per-route-classification.md`（§9 母清单）、`docs/2026-07-23-m0c-1-origin-migration-classification.md`（批C 迁移）。
