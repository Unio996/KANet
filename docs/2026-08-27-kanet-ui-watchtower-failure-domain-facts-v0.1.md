# watchtower 故障域独立性 · 运营事实底稿 v0.1（KANet-UI·TN 运营者·不依赖节点同步）

> **性质**: 运营**事实**清单, 非设计、非方案菜单。供 Bettor 精炼后单点上报 Owner。
> **背景**: Codex 裁 best-of-N watchtower 只在「节点/RPC/故障域**真独立** 且 payout 不可重定向」时算数。payout 已结构满足(Bettor 述); 剩**故障域独立性**一条要事实核实上报。
> **作用域诚实**: 本机(DESKTOP-DA9QQ46)事实=**本地实测**(命令+输出附)。J1 远端(younio)=**只能引 ledger/memory, 本地不可验**, 标 `[引·待 J1 提权确认]`。第三点=下方结论。
> **采集时刻**: 2026-08-27 · console PID 27412 · kaspad PID 22428。

## §1 观察点候选与逐项事实
### 候选 P1 = 本机 DESKTOP-DA9QQ46（本地实测）
| 项 | 事实 | 命令/出处 |
|---|---|---|
| kaspad 实例 | PID **22428**, 起 8/26 16:29:25 | `Get-CimInstance Win32_Process -Filter Name='kaspad.exe'` |
| 数据目录 | `D:/kaspa-tn12-data`(appdir) | `kaspad-watchdog.ps1:47` `--appdir=D:/kaspa-tn12-data` |
| RPC 端点 | `ws://127.0.0.1:17210`(borsh, loopback); 另 :16210/:16311 | `netstat` :17210/:16210/:16311 全 pid 22428; `kanet.env:23` KASPA_RPC_URL |
| console/relay 进程 | console **27412**; 32 个 relay 子进程(见 (A) 拓扑报告) | `netstat :3200`=27412 |
| 🔴 relay 私钥归属 | **32/32 relay 私钥材料全在同一 `kasia-console/data/console.db`, 全由同一把 `CONSOLE_ENCRYPTION_KEY` 解密** | `SELECT COUNT(*) FROM relay_nodes WHERE mnemonic_encrypted IS NOT NULL OR privkey_encrypted IS NOT NULL` = 32/32(⚠ 须写 IS NOT NULL; 裸 `WHERE mnemonic_encrypted OR ...` 在 SQLite 里字符串布尔=0 会误得 0/32; relay-manager.js:184 生产同写法) |
| 电源/网络/机器 | host **DESKTOP-DA9QQ46**, 物理 RAM 62GB, commit 上限 ~99.6GB(单机单 commit 池) | `Win32_ComputerSystem`/`Win32_OperatingSystem` |
| watchdog 归属 | 本机: `kaspad-watchdog.ps1`(SYSTEM 计划任务, 拉 kaspad) + `kanet-console-supervisor.sh`(拉 console)——**都在本机同 OOM 域** | ledger (624); 计划任务非提权读不全 |
| 8/23 型 OOM 会否同时打掉 | **会·一锅端**: 8/23 整机 commit 撑顶("分页文件太小")→console+32 relay+kaspad **全同时没**(整机失响)。commit 池是机器级单一资源 | ledger (624) 8/23 postmortem |

### 候选 P2 = J1 远端 younio `[引·待 J1 提权确认, 本地不可验]`
| 项 | 事实(引 ledger/memory) | 出处 |
|---|---|---|
| 机器 | younio 机(≠DESKTOP-DA9QQ46), 8/23 迁机 | ledger (622)-(624), memory `project-j1-ssh-remote-repair` |
| kaspad 实例 | J1 独立 kaspad(J1 提权停 9084→watchdog 拉 25524, 独立 IBD/出块) | ledger (622) |
| RPC 端点 | younio `:3400`(频道 API 仍走本机 :3200) | Monitor-SOP 勘误(624) |
| relay 私钥归属 | **J1 新通信 relay `qq0kt3dm`, younio 上独立生成**(≠本机 console.db, ≠本机 CONSOLE_ENCRYPTION_KEY) | ledger (623)(624), memory `kanet-cross-node-identity` |
| 电源/网络/机器 | 独立机器 ⇒ 独立电源/网络/commit 池 | 迁机事实 |
| watchdog 归属 | J1 侧独立(younio 本地 watchdog) | ledger (622) |
| 8/23 型 OOM 会否同时打掉 | **不会**: 独立机器独立 commit 池, 本机 OOM 不波及 younio | 推断(独立机器) |

### 候选 P3 = 本机 C:\KANet 主网树（本地实测·同机）
| 项 | 事实 | 出处 |
|---|---|---|
| 存在 | `C:/KANet/kanet-start.sh` 存在 = 主网 console/kaspad 在**同一台 DESKTOP-DA9QQ46** | `ls C:/KANet` |
| 独立性 | **主网树同机, 但【当前未运行】** —— 本机现只 1 个 kaspad(22428, tn12), :3100 无监听=无主网 console(树外只 ws-proxy:17310+cc-bridge:9100)⇒ 作为 watchtower 候选 = **0 个观察点**; 即便运行也同电源/网/commit 池/GPU=同域 | `kaspad.exe` count=1; `netstat` :3100 无监听 |
| 8/23 型 OOM | **会·一锅端**(机器级 OOM/断电不分 tn12 与 mainnet 树) | 机器级资源 |

## §2 结论（两格·Bettor 上报 Owner 用）
### A. 哪些对是【真独立】故障域
- 🟢 **P1 本机 ↔ P2 J1远端** —— **唯一真独立对**: 独立机器 + 独立 kaspad 实例 + 独立 RPC + **独立 relay 私钥托管**(younio 生成 ≠本机 console.db/key) + 独立电源/网络/commit 池 ⇒ 8/23 型 OOM 不同时打掉。
  🔴 **成立前提(待 J1 提权确认, 本地不可验)**: ①J1 watchtower 用的那把 key 确在 younio 独立托管(非本机 console.db 的某 relay)②younio 确是物理独立机器(非本机的 VM/容器共 commit 池)。这两条我只能引 ledger, **须 J1 现场确认才能对 Owner 声明"真独立"**。

### B. 哪些只是【看起来两个】其实同故障域
- 🔴 **任意两个本机 relay**(如 用 relay_A 和 relay_B 各做一个 watchtower 观察点): 同 console 进程树(27412) + **同一 console.db + 同一 CONSOLE_ENCRYPTION_KEY(32/32 一把 key)** + 同机 + 同 kaspad(22428) + 同 commit 池 ⇒ **同 key 托管 + 同 OOM 域, 8/23 一锅端全没**。"两个 relay"≠两个故障域。
- 🔴 **本机 tn12 console ↔ 本机 C:\KANet mainnet console**: 不同 console/不同 kaspad, **但同一台 DESKTOP-DA9QQ46** ⇒ 同电源/网络/commit 池/GPU ⇒ 8/23 型机器级 OOM/断电**一锅端**。"两个 console"≠两个故障域。
- 🔴 **本机任意观察点 ↔ 本机 watchdog**: kaspad-watchdog + console-supervisor 都在本机同 OOM 域, 机器崩时它们和被观察对象**一起没**(8/23 实证: watchdog 反复拉起也救不了整机撑顶)。watchdog 不构成独立故障域。

## §3 一句话给 Owner（Bettor 精炼）
本机上**无论开几个 relay/console 观察点, 都是同一个故障域**(同机/同 commit 池/本机 relay 同一把 key)——best-of-N 在本机内**N=1 有效**。真正第二个独立故障域**只有 J1 younio 远端一处**, 且其"真独立"**取决于 J1 那把 watchtower key 是否 younio 独立托管 + younio 是否物理独立机**这两条**待 J1 提权现场确认**。没有本地可验的第三独立点(C:\KANet 主网树同机=同域)。
