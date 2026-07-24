# KANet-UI · Codex MSG-126 P1（收窄 /diagnose 授权 + 共享 policy helper）pending-review diff

> **性质**: 历史 pending-review 工件（**🔴 v0.1 更正，Codex MSG-127 O3 抓出的 stale 真相**：本文档原写"代码在共享工作树未 committed"，那是三方核实（我+NWT review_ref=53117aed+J2）通过前的状态——代码已正式 commit（`eae35ae4`，含 `tg-wallet.js`/新文件 `pilot-wallet-policy.js`/regression 测试），本文档降级为 P1 设计记录，不再是活跃 pending-review。当前实际代码状态以 `eae35ae4` + `git log -- kasia-console/src/api/tg-wallet.js` 为准）。
> **依据**: `docs/2026-07-24-m0c1-pilot-codex-msg126-rectification.md` §P1（Bettor 批：复用 `operator-settle.js`/`coord-status.js` 既有 admin 端点模式，不新造 auth 机制）。
> **用户面钱路 + 密钥经手**: 不自批，走完整 pending-review 周期。

## 洞

Codex 判：`GET /:tg_user_id/diagnose`（Codex MSG-125 MUST-FIX C 引入）挂 shared ingest secret，能对任意 `tg_user_id` 触发解密——不返 secret，但把共享凭据从"正常 bot/API 凭据"扩成"全托管钱包表的 decrypt-and-derive 触发器"，是不必要的新暴露面。

## 改动

### 新文件 `kasia-console/src/lib/pilot-wallet-policy.js`

共享 `access_mode` 策略 helper（Codex req 5，同时闭合 d605 req 3"两 parser 各自 drift"的同类问题）：
- `isLegacySendAllowed(accessMode)` = `accessMode === 'normal'`（白名单式，只放行 normal，unknown/null/capability_only 全拒）
- `isDiagnoseAllowed(accessMode)` = `accessMode === 'capability_only'`（白名单式，只放行 capability_only）

### `kasia-console/src/api/tg-wallet.js`

1. `/send`：改用 `isLegacySendAllowed()`（从"排除 capability_only"改成"只放行 normal"——收紧到白名单式判定，未来出现的第三种 `access_mode` 值默认最严）
2. `/diagnose`：**去掉 shared `AUTH`**，改三层（同 `coord-status.js`/`operator-settle.js` 既有模式）：
   - `ADMIN_DIAGNOSE_ENABLED !== '1'` → 503（默认 off）
   - `checkAdminSecretTier(request, 'ADMIN_SECRET_PILOT_DIAGNOSE')`（独立 operator 级凭据，非 shared ingest secret）
   - `ADMIN_IP_ALLOWLIST`（loopback 默认）
   - **解密前**先查 `isDiagnoseAllowed(access_mode)`，非 capability_only 直接拒，不碰 `decrypt()`

### 既有 schema 复核（无需改动）

`migrate.js` v193 `ALTER TABLE ... ADD COLUMN access_mode TEXT DEFAULT 'normal'` 对既有行和后续经 `/create` 端点新建的行都会读到 `'normal'`（SQLite 对常量 DEFAULT 的既有行回填是标准行为，`/create` 的 INSERT 语句本就不显式传这一列，靠列 DEFAULT）——`isLegacySendAllowed` 从"排除 capability_only"收紧到"只放行 normal"不会误伤既有/新建的普通用户钱包（regression ⑩ 验证）。

## 测试（`tg-wallet-pilot-isolation-regression.mjs`，重写 ④⑤ + 新增 ⑥-⑫，working tree diff）

真 Fastify inject，23/23 PASS（原 8 + C 诊断原 6 改写为 9 + 新增 4）：
- ④ operator 授权 + capability_only → 成功
- ⑤ 只 shared ingest secret（无 operator tier header）→ 403 拒
- ⑥ normal 钱包（即便 operator 授权对）→ 解密前 403 拒
- ⑦ unknown access_mode（未来值）→ 默认最严拒绝
- ⑧ key 不一致（operator 授权对+access_mode 对）→ decrypt 失败 ok:false，无泄露
- ⑨ `ADMIN_DIAGNOSE_ENABLED` 未设 → 503（即便其余都对）
- ⑩ normal 钱包走 `/send` 不受影响（证收窄没误伤既有用户）
- ⑪⑫（沿用既有）durable 列 env-unset/畸形场景

## lint

`node scripts/lint-kanet.mjs kasia-console/src/api/tg-wallet.js kasia-console/src/lib/pilot-wallet-policy.js kasia-console/test-framework/cases/m0c1-gate/tg-wallet-pilot-isolation-regression.mjs` — 0 errors。新文件 `pilot-wallet-policy.js` 纯逻辑判断函数（不 import better-sqlite3/relay-manager），未触发 M0a 门。

## 待办

- NWT 红队通过后 commit 实代码
- P2（receipt/runbook 真相对齐）单独提交

---

**关联**: `docs/2026-07-24-m0c1-pilot-codex-msg126-rectification.md` §P1、`docs/2026-07-24-kanet-ui-c-diagnose-pending-review-diff.md`（此前的 diagnose 端点首版，本次在其基础上收窄授权）。
