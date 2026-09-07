# G-1 + G-2 · 钱路"节点可信"闸（console `sendCommandAsync` + relay submit 包装层）+ console RPC 本机自愈 · 设计 v0.1（不写码）

> **Status**: DRAFT-FOR-REVIEW · **v0.1.1**（2026-09-07T07:4xZ · Bettor 拍 S2：sink 时间戳落后 ≤ 900 s 为硬判据，IBD 状态只作观测字段；lint 规则改 R-REALCHAIN 同族）· J2 · 首稿 07:3xZ（`date -u`）· Bettor 派工 ledger 970/971/973/974（范围裁定）+ 986（开工）· 交 **NWT 红队** → Bettor → 🔴 **钱路改动 ⇒ Owner 批**后才落码。
> 输入：ledger 967–974（fail-open 审计 → jepu1 写者 → 门外钱路清单 → 反例勘误）、NWT `docs/2026-09-07-NWT-sendcommand-callers-table-v0.1.md`（§A/§B/§C + §D 勘误）、J2 `scratch/_j2_jepu1_write_audit_2026-09-06T23-56Z.md`、`scratch/_j2_sendcommand_table_4checks_2026-09-07T00-16Z.md`（v2）、D-c/D-d 落地实况（ledger 980–986）、memory `reference-kaspad-issynced-flips-true-inside-nearly-synced-window-before-last-ibd-rounds-end`。
> 本稿只裁"改什么、判据是什么、闸放哪、怎么验"；行号随 HEAD `a3a3a6da`（2026-09-07T07:2xZ）。

## 0. 一句话
今晚 22:55Z–03:47Z 的三种失败形状——**(i)** console ③ 门在 RPC 失败时 fail-open、且门读数被公网 **mainnet** 节点喂成"synced"；**(ii)** relay 侧多条**花钱** submit 路径对节点状态**零检查**（23:14:19Z 9 笔 split 在 IBD 头部相位递上去、三源无）；**(iii)** console 共享 RpcClient 在 kaspad 重启后**永不回本机**（两次实证，只有 console 重启能修）——用一把闸（G-1）和一组自愈（G-2）根治。G-1 = 判据三元组 `T(node) := networkId === KASPA_NETWORK ∧ isSynced === true ∧ S2`，两层闸位（console `sendCommandAsync` 按 type hold + 明确拒绝码；relay `submitTransaction` 包装层）；G-2 = rpc-health 不再回退 mainnet、discovered 节点核 networkId、共享客户端本机连不上 N 次后**重建实例**、③ 门 `rpc-fail` 视同未同步、worker RPC 超时核实。

## 1. 事实基线（全部有 grep 短语）
| # | 事实 | 出处 |
|---|---|---|
| F1 | ③ 门 `ibdGateSkip` 只在 `gate.isSynced === false` 时跳；读门抛错/unknown ⇒ **不跳**（`src/lib/ibd-tick-gate.mjs:24-28`：`try { gate = await read(); } catch { return false; }`、`const skip = !!gate && gate.isSynced === false`）。22:55:22Z 12 站点同刻 `resume: node synced (reason=rpc-fail: rpc-shared connect timeout 5000ms)` | ledger 967；`console.log.prev-20260906T234648Z` L23021–23416 |
| F2 | `rpc-health.js` 发现列表硬编码 **`new Resolver().getUrl(Encoding.Borsh, 'mainnet')`**（:118）；对 discovered 只 `tcpPing`（:125–148）不核 `networkId`；命中即写 `_cache`（:177–181，TTL 5 min）。22:5x 起 `[rpc-health] discovered node: wss://emma.kaspa.stream/kaspa/mainnet/wrpc/borsh` → `[rpc-shared] build wss://…/mainnet/…|testnet-12 (pool size 2)`…池涨到 6 | jepu1 页 §2；prev L23448–23480、26503–26511 |
| F3 | 门读数来源 = `preprune-capture-worker.mjs:_readNodeSynced` → `getWorkingRpc()` → `getSharedRpc({url, networkId})`；url 被 F2 换成 mainnet 端点后 `getServerInfo().isSynced` 为 mainnet 节点的 true ⇒ 门开（推断链：worker 22:56 后无 skip 行、门无翻转行；无逐次读数日志） | jepu1 页 §3 |
| F4 | 共享客户端（`src/lib/kaspa-rpc-shared.mjs`）出错分类只做**同实例 `disconnect()` → 下次同实例 `connect()`**（:47–62），**没有重建实例**；kaspad 22:55Z / 23:11Z 两次重启后本机 key 再没连回，`local node TCP ok but data check failed: rpc-shared connect timeout 5000ms` ×N；唯一修复 = console 重启（23:46:39Z、03:02:34Z、06:21:15Z 三次实证，重启后 `[rpc-shared] build ws://127.0.0.1:17210` + `[rpc-health] using local node`） | ledger 975+；runbook ⑤-①b |
| F5 | relay 侧节点状态检查**只有一处**：`kasia-relay/src/lib/transaction.mjs:150-151`（`_sendKaspaInner`：`if (!isSynced) throw new Error('RPC node is not synced')`），覆盖 `handshake/send_message/publish_card/send_broadcast/transfer/custodial_transfer`。**零检查**：`p2sh.mjs` 29 处 `await …submitTransaction(`（pool_settle_tx/各 refund/sweep/全部 bshard_*/closezk_v2_*）+ `utxo-split.mjs:125/:275` 两处 `pending.submit(rpc)`（split_utxo/consolidate_utxo） | 4 处核页 §3 v2；NWT §D |
| F6 | 反例 23:14:19Z（console tick 起 23:13:54Z）：9 笔 `split_utxo` 走 F5 零检查路径，kaspad 23:11:13Z 刚起、`IBD started` 23:11:35Z、头部相位 75%、`Processed 0 blocks`、sink 未动（落后 ≈20 min）；relay 记成功、9 txid 至今不在 `kaspa_tx_log`。**证的是覆盖面有洞**，不是判据不够 | ledger 974；4 处核页 §3 表 |
| F7 | 判据不够的独立证据：`isSynced = has_peers ∧ now < sink_ts + 661 s`（rule_engine.rs:125，非 IBD 态）；21:56:19Z / 22:28:22Z 门在体相位内就开；今晨 05:19:19Z isSynced=true 时第四轮 IBD 仍跑到 05:21:01Z | memory；ledger 983 |
| F8 | kaspa-wasm `PendingTransaction.submit(rpc)` = `wasm.pendingtransaction_submit(this.__wbg_ptr, rpc.__wbg_ptr)`（`node_modules/kaspa-wasm/kaspa.js:6842-6846`）——**wasm 内部直呼，不经 JS `RpcClient.submitTransaction`**（:8885）⇒ 对实例方法的 JS 包装拦不住 `pending.submit` | 本稿实核 |
| F9 | relay 的 RpcClient 单一创建点 `rpc-listener.mjs:740 _rpc = new RpcClient(rpcOpts)`，访问器 `getSharedRpcClient()/waitForRpc()`（:68–95）；30 s 健康 ping 失败即 `_scheduleReconnect`（:786–797） | 本稿实核 |
| F10 | `sendCommandAsync(relayNodeId, command, timeoutMs=30000, origin)`（`relay-manager.js:291`）：唯一 console→relay 命令入口；`origin ∈ {internal, app, operator, legacy-unmigrated, undefined(warn)}`；`api/relay.js:1774` 直通任意 `body.type`（无白名单）；变量传入点 10 处 | NWT §D；4 处核页 §2 |
| F11 | ③ 门 15 站点（`ibdGateSkip('…')`）：`pool.tick` `settle.tick`(×2) `zk.closeTickV2` `zk.claimAutonomousTick` `zk.handoffAutonomousTick` `zk.judgeProposeAutonomousTick` `zk-prove-worker.tick` `bshard-close-voter.tick/.v2Tick/.submitV2Tick` `prediction-settler.tick` `prediction-voter.tick` `refund-claim-auto.tick` `oracle-pool-scanner.tick` `oracle-renewal.tick`；另 `preprune-capture-worker` 自判、`captureSideLockDaa` 叶子门 | 本稿 grep |
| F12 | 门外真广播 4 族（Bettor 970 纳入同一把闸）：A1 `lib/broadcaster-utxo.mjs:59 split_utxo` · A2 `lib/mining-utxo-consolidate.mjs:91 consolidate_utxo` · A3/A8′ broker-intake / authority 经 `broker-action-queue` `sendKas→transfer` · A6 market-seeder（KAS 侧只 `send_broadcast`，钱在 EVM）；"第二批待核"= 5–9 族 + bettor-scavenger/valve/protector | ledger 970；NWT §D |

## 2. G-1 · 判据三元组 `T(node)`
### 2.1 定义
```
T(node) := networkId(node) === KASPA_NETWORK        // 排除 F2/F3 那类"别的网的 synced"
        ∧ isSynced(node) === true                    // 节点自报（661 s 判据）
        ∧ S2(node)                                   // 第二量：见 2.2
读不到任一项（RPC 失败/超时/字段缺）⇒ T = false（fail-closed，reason='rpc-fail'/'unreadable'）
```
`networkId` 取 `getServerInfo().networkId`（kaspa-wasm 有该字段，`_readNodeSynced` 今天只读 `isSynced`）。

### 2.2 第二量 S2：三候选逐一对反例
Bettor 973 三候选：(a) sink 头时间戳落后 ≤ L；(b) "非 IBD 中"；(c) virtualDaaScore 最近 N s 推进量 ≥ 下界。**先说 RPC 能给什么**：kaspa-wasm RPC **没有** `is_ibd_running`（memory `reference-kaspad-addpeer-ban-unban-need-unsaferpc…`：RPC 无 is_ibd_running）；`getBlockDagInfo` 给 `sink/virtualDaaScore/blockCount/headerCount/pruningPointHash`；`getBlock(sink).header.timestamp` 给 sink 时间戳。

| 反例 / 场景 | (a) L=120 s | (b) 非 IBD 中 | (c) DAA 推进量下界 | 备注 |
|---|---|---|---|---|
| R1 23:14:19Z 9 笔（头部相位、sink 落后 ≈20 min、blocks 0、headers +1–2k/10 s） | **挡**（1200 s ≫ 120） | **挡**（`IBD started` 23:11:35Z 无 completed） | **挡**（virtual 不动） | 三者都挡；但它同时 isSynced=false ⇒ 二元组已挡（F6：它证的是覆盖面） |
| R2 21:56:19Z / 22:28:22Z（isSynced=true，IBD 体相位最后几轮仍在跑） | 视 lag：<661 但多半 >120 ⇒ **多半挡**（无直读，需回填） | **挡**（started 无 completed） | 体相位 200–400 块/10 s vs 同步态 ≈100/10 s ⇒ 下界设"≤ 2× 网络率"可挡，**判别度只有 2×** | (b) 最干净 |
| R3 05:19:19Z isSynced=true，第四轮 IBD 跑到 05:21:01Z（尾巴 100 s） | lag 575 s > 120 ⇒ 挡 | 挡 | 该轮 4103 块/232 s ≈ 530/30 s，边缘 | (b) 干净；(a) 挡但理由是 lag 不是 IBD |
| R4 中继爬行（D-c 480 触发前，0.75 bps，sink 落后 0→500 s 线性涨） | **L=120 ⇒ 每 12.5 min 周期只有 ≈2 min 可用（≈16% 占空比）**——比现状差 | 放行（IBD 空闲） | 爬行 ≈7 DAA/10 s vs 同步 ≈100 ⇒ **挡**（若下界 ≥50） | 🔴 这是 (a) 与 D-c 的冲突点：D-c 设计 Q1 选 480 是为了让 isSynced 跨触发保持 true；(a) 取 120 会把钱路占空比压到 16% |
| R5 同步态正常跟随（10 bps，lag < 30 s） | 放行 | 放行 | 放行 | — |

**裁定（Bettor 2026-09-07T07:4xZ，v0.1.1）**：
- **S2 = 本机 sink 块头时间戳落后 ≤ 900 s**（= D-c 阈 480 + 轮长上界 ≈240 + 余量），`NODE_TRUST_MAX_SINK_LAG_S` 默认 **900**。读法：`getBlockDagInfo().sink` → `getBlock(sink).header.timestamp`，与本机墙钟差；读不到 ⇒ false。
- **(b) "IBD 中"不作硬判据**（Bettor 理由：D-c 让小轮 IBD 每 ≈9 min 一次、每次 ≈4 min，IBD 中即 hold 会把钱路占空比压到 ≈55%；D-c 轮内链视图最多陈 ≈510 s，不是 23:14Z 那种 20 min 头相位的形）。IBD 状态**只作日志观测字段** `ibdQuiet`（可从 kaspad canonical 行读，读不到就记 `?`，不影响判定）。
- **(c) 不作判据、不记**：判别度 2×、与同步率纠缠。
- 🔵 **如实标注**：节点自身 `isSynced` 已含 "sink_ts + 661 s"（F7），900 > 661 ⇒ **isSynced=true 时 S2 永不单独绑定**；S2 的作用是"同一量由我们自己算 + 余量"的双保险（防上游判据改动/`has_peers` 分支），**不是新的拦截面**。本闸真正新增的拦截面 = `networkId` 核（F2/F3）、覆盖面补全（F5/F6）、fail-closed（F1）。表 2.2 的 R2/R3（体相位尾巴、lag < 661）在此裁定下**放行**——接受的风险 = 链视图 ≤ 661 s 陈；R1（20 min 头相位）由 isSynced=false + 覆盖面挡。
- R4 那行**保留为反例记录**：(a) 取 120 s 会与 D-c 480 冲突把占空比压到 ≈16%——若 Owner 要更紧，必须连 D-c 阈一起议（§7 Q2）。
- 三元组 + S2 全部**每 5 s 缓存**（同 `isNodeSyncedCached` 形，TTL 可配），一个 tick 内不重复读。

### 2.3 拒绝码与日志（逐字，供 grep）
- console：`sendCommandAsync` hold ⇒ `Promise.reject(Object.assign(new Error('NODE_UNTRUSTED'), { code: 'NODE_UNTRUSTED', reason, gate }))`，`reason ∈ {network-mismatch, not-synced, sink-lag, rpc-fail, unreadable}`（`ibdQuiet` 只是字段，不是 reason）；日志 **`[node-trust] HOLD type=<type> origin=<origin> relay=<id8> reason=<reason> networkId=<x> isSynced=<b> ibdQuiet=<b> sinkLag=<s>`**；放行不打（影子模式打 `[node-trust] WOULD-HOLD …` 同字段）。
- relay：`assertNodeTrusted` 抛 `Error('NODE_UNTRUSTED: <reason>')`，relay 日志 **`node-trust HOLD submit reason=<reason> …`**，经 IPC 回 `{ok:false, error:'NODE_UNTRUSTED: …', code:'NODE_UNTRUSTED'}`；B 类 API 拿到 5xx 时**带这个 code**（NWT §C.3 要的"明确拒绝码而非静默超时"）。
- 计数：`[node-trust] stats holds=<n> byReason={…} byType={…} duty=<放行比>`，每 10 min 一行 + `sharedRpcStats()` 旁的 `nodeTrustStats()` 供 /api 读。

## 3. G-1 · 闸位两层
### 3.1 第一层：console `sendCommandAsync`（`relay-manager.js:291`，唯一入口）
- **按 type 分档**（单源 = `kasia-relay/src/lib/commands.mjs` `COMMAND_TYPES`，console 侧不复制字符串，`import` 同一文件——`broker-intake-watcher.js:122` 已这样 import）：
  - **CHAIN_WRITE（hold）**：`transfer custodial_transfer split_utxo consolidate_utxo sweep_per_bet stake_unlock_tx prediction_settle_tx prediction_settle_consensual_tx prediction_refund_tx pool_settle_tx pool_refund_disagreement_tx pool_refund_maker_unjoined_tx pool_side_refund_cancelled_tx bshard_* closezk_v2_* create_escrow lock_escrow execute_escrow` + **手续费级也 hold**：`send_broadcast send_message publish_card handshake`（都是链上 tx；未同步节点收了照样三源无）。
  - **PASS**：`get_* check_utxo_landed chain_get_* ecdsa_sign sign_input_for_settle get_arm_status get_rpc_state get_per_bet_address pool_v07_compute_refund_mass *_build_preimage`（只读/签/算）。
  - 未列入的新 type ⇒ **默认 hold**（fail-closed）+ 一次性 warn（同 `_originWarnedTypes` 形）。
- 判据读数来自 **console 自己对本机节点的读**（2.1，经 G-2 修好的共享客户端 + `KASPA_RPC_URL` 本机）——不信 relay 转述。
- `origin` 不豁免（operator 专道也 hold；要"强推"由 Owner 另开 `NODE_TRUST_OPERATOR_FORCE`，v0.1 不做）。
- ③ 站点闸保留作第 0 层（省 tick 成本），但 **`reason=rpc-fail`/unknown 改为 skip**（`ibd-tick-gate.mjs:27-28`：`catch { return true }`、`skip = !gate || gate.isSynced !== true`），并且门读数加 `networkId` 核（F3 根治：mainnet 节点的 true 不再算）。
- 模式开关：`NODE_TRUST_GATE=off|shadow|enforce`（代码默认 `off`——库/测试零行为差；`kanet.env` 先 `shadow` 一天再 `enforce`，同 6c-β dry-run 惯例）。

### 3.2 第二层：relay `submitTransaction` 包装层
- 新 `kasia-relay/src/lib/node-trust.mjs`：`assertNodeTrusted(rpc, {cacheMs=5000})` 读 `getServerInfo()`（networkId/isSynced）+ sink lag（`getBlockDagInfo` + `getBlock(sink)`，≤ 900 s）；`ibdQuiet` 观测字段可选（日志尾），同 2.1/2.2 规则；relay 侧同样 `NODE_TRUST_GATE` 三态。
- **挂载点 A（一处，盖 p2sh 29 处）**：`rpc-listener.mjs:_connect` 建好 `_rpc` 后**实例级**包装：`const orig = _rpc.submitTransaction.bind(_rpc); _rpc.submitTransaction = async (req) => { await assertNodeTrusted(_rpc); return orig(req); }`——p2sh.mjs 全部 `rpc.submitTransaction(`（JS 调用）经此；`_scheduleReconnect` 重建实例时同样包（同一函数 `armSubmitGate(_rpc)`）。
- **挂载点 B（3 行替换，F8 所迫）**：`pending.submit(rpc)` 是 wasm 内部直呼，包装拦不住 ⇒ `transaction.mjs:226`、`utxo-split.mjs:125/:275` 三处改为 `await submitPending(pending, rpc)`（helper：`await assertNodeTrusted(rpc); return pending.submit(rpc)`）。**不是逐点改判据，是逐点改调用形**；lint 规则 **`R-REALCHAIN-SUBMIT-VIA-GATE`**（与 `R-REALCHAIN-SKIP-BATCH` 同族，`scripts/lint-kanet.mjs`）：`kasia-relay/src/**` 内禁止裸 `pending.submit(`/`.submit(rpc)` 与直接 `rpc.submitTransaction(`（白名单只有 `node-trust.mjs` 与 `rpc-listener.mjs` 的包装点），只准经 helper（防第 4 处回来）。
- `transaction.mjs:150-151` 原检查**保留**（双保险，同一 reason 文案对齐为 `NODE_UNTRUSTED: not-synced`）。
- relay 侧 `ibdQuiet` 观测字段读日志文件：路径由 `KASPAD_LOG` env 传（console 起 relay 子进程时透传），缺省/读不到 ⇒ 字段记 `?`，**不影响判定**（判定只用三元组）。

## 4. G-2 · console RPC 本机自愈
| # | 改什么 | 在哪 | 为什么（事实） |
|---|---|---|---|
| G2-1 | Resolver 发现按 `KASPA_NETWORK` 传参：`getUrl(Encoding.Borsh, LOCAL_NETWORK)`；**且** TN12 生产加 `KASPA_RPC_LOCAL_ONLY=1` ⇒ 跳过 discovery，直接 `no RPC node available`（fail-closed） | `rpc-health.js:118`、`getWorkingRpc()` 第 3 步 | F2/F3：mainnet 节点的 isSynced=true 喂门 |
| G2-2 | discovered/configured 节点做**数据核**：`getServerInfo().networkId === LOCAL_NETWORK` 且 `isSynced===true` 才缓存；否则不缓存 + `[rpc-health] REJECT <url> networkId=<x> expected=<y>` | `rpc-health.js:125-148, 177-181` | 同上；今天只 `tcpPing` |
| G2-3 | 共享客户端**重建实例**：`noteSharedRpcError` 对本机 key（url 以 `127.0.0.1`/`localhost` 起）连续 `errCount ≥ 3` 且距上次重建 ≥ 60 s ⇒ `_pool.delete(key)`（旧实例 `disconnect()` 后弃置，接受 ~11–18 KB wasm 线性内存一次性代价，60 s 限频 ⇒ 每小时 ≤ 60 次上界 ≈ 1 MB）+ `[rpc-shared] REBUILD <key> after <n> not-connected` | `kaspa-rpc-shared.mjs:47-62` | F4：同实例 reconnect 在节点重启后两次实证永不成功，唯一修复是进程重启 |
| G2-4 | `getWorkingRpc()` 的 5 min 缓存对**本机**失败不缓存公网结果（有 G2-1 后无公网可缓存；仍写死：`isLocal=false` 结果 TTL 降到 30 s） | `rpc-health.js` `_cache` | 本机回来后 5 min 内继续用错节点 |
| G2-5 | ③ 门 `rpc-fail`/unknown ⇒ skip（见 3.1）；门读数补 `networkId` | `ibd-tick-gate.mjs:27-28`、`preprune-capture-worker.mjs:_readNodeSynced` | F1/F3 |
| G2-6 | worker `_readNodeSynced` RPC 超时：**已有**（`GATE_RPC_TIMEOUT_MS=4000` 包 `connect`/`getServerInfo`，:131–148），G2 只补 networkId 读取与 `reason` 细分；`captureSideLockDaa` 叶子门同源不改 | 同上 | Bettor 970 ⑤ 项核实为已存在 |
| G2-7 | 自愈可观测：`[rpc-health] using local node` 每次从非本机切回本机打一行 `[rpc-health] BACK-TO-LOCAL after <s>s`；`sharedRpcStats()` 加 `rebuilds` 计数 | 两文件 | 让"回本机"有 grep 短语，runbook ⑤-①b 不再靠重启 |

G-2 落地后 runbook ⑤-①b（每次 kaspad 重启紧跟 console 重启）应可撤——**撤销条件**：一次 kaspad 重启后 ≤ 3 min 内出现 `BACK-TO-LOCAL` 且 ③ 门无 `rpc-fail` 放行行（验收 §6）。

## 5. 不做 / 边界
- 不改 kaspad（无 RPC `is_ibd_running` 字段；D-e 不立）；不改 kaspa-wasm。
- 不动 `TERMINAL_STATUSES`、不动 settle 状态机（jepu1 小时重试无终点是另案，页 §4）。
- B 类 API 不加门（NWT §C.3）：它们经 3.1 拿到 `NODE_UNTRUSTED` 明确码即可。
- "第二批待核"（5–9 族 + scavenger/valve/protector）不在本稿；它们若经 `sendCommandAsync` 自动被 3.1 覆盖，若直连 relay RPC 则被 3.2 覆盖——本稿 §7 列出需核的例外：**任何不经这两层的链上写路径**。

## 6. 验收（影子 → 生效）
1. **单测（离线）**：type 分档纯函数（全 COMMAND_TYPES 枚举，未列入 ⇒ hold）；`T(node)` 判定纯函数（输入 networkId/isSynced/sinkLag/rpc-fail，表 2.2 R1–R5 作 fixture：R1 hold(not-synced)、R2/R3 pass、R4 pass、R5 pass、networkId=mainnet hold、lag 901 hold、任一读不到 hold）；`ibdQuiet` 解析器单测（今晚日志片段 `2026-09-07 10:03:20…` 等，含"孤 started"与"文件不存在" ⇒ `?`）；`kaspa-rpc-shared` 重建（假 Ctor 计构造次数：3 次 not-connected 后第 4 次 `getSharedRpc` 新建实例，60 s 内不重建）；`rpc-health` 对 mainnet networkId 的 discovered 节点 REJECT；relay `armSubmitGate` 对假 RpcClient 的 `submitTransaction` 与 `submitPending` 各挡一次并透传一次。
2. **影子窗（`NODE_TRUST_GATE=shadow`，≥ 24 h，含 ≥ 2 次 kaspad 重启/自触发周期）**：统计 `WOULD-HOLD` 按 reason/type 的计数与占空比；预期：`ibd-running` 只在 `IBD started…completed` 区间内出现；`network-mismatch` = 0（G2-1 后）；`rpc-fail` 出现即对照 G2-3 的 `REBUILD` 行是否在 ≤ 3 min 内跟上。任何 WOULD-HOLD 落在 R5（正常同步态）⇒ 判据误伤，回 NWT。
3. **生效（Owner 批）**：`enforce`；一次计划内 kaspad 重启做对照：期望 (i) ③ 门零 `rpc-fail` 放行行、(ii) console `BACK-TO-LOCAL` ≤ 3 min、(iii) 重启窗内 `[node-trust] HOLD` 计数 > 0 且 `kaspa_tx_log` 无窗内新 txid（= 没有 23:14:19Z 形状）、(iv) 恢复后 HOLD 归零、门外 cron（A1 再平衡）首次 tick 成功。
4. **回滚字符串**：`NODE_TRUST_GATE=off` 一行 env 即回；relay 侧包装无状态。

## 7. 待核 / 交 NWT 的开放点
- (Q1) `ibdQuiet` 观测字段读 `D:\kaspa-tn12-data\kaspad-stdout.log` 的权限与轮转时机（非阻塞：读不到记 `?`）——NWT 顺手核一次即可。
- (Q2) **S2 随 D-c 阈值联动（常设规则）**：`S2 上界 = D-c 阈 + 轮长上界 + 120 s`（今 480 + 240 + 120 = 840 ⇒ 取整 900）；以后 D-c 阈调，S2 随动，两者在同一 env 段落里相邻声明并互引注释。Owner 若要比 661 更紧（R4 的 120 s 形），必须连 D-c 阈一起议。
- (Q3) 手续费级 `send_*`/`handshake` 是否 hold：本稿 hold（链上 tx 同样会丢）；若 Bettor 认为协议消息延迟代价更高，可降为 PASS + 只记数。
- (Q4) "第二批待核"里是否有**不经 `sendCommandAsync` 也不经 relay `_rpc`** 的链上写（例：console 直连公网 RPC 的旧路径）——若有，本闸盖不到，须列入。
- (Q5) G2-3 重建的 wasm 内存代价上界与 4 GiB 顶（memory `reference-console-wasm-linear-memory-4gib-cap…`）：60 s 限频下每天 ≤ 1440 次 × 18 KB ≈ 26 MB 上界，可接受但要在 `sharedRpcStats` 里可见。
