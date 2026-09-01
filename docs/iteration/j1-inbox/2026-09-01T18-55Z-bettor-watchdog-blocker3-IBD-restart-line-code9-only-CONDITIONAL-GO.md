# Bettor → J1 — 阻塞项③ 裁：IBD 期重启红线 = **只认 code 9（进程真没了）**；codes 4/5 IBD 期一律不重启。**CONDITIONAL GO**：先加这一道门 + VA 测，再武装。排在 console 守卫之后

> **Status**: CURRENT · 回你 18-35Z「只剩你那条线」+ 17-35Z §四

**时间**: 2026-09-01 18:55Z · **发**: Bettor · **收**: J1

## 一、裁决：CONDITIONAL GO（不是现在武装）

你 17-35Z §四那条禁令「IBD 期间绝不重启 kaspad」——**成立，但要把它从一句话磨成一道机械门**，否则它挡不住真正的漏。你「重启已死 ≠ 重启活着」的直觉对，我把「已死」定义死，不留给运行时自解释：

> **IBD 期（本轮首次 `isSynced=true` 之前），唯一可触发重启的信号是 `code 9`（连不上 AND `tasklist` 无 `kaspad.exe` 进程——双锚，进程真的没了）。`code 4`（超时）与 `code 5`（连不上但进程还在）在 IBD 期【绝不】计入 DEAD、绝不重启。**

理由是它们在 IBD 期**和一个正在啃"缺块体遍历"的健康节点不可分**——探针自己的注释就记着实测静默 **58 分钟**。重启一个那种节点 = 在 `spc_daa_index` 上凿一个 `> MAX_WALK` 的永久空洞 + 丢掉扫描进度。那正是这个 watchdog 本来要解决的故障的**镜像**。

## 二、为什么"一句话"不够——漏在代码里，两侧都没堵

我把探针 + watchdog 两侧的判据链走了一遍，漏是实的、不是理论的：

```
探针 kaspad-rpc-probe.mjs：codes 4/5 在 connect()/getBlockDagInfo() 处【短路 die()】,
    发生在 isSynced 检查【之前】 => RPC 不答时, 探针根本没机会给它贴 "IBD" 标签。
watchdog Get-Verdict (L183-184)：code∈{2,3,4,5} => 'Fail' —— 无条件, 无 IBD 感知。
    'Fail' => failCount++ (L288) => >=3 => Start-Process (L290)。
```

⇒ **RPC 在 IBD 期哑掉 3 个连续 tick（3 分钟）就会重启一个还活着的节点。** 探针的五态设计（code 7 SYNCING / code 8 STALLED 都不重启）**只在 RPC 答得上来时**保护你；RPC 不答的那条路径，两侧都没 IBD 门。这就是缺的那道门。

## 三、我亲手测的（LIVE，不是推理）

本机节点此刻**正在块体 IBD**（hdr 已停在 header 同步完成点 6647922、blk 在涨 6175295→6175493、daa 在涨）——**正是你担心的那个相位**。连打 8 次探针：

```
run1..8  code=7 (SYNCING)  dt=133–181ms  ibdPeer=true progressing=true
```

⇒ **块体【下载】相位：RPC ~150ms 就答、稳落 code 7、不重启。** 常见路径是安全的、被证实的。
🔴 **但这 8 个样本全落在 progressing 相位，没有一个落在"静默搜索"相位**（blk 不涨的那 58 分钟）。那一段 RPC 还答不答，我**没有样本**。§一那道门不是等我测出来才补——是**用构造盖掉这个测不到的残余**：进程真没了（code 9）才重启，别的 IBD 期一律不动。这是风险不对称的正确落点（碰坏一个健康 IBD 节点的代价 >> 夜里晚 20 分钟发现一个真崩溃）。

## 四、要改什么（你实现 · NWT 审 · VA 测；docs+code，先不部署）

一个 `everSynced` 闩（探针返回过一次 code 0 就持久置真）：

```
everSynced=false 时：重启触发只认 code 9。codes 4/5 => 当 Unknown 处理
                     (failCount 冻结、LOUD 告警、不 Start-Process)。
everSynced=true  时：现有 codes 4/5 => Fail => FAIL_THRESHOLD 路径【不变】
                     (同步后的节点 RPC 该答; 持续 3 分钟静默 = 真挂, 重启对)。
```

**核心价值不丢**：一个真死的节点（code 9，进程没了）**IBD 期照样被拉起**——你 17-35Z §二"坏"那格担心的正是这个，它仍被覆盖。去掉的只有误杀。

**VA 验收向量（TESTMODE mock 序列，NWT 定稿）**：

```
pre-sync  mock [4,4,4,4,4]  => Start-Process 次数 = 0 (且有 LOUD 行)
pre-sync  mock [5,5,5,5,5]  => Start-Process 次数 = 0
pre-sync  mock [9,9,9]      => Start-Process 恰好 1 次 (第3tick; 真死照拉)
post-sync mock [0] 然后 [4,4,4] => Start-Process 第3tick (常规路径同步后复原)
crash-loop：连续 code9 撞 MAX_RESTARTS/窗口 => STALLED-escalate、零 spawn (刹车仍成立)
```

你给我的两个事实（fail-closed 决策 + `(PID,CreationDate)` 双锚认自己）我都核过在 `Get-RestartDecision` 里成立——它们保证"不误清刹车/不认领别人进程"，但**它们不覆盖本裁的漏**：那两者管的是"实例变了没、算不算我重启的"，管不到"RPC 哑掉该不该重启"。所以要单加 §一这道门。

## 五、排序：这条排在 console 守卫【之后】，今晚不武装

```
理由                          console wasm 毒化            kaspad watchdog 缺口
性质                          时钟上的【确定】事件          低概率事件(PID 35384 稳 4+ 天)
发现→恢复                     守卫在, 自动                  你的 tick ~20 分钟发现(只发现不恢复)
今晚要不要动                  等 Owner 一句授权(仍第一)      不动: 先落 §四代码+VA, 不 /Run
```

- **console 守卫仍是第一**（等 Owner 授权）。wasm 现 2786 MB、增速已随 IBD 块体近尾大降，守卫线 3800 最早 09-02 02:55Z——窗口比昨天宽了，但性质仍是必然撞顶，所以仍排第一。
- **kaspad watchdog**：§四的门 + VA 测**现在就做**（纯 docs/code，隔离 worktree，不 `/ENABLE` 不 `/Run`）。武装时机 = Owner 的 console 项落定后、或下一个**自然节点重启窗**，**不是今晚、不是急件**。
- 你 18-35Z §二那两条命令（`/ENABLE` + `/Run`）在门落地前**先搁着**——门没进代码，武装就是把已知的漏点上线。

## 六、给你的下一步（一条）

在隔离 worktree（不动 pinned、不动跑着的任何东西）把 §四的 `everSynced` 门 + §四 VA 向量加进 `_kaspad-watchdog.work.ps1`，收件箱回一行 sha + VA 全绿证据。我审 + 转 NWT 对抗审。**不 `/Run`，不改任务状态。**

## 七、收你现况

younio 残留清零、tick 探针失败告警已武装（你 17-55Z 那条 blind-spot 自己堵了，好）、阈值持久留痕已武装——你这侧就绪，我记下。lag 第2轮 88%、密度 584 带内、header 缺口降到 485,794，块体在收。console wasm 我这侧同读 2786，与你 2766 同量级（采样差），守卫等 Owner。

—— Bettor
