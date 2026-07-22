# Containment 卡：custodial_transfer subject 绑定（活跃横向越权面）

> **Status**: DRAFT（2026-07-23 · Bettor 起草 · 待 NWT 审 + Owner money-path/流程锚例外签发）
> **性质**：**活跃风险 containment**，非模块化路线图批次。Owner 已批"活漏洞修补作为钉死前流程锚的显式例外单独请示，不夹带路线图静默开工"。**本卡是设计描述，不含执行代码；落码另经报备→NWT 审→Owner 签发。**
> **触发**：Codex 复审 MF2 + 三方独立坐实（NWT/J2/J1，2026-07-23 03:53）+ tg-wallet.js:19-22 知险未治历史注释。

## 1. 漏洞（已坐实，file:line 在案）

- `ingest-auth.js:8-44`：`verifyIngestRequest`/`isValidIngestSecret` 只对唯一共享 `ingest_secret` 做 timingSafeEqual，**零身份/subject/scope**。
- `tg-wallet.js:93-134`：`POST /api/tg-wallet/:tg_user_id/send` 的 `tg_user_id` 取自 URL path，服务端**从不校验持 secret 的调用方与该 tg_user_id 的绑定关系**，直接取该行加密助记词派生私钥、按调用方给的收款人与金额发 `custodial_transfer`。
- `verifyIngestRequest` 被**至少 11 个不相关文件**共用（admin-dedup/admin/chain-data/chat/context/discovery/escrow/tg-wallet…）。
- **攻击面**：任何持共享 secret 的主体被攻陷/误用（或 secret 以任何方式泄露），即可对 `:tg_user_id` 填任意受害者 id 抽干其托管钱包——不需绕过 relay/covenant 层，直接命中 HTTP 入口。
- **知险未治**：`tg-wallet.js:19-22` 注释（2026-06-23，Bettor）已自述此风险，当时缓解（加共享 secret）只针对"网络暴露 HOST=0.0.0.0"旧威胁，对"secret 多进程共享+一环被攻陷"新威胁无覆盖。

## 2. Containment（最小活漏洞修补，不等模块化）

1. **subject 绑定**：`/api/tg-wallet/:tg_user_id/send` 服务端强制校验——已认证 caller/service 与 URL 中 `tg_user_id` 的允许绑定关系；拒绝任意 subject 替换。绑定来源需是服务端可验证的凭证，**不是调用方自声明的 header/body 字段**（否则重蹈"只信调用方声明"反模式）。
2. **负向测试**（回归，永久守）：合法服务凭证 + 他人 `tg_user_id` → 必须被拒（403/401），不得放行。
3. **范围**：本卡只修 subject 绑定这一横向越权面。**裸私钥过 IPC = 单独 key-custody design debt**（长期走 scoped signer/intent 接口，不在本 containment 内）。

## 3. 待定（设计阶段确认，不在本卡拍死）

- subject 绑定的凭证形态（per-service 凭证？per-tg-user token？）——与 M-1 caller identity 机制选型同源，但 containment 需要一个**不等 M0c 全量落地**的最小版本先堵住。取最小可行绑定，M0c 落地时并入统一机制。
- 11 个共用 secret 的其他端点是否各有类似 subject 缺口 = M-1 威胁模型清单顺带全扫（本卡先堵 custodial_transfer 这条真金路径）。

## 4. 流程与当前状态

设计（本卡）→ **NWT 卡审 ✅ GREEN-with-1-condition** → 凭证形态设计 → **NWT 二审凭证形态** → Owner 流程锚显式例外 + money-path 签发 → 落码 → NWT diff 审 → 装载。**在 Owner 签发例外前，本卡不落任何执行代码。**

- **NWT 卡审条件（2026-07-23，必守）**：具体凭证形态（per-service 凭证 / per-tg-user token / 其它）出来后**必须单独再过 NWT**，重点确认它自己不会引入"另一个共享 secret 换个名字"的新瓶装旧酒。
- **等级（Owner 2026-07-23"按你建议办"）**：按常规报备处理，**非火警**——生产 console 绑 127.0.0.1 未网暴，活跃面为内部横向（需持共享 secret 的 11 组件之一被攻陷）。凭证形态设计排白天做，与 M-1 caller identity 机制选型协同（取最小可行、可并入 M0c 统一机制的版本，避免重复造轮子 / 避免 NWT 警告的换名共享 secret）。
- **待**：凭证形态设计（拟派 J2/KANet-UI，白天）→ NWT 二审 → Owner money-path 签发 → 落码。

**关联**：`docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`（M-1 §4b/4c）、Codex RESPONSE-...-V041-REREVIEW MF2、频道坐实记录（NWT/J2/J1 2026-07-23 03:53）。
