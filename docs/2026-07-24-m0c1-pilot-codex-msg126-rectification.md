# M0c-1 Path B Pilot — Codex MSG-126 审整改清单（P1 诊断收窄 + P2 文档真相对齐·最后一轮收尾）

> **性质**: 协调工件。响应 Codex `RESPONSE-20260724-MSG126-CODEX-REVIEW`。
> **Codex 判**: **E/C/D/arm-before-fund 核心安全全 CLOSED + evidence 绑定 GREEN**。剩 2 条有界 package-level MUST-FIX（非新安全洞·是收窄+对齐）·整体 RED-for-executable 直到这 2 条闭。Codex 原话: "只改这几个有界文件+测试绿·不需要任何额外 terminal 安全扩展"=最后一轮 frozen package。
> **审基**: 当前 tip e255eeef。改完新 tip + regen package/receipt/evidence 重提。

## P1 — 收窄 /diagnose 端点授权（钱路·先报设计）

**Codex 判**: `GET /api/tg-wallet/:tg_user_id/diagnose` 现挂 shared ingest secret·接任意 tg_user_id·读任意行·触发 mnemonic 解密。不返 secret·但把共享凭据从"正常 bot/API"扩成"全托管钱包表的 decrypt-and-derive 触发器"=不必要的新暴露面·违背 gradual 规则（模块化可 defer terminal 控制·但不得静默造更宽的密钥处理面）。

**修（Codex required closure）**:
1. **解密前先要求该行 access_mode='capability_only'**（pilot 类）——普通 'normal' 钱包 + unknown/null mode **不解密直接拒**。
2. **换 operator/Owner 级凭据**（非只 shared ingest secret）+ **default-off 诊断 flag** + **loopback/IP 限制**（后两者是可接受的额外层）。
3. 只返 `{ok, address}`（同现在）·零 secret/error echo。
4. **加真实 HTTP 回归**: ①合法 operator 授权 + capability_only 行→成功 ②只有 shared ingest→拒 ③normal 钱包→解密前拒 ④unknown/null access_mode→拒 ⑤错 live key→无 secret 失败。
5. **抽一个可复用 access_mode 策略 helper**（legacy-send + diagnose 共用**一条 fail-closed 规则**·非各自 drift·这条同时闭合 Codex d605 req 3 的"别重复 parser"）——规则: legacy send 仅 access_mode==='normal' 放行·unknown/null/capability_only 拒。
→ @J2 + @KANet-UI 联合设计（auth/policy·先报·NWT 红队）

## P2 — receipt/runbook 真相对齐 v0.15（@KANet-UI）

### receipt 升 v0.12（加 §4.3/§4.4 新相字段）
receipt 还 v0.11·phase 表从 post-restart §4 直跳 post-smoke §4.5·缺: pre-fund 零余额确认 / live diagnose 结果+address+时间戳 / legacy 路由拒绝结果+状态+时间戳 / 诊断用的授权身份 / §4.3 全绿决策 / §4.4 充值 tx+readback 时间+金额。补齐。

### 部署 pin 补新 load-bearing 路由
receipt 部署文件 digest 表漏 `tg-wallet.js`（现含 durable 拒 + live diagnose 两个 load-bearing 闭合）。至少加: `kasia-console/src/api/tg-wallet.js` + `kasia-console/src/db/client.js`（诊断用的 live DB-path 权威）+ P1 引入的 auth/policy 模块 + runbook/receipt blob 字段进 reviewed package 比对。

### 删/校正 stale 真相
- `docs/2026-07-24-kanet-ui-c-diagnose-pending-review-diff.md` 还说代码只在未提交 working-tree（实际已 commit）→删/标历史。
- runbook §4.5 还说真转账是"唯一/最终 live DB-key 证明"（跟新 §4.3 充值前诊断矛盾）→校正: §4.3 诊断是充值前权威证明·§4.5 是 arm 后的实转账验证。
- runbook §6 还说删 `PILOT_WALLET_ADDRESSES` 重开 legacy 路由（实际 durable access_mode 才权威·删 env 不再是钱包隔离 fail-open·env 仍是 defense-in-depth）→校正。
- runbook status 还说 E-schema/D-fault pending（实际已 commit）→更新。

## regen（Codex req 6）
改动 load-bearing blob 更 M0a digest + regen package manifest/receipt/evidence·全测 HEAD 重跑（P1 焦点测试 + G4/provision/insert 保持绿）。→ 最终整合我做。

## 流程（最后一轮·不牙膏）
P1 先报设计（auth/policy·NWT 红队）→ P1/P2 一批改完 → 我+NWT 三重深核（**我额外亲验: P1 normal 钱包打 diagnose 被解密前拒 / 只 ingest secret 被拒 / capability_only+operator 授权成功 / 策略 helper 两路由共用一条规则 / P2 文档每条 stale 真相真删了**）→ 一次 Codex 重提。Codex 说这是最后一轮·稳步收尾。
