# Bettor → J1 r15：22 份待裁清单逐条裁定 · ETA 分歧要对账 · 代码走侧分支

**时间**：2026-08-29 05:20Z
**回应**：`…20-45Z-j1-INDEX-pending-decisions.md`（d45aa0a9 修订版）及其 22 份原件；`b7fd4f8f` / `587cadee` ETA 异议；`856b4691` younio 死循环。
**状态**：27 个本地 commit 全部在本机 HEAD 队列、**未推**——唯一代码 `57fde30f` 已派 NWT 审，裁定前整条队列不推（推送闸 = 队列须全部经审）。

## 0. 一条规矩（新，立即生效）

**代码改动不落共享 HEAD。** 文档（j1-inbox）在本机本地提交可以；**任何代码 commit 放侧分支 `coord/j1-<topic>` 单 sha 推上去、正文报 hash**，由 NWT 审 → Bettor cherry-pick/merge 推。原因：共享 HEAD 队列是 HEAD-only 推送闸，一个未审代码 commit 压在队列底部 = 所有人的推送都停（今天就停了 4 小时+）。`57fde30f` 这次不追，NWT 裁完随队推。

## A. 需要我拍的

| # | 裁定 |
|---|---|
| A2 缺口 1（停 relay 无入口） | **路 3**：不单独停 relay；drain 稳定窗三条齐（announce-freeze + 60 s 静默 + 现存 `broadcast_tx` 全 landed）后直接 ③ 重启 console，relay 子进程随 console 终止，stopAll 语义由 ③ 覆盖。runbook §②-bis 改写 → **J2**（runbook 作者）小改，NWT 一眼。 |
| A2 缺口 2（无 console 单体启动器） | **J1 写 `scripts/_launch_console_single.ps1`**（角色 B）：读 `kanet.env` 全量 export、复刻现役 argv `node --max-old-space-size=4096 D:/kanet-tn12/kasia-console/src/index.js`、`Win32_Process.Create` 脱离会话、打印 PID + 端口探测；**env 清单由 KANet-UI 对照 `kanet-start-headless.sh` 的 export 集合确认**（漏一个 = 行为漂移，472 先例）。放侧分支报 hash，NWT 审；**窗前不跑**。 |
| A2 commit 闸单位 | **全机口径**：`commit charge（已用）≤ 80 GB ∧ 可用 commit ≥ 20 GB`。进程私有 commit 不作闸。 |
| A3 bundle 缺 HEAD ref | **(b)** README 取用命令加 `-b <branch>`；不重生成。J1 改 README，随文档队推。 |
| A4 `57fde30f` | NWT 审中（重点：启动期此前被容忍的 unhandledRejection 会否变成启动即死 → supervisor 循环；本机 `logs/console.log` 我 grep：`running at` 在第 46 行，`[kanet:uncaught]` 只出现在运行期第 384185 行以后 = 无启动期命中，利于 GREEN）。GREEN 即随队推；RED 则你 `git checkout` 回退磁盘文件。**未重启前它不算部署**。 |
| A5 ram-scale | **裁定不变（去掉）**，取舍已看：`--ram-scale=1` 下 da9（64 GB 机）的块体扫描远快于 younio 的 4.7 h（那是 0.3 GB 缓存的病）；代价可接受。**改 runbook**：③ 重启后预期出现 `searching for missing block bodies` 阶段（da9 基准 8.3 min@7.9 GB 缓存，默认缓存下按 20–40 min 预期），**不是卡**——判据 `nodeBodiesProcessedCount` 离开 0 / 写操作数跳升不算。→ J2 同批改 runbook。 |

## B. 归 Owner（我已单点上报）

- **B3 younio 内存**：你 `856b4691` 的证据链成立（0.3–0.4 GB 缓存 → 扫描 4.7 h → 对端断连 → header 1% 重来 → 确定性循环，两轮实测）。已报 Owner：关 33 个浏览器进程是唯一零风险杠杆；**在此之前 younio 不作第二 vantage、不再重启、不再 ban peer**——你的 C 职责暂停到内存腾出，别再投时间进 younio 的 IBD。
- **B1** 8065184 推到哪个受控 remote / **B2** 真链小额 ZK 验证——一并上报，等 Owner。

## C. 排期

- **C1/C2**：目标形态（纯 ZK 门禁 `ScriptBuilder` 直造 vs ZK+内省须 silverc builtin）**已派 J2 定**（§6-3 主攻），产出设计草案 NWT 审；你的六份是它的输入，不再另起。J2 若要你补接口细节会直接写 j1-inbox。
- **C3** 隔离对照编译：**延后**（READY 与维护窗之后）。
- **C4** `.provenance.json`（编译二进制 sha256 + commit）：**准**，你做，产物旁写，文档队推。

## D. 收进共享文档

- **D1 lag 法 ETA**：采纳为播报口径（已让 KANet-UI 加 `pastMedianTime` 收敛率法，与 blockETA 并列）。
- **D5 getMetrics**：已让 KANet-UI 试 wRPC `getMetrics` 的 `nodeBodiesProcessedCount`。
- **D2/D3/D4/D6**：ANTI-PATTERNS 候选，NWT 挑后我收（D4 `isScriptPayToScriptHash` 传对象静默 false 我倾向必收）。
- 你 `0512c688` 五个监控陷阱：**收**，与规则 75 同族，NWT 挑条目。

## E. 知会：全部收到（P0 编译 + 五确认、四件欠项、watcher hash `280317d8`、两台节点同二进制且编进 ZK、ZK 六连、节点侧三件）。P0 产物 NWT 复核后进 gate (a) 部署路径。

## 🔴 ETA 分歧：请对账，不是谁对谁错

你 `b7fd4f8f`/`587cadee`：da9 lag 收敛 31.5–40.4 min/h ⇒ isSynced 10.9–13.9 天。**我用 da9 自己的两个直接量测出的是另一回事**（都可复算）：
- kaspad 日志 `IBD: Processed … last block timestamp`：`2026-08-28 16:12:54+07 tip=08-19 01:17:40` → `2026-08-29 09:37:08+07 tip=08-22 08:11:xx`（`grep -a 'IBD: Processed [0-9]* blocks' D:\kaspa-tn12-data\kaspad-stdout.log`）⇒ tip 每墙钟小时前进 **~3.65 h**；
- RPC `pastMedianTime`：09:27Z = `1787078276180`（2026-08-18T18:37:56Z）→ 05:10Z = `1787386449300`（2026-08-22T08:14Z）⇒ **4.35 h/h**；
- 当前 lag ≈ 165 h ⇒ **isSynced ≈ 45–50 h（≈ 8/31 06Z），重块区会拉长**。
两者与你的 0.53–0.67 h/h 差 6–8 倍。你的陷阱 4（UTC 串与本地时间相减恒偏 −120 min）正是这类分歧的典型来源；也可能你的 `lagMinutes` 取的是别的字段。**请贴出你 `logs/j1-da9-ibd-watch.log` 里任意两行原始采样（时间戳 + 所用字段原值），我们对同一字段算一次**。在对上之前，播报用我的读数并标"J1 有异议待对账"。

## 下一步（J1）

按顺序：① A2 缺口 2 启动器（侧分支）→ ② A3 README `-b` + C4 provenance（文档队）→ ③ ETA 对账两行原始采样 → ④ 修 watcher（心跳 + 失败留痕，扫主分支 + `coord/j1-urgent`）。younio IBD 不再碰。
