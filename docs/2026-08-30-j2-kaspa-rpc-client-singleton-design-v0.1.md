# J2 · console 侧 kaspa-wasm `RpcClient` 进程内单例 设计 v0.1（根治 per-call 构造泄漏）

> **Status**: DRAFT v0.1 · 给 NWT 审 · docs only，**不落码** · Bettor 派工 2026-08-30 · 根因出处 `docs/2026-08-30-j2-console-ibd-memory-growth-diagnosis.md` §9.2 + `docs/provenance/2026-08-30-console-wasm-growth/wasm_rpcclient_free.mjs`
> **轨迹（Bettor 定）**：GAP-1/2 + 周期重启 = interim → 小补丁 `coord/j2-capture-sidelock-ibd-gate`（叶子门）= 残余降到底噪 → **本稿单例 = 零周期重启**。

## 0. 一句话
kaspa-wasm 1.1.0 `new RpcClient()` **每实例永久占 wasm 线性内存 ~11–18 KB，`disconnect()`/`free()`/GC 都收不回**（隔离四臂实测；上游到 v2.0.1 `rpc/wrpc/wasm/src/client.rs` 无相关修复）。console 主进程 **23 处**"每调一次 `new RpcClient`"，其中 crons 每分钟级、recapture 每 tick 数百个 ⇒ wasm 只增不减、4 GiB 撞顶毒化。根治 = **进程内共享单例**（按 `{url, networkId}` 键，懒连、出错重建、永不 per-call 构造），与既有 `bshard-settle-daemon.mjs:74-83` `_rpc` 惯例对齐。每个站点迁移 = 把 `new RpcClient(...)+connect+disconnect` 三行换成 `const rpc = await getSharedRpc({ url, networkId })`，**不 disconnect**。

## 1. 实测依据（隔离进程，`docs/provenance/2026-08-30-console-wasm-growth/`）
| 实验 | 读数 | 结论 |
|---|---|---|
| `wasm_rpcclient_free.mjs` | 100 个 ×3 轮：no-free +1.75/+1.50/+1.50 MB；free() +1.50/+1.56/+1.56；只构造不 connect +1.25/+1.13；构造+free +1.00/+1.13 | 构造器级泄漏 ~11–18 KB/实例，任何释放路径无效 |
| `rpc_concurrency.mjs`（本稿新增） | 同一 client 50 路并发混合（getBlockDagInfo/getUtxos/getBlock）**ok=50 fail=0 7 ms**；20 路并发响应序 = 请求序 `0..19`；`disconnect()` 后调用 ⇒ `RPC Server (remote error) -> WebSocket -> WebSocket is not connected`；**同实例再 `connect({})` 后调用 ok，`isConnected=true`**；有 `rpc.isConnected` / `rpc.url` 属性 | 单例并发安全（wRPC 请求 id 复用，无需外部序列化）；断连可原实例重连，不必重建 |
| `wasm_connburst.mjs` | 100 次 connect+disconnect 141 ms | 本地 connect 1.4 ms，"为省连接而每调新建"没有性能理由 |
| A/B（诊断 v0.2 §9.1） | 门后台阶 = 602 个/tick × ~17 KB = +10 MB/14 min | 只要 per-call 构造还在，任何 gate 都只是搬运问题 |

## 2. 单例模块 `kasia-console/src/lib/kaspa-rpc-shared.mjs`（新建，≈80 行）
```js
// key = `${url}|${networkId}` ；value = { rpc, url, networkId, connecting: Promise|null, lastErrAt, errCount }
const _pool = new Map();
export async function getSharedRpc({ url, networkId }) {          // 懒建 + 懒连; 并发首调共享同一 connecting Promise
  const key = `${url}|${networkId}`; let e = _pool.get(key);
  if (!e) { const { RpcClient, Encoding } = await import('kaspa-wasm'); e = { rpc: new RpcClient({ url, encoding: Encoding.Borsh, networkId }), url, networkId, connecting: null, errCount: 0 }; _pool.set(key, e); log('[rpc-shared] build', key); }
  if (!e.rpc.isConnected) { e.connecting ||= withTimeout(e.rpc.connect({}), 5000, 'connect').finally(() => { e.connecting = null; }); await e.connecting; }
  return e.rpc;
}
export function noteSharedRpcError(rpc, err) { /* 分类见 §3; 只对 WebSocket-not-connected 类做 disconnect()→下次 getSharedRpc 重连(同实例, 不 new) */ }
export function sharedRpcStats() { return [..._pool.values()].map(e => ({ key, connected: e.rpc.isConnected, errCount: e.errCount })); }  // 供 heap-sample/健康面
```
- **永不 `new` 第二个**同 key 实例（这是整件事的全部）；**永不 per-call `disconnect()`**（disconnect 只在 §3 的重连分类里由模块自己做，且是同实例 `connect()` 回来）。
- URL 变化（`getWorkingRpc()` 5 min 缓存切到 configured/discovered 节点）⇒ 新 key ⇒ 新实例（正常，几小时/天一次；旧实例保留在 pool 里不再用——每次 URL 切换代价 ~17 KB，可接受；若要压到零，旧实例 `disconnect()` 留在 pool 即可，反正不能 free）。
- 网络键：本机全 `testnet-12`；`api/relay.js:365/656` 用 `relay.network || 'mainnet'`（按 relay 行），单例按 key 天然分开。
- 与 `bshard-settle-daemon.mjs:74-83` 对齐：它已是"模块级 `_rpc` + `rpcEnsure()` + 出错 `disconnect()`+置空"的形；迁移时 settle-daemon 改为调 `getSharedRpc`（删掉自己那份），**避免两套单例**。

## 3. 断连 / 出错谁重建（错误分类，来自实测串）
| 错误形 | 处置 | 谁做 |
|---|---|---|
| `WebSocket -> WebSocket is not connected` / connect timeout | `rpc.disconnect()`（幂等）后下次 `getSharedRpc` 同实例 `connect()`；`errCount++`，连续 ≥3 次 LOUD 一行（不重建实例——重建 = 再漏 17 KB 且无必要，实测同实例可重连） | 模块 `noteSharedRpcError` |
| 业务级 `RPC Server (remote error) -> cannot find header …` / not synced / 空集 | **不碰连接**（连接是好的），由调用方按自己语义处理（IBD 空值语义见 memory `ibd-period-chain-reads-return-empty`） | 调用方 |
| 单次调用超时（调用方自己的 `Promise.race`） | 不碰连接；超时不等于断连（8/05 教训：curl/超时 ≠ 死） | 调用方 |
| `RuntimeError: unreachable` / `memory access out of bounds` / `DataView` 越界（wasm 毒化） | **无法在进程内修**（ESM 实例唯一、无重建入口，memory `project-rpc-degradation-2026-08-05-state`）⇒ 模块打 `[rpc-shared] POISON` 一行 + 写 `events`，交 supervisor GAP-1 判死路 | 模块打点，supervisor 处置 |
- 🔴 不做 `retry` 循环（`connect({})` 自带 wRPC 重试策略；模块层再包一层重试 = 8/12 J2 "重试循环把所有失败当同一种"那坑）。

## 4. 站点迁移表（console 主进程 23 处；🔴 = 钱路调用方，须 Owner 批；🟢 = 非钱路，Bettor/NWT 审）
| # | 站点 | 触发/节拍 | 用途 | 现状 | 迁移动作 | 级 |
|---|---|---|---|---|---|---|
| 1 | `services/trade-protocol-filter.js:1189` captureSideLockDaa | recapture 每 NULL side 一次（一 tick 可 602） | 读 block header daa | 叶子门后 IBD 期 0，READY 后仍 per-side | `getSharedRpc`；去 `disconnect` ×3 处 | 🟢（只读；结果只写 side_lock_daa） |
| 2 | `services/trade-protocol-filter.js:788` | bet 注册（ingest） | UTXO 存在核验 | per-call | 同上 | 🔴（bet 是否入账的依据） |
| 3 | `lib/faucet-utxo-health.mjs:49` | 60 s cron | faucet UTXO/余额告警 | per-call + finally disconnect | 同上 | 🟢 |
| 4 | `services/rpc-health.js:69` checkLocal | getWorkingRpc 5 min 缓存到期 | 节点健康 | per-call，**超时路径漏 disconnect**（backlog ②） | 同上（顺带修漏） | 🟢 |
| 5 | `services/preprune-capture-worker.mjs:118` `_readNodeSynced` | 60 s cron + 叶子门 30 s 缓存 | isSynced 门 | per-call | 同上 | 🟢 |
| 6–7 | `services/oracle-pool-chain-scanner-cron.mjs:15/:40` | 5 min cron | oracle 质押链扫 | per-call | 同上 | 🟢 |
| 8–9 | `services/oracle-pool-renewal-cron.mjs:34/:125` | 1 h cron + 到账轮询 | 质押到账 NO-TX-NO-STATE 门 | per-call | 同上 | 🔴（质押结算门） |
| 10 | `services/bshard-settle-daemon.mjs:74` | 常驻单例 | 结算链读 | **已是单例**（自家 `_rpc`） | 改调共享模块，删自家副本 | 🔴（结算） |
| 11 | `services/cross-chain-verify.mjs:530` | exchange 验证（fallback 路） | KAS 到账核验 | per-call | 同上 | 🔴（交割门） |
| 12–15 | `api/pool.js:1124/1729/2461/2657` | HTTP（下注/领奖/退款核验） | UTXO 核验 | per-call | 同上 | 🔴 |
| 16–17 | `api/relay.js:365/656` | HTTP（余额） | `getBalancesByAddresses` | per-call，network 按 relay 行 | 同上（key 按 `relay.network`） | 🟢（只显示） |
| 18–20 | `api/oracle-pool.js:373/383/471` | HTTP（`rpc`+`rpc2` 双读交叉） | 质押登记 | per-call ×2 | 同上——**双读交叉的语义要保**：两次读走同一连接不改变"两次独立查询"（是两次 RPC，不是两条连接） | 🔴 |
| 21 | `api/escrow.js:157` | HTTP | 三方托管 | per-call | 同上 | 🔴 |
| 22 | `api/chain-data.js:501` | HTTP | 链数据 | per-call | 同上 | 🟢 |
| 23 | `api/tg-wallet.js:42` | HTTP（TG 余额） | 余额 | per-call | 同上 | 🟢（显示） |
- relay 子进程侧 `kasia-relay/src/lib/p2sh.mjs:194`（per-call）/ `relay.mjs:1106` / `rpc-listener.mjs:740`（常驻 `_rpc`）：**同病但另一进程、另一批**（relay 子各自 wasm 实例，泄漏被 35 个进程分摊，今日 23 min 合计 +39 MB = 0.1 GB/h/35 进程，不紧迫）；不进本稿范围。

## 5. 分批与验收
- **批 1（🟢 非钱路 crons，先落）**：#1 #3 #4 #5 #6 #7 #16 #17 #22 #23 + 模块本身。验收：(a) 每站点 regression（DI 注入 `getSharedRpc` 的 fake，断言**构造计数 = 0**、`disconnect` 不被调用）；(b) 隔离进程 `sharedRpcStats()` 1 个实例跑 1000 次混合调用 wasm +0.x MB（对照 per-call 版 +17 MB）；(c) live A/B：装载后 `[diag:heap-sample]` 底噪从 ~0.04 MB/min 降到 ≈0（除 URL 切换）。
- **批 2（🔴 钱路）**：#2 #8 #9 #10 #11 #12–15 #18–21，逐站点 diff + 原有 case 复跑 + Owner 批；行为差异只有"不再每次 disconnect"，读语义不变。
- 突变对照（每站点一条）：把 `getSharedRpc` 换回 `new RpcClient` ⇒ 构造计数断言红。

## 6. 风险与不做的
- **共享连接的故障域**：一条连接坏 ⇒ 所有站点同时报 not-connected ⇒ 由模块统一重连（同实例），比现在"每站点各自 new + 各自漏"更可观测；风险 = 重连期间并发调用全部失败一轮（≤5 s），调用方本就有各自超时/重试语义。
- **不做**：连接池/多实例轮转（没有并发瓶颈：50 路并发 7 ms）；per-call `free()`（实测无效）；等上游修（v2.0.1 未修，且换 kaspa-wasm 版本 = 全仓回归）。
- **wasm 毒化仍需换进程**：单例消灭的是"慢涨到顶"，不是"trap 毒化"；GAP-1 判死保留。

## 7. 待 NWT 判
1. 模块放 `lib/kaspa-rpc-shared.mjs` 还是并进 `services/rpc-health.js`（它已管 URL 选择）——我倾向独立文件、由 rpc-health 提供 URL。
2. #18–20 双读交叉（`rpc`/`rpc2` 两实例）是否要求"两条物理连接"——我读设计意图是"两次独立查询"，同连接两次 RPC 满足；若 NWT 判须两连接，则 #18–20 保留第二实例（常驻，非 per-call）。
3. settle-daemon 自家单例是否本批合并（🔴 结算路，Owner 批）——可留到批 2。
