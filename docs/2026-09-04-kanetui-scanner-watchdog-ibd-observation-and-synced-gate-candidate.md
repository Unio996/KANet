# 观测页：scanner watchdog 在 IBD 期每 ~2m15s 杀一次正在干活的 kaspa-scout · synced 门候选（M-scout）

> **Status**: CURRENT（OBSERVATION + CANDIDATE · 只读观测 · 未落码 · 未提交 · v2 采纳 NWT 审三处 · 极性按 mitigation-design v0.3.1）

- 提出：KANet-UI · 2026-09-04 · Bettor `kanet-tn12-1c [4a17db]` 派工 · 审：NWT（v1 已审，v2 待复核）
- 数据窗：`logs/console.log`（console 25156，13:33:07Z 起）读到 14:20Z；D 行 lag=63h
- 不改、不停任何东西。建议部分是候选，实现稿等 Bettor 派。
- v2 改动：§4 对齐检验改为窄窗+置换检验（v1 的"数据不支持"撤回，v1 检验功效不足）；§5 反转（v1 "每代死在实时订阅之前"被 lastLog 与 NWT 实读反证）；§6 真路由；§7 极性改 `isSynced === false` 才跳。

## 1. 判据在哪（源码坐标）

| 项 | 坐标 | 内容 |
|---|---|---|
| watchdog 主体 | `kasia-console/src/services/scanner.js:270-292` `startScannerWatchdog()` | 每 45s tick：读 `scout_checkpoint._global_.last_block_time`，`staleMs = Date.now() − last_block_time`；`>120s` 且距上次重起 ≥120s ⇒ `stopScanner()` + `startScanner()` |
| 常量 | `scanner.js:44-45` | `WATCHDOG_INTERVAL_MS=45000`、`SCAN_STALL_MS=120000` |
| 日志形 | `scanner.js:286` | `[scanner:watchdog] scout_checkpoint stale <s>s (child=alive=false-alive/stall) — forcing restart` |
| checkpoint 写者 | `kaspa-scout/src/message-indexer.mjs:129-136, :170-187`（每 30s flush，值 = 扫到的**块时间**）；`kaspa-scout/src/history-fetcher.mjs:77`（history fetch 完成后写**墙钟**） | console 端 `kasia-console/src/api/discovery.js:566-590` |
| status 路由 | `kasia-console/src/api/discovery.js:211` `GET /api/discovery/scanner/status` → `{scanner:{running,mode,startedAt,pid,lastLog,…}}`（`scanner.js:236-247`） | ⚠ `/api/scanner/status` 是 404，v1 引错 |
| e12e8ac4 门（参照形） | `preprune-capture-worker.mjs:108-131` `_readNodeSynced()`（共享 rpc，`isSynced===true` 才 synced；三态返回）；`:138` `isNodeSyncedCached({ttlMs:30_000})`；`:154` skip 日志 | 已被 `trade-protocol-filter.js:1195` 复用 |

## 2. 观测 A：重起节律

- `[scanner] started scout` 13:33:24Z（首启）后到 14:20:33Z 共 **21 次**，间隔 **2m05s–2m30s**（= 120s 去抖 + 45s 巡检粒度 ⇒ 理论 135–180s）。通报里的"5–8 分钟"是抽样间隔。
- 每次 `stale` ≈ 228022s → 226828s，即 **≈63h = 节点 lag**，36 分钟缓降 ~1194s。

## 3. 观测 B：为什么 IBD 期结构性恒 stale（NWT 实读补强）

- NWT 14:18:37Z 经 `GET /api/discovery/checkpoint?key=_global_` 实读：`last_block_time=2026-09-01T23:32:26Z`（62.8h 前 = D 行 lag）、`updated_at` 距读取 2s。⇒ 写者活着、每 ~30s 写、值是 IBD 回放中的**块时间**。
- 判据拿块时间减**墙钟**；IBD body 相位节点回放 63h 前的块 ⇒ 差值恒 ≈ lag，与 scout 活不活无关。
- ⇒ 判据把**"节点落后"**读成**"scout 假活"**，属结构性误判（与 e12e8ac4 治的 preprune-capture-worker 同族）。

## 4. 观测 C：重起与 console eventloop-lag 的对齐（v2：窄窗 + 置换检验）

v1 用窗 [−10s,+90s] 判"无富集"——该窗覆盖 75% 时间，15 个事件下**检验功效不足，只能说"检验不出"**（NWT 审 ②，采纳）。v2 改按机制取窄窗，并以 1000 次随机循环平移重起时刻的置换分布为零假设（脚本：读 console.log，重起时刻 = `started scout` 前最近 ISO 时戳；lag 事件 = `eventloop-lag` ≥3s；窗 13:39:47Z（轮询全停）→14:20:19Z，18 次重起、54 个事件）：

| 窗（相对 started） | 观测事件 / lag 秒 | 零分布中位 事件 / lag 秒 | p(事件) | p(lag 秒) | 读法 |
|---|---|---|---|---|---|
| [0,+20s] 启动脉冲 | 8 / 42.4 | 8 / 48.0 | 0.56 | 0.60 | **启动本身不带可测停顿** |
| [−5,0] 杀前/stop-start 序 | 7 / 37.5 | 2 / 10.1 | **0.006** | 0.051 | 显著：重起紧跟在停顿之后 |
| [−8,+3] | 8 / 45.4 | 4 / 25.5 | 0.077 | 0.15 | 边缘 |
| [+20,+60] | 15 / 124 | 16 / 96.6 | 0.63 | 0.13 | 无 |
| [+55,+70] | 10 / 98.4 | 6 / 32.5 | 0.064 | **0.002** | 显著（按 lag 量）：起后 ~60s 有一簇 |
| [−10,+90]（v1 窗） | 34 / 223 | 39 / 241 | 0.96 | 0.74 | 宽窗看不出（功效不足） |

**[−5,0] 的顺序核**（逐次看 lag 行在 `warn / stopped / started` 三行中的位置）：21 次重起里 11 次附近有 ≥3s lag，**全部落在 `[scanner:watchdog] … forcing restart` 之前**（唯一例外 13:37:11 的 15s 落在 warn 与 stopped 之间 = stopScanner 等子进程退出那 3s 内）。⇒ 顺序是 **停顿结束 → lag 诊断行 → 到期的 watchdog tick 执行 → 重起**：定时器补发序（NWT 认）。这解释 [−5,0] 的富集是**选择效应**（tick 只能在事件循环空出来时跑），**不是重起造成停顿**；也不能反过来说重起无害——它只说明启动脉冲 [0,+20s] 本身检验不出。

**[+55,+70s] 簇——候选（NWT 提·有机制·未证）**：13:40:48（11.1s）、13:43:08（4.2s）、13:45:32（13.8s）、13:50:05（41.6s）等；已剔除每分钟 :19–:20 的 settleDaemonTick。scout 侧没有 60s 定时器，但**启动序有一个"连上就跑"的首轮**：`index.mjs:83-89` rpc-scanner → chain-fundamentals → **balance-tracker**，`balance-tracker.mjs:68` `await _trackCycle()` 首轮立即执行，`:192` `GET /api/discovery/activity?limit=200`；console 侧 `discovery.js:60-90` 这个 handler（`:60` 注释 no auth）在主线程**同步**跑三段 SQL：`chain_events` 两路 `UNION ALL` + `GROUP BY addr ORDER BY total`（`:65-80`）、`event_type='handshake' ORDER BY observed_at` 全量 `.all()` **无 LIMIT**（`:83-85`）、一组 `COUNT` 子查询（`:88-`）。时间线：起后 10–39s 写 `:77` → rpc-scanner → chain-fundamentals → balance-tracker 首轮 ≈ +45–60s → console 同步聚合 ⇒ 落 [+55,+70]。（坐标我已逐条复核。）
判别（未做、等 Bettor 定范围）：(a) 在 **cp 出的**备份副本上对这三条 SQL `EXPLAIN` + 计时（不碰原备份；`EXPLAIN≠成本`，须实计时）；(b) 更直接：M10 `[diag:step]` 家族加 `http.discovery.activity`（handler 内包三条 SQL 的 ms），NWT 提进 M10 范围。
另：该端点属**无鉴权重查询端点**（指针，细节走窄通道，不进本页）。

## 5. 观测 D：每代 scout 实际做了什么（v2 反转）

v1 推断"history-fetch 135s 内拉不完 ⇒ 每代死在实时订阅之前"——**不成立**，两条活数据反证：
- NWT 14:18:37Z：checkpoint `updated_at` 2s 前、值是块时间；同刻 CIM 见 console 只有 1 个 scout 子进程（38228，14:18:52Z 起）无孤儿 ⇒ 那次写是**上一代**被杀前 ~15s 写的块时间 ⇒ 上一代已过 history-fetch、进了 `startRpcScanner`。
- 我 14:20:05Z `GET /api/discovery/scanner/status`：`running=true mode=rpc pid=38228 startedAt=14:18:52.772Z`，`lastLog="14:19:06.644Z [rpc-scout] report: ok=0 fail=0 | dedup-set: 0"` ⇒ **起后 14s 已在实时订阅循环**；14:21:06Z 再读 `lastLog="14:20:33.989Z [rpc-scout] LARGE TX: …"`（同代仍在索引 IBD 块）。

⇒ 成立的画面：**每代跑通启动序 → 索引 IBD 回放块 → 每 30s 写 63h 前的块时间 → 45s 后被 watchdog 当假活杀掉 → 下一代**。即 "每 2m15s 杀一次正在干活的 scout"。IBD 期这些块本就是历史块，杀了重来的直接损失是每代重做启动序（console 侧 2 次 config 写 + 若干读 + spawn；scout 侧 `local-addresses` / `checkpoint` / 已知地址加载 / history-fetch / 订阅重建），以及每代对外部 API 的一轮外呼（见 scratch 三层页，细节不进公开 git）。

## 6. 仪器缺口

- scout stdout/stderr 只被 `scanner.js:135-143` 收成 `_lastLog`（最后一行），**不写进 console.log**，也无自己的日志文件。
- `_lastLog` 只经 `GET /api/discovery/scanner/status` 可读（Bettor 放行：每分钟 ≤1 次，只读盯守已武装）。
- checkpoint 是否每代起后有一瞬 ≈now（`history-fetcher.mjs:77`）再被第一块覆盖回 63h：45s 采样看不到。**Bettor 批的一次性 2s×180s 端点轮询（14:21:54Z→14:24:54Z，`scratch/_checkpoint_poll_2026-09-04T14-21Z.log`，零失败）坐实了 NWT 的画面**，`last_block_time` 只在这些时刻变：
  - 14:21:46.948Z **= 墙钟**（`updated_at` 14:21:46.951Z；该代 pid 30200 起 14:21:07.86Z ⇒ **起后 39s** 跑完 history-fetch 写 `:77`）
  - 14:22:08 → `2026-09-01T23:33:49Z`（块时间，**≈20s 后被覆盖回 63h**）→ 14:22:38 → 14:23:08（每 30s = message-indexer `CHECKPOINT_FLUSH_INTERVAL_MS`）
  - 14:23:32.644Z **= 墙钟**（下一代 pid 36116 起 14:23:22.88Z ⇒ **起后 10s**；两代 history-fetch 用时 10s 与 39s，不恒定）→ 14:23:53 → `2026-09-01T23:35:00Z`（回 63h）
  ⇒ 每代都有约 20s 的 "≈now 窗"；watchdog 45s tick 若恰落在窗内会放过一次（解释间隔在 2m05s–2m30s 间抖动），落在窗外即判 stale 杀。两种时间语义共用一个字段的后果在这里直接可见。

## 7. 建议：IBD 期该有 synced 门 —— **该有**，形同 e12e8ac4，只放在 watchdog；极性按 v0.3.1

**改动面（候选，未落码，实现稿等 Bettor 派）**：`scanner.js:startScannerWatchdog` tick 内、读 checkpoint 之前：

```js
// IBD 门(同 e12e8ac4 形 · 极性同 M2, mitigation-design v0.3.1): 门是为"已确认 IBD"切出的例外;
// 只在本 tick 拿到新鲜的 isSynced===false 才跳; null/超时/rpc 失败/unknown ⇒ 回既有行为(按 stale 照判)
const { isNodeSyncedCached } = await import('./preprune-capture-worker.mjs');
const gate = await isNodeSyncedCached();            // 三态, TTL 30s < 45s 巡检, 共享 rpc, 不复制判定
if (gate.isSynced === false) {
  if (Date.now() - _gateSkipLoggedAt > 60_000) {     // 60s 节流一行
    console.log(`[scanner:watchdog] skip: node not synced (isSynced=false, ${gate.reason})`);
    _gateSkipLoggedAt = Date.now();
  }
  return;
}
```

- **极性（v1 错、v2 改）**：v1 写 `gate.synced !== true ⇒ 不重起`，把 rpc 失败折成"不重起"。NWT/Bettor 指出：console 共享 RpcClient 中毒而节点正常时（08-30 wasm 4GiB 那型），scout 可能真假活，watchdog 却永久失效 = 门自己打开它要治的 false-alive 缺口（活性反向）。**v0.3.1 裁定：只 `isSynced === false` 才抑制；确认不到 ⇒ 现行为。** 与 M2 是同一条规则（M2 既有行为=扫，watchdog 既有行为=按 stale 判死）。
- **只门 watchdog**：不动 `startScanner`/scout/判据本身；进程死亡仍由 `on('exit')` respawn（`scanner.js:145-150`）兜，门不影响那条。
- **复用不复制**：`isNodeSyncedCached` 第三处 import。
- **负向量三条（Bettor 定）**：注入 `isSynced:false` ⇒ `stopScanner`/`startScanner` 未被调用、60s 内只打一行；突变去门 ⇒ 红；注入 rpc 失败（`isSynced:null`）⇒ 照判（重起发生）。参照 `trade-protocol-filter.capture-gate.test.mjs` 注入方式。
- 后续候选（另议、本次不做）：判据改为相对节点 tip 的陈旧度，不依赖墙钟；scout 历史补全走本地 RPC（见 scratch 三层页）。

## 8. 未核清单

- [+55,+70s] 那簇 lag 的来源。
- 每代起后 checkpoint 是否有一瞬 ≈now（2s 轮询结果待附）。
- `isLocalNode()` 实现与每次重起的 RPC 成本（`scanner.js:79`）。
- N（本地地址数）。
