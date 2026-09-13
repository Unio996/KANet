# (a) LOCAL_ONLY strict · patch 说明 v0.1（J2 · 2026-09-13 · NWT diff 审 GREEN 23cf7bc3 · 侧分支 coord/j2-a-local-only-strict）

> **Status**: CURRENT（2026-09-13T11:0xZ · 落地窗 = 波 0 主网 console 首次起来那次，不 apply 进 TN12 共享 live 检出）· NWT `docs/2026-09-13-nwt-redteam-j2-a-local-only-patch-diff-review-v0.1.md` GREEN（亲跑 H0–H13 42 断言）· patch sha256 `efc4ae29da264859a4e654e6b34c7aa637ec5c11735da7f9a4d1ce2dc99769b0` · 基线 594049ae → 侧分支基于 5f1b908e 一笔 commit。

- **patch**: `scratch/_j2_a_local_only_strict_2026-09-13T10-49Z.patch` · sha256 `efc4ae29da264859a4e654e6b34c7aa637ec5c11735da7f9a4d1ce2dc99769b0` · 562 行 · **基线 `594049ae`**（origin/bshard-m3-deploy 当时 HEAD）· 17 文件 +256/−37
- **产出方式**: 隔离 worktree `scratch/_j2_wt_a_patch`（detached @594049ae，`node_modules` junction 到主 checkout，实测 better-sqlite3/kaspa-wasm 可加载）；**live 树未动、src 未落**。apply: `git apply --check <patch>` 于 HEAD ⊇ 594049ae。
- **设计**: `docs/2026-09-13-j2-local-only-strict-rpc-design-v0.1.md` v0.2（NWT 7149e3a5 PASS）；本 patch 同时把该稿 §7 的"待判"改成"裁定记录"（Bettor 要求）。
- **落地窗**: 波 0 主网 console 首次起来那次；strict 以主网 env 为准（`KASPA_NETWORK=mainnet` + `KASPA_RPC_URL=ws://127.0.0.1:17110` + `KASPA_RPC_LOCAL_ONLY=1`）。TN12 值只出现在测试夹具。

## 契约 → 改动映射

| 契约/改动 | 文件 | 内容 |
|---|---|---|
| C1 S1/S2/S3 | `kasia-console/src/services/rpc-health.js` | `getWorkingRpc()` 本机未命中后 strict 早退 `{url:null}`，不调 `checkConfigured()`/`discoverNode()`；canonical 行 `discovery disabled (KASPA_RPC_LOCAL_ONLY=1)…` 逐字保留（打点移到早退处）+ 新行 `strict local-only (KASPA_RPC_LOCAL_ONLY=1): configured fallback skipped`（各一次）；"全部失败" warn/events 抽成 `_noteAllFailed(strict)`：`event_type` 不变、canonical 短语 `no RPC node available` 不变、strict 下 summary 改为"configured/discovery 未尝试" |
| S5 | 同上 | 新导出 `isStrictLocalOnly()`、`resolveChildRpcUrl(caller)`（strict ⇒ 恒 env，DB 值被忽略且每 caller 打一次 `strict local-only: DB rpc_url ignored for <caller>`；non-strict ⇒ 原顺序 DB‖env） |
| C13 | 同上 | 新导出 `requireRpcUrl(url, site)`：空 ⇒ false + `[<site>] skip: no rpc url (…; next note in 10 min)`（每站 10 min 限频）|
| C2 S4 | `kasia-console/src/api/settings.js` | `POST /settings/node` strict 且 `mode≠local` ⇒ 409 `strict-local-only`；`mode=local` 写 env 值（原硬编码 `ws://127.0.0.1:17110`）；`/api/config/rpc-status` 的 local 判定改比 env |
| C3 S4 | `kasia-console/src/services/system-repair.js` | `diagnose()` 端口取自 env；`switch_to_local` 写 env 值；`switch_to_discovered`/`discover_node` strict ⇒ `{ok:false}` |
| C4 S5 | `kasia-console/src/services/relay-manager.js:69` | 改 `resolveChildRpcUrl('relay-manager')`；strict 且空 ⇒ `{ok:false, reason:'no_rpc_url_strict'}`（不把 `''` 递给子进程） |
| C5 S5 | `kasia-console/src/services/scanner.js:98` | 同上（`'scanner'`） |
| C6 S5 | `kasia-console/src/api/escrow.js:153` | 同上（`'escrow.refund-precheck'`） |
| C13 ×5 | `oracle-pool.js:371/469` · `pool.js:1120` · `oracle-pool-renewal-cron.mjs:125` · `oracle-pool-chain-scanner-cron.mjs:32` | `getWorkingRpc()` 之后、`new RpcClient`/`getSharedRpc` 之前 `requireRpcUrl(...)`：HTTP 路径 503 `no working Kaspa RPC node — retry shortly`（与 `pool.js:1727` 既有文案逐字同）；cron 路径 `return { skipped: true, reason: 'no-rpc' }` |
| C7/C8 S6 | `shared/lib/rpc-utils.mjs` + `kasia-relay/src/rpc-listener.mjs` | 新导出 `isStrictLocalOnly()` / `assertStrictRpcEnv()`；`resolveRpcUrl()` strict ⇒ 只回 env（空 ⇒ throw，不拉 console 配置）；rpc-listener **模块顶层** `_assertStrictRpcEnv()`（Q2 顶层 throw）+ `_connect()` strict 下拒进 Resolver 分支 |
| C7 | `kasia-relay/src/lib/transaction.mjs` | `resolveRpcUrl()` strict ⇒ 只回 env / 空 throw（它只被动态 import，不能当顶层） |
| C9 | `kasia-relay/src/relay.mjs:1106` | 删硬编码 `‖ 'ws://127.0.0.1:17210'`，env 必填（同时是 §G 类 E 的 TN12 绑定） |
| C10 | `kasia-relay/src/lib/utxo-split.mjs` | strict 下不认 `RPC_URL` 别名 |
| C12 | `kasia-console/src/services/rpc-health-datacheck.test.mjs` | H7–H13（下表） |
| **C11（不在 patch 里）** | `kanet.env:304` | `kanet.env` 未被 git 跟踪，patch 带不了。**推入时请 Bettor 手工把 :304 注释换成**：`# 2026-09-13 strict 语义 (设计 v0.2): =1 ⇒ 唯一可信 RPC = KASPA_RPC_URL; 本机不可用 ⇒ getWorkingRpc() null(不试 DB rpc_url、不 Resolver); relay/scout/escrow 同信任域; 写入口拒写非本机; 回滚 = 改 0。主网: KASPA_RPC_URL=ws://127.0.0.1:17110 + KASPA_NETWORK=mainnet + 本行 1` |

## 验证（全部本机自跑，隔离 worktree，2026-09-13T10:4xZ）

`cd kasia-console && node src/services/rpc-health-datacheck.test.mjs` ⇒ **✅✅ ALL PASS**（H0–H6 既有 22 断言全绿不变 + 新增 H7–H13 20 断言）：

| 用例 | 对应 | 断言要点 |
|---|---|---|
| H7 | 设计 N1 / **NWT A-N2** | strict·本机未同步·DB `rpc_url`=第二个本机 listener（假 Ctor 对它会回 synced）⇒ `null`；**配置端点实例数 0**（`st.ctor` 不增 = 没走到，不是走了被拒）；无 `using configured node`；strict 行逐字恰一次；canonical `discovery disabled` 行仍恰一次（N7） |
| H8 | 设计 N2 / **NWT A-N3 口径** | DB `rpc_url`=`ws://192.168.1.2:17210` ⇒ `null`、`isLocal=false`、耗时 0 ms（没去 tcpPing 私网） |
| H9 | 设计 N3 | DB `rpc_url` 恰等于 env·本机健康 ⇒ 本机，`getServerInfo` 只 1 次 |
| H10 | 设计 N4 | `applyFix('switch_to_discovered'/'discover_node')` ⇒ `ok:false` 且 DB 不变；`switch_to_local` 写 env 值 |
| H11 | 设计 N5 / S5 | `resolveChildRpcUrl` strict ⇒ 恒 env；`DB rpc_url ignored for test-caller` 逐字、同 caller 只一次 |
| H12 | 设计 C13 | `requireRpcUrl(null)` ⇒ false + 一行、同站二次不打；有值 ⇒ true 无行 |
| H13 | 设计 N6+N8 / **NWT A-N5** | **子进程**（模块级常量只在 import 读）`KASPA_RPC_LOCAL_ONLY=0` + 与 H7 完全相同设置 ⇒ 返回配置端点 + `using configured node` 行 + 无 strict 行（= 老行为原样；也是弱注入臂：只翻开关结果翻转） |

其它：`node scripts/lint-kanet.mjs <17 文件>` ⇒ **0 errors**（warning 为仓内既有）；`node --check` 15 个改动 JS 全过；relay 侧 `shared/lib/rpc-utils.mjs` 三态探针：strict+空 env ⇒ `assertStrictRpcEnv()`/`resolveRpcUrl()` 都 throw；strict+env ⇒ 回 env 不 fetch console；non-strict+空 env ⇒ 回 null（老行为）。

## 没覆盖 / 请 NWT 重点看

- **N4 的 HTTP 形**（`POST /settings/node` 409）没起 fastify 测，只测了同语义的 `applyFix`；路由代码 5 行，请 diff 审。
- **relay-manager 的 `no_rpc_url_strict` 拒起分支 = strict 下不可达的防御性代码**（NWT ④-2 订正措辞，非"未覆盖"）：strict 时 `resolveChildRpcUrl` 返回模块顶层常量 `LOCAL_RPC`，而 `rpc-health.js:19` 在 import 时已对它 fail-fast，不可能为空；该分支只防未来有人改掉顶层 fail-fast。N5 测的是它调用的 `resolveChildRpcUrl`（H11）。
- `settings.js`/`system-repair.js` 的 `‖ 'ws://127.0.0.1:17110'` 右侧 = **不可达防御分支**（NWT ④ 同理：`rpc-health.js:19` 顶层 fail-fast 在前），留着只为孤立 import 不炸。
- **A-N4**（瞬时 tcp 抖动不引入假死）：`checkLocal()`/负缓存一字未改，由 H4 既有用例覆盖，未单独加。
- `kasia-relay` 侧没有现成测试骨架；C7–C10 只有 `node --check` + 上面三态探针。
- 不动 non-strict：H13 对照臂证明。
