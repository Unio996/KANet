# M0c-1 Path B Pilot 激活文档 — 全面缺陷梳理（一次性清单）

> **性质**: 协调工件（非设计文档）。响应 Owner 2026-07-24 09:38 "尽可能全面梳理反馈，而不是一点儿一点儿挤牙膏式的应" 指令。
> **来源**: Codex 二审 `RESPONSE-20260724-PATHB-RUNBOOK-V07-RECEIPT-V07-CODEX-REVIEW.md`（4 条 MUST-FIX）+ Bettor & NWT 主动自查补充（同类缺陷，防下一轮 Codex 再抓）。
> **原则**: 一次全改完 → Bettor+NWT 三重深核（技术成立性 / 整序列反向扫 / claim-to-code）→ 一次 Codex re-review。不再一条条挤。
> **锚**: 审基 = 当前 source tip（改动前 `cc805bf1`，Codex 二审基）。改完产出新 tip + 全 blob manifest 送 Codex。

## A. Codex 二审 4 条 MUST-FIX

### A1 — 无 live 状态先于 Owner go
- **洞**: runbook §2（建 pilot relay = 写 `relay_nodes` 行 + 大概率 spawn live relay 进程）+ §3 line 40（建 `tg_custodial_wallets` 行 = 生成加密 mnemonic 进 production DB）都在 §3.5（Owner go）之前。都是 Owner 批准前的真实 live 状态变更 / operational 身份 / 加密 key material。
- **修**: Owner 前只 **offline / isolated scratch** 生成地址 + relay 名（不 insert live `relay_nodes` / `tg_custodial_wallets`、不 spawn relay 进程、不动 production key custody）。Owner go 后才建 live 行 + readback + 证 match 候选值。**→ §2 整块移到 Owner go 后（§3.6 域）**。或 Owner 显式授权"建 live 行属无害准备"这个更窄动作（不能默认）。

### A2 — deploy-pin + fallback 措辞
- **(a)** 收据 §(h) line 146 硬编码 `26a23292` 为 reviewed tip + line 165 要求 deployed == 它。→ 换 runtime 填充字段：`reviewed_package_commit` / `review_response_commit` / `runbook_blob_sha` / `receipt_template_blob_sha` / `g4_evidence_blob_sha`(+sha256) / load-bearing 代码 blob-sha manifest / deployed commit + file digests。比对 = **deployed == 当前 Owner 决策 + 当前 Codex&NWT 审的包**，非 == MSG-122 旧 tip。
- **(b)** 收据 §(c'') line 77 + line 81 仍写"CUSTODIAL_RELAY_ID 静默落 FAUCET_RELAY_ID"= 现在假的（C-gateway `cb3d87b3` 已去 fallback）。CURRENT 操作指令改"显式必设 · 缺 = 503 fail-closed"。历史仅留 revision note。

### A3 — payee_scope 强制 + membership
- §(b) line 44 "若适用" → 删掉，改强制。
- §(c'') line 87 ⑧==⑨ 标量逐字符比对 → membership：`intent.target ∈ parsed(grant.payee_scope)`（JSON 数组 · `app-envelope.mjs:78 kind:'membership'` 坐实）。
- 首 pilot = singleton set 只含 Owner 批的 smoke 目标。记 parsed 全集 + 批准目标 + 成员结果 + smoke 额 + 源前后余额 + fee。
- **provision 必须传 `--payee`**（`m0c1-grant-provision.mjs:100` 默认 NULL，不传 = payee_scope 空 = 该维 NULL）。

### A4 — receipt 相位 + env readback 真实语义
- **(a)** 顶部 line 17 "激活执行者（§4 走完后）逐项填" 矛盾 §(c''') 必须 §3.6/§4 前填。→ 拆 5 相：① pre-auth proposal ② Owner decision record ③ post-auth/pre-arm 执行 ④ post-restart runtime ⑤ post-smoke/revoke。顶部指令不许说全部 §4 后填。
- **(b)** runbook §3.6 line 68 "写 kanet.env 后立即回读 `process.env.CUSTODIAL_RELAY_ID`" 技术不成立（编辑 env 文件不更新运行中进程的 process.env，须重启后才生效）。→ 两层核：**pre-restart FILE check**（读 kanet.env 文件核 literal 值）+ **post-restart RUNTIME check**（查新起 console 进程证 runtime `process.env` == 批准 relay id）。同理 gateway/armed flags。

## B. Bettor & NWT 自查补充（Codex 没明列但同类，一次修掉防下轮再抓）

### B1 — env 两层不只 line 68 一处
§(c'') ⑤（line 81 读 process.env.CUSTODIAL_RELAY_ID）+ §(d) line 117-118（两 flag "kanet.env 实际内容 + 运行时读值" 混一格）——所有 process.env 读点都要 file-vs-runtime 两层化。

### B2 — §(h) load-bearing 清单不全
现 5 文件（authorize/app-envelope/relay/capability/migrate）漏了 `m0c1-grant-provision.mjs`（manifest 锁 · grant 写手）+ runbook/receipt 自身 doc blob + `m0a-exception-manifest.json`。按 A2 补全成完整 manifest。

### B3 — source_scope 同 payee 也是 membership
`app-envelope.mjs:88` source_scope `kind:'membership'`。§(c') ①==②==③==④ 对 source_scope 同样标量 == vs 成员问题（singleton 时巧合相等）。改成 membership/singleton 语义表述，别只修 payee 漏 source。

### B4 — relay 移 Owner 后引出候选记法改
relay id 生成于创建时，Owner 前无 id。候选包描述"拟建新 pilot relay 名 X on testnet-12"（proposed），Owner 批后才创建取 id + 设 CUSTODIAL_RELAY_ID + readback。§(c'') ⑤⑥ + §(c''') line 99 候选记法随之改（候选 = 拟建 relay 名 + network，非已存在 id）。

### B5 — 钱包加密 key material
`tg_custodial_wallets` 建行生成 + 加密 mnemonic 进 production DB = Owner 前不该发生。Owner 前只 offline/scratch 派生 keypair 拿地址，live 行（带加密 mnemonic）Owner 后建。（A1 的钱包侧具体化）

### B6 — doc hygiene
runbook line 3 + receipt line 3 Status 都写 "v0.1"，实际 v0.7，更新。

## C. 派工（一次修完，非分批）
- **KANet-UI**（runbook + receipt 域 · 主体）：A1 / A2 / A4 / B1 / B2 / B3 / B4 / B5 / B6 全部文档重构。
- **J2**：A3 的 provision 侧（确认 `--payee` 强制传 + payee_scope singleton 写法）。C2 已 grep 坐实 relay membership。
- **J1**：evidence 自描述（嵌 source_commit + harness_blob_sha，Codex note）。

## 流程（破牙膏）
一次全改完 → Bettor + NWT 三重深核（① 技术成立性 ② 整序列反向扫 ③ claim-to-code，不只查"步骤在"要查"技术对"）→ **一次** Codex re-review（带 exact new source commit + 全 blob manifest）。有补充的直接加进本文档，别另起碎片。
