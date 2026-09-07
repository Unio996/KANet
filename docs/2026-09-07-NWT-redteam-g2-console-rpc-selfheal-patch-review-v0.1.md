# NWT 红队审 · G-2 补丁（J2 `scratch/_j2_g2_console_rpc_selfheal_2026-09-07T07-43Z.patch` · 809 行 · sha 前缀 `d831d15b182981cc`）v0.1 · 2026-09-07T08:2xZ

**判定：GREEN-final（可 apply）· 0 MUST · 3 SHOULD（后续一笔）· 3 NOTE。** 非钱路非用户面 ⇒ Bettor GO；apply 与 6c-α 同一次重启（页 §0）。
**我亲手**：`git apply --check` 对 HEAD 7575b2d6 通过；隔离 worktree `scratch/_wt_nwtg2`（HEAD + junction node_modules）apply 后 9 文件；7 个 test 全绿——新 `kaspa-rpc-shared-rebuild` **23/0**、新 `rpc-health-datacheck` **22/0**、`kaspa-rpc-shared` ALL PASS、`ibd-tick-gate` 6/0、`preprune-capture-worker-ibd-gate` ALL PASS、`preprune-capture-worker` ALL PASS、`trade-protocol-filter.capture-gate` ALL PASS；`lint-kanet` 9 文件 0 errors。worktree 已删。

## 逐 hunk 核对（对照设计 v0.2 §4 / 我的 MUST-4 与 SHOULD）
- **H1 `kaspa-rpc-shared.mjs`** ✓：`noteSharedRpcHealthFailure({url,networkId})` **按 key 而非实例**——连 `getSharedRpc` 自己 connect 超时（拿不到实例）也能计数，这是 MUST-4 故障形状的正确触发点；`healthFail+errCount ≥ 3` 两路同台阶；`_rebuild` 非本机 `not-local`、限频 60 s、硬上限 `NODE_TRUST_REBUILD_MAX` LOUD 一次；`_rebuildMeta` 让 rebuilds/lastRebuildAt 跨 `_pool.delete`；新实例 errCount/healthFail 归零；`_ctors` 记注入 Ctor；`sharedRpcStats()` 仍数组 + `sharedRpcRebuildStats()`。canonical 行 `[rpc-shared] REBUILD <key> after <n> failures (source=rpc-health|business, reason=…) rebuilds=<k> total=<t>/<max>` ✓。
- **H2 `rpc-health.js`** ✓：顺序 网络过滤（`LOCAL_ONLY` / Resolver 按 `LOCAL_NETWORK`）→ tcpPing → `dataCheck`（`getServerInfo` 3 s：`networkId === LOCAL_NETWORK` 实串 ∧ `isSynced === true`）→ 才缓存；失败不缓存 + `REJECT` 60 s 限频；本机失败计 healthFail **一次**（内层 catch 只对非本机 `noteSharedRpcError`，外层对本机计——不双计 ✓）；not-synced 归零 healthFail（节点活着）✓；非本机 TTL 30 s、本机负缓存 10 s；`BACK-TO-LOCAL after <s>s`；全失败 warn/events 10 min 限频（events 表刚治过 LIKE 全扫）✓。
- **H3 `ibd-tick-gate.mjs`** ✓：`skip = !gate || gate.isSynced !== true`，读门抛错 ⇒ `reason=read-error: …` 跳；心跳 `heartbeat, streak=<n>, since=<iso>`；canonical 前缀不变。
- **H4 `preprune-capture-worker.mjs`** ✓：`_readNodeSynced` 只读 `env.KASPA_RPC_URL`（kanet.env:23 = ws://127.0.0.1:17210）、核 `networkId === KASPA_NETWORK`（kanet.env:24 = testnet-12）缺/不等 ⇒ `network-mismatch(<x>!=<y>)`；4 s 超时不变。
- **H5 测试** ✓：重启仿真（实例 #1 超时 ×3 ⇒ REBUILD source=rpc-health ⇒ 实例 #2 + BACK-TO-LOCAL）在 datacheck H4；不双计有用例钉。

## 🔴 行为差（J2 页 H2）裁定：**接受**，降为 SHOULD-1
`getWorkingRpc()` 在本机 `isSynced=false` 期返回 `{url:null}`。30 个调用方我抽 6 个：`chain-data.js:496` 503、`tg-wallet.js:39` null、`cross-chain-verify.mjs:523` "no RPC"、`trade-protocol-filter.js:1232` `no-rpc`、`faucet-utxo-health.mjs:46` throw、**`pool.js:1120-1124` 无 null 检查直接 `new RpcClient({url:null})`（既有缺陷，非 G-2 引入，见 NOTE-2）**。
**代价实测比 J2 估的还小**：D-c 稳态下 isSynced **不翻 false**——触发时 lag 503–528 s，头相位 ≈40–60 s 后进体相位，sink 以 2–4× 墙钟推进 ⇒ 峰值 lag ≈ 560–600 s < 661。我的 2 min 直读 watcher 自 06:57:33Z 起四个自触发周期**零 notsynced 样本**（07:01 / 07:31Z 心跳均 SYNCED，hdr−blk 162→0）。⇒ null 只出现在真正的追平窗（重启后、大落后），那里 fail-closed 是对的。
**SHOULD-1**：返回值加 `isSynced`（`{url, isLocal, isSynced}`），本机可达且网对但未同步时**仍返回本机 url + isSynced=false**，让纯展示类读（chain-data / tg-wallet 余额）自己决定用陈视图，钱路/门类调用方看 isSynced 拒——门与 worker 已直读本机不受影响。另出一笔带用例，不阻塞本次 apply。

## SHOULD-2 · 本机 not-synced 别用 `REJECT` 字样
`_logReject` 对本机未同步也打 `[rpc-health] REJECT ws://127.0.0.1:17210 … isSynced=false`——监控按 `REJECT` grep 会把"我们自己的节点在追平"当"错网候选被拒"。改为 `[rpc-health] local node not synced (networkId=… isSynced=false)`，`REJECT` 只留给错网/非本机。
## SHOULD-3 · `BACK-TO-LOCAL` 带原因
`_notLocalSince` 在本机 not-synced 时也置位 ⇒ 每次追平窗后都打 `BACK-TO-LOCAL`，稀释 runbook ⑤-①b 的撤销判据（要配对 `REBUILD` 行才有意义）。行尾加 `(was: rpc-fail|not-synced|network-mismatch)`。
## NOTE
- N1 `const ALL_FAILED_NOTE_MS`/`let _lastAllFailedAt` 与 `const _rebuildMeta` 声明在使用函数之后——运行时无 TDZ 问题（模块求值完才调用），但读者会以为是 bug；提前到文件头。
- N2 `api/pool.js:1120` 既有缺陷：`getWorkingRpc()` 为 null 时直接 `new RpcClient({url:null})`；G-2 前也会在"全不可达"时炸，G-2 后多一个触发面。交 pool.js 责任人另修（一行 null 检查）。
- N3 非 `LOCAL_ONLY` 模式下 `discoverNode` 对每个候选 `getSharedRpc` 建一个共享实例（wasm 构造器级 11–18 KB 永不回收）；TN12 生产 `KASPA_RPC_LOCAL_ONLY=1` 无此面；mainnet 场景给候选数上限（≤3）。

## 部署 / 验收（同页 §3/§4）
env `KASPA_RPC_LOCAL_ONLY=1`；回滚 = revert commit（语义已变，去 env 不够）。下次 kaspad 重启看：③ 门零 `resume … reason=rpc-fail`、`REBUILD … source=rpc-health` 后 ≤3 min `BACK-TO-LOCAL`、skip 心跳带 streak、恢复后 `using local node`。达标 ⇒ runbook ⑤-①b 撤。
