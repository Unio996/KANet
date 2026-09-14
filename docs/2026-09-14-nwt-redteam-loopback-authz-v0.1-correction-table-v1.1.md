> **Status**: CURRENT

# NWT · T-LOOPBACK-AUTHZ v0.1"264条无鉴权"口径更正表 v1.1

> Bettor 裁：本表出来后替换 v0.1 的"264条无鉴权"口径，防止那个数字被外推。范围限定在
> `relay.js`/`admin.js`/`link.js`/`events.js`（资金/私钥相关文件）+ 补齐 v1.0 已发现的 escrow.js/
> tg-wallet.js/admin-dedup.js 三例，**不扩成264条全量审计**（原型主线优先，全量审计留后续班次）。

## 方法

对目标文件逐条数"总路由数 vs 有 `preHandler`/`verifyIngestRequest`/`checkAdminSecretTier`/其他已知专属
闸（如 `checkKeyExportWindow`）的路由数"，跟 v0.1 原文档的标注逐条比对。

## 一、四个目标文件路由总数 vs 已鉴权数对齐

| 文件 | 总路由数 | 已挂 preHandler/专属闸 | 未鉴权 | v0.1 标注是否准确 |
|---|---|---|---|---|
| `relay.js` | 44 | 3（`import-privkey` 挂 verifyIngestRequest；`/relays/:id/mnemonic`、`/api/relay/:id/wallets/:walletId/privkey` 挂 `checkKeyExportWindow` 专属闸——T-KEY-EXPORT 既有机制，早于本次分档，v0.1 §1.4 讨论文字已知悉但未列进表格，**不算误判，是合理排除**） | 41 | **准确**，本文件是 v0.1 Tier1 的核心，此次核实无变化——`/api/relay/:id/transfer`(535)/`wallets/:walletId/{withdraw,send,swap,bridge}`(999/1059/1208/1307)/`wallets/import`(837)/`send-command`(1827)/`/relays/:id/{delete,assign}`(188/193)/`restart`(209) 全部确认真无鉴权 |
| `admin.js` | 1 | 1 | 0 | 未在v0.1任何表格出现，本身就只有1条且已鉴权，无需更正 |
| `link.js` | 2 | 2 | 0 | 同上，2条全鉴权，v0.1未提及是合理排除 |
| `events.js` | 4 | 2（`trace/:traceId`、`since/:ts`） | 2（`/events` `/events/export.csv`，纯GET日志展示，非资金/密钥类） | 未在v0.1提及，2条未鉴权路由风险低（无状态变更，日志读取），建议归Tier3，非误判也非漏判，只是本来就不该在264条清单里 |

**结论：relay.js 是本次核实里唯一"v0.1标注与实测完全一致"的文件——它的高危险度标注是准的，之前的
escrow.js/tg-wallet.js/admin-dedup.js 误判问题不代表"264条"里全部资金类文件都被高估，两种情况并存，
必须逐文件看，不能整体上调或下调severity。**

## 二、逐条更正表（escrow.js / tg-wallet.js / admin-dedup.js，v1.0 已发现，本表汇总）

| 路由 | 原 v0.1 标注 | 实际鉴权状态 | 更正后严重度 |
|---|---|---|---|
| `POST /api/escrow/create`（escrow.js:59） | Tier2"待后续单独评估"（暗示无鉴权） | 已挂 `verifyIngestRequest`（`const AUTH`，preHandler数组模式） | **无需新增鉴权，已达标**。资金语义仍属敏感但访问控制已到位 |
| `POST /api/escrow/lock`（escrow.js:108） | 同上 | 同上 | 同上 |
| `POST /api/escrow/execute`（escrow.js:138） | 同上 | 同上 | 同上 |
| `POST /api/tg-wallet/:tg_user_id/send`（tg-wallet.js:152） | Tier1.1"最高优先级"（暗示零防护） | 已挂 `verifyIngestRequest`（2026-06-23）+ M0c-1 pilot 隔离双层（`isLegacySendAllowed`/`access_mode`/env allowlist） | **不是零防护，降低"最高优先级"标注**；但保留关注——代码自身注释承认这条legacy路径鉴权强度不如capability网关（`custodial_transfer`），且只查`access_mode`本身可被后续迁移遗漏，非"已彻底解决"，建议维持在案但不再算作264条无鉴权成员 |
| `POST /api/admin/dedup-refund`（admin-dedup.js:50） | v0.1完全未提及（整文件缺席） | 已挂 `verifyIngestRequest` | 补记：已鉴权，非264条成员 |
| `POST /api/admin/reclaim-bshard-maker-bond`（admin-dedup.js:97） | 同上 | 同上 | 同上 |
| `POST /api/admin/clear-repeat-offender`（admin-dedup.js:119） | 同上 | 同上 | 同上 |
| `GET /api/admin/z20-circuit-broken`（admin-dedup.js:134） | 同上 | 同上 | 同上 |
| `POST /api/admin/clear-z20-circuit`（admin-dedup.js:142） | 同上 | 同上 | 同上 |

## 三、热修切片 8 条 —— 逐条标"当前有无 verifyIngestRequest"（Bettor 回填请求①）

**全部 8 条当前均无任何 preHandler/AUTH（逐条 grep 路由声明行确认，无第二参数对象）——J2 落码是全新
挂闸，不存在"叠加第二道闸导致 tg-bot 类合法调用方被 503"的风险，可以放心统一处理，不需要为个别路由
做"已有闸→跳过"的特殊分支：**

| 路由 | 当前 verifyIngestRequest | 备注 |
|---|---|---|
| `POST /api/relay/:id/transfer`（relay.js:535） | 无 | — |
| `POST /api/chat/local`（chat.js:336） | 无 | 这条要修的是 §0.1 canTrade 判据本身，不是单纯补一道闸就够（补闸能挡外部调用，但 mind.mjs:459 的字符串前缀判据本身仍是设计缺陷，建议 J2 两处都改） |
| `POST /skills/upload`（skills.js:461） | 无 | Bettor 已裁倾向直接下线该路由（(b)方案），若走(b)则本行"加鉴权"选项作废 |
| `POST /api/prediction/publish-v2`（bettor.js:1269） | 无 | — |
| `POST /api/prediction/taker-stake/:offer_id`（bettor.js:1569） | 无 | — |
| `POST /api/prediction/refund/:offer_id`（bettor.js:1848） | 无 | 收款方/relay_id从DB读非请求体指定，鉴权仍建议加，但落码优先级可低于其余可被重定向的几条（v1.0 §1.3已注明） |
| `POST /api/pool/market/:id/oracle/deposit`（pool.js:2138） | 无 | — |
| `POST /api/pool/market/:id/bettor/register`（pool.js:2200，⚠非register-v07） | 无 | v1.0已提醒：跟同名v07版本资金语义相反，鉴权落码时确认改的是这条非v07路径 |

## 四、给 Bettor 的口径更正建议

**"264条无鉴权路由"这个数字不可靠，不建议继续引用**——已确认至少 9 条被误算进去（escrow.js 3 +
tg-wallet.js 1 + admin-dedup.js 5），且这只是本次核了 4 个"资金/私钥相关文件"的结果，v0.1 原始清单
覆盖的其余文件（`identities.js`/`discovery.js`/`conversations.js`等 Tier2/3 分组，共约 200+ 条）完全没有
做过这种"总数 vs 已鉴权数"的交叉核对，误差可能双向存在（也可能有文件被漏判成"已鉴权"实际没有）。
**建议口径改为**："v0.1 分档方法论对`preHandler`数组式鉴权存在扫描盲区，已确认的资金/私钥相关文件误差
≥9条；全量264条清单的准确性未经交叉验证，不建议作为待办总量对外引用或用于估算剩余工作量，具体某条
路由是否需要鉴权应以逐条读码结论（本表 + v1.0 + v0.1 原表未被本次推翻的部分）为准。" 全量264条的系统性
交叉核对是否要做、什么时候做，留给你按主线优先级排期，不在本次任务范围内展开。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017mABguTXfun4485ecgqWsd
