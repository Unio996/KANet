> **Status**: CURRENT

# T-LOOPBACK-AUTHZ 资金类路由热修 v0.1（分支 `coord/j2-authz-funds-hotfix`）

出处：NWT T-LOOPBACK-AUTHZ 分档（ledger 1300/1319）→ NWT 发现 `POST /api/chat/local` 零鉴权可伪造 owner
身份触发 `canTrade` → Bettor 顺藤查出 `POST /api/relay/:id/transfer` 本身零鉴权（ledger 1329）→ NWT v1.0
必入清单（0c5994c3）补齐 `bettor.js`/`pool.js` 四条同类路由 → Bettor 1330 追加 `/skills/upload`。
**本分支只开不合，不重启**——合入+重启涉钱路，等 Owner GO（同今晨 RCE 热修 c0ed69fa 的处置形状）。

## §1 覆盖的 7 条路由

| # | 路由 | 文件:行(热修前) | 风险 |
|---|---|---|---|
| 1 | `POST /api/relay/:id/transfer` | `relay.js:535` | 零鉴权直接真实转账（Bettor 1329 发现，NWT 清单#0） |
| 2 | `POST /api/chat/local` | `chat.js:336` | 伪造 `owner:`+relayId 满足 `mind.mjs:459 canTrade`，间接触发 agent 自主真实交易（NWT 首发） |
| 3 | `POST /api/prediction/publish-v2` | `bettor.js:1269`(热修前) | `maker_relay_id` 调用方指定，零鉴权可代任意 relay 发起转账锁资金（NWT v1.0 #1） |
| 4 | `POST /api/prediction/taker-stake/:offer_id` | `bettor.js:1569`(热修前) | `taker_relay_id` 同上（NWT v1.0 #2） |
| 5 | `POST /api/pool/market/:id/oracle/deposit` | `pool.js:2138`(热修前) | `oracle_relay_id` 调用方指定，真实转账锁 bond（NWT v1.0 #3） |
| 6 | `POST /api/pool/market/:id/bettor/register` | `pool.js:2200`(热修前) | **旧版真转账路由**（非只读安全版 `register-v07`，两者资金语义相反，未混淆）；`bettor_relay_id` 调用方指定（NWT v1.0 #4） |
| 7 | `POST /api/prediction/refund/:offer_id` | `bettor.js:1848`(热修前) | relay_id/收款方从 DB 读，只能被提前触发不能被重定向，风险低于 1-6，同档处理（NWT v1.0 #5 建议同批） |

## §2 处置

- **路由 1-7**：handler 首行挂 `checkAdminSecretTier(request, 'ADMIN_SECRET_FUNDS')`（新 tier，未设 = 503，
  主网默认关闭；已设但请求不带/带错 `x-kanet-admin-secret` header = 403）。与今晨 `ADMIN_SECRET_SYSTEM_ACTIONS`
  同一族用法，复用既有 `src/lib/admin-secret-tier.mjs`，零新增基础设施。
- **`POST /skills/upload`**（`skills.js:461`，Bettor 1330 追加）：任意 `fileContent` 写入
  `agent-mind/src/skills/`，registry `autoDiscover` 在 mind 进程启动时逐个 `import()` = RCE 级。
  **采纳 Bettor 倾向的选项 (b)**：主网直接下线该路由，恒 `404`，不看任何 env/header；旧实现整段删除
  （不留 `// removed` 注释，git 历史可查）。若未来确需在线上传，改挂
  `checkAdminSecretTier(request,'ADMIN_SECRET_SYSTEM_ACTIONS')`（与 `/api/system/run` 同档）而不是恢复零鉴权
  ——本文件头注已留这条路径供下次参考。

## §3 这次不做的（NWT §2 记录，避免误读为"已解决"）

`exchange.js` 的 `confirm`/`dispute`/`resolve` 与 `pool.js` 的 `oracle/vote` 身份判定只查 `relayNodeId→address`
映射、无私钥签名——本机知道 `relay_id` 就能冒充。**这次不做**，NWT 另立票，本分支不覆盖。

## §4 前端配合（这次也不做）

范围只做服务端。前端 sessionStorage 一次性解锁（操作员输入 → 存 sessionStorage → 后续请求自动带 header）
留给 v0.2 主闸设计（ledger 1314/1319 已定方向），本次热修合入后、前端跟上之前，这 7 条路由对所有调用方
（含合法前端）一律 503——这是设计好的过渡代价，不是 bug，等 Owner GO 合并时需同时排期前端改点或接受短暂
功能不可用（由 Bettor/Owner 决定合并时机）。

## §5 回归测试

`kasia-console/src/api/t-loopback-authz-funds-hotfix.test.mjs`（新文件），三态覆盖路由 1-6（`/api/prediction/refund`
并入同一批）+ `/skills/upload` 恒 404 独立断言：

1. `ADMIN_SECRET_FUNDS` 未设 → 全部 503。
2. 已设 + 不带/错 header → 全部 403。
3. 已设 + 带正确 header → 放行到原逻辑（用不存在的 relay/offer/market 触发早期 404/400，不真实执行转账/写状态）。

真 migration 隔离临时库 + 真 Fastify 实例 + `app.inject()`（同 `feedback.test.mjs` 既有 bootstrap 手法，无新造
测试框架）。`node src/api/t-loopback-authz-funds-hotfix.test.mjs` 本机实跑 **ALL PASS**（21 route-state 断言 + 2
skills 断言，全绿）。

`node scripts/lint-kanet.mjs <changed files>`：0 violation 出自本次改动（`bettor.js` 报的 6 条
`R-SQL-TIME-STRINGCMP` 经 `git diff` hunk 核实全部在 366/494/645/2214/2316 行，不在本次任何 diff hunk 内，属
既有债务，非本分支引入）。

## §6 合并前置条件（不由本分支自行决定，供 Owner/Bettor GO 时核对）

- NWT 审 GREEN。
- 决定合并窗口（本身不改变运行时行为直到 env 被设置，但 `/skills/upload` 硬 404 是**立即生效的行为变化**——
  合并当次重启后主网技能在线上传功能消失，改走离线 git 流程，需提前告知相关方）。
- 决定 `ADMIN_SECRET_FUNDS` 何时实际设置到 env（设置那一刻，路由 1-7 从"未设=503向后兼容"切到"已设=需
  header"，届时若前端尚未接入 sessionStorage 解锁，这些路由对所有人（含合法用户）都会变成 403，需要与 v0.2
  前端排期同步或临时接受功能中断）。
