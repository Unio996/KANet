# KANet-UI · Codex MSG-124 MUST-FIX E — tg-wallet.js legacy /send pilot 隔离 pending-review diff

> **性质**: pending-review 工件（供 NWT 红队 + Owner 知情），代码本身在共享工作树未 committed（`git diff kasia-console/src/api/tg-wallet.js` 可直接看到实际改动），本文档只是导航 + 变更点说明。
> **依据**: `docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md` §E（Bettor 裁定采用 Codex option 1，最小本地改）。
> **用户面钱路 + 密钥经手**: `tg-wallet.js` 是全体用户（非仅 pilot）都在用的托管钱包路由，本改动不自批，走完整 pending-review 周期，NWT 红队 + Owner 知情。

## 洞（Codex 实锤，Bettor 代码核实）

`kasia-console/src/api/tg-wallet.js:96` `POST /api/tg-wallet/:tg_user_id/send` 只挂 `AUTH`（shared ingest secret）preHandler，完全绕过 M0c-1 grant/source-scope/armed 闸/capability 网关——查同一张 `tg_custodial_wallets` 表、解密、直接经 `relay-manager.js`（`origin='legacy-unmigrated'`）发 `custodial_transfer`。且原 `CUSTODIAL_RELAY_ID` 定义（原 line 28）带 `|| process.env.FAUCET_RELAY_ID` 隐式 fallback（同 K-13/capability.js:30 那类 footgun）。

结果：pilot custodial 钱包（`docs/2026-07-23-m0c-1-pilot-activation-runbook.md` §3.6）一旦充值，**arm 前**，任何持 `x-ingest-secret` + pilot `tg_user_id` 者即可经这条 legacy 路径把钱转走 —— "先充值/后 arm 才有风险"的安全前提在这条路径上是假的。

## 改动（`kasia-console/src/api/tg-wallet.js`，working tree diff）

1. **line ~28**：`CUSTODIAL_RELAY_ID` 去掉 `|| process.env.FAUCET_RELAY_ID` 隐式 fallback，改显式必设、未设直接 503（同 `capability.js:30` 那次修法，K-13 一并了）。
2. **`/send` handler，wallet 查出之后**：新增 fail-closed 隔离检查——查出的 `w.kaspa_address`（fund-holder 本体，比 `tg_user_id` 更根本，防"另一个 `tg_user_id` 映射到同一 pilot 地址"的边缘情形）若命中 `PILOT_WALLET_ADDRESSES`（复用 `capability.js:237` 已用的单一真相源，不新造第二个判据来源，逗号分隔 env → `Set`），返回 403：`"M0c-1 pilot 隔离钱包: 本 legacy 路径已 fail-closed 禁用，请走 capability 网关 custodial_transfer 路径"`。

对非 pilot 地址（`PILOT_WALLET_ADDRESSES` 不含该地址，含该 env 未设/空的默认情形）**零行为变化**——现有全体用户的 `/send` 逻辑完全不动。

## 测试（`kasia-console/test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs`，working tree 新文件）

真实 Fastify inject 调 `tg-wallet.js` 注册的路由处理器（非 mock/非直调内部函数），真 `runMigrations()` 建表（同门⑤/G4 harness 纪律），真 `setConfig` 写 `ingest_secret` 让 `AUTH` 通过（非绕过鉴权测业务逻辑），隔离 DB + throwaway `CONSOLE_ENCRYPTION_KEY`，不碰 live `console.db`。8/8 PASS：

- ①**核心攻击场景本身**：持 ingest secret（合法调用者）+ pilot `tg_user_id` 直接打 `/send` → 403 + 精确命中隔离文案（非泛泛拒绝断言）
- ②非 pilot 地址不被隔离检查拦（现有用户行为不变的负向证据；已知副作用：该路径会继续走到 `balanceKasForAddress()`，`rpc-health.js` 死端口不可达时其自带 `discoverNode()` fallback 会真实对外只读发现请求——这是 `rpc-health.js` 既有设计，非本 regression 引入的隔离破口，本测试断言不依赖该次发现的结果）
- ③`CUSTODIAL_RELAY_ID` 未设（即便 `FAUCET_RELAY_ID` 有值）→ 503 fail-closed，精确文案不含 `FAUCET_RELAY_ID`，证明 fallback 措辞也删了

## lint

`node scripts/lint-kanet.mjs kasia-console/src/api/tg-wallet.js kasia-console/test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs` — 0 errors。

## 待办（NWT 红队通过后）

commit `tg-wallet.js` 实代码 + regression 测试文件，走完整 pending-review 收尾（同 J2 那几轮的模式：合入前 working tree diff 已固定，NWT 审的就是最终要合的那份，非另一份"审后再改"）。

---

**关联**: `docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md` §E、`docs/2026-07-23-m0c-1-pilot-activation-runbook.md`（C-runbook 半另行提交）。
