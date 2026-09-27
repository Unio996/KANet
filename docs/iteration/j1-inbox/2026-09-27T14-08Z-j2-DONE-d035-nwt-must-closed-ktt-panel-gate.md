# J2 → Bettor · DONE：D-035 NWT MUST 闭合(tokens.js 路由闸)

**分支**: `coord/j2-ktt-wallet-panel-20260927`，commit `5bd5df41`(接在 `7c4b702f`/`03c63c3c` 之后)，
已推 origin。

## 对照你的五点逐条

**①开关**：`KTT_PANEL_ENABLED`，默认关(未设或非 `'1'`)。关时 `/api/ktt/mint`、`/api/ktt/transfer`
返回 403；`GET /api/ktt/holdings`(只读)不受限——单测验证过开关未设/`='0'` 两种关态都拒，holdings
在两种关态下都仍 200。

**②relay_id 收紧**：`tokens.js` 不再从 `request.body.relay_id` 读。改为服务端读
`process.env.KTT_PANEL_RELAY_ID`(单一专用 relay)，未配置直接 403，不 fallback 到 `relay_nodes`
表任意一行。单测验证：body 里显式塞 `relay_id: 'attacker-chosen-relay'` 依然被忽略、仍走服务端固定值。

**③限流**：双窗口(分钟+日)，`KTT_PANEL_RATE_LIMIT_PER_MIN`/`KTT_PANEL_RATE_LIMIT_PER_DAY`(env 可调，
默认 10/分、200/日)。新表 `ktt_panel_rate_limit_log`(`migrate.js` v219，纯新增，已跑通 v196→v219
全链临时库迁移测试)，`action`(`'mint'`/`'transfer'`独立计数，互不占额度) + `requested_at`，
count+insert 单事务原子化(同 `capability.js` `_rateLimitTxn` 精神，杜绝并发竞态)+ 自清理(每次检查
顺带删超过 10 倍日窗口的旧行)+ fail-closed(DB 异常算拒绝)。超限返回 429，且超限请求本身不计入
额度(不会"用被拒的请求把自己解锁")。

**④relay 侧纵深防御**：`p2sh.mjs` 新增 `_assertKttPanelRelayAuthorized(fnName)`，`unlockKttV2Mint`/
`unlockKttV2Transfer` 入口第一行调用。校验 `process.env.KTT_PANEL_ENABLED==='1'` 且
`process.env.RELAY_NODE_ID===process.env.KTT_PANEL_RELAY_ID`，两者任一不满足即抛错拒绝。机制：
`relay-manager.js` fork relay 子进程时 `env` 以 `{...process.env, RELAY_NODE_ID: relayNodeId, ...}`
展开，console 进程自己若设了 `KTT_PANEL_ENABLED`/`KTT_PANEL_RELAY_ID`，每个被它 fork 出来的 relay
子进程自动继承同一份 env——不需要额外接线；子进程读自己的 `RELAY_NODE_ID` 跟 `KTT_PANEL_RELAY_ID`
比对即可判断"我是不是那个被指定的专用 relay"。这一层独立于 console 侧的 tokens.js 闸——万一将来
有别的调用方绕过 tokens.js 直接对 relay 发 `ktt_v2_mint`/`ktt_v2_transfer` 命令，relay 自己也能拒。

**⑤单测**：
- `kasia-console/src/api/tokens-ktt-panel-gate.test.mjs`(真 Fastify + `app.inject` + 真 migration
  临时库，同 `proto-oracle-create-route.test.mjs` 既有先例)：**10/10 通过**，覆盖 §①开关关(两种关态)
  /holdings 不受限、§②relay_id 未配 + body 塞 relay_id 试图绕过、§③限流触发(连续第 3/4 次 429)+
  mint/transfer 独立计数不互占。
- `kasia-relay/src/lib/p2sh-ktt-panel-gate.test.mjs`(纯同步单测，不碰网络/RPC/私钥)：**6/6 通过**，
  覆盖 relay 侧纵深防御的全部分支(开关关/relay_id 未配/本 relay 身份未设/relay 不符/全部满足放行)。
- 回归：v1 既有 `ktt-transfer-witness.test.mjs` **仍 6/6 绿**，确认这次改动零影响老代码。

## content_digest 更新

最终版 `tokens.js` sha256 = `f3b61f33b484a683234ed1c45e65a96ff22c84da22bb9c929910f5cf8b67f4f1`，
`scripts/m0a-exception-manifest.json`(`MRC-ktt-v2-panel-tokens`)与 `scripts/m0a-lib.mjs`
(`CONTROLLED_FUNNEL_ALLOWLIST` 注释)两处都改了。**独立核对**：`git show :kasia-console/src/api/tokens.js`
取暂存区 blob 内容跑同一段 sha256Hex 算法，与 manifest 里的值逐字节一致(不是从 manifest 抄回去)。
`node scripts/lint-kanet.mjs` 对 8 个改动文件跑 **0 errors**(M0a 门连同其余规则全过，541 条 warning
全部是仓库既有、与本次改动无关的项，不是本次改动引入的)。

## UI 侧同步

`tokens-list.eta`：mint/transfer 表单移除了客户端 `relay_id` 输入框(服务端固定值，前端传了也会被
忽略)；"查阅"卡片里给 `verify=1` 的回链核实单独留了一个 `verifyRelayId` 字段(这条是只读 RPC 查询，
不受 `KTT_PANEL_ENABLED` 限制，跟 mint/transfer 完全独立)。

## 现状

八个文件改动(`tokens.js`/`migrate.js`/`tokens-list.eta`/`p2sh.mjs`/两个新测试文件/manifest/
m0a-lib.mjs)全部同一个 commit `5bd5df41`，已推。等 NWT 复核回填 `review_ref`，零 MUST 即可合并。
停在这里等结果。
