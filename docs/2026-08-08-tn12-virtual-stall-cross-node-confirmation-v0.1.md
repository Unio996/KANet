# TN12 virtual 停滞 — 跨节点实证与作用域 v0.1

> **Status**: CURRENT · **v0.2** · 2026-08-08T09:5xZ · J1tn 现取实测
> ⚠ 本文全部读数是**会动的量**；结论(§0/§3)稳定，**数字必须用 §4 现取**。
> 🆕 **v0.2(同日晚些, Owner 令「彻底修复」后)**：v0.1 只是**诊断**且写于事故进行中；
> **§6 起是根因、修复与验证**。v0.1 原文一字不删。
> 🔴 **v0.2 起本文不再是零生产动作**：停/起矿工、部署 watchdog v2 均已实施，逐条记在 §6.3。
**为什么走 git 而不是频道**：频道此刻对**全队**不通（见 §2）。git 是当前唯一验证可达的团队通道。

---

## §0 一句话

**上一班留下的 A/B 判据已判定：不是我这台的 DAG 坏了 —— 队里第二台独立节点(DESKTOP-DA9QQ46)读数与我逐字相同，
而它没有重灌过 appdir。⇒「重灌我这台 appdir」的【原始理由】被排除。**

🔴 **同时抓到一个此前没人记的更大事实：频道不是对 J1 死，是对全队死，已 15 小时。**

---

## §1 跨节点对照（同一时刻现取，两台各自本地 RPC）

| 读数 | J1tn 本机(:17210) | DESKTOP-DA9QQ46(经 SSH 隧道) |
|---|---|---|
| `isSynced` | **false** | **false** |
| `virtualDaaScore` | 76181041 | **76181041**（逐字相同） |
| `blockCount` / `headerCount` | 1104732 / 1104732 | **1104732 / 1104732**（相同） |
| `pruningPointHash` | `e23bf4f3…f407` | **相同** |
| `tipCount` | 6381 → 6408 | 15882 → 15985 |
| 吞吐行 | 7 blocks/10s · **0 UTXO-validated** · mergeset ≈248 | 7 blocks/10s · **0 UTXO-validated** · mergeset ≈248 |
| 块 mass | `4114.0s/409450.0c/185320.0t` | **逐字相同** |

**≈3 分钟 delta**：`virtualDaaScore` 与 `blockCount` **一动不动**；`tipCount` 两台**单调增长**；
日志两台都在持续 `Accepted block … via relay`（远端还有 `via submit block`，那台上有矿工）。

⇒ **新块在进来，但没有被合并进 virtual。** DAG 宽度在涨，共识不前进。

### 🔴 为什么"两台一样"这次是【独立】证据

两台**不是互为 peer**，而是**连同一对外部节点**：`86.48.24.208:16311` 与 `152.53.236.224:16311`
（本机日志 + 远端 `Get-NetTCPConnection -OwningProcess <kaspad>` 双向核过；远端在 CGNAT 后，
本机 peer 表里没有它的出口 IP）。两个独立 appdir、两台机器、两份运行时，收敛到同一 DAG 态。

🔴 **而这恰好也钉死了结论的天花板**：**我们两台够得到的 TN12 只有这 2 个 peer。**
⇒ 本文只能断言「**我们够得到的那部分 TN12 已停止推进 virtual**」，
**不能**断言「TN12 全网挂了」——我够不到别的节点，`api-tn12.kaspa.org` 无公开 API（上一班实测 503）。
承 `[[feedback_conclusion-scope-equals-instrument-reach]]`：全称否定的作用域只等于仪器够到的范围。

---

## §2 🔴 频道对全队死了 15 小时（本班新发现）

| | 本机 console 库 | DESKTOP-DA9QQ46 console 库（经隧道只读 API） |
|---|---|---|
| `dev-coord-testnet` 最新消息 | 2026-08-07T16:18Z | **2026-08-07T16:19Z**（同一条 Bettor 派 ⑥ v0.2 分片） |

⇒ 两台库**同时停在同一条消息**。上一班把这读成"我瞎了"（`isSynced=false` ⇒ 我收不到），
**而真相是全队都 `isSynced=false` ⇒ 全队 relay 广播都被 not-synced 闸拒 ⇒ 根本没有新消息产生。**

🔨 **判据教训**：「我读不到」与「没人说话」在单机侧读数相同 —— 上一班已立此条并去查了自己那半，
**但没有第二台可比对，所以只能停在"我瞎了"。这次第二源恢复，才把它翻过来。**

🔵 **队伍并没有停摆，它换了通道**：`coord/codex-bridge` 分支在频道死后仍有 4 笔推进
（最新 `26b9ec14`，2026-08-07T21:08Z）。**git 是活的，Kaspa 通道是死的。**

---

## §3 导出的动作（与不该做的动作）

- ✅ **「重灌 J1tn appdir」的原始理由（我这台库坏了）已被排除** —— 对照那台没重灌、同样的病、tip 还更多。
  ⚠ **准确措辞**：这**不等于**"重灌一定无效"（IBD 走的是另一条代码路径）；
  它排除的是**单机损坏假设**，因此**修复不在单机侧**，付一小时停机去赌的期望收益大幅下降。
  **仍挂 Owner**（上一班已明说在 Owner 回话前不动它，本班不动）。
- 🔴 **不要拆 relay 的 not-synced 闸**。那闸是对的：未同步节点上构造的 tx 建在陈旧 UTXO 态上。
  承 `NO TX NO STATE CHANGE`。**它堵住了报障通道这件事，不构成拆它的理由**——改走 git 才是。
- 🔵 **报障走 git**（本文即是）。承 `[[feedback_failure-blocks-its-own-report]]`：
  报障通道依赖出故障的组件时，先备第二条路。

---

## §4 自查命令（照 CLAUDE.md 通则：唯一记录必须配自查命令）

本文所有读数都是**会动的量**，30 秒后就可能不成立。**别信本文，跑命令**：

```bash
# 本机
node D:/kanet/kanet/scratch/j1-peer-node-probe-0808.mjs

# 队里第二台（需 Tailscale 在线；Owner 2026-08-01 授权 SSH 入口）
ssh -N -L 17211:127.0.0.1:17210 admin@100.99.147.101 &
J1_PROBE_URL=ws://127.0.0.1:17211 node D:/kanet/kanet/scratch/j1-peer-node-probe-0808.mjs
```

🔴 **`ok:false` = 探针自己坏了，不等于节点没同步**（两者导出的动作不同）。
🔴 **探针脚本在 `scratch/`，而 `scratch/` 是 gitignored** —— 换机/清 scratch ⇒ 它没了，而本文仍在告诉你去跑它。
   源码 30 行，逻辑只有"连 RPC → `getServerInfo` + `getBlockDagInfo` → 打 JSON"，缺了照此重写即可。

**判据摘要（给下一个人一句话就能用）**：
> 只要**两台独立机器的 `virtualDaaScore` 相同且都不动**，问题就不在任何一台的本地存储上。

---

## §4-bis 第三台独立机器确认（KANet-UI，操作员机，2026-08-08，读数现取）

- 本机（:3200 生产 console 所在机，独立 appdir，独立运行时）现读 `getServerInfo`/`getBlockDagInfo`：`isSynced=false`，`virtualDaaScore=76181041`，`blockCount=1104732`——**与上表两台逐字相同**。8 秒 delta 复测：`virtualDaaScore`/`blockCount` 完全冻结，`tipHashes` 从 18108 涨到 18118（仍在长，同一"DAG 宽度涨、共识不前进"模式）。
- **尝试走频道广播实测失败**：`_kanetui_send.cjs` 返回 `HTTP 500 {"error":"RPC node is not synced"}`——与本文 §2 的判词完全吻合（relay not-synced 闸生效，广播被拒，不是频道 API 本身坏）。
- 🔴 **独立性必须如实标注收窄，不能照抄"两台独立"升级成"三台独立"就完事**：`netstat` 现查，本机对外连接**正是同一对** `152.53.236.224:16311` / `86.48.24.208:16311`（`ESTABLISHED`，非本机 peer 自选的巧合——这两个 IP 与 J1tn/DESKTOP-DA9QQ46 完全相同）。⇒ **本次确认排除的是"某一台机器/appdir 本地损坏"这个假设（现在是三台独立存储、三份运行时收敛到同一冻结态），但不能拉近 §5 那条"这 2 个 peer 是网络代表还是它们自己坏了"的悬而未决**——三台都经由同一对 peer 连接整个 TN12，仪器的够达范围完全一致，没有变宽。

---

## §5 我不知道的（不写成已知）

- **TN12 真正的链尖在哪** —— 够不到第三个源。
- **那 2 个 peer 是网络的代表，还是它们自己坏了** —— 分不开；两台连的是同一对，所以这两种情形对我们**读数完全相同**。
- **tip 爆炸是因还是果** —— 上一班对"tip 数=病态"留过保留意见，本班只把它降级为**同步增长的伴随量**，
  **不作因果断言**。（可证伪判据仍是上一班那条：若节点后来自己追平，tip 数就是症状不是病因。）
- **矿工是谁在挖**（远端 `via submit block`）——未查，不猜。

---

# 🆕 v0.2 — 根因、修复、验证

## §6.1 根因：分两层，只有第二层可根治

**第一层 · 触发** `[未查清 · 不写成结论]`
节点 sync rate 从 0.48 掉到 **0.05**（`rusty-kaspa.log`，2026-08-08 01:45+08）。
那台同时扛着 30+ relay / llama-server / 多个 Claude 会话 / 三个 bot ⇒ 资源争用**最可能**，
但**我没有直接证据**。⚠ 这一层大概率**根除不了**（扰动总会发生），所以它不是修复的着力点。

**第二层 · 放大** `[CONFIRMED · 源码 + 日志 + 实测]`
1. 两道同步闸被**同时**关掉：kaspad `--enable-unsynced-mining`
   + bridge `BRIDGE_SKIP_SYNC_GATE=1`（写死于 `tn12-mining-watchdog.ps1`，注释自陈为防 TN12 halt 的 bootstrap 措施）。
2. 节点落后后矿工**照常挖**（`via submit block` 2006 次/小时，同期 `via relay` = **0** ⇒ 全网只有我们在挖）。
3. **产块 0.56/s > UTXO 验证 0.2/s** ⇒ tips 堆积 ⇒ mergeset 顶到上限 248 ⇒ 验证更慢 ⇒ **更多 tips**。
   **正反馈，不自愈**：无人干预跑了 15 小时，tips 到 **18132**。

🔨 **一句话**：那两个开关的名字听起来是「让它能挖」，**作用是「拆掉保护」**。
它把一次**能自愈的落后**，变成了**不可自愈的 DAG 污染**。

🔴 **而这两个 flag 【不能删】——我中途判断错过一次，已纠正并记在这里**：
`rpc/service/src/service.rs:308` 的守卫由 `is_synced` 驱动，而 `is_synced` 看 sink 时间戳。
删掉 flag ⇒ 无新块 ⇒ sink 永远陈旧 ⇒ 永远 not-synced ⇒ 永远拒绝 submitBlock ⇒ **永远没有新块 = 死锁**。
⇒ **正解是给它配熔断，不是拆掉它。**

## §6.2 为什么 15 小时没人知道 —— 这条比故障本身更该留下

**唯一的告警通道是频道，而频道正是被这次故障打掉的组件。** 全队 relay 广播都被 not-synced 拒绝。
事故不是被系统发现的，是 **Owner 恰好来问**才被发现的。
🔨 **判据（已在册，这次是它的又一个实例）**：**报障通道不得依赖被报障的组件。**
⇒ 修复里的 `_DAG_ALERT.txt` 走本地文件、**刻意不经 Kaspa**。

## §6.3 已实施的修复（全部现已 live）

| 动作 | 结果 |
|---|---|
| 停 5 个 `tn12-mining-watchdog` 实例 + 停矿工 | 两台**立刻**开始消化 |
| 观察恢复 | tips 18132 → 11096 → **2**；两台 `isSynced` false → **true**；mergeset 248 → 87 |
| 部署 `scripts/tn12-dag-health-probe.mjs` | DAG 宽度探针（tips/isSynced/blockCount），**按候选发现 wasm 路径**不写死 |
| 部署 `scripts/tn12-mining-watchdog-v2.ps1` | keepalive **+ tips 熔断**，detached 常驻（WMI Create，不依附任何会话） |
| v1 备份 | `tn12-mining-watchdog.v1.bak`（原脚本一字未改） |

**熔断设计**：`tips > 500 ⇒ 停挖等消化` / `tips < 50 ⇒ 恢复挖`（迟滞防抖）。
**阈值依据是实测不是拍脑袋**：健康态 tips = **2**（个位数），事故峰值 **18132** ⇒ 中间四个数量级，不是临界判断。

🔴 **探针失败时【继续挖 + 高噪告警】，这是刻意的**：
「探针读不到」与「DAG 坏了」是两个不同读数，**导出的动作相反**。
拿未知读数去刹车，会把探针 bug 变成**确定的链停**；而链停是立刻可见的，DAG 污染是静默的（本次静默 15h）。
⇒ **未知 ⇒ 保持现状并喊；已知坏 ⇒ 刹车。**

## §6.4 熔断器已被【实际触发过】—— 不是装饰

**一个从没有人故意触发过的熔断器，「因为一切正常所以没响」和「因为它坏了所以没响」读数完全相同。**
所以阈值做成 env 可覆盖，用**同一份生产脚本**演练（不另写副本，否则测的不是要交付的东西）：

```
TN12_TIPS_BRAKE=1 TN12_TIPS_RESUME=0 TN12_POLL_SEC=5 TN12_MAX_ROUNDS=4 \
  powershell -File D:\kaspa-tn12-mining\tn12-mining-watchdog-v2.ps1
```
实测输出（`_DAG_ALERT.txt`）：
```
BRAKE ENGAGED: tips=2 > 1. Miner stopped so the node can digest. Will resume under 0.
```
且演练退出时**自动把矿工放回来**（`miner after exercise: 1`）——bounded 模式不会把矿工遗留在停止态。

## §6.5 自查命令（照 CLAUDE.md 通则）

```
# 那台（挖矿主机）
node D:\kaspa-tn12-mining\tn12-dag-health-probe.mjs        # tips 现值
Get-Content D:\kaspa-tn12-mining\_watchdog.log -Tail 5     # 熔断/keepalive 动作
Get-Content D:\kaspa-tn12-mining\_DAG_ALERT.txt -Tail 5    # 只在异常时才有内容
```
🔵 **两个脚本已入库**（`scripts/`），**仓库名与部署名一致**——
避免「库里那份」和「跑着的那份」不是同一个东西。
🔴 **但部署副本本身仍在 git 之外**（`D:\kaspa-tn12-mining\`）：
改了库里的**不会**自动生效，必须重新 scp + 重启 watchdog。**这是已知缺口，不是已解决项。**

## §6.6 仍然没有解决的

- **第一层触发未查清**（为什么 sync rate 会掉到 0.05）。熔断器让它**不再致命**，但**没有消除它**。
- **只有那台装了熔断**。我这台（J1 :3300）不挖矿，不需要；**若将来有第三台挖矿，必须同装**。
- **告警靠文件，没有推送**：`_DAG_ALERT.txt` 要有人去看。**比 15 小时静默好，但不等于有人会知道。**
- **本机事故中 DAG 曾破洞**（最近窗口 `Orphaned 180 / Unorphaned 0` = 孤块进得去出不来），
  已随消化恢复，**未单独复盘**。
