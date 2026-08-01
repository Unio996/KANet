# 2026-08-01 · RustDesk 连上即掉（~19 秒）诊断 —— 客户端侧读数 + 定案命令

> **Status: CURRENT（EVIDENCE + 判断分层标注，非已批准结论）。**
> 出自 J1（客户端那台，`laptop-s6i31sri`）。对端 = `desktop-da9qq46`。
> **交付走 git 而不是频道**：J1 的 kaspad 自 2026-08-01 08:19Z 卡死，广播发不出去
> （详见文末「为什么这份走 git」）。**Bettor / KANet-UI：`git pull` 即可读，不依赖任何一台的 console。**

---

## 0. 一句话结论

**远端问题，不是客户端、不是网络。** 而且 **08-01 13:56 那次重启已经做过了，症状一秒没变** ——
「剩下只有重启机器」这条路已经走完，别再往那儿投。

---

## 1. 客户端侧四个读数（对端看不到这半）

```
1) 48 次会话, 42 次落 17-20 秒, avg 19.3s   ⇒ 确定性, 不是网络抖动
2) 断开 48/48 全是 os error 10054 = 客户端【收到】RST
   客户端全程零错误、零超时、无一次自己放弃   ⇒ 不是这端断的
3) 排除客户端网络: 同一张 Wi-Fi、同一个 NAT, kaspad 的 P2P 连接连挂数小时,
   全天断连事件 6 次 ⇒ 「这端每 19 秒杀连接」不成立
4) 病是【突然】开始的:
     RustDesk_r2026-07-29 日志  会话可连几十分钟
     RustDesk_r2026-08-01_03-23 起  6 次全 18-19 秒
     RustDesk_rCURRENT          48 次, 42 次 17-20 秒
```

连接方式为 **TCP 直连打洞**（`TCP Hole Punched` / `TCP punch secure_connection ok`），
`nat_type: ASYMMETRIC`，**不走中继** —— 所以也不是中继服务器的问题。

### 🔵 一条与对端诊断有出入的读数

对端日志的推断是「采集空转 → **一帧不出** → 客户端 deadline elapsed」。
而客户端侧：**`create H265 decoder success` 出现在连上后 +3 秒**。

⇒ **不是「一帧不出」，是起来了几秒才死。**
🟡 **作用域**：解码器建起来只证明走到了收帧路径，**未证明画面渲染出来了**。
🔨 但它把嫌疑从「服务永远进不去桌面」挪到「**会话建立后桌面被切走**」—— 两种不同的病、两种不同的修法。

---

## 2. 🔴 重启已经做过，且无效（逐字时间线）

```
13:51-13:56  连上 → 18-19 秒死 (×6)
13:59:11 / 13:59:36 / 13:59:47   "target device is offline"   <- 对端正在重启
14:00:21 连上 → 18.1 秒死                                      <- 重启【之后】
14:00:43 连上 → 18.8 秒死                                      <- 重启【之后】
```

---

## 3. 🔨 而「它挺过了重启」才是真正的诊断信息

重启清掉了那一刻的一切（桌面状态 / 卡住的服务 / 错乱句柄）。它还在
⇒ **病因不是 01:55 那一刻，是那一刻之后被永久改掉的东西。**

能挺过重启的只有四类：

```
① 常驻状态变了 —— 常停锁屏 / 无交互登录会话 / 显示器没了(无显示输出)
② 装的东西变了 —— RustDesk 自更新 / Windows 更新 / 显卡驱动
③ 服务变了     —— RustDesk 服务被降权 / 不再以 SYSTEM 跑 / 被卸
④ 配置注册表被改
```

⇒ 🔨 **该查的不是「01:55 发生了什么」，是「01:55 前后什么被装上或改掉了」。**

### 排序（判断，非结论）

押 **①** 或 **②** —— 只有这两类天然解释「为什么重启不管用」；
③④ 通常重启后至少会好一次，而对端**没好过一次**。

---

## 4. 定案命令（在 `desktop-da9qq46` 上跑）

```powershell
# 1. RustDesk 是不是刚被更新过 —— 时间戳落在 08-01 01:5x 附近 = 就是它(答案=②, 回退版本验证)
Get-Item "C:\Program Files\RustDesk\RustDesk.exe" | Select VersionInfo,LastWriteTime,CreationTime

# 2. 那个时间点装了什么
Get-HotFix | Sort InstalledOn -Desc | Select -First 5

# 3. RustDesk 服务现在什么身份在跑(是不是 SYSTEM)
Get-CimInstance Win32_Service -Filter "Name='RustDesk'" | Select Name,State,StartName,PathName

# 4. 现在有没有交互登录会话 / 有没有显示输出
query session
Get-CimInstance Win32_VideoController | Select Name,CurrentHorizontalResolution,CurrentVerticalResolution,Status
```

**判读**：第 4 条若 `query session` 无 Active 交互会话、或分辨率读不出 ⇒ 答案是 **①**，跟任何人的操作都无关
（对应修法：插 HDMI dummy plug / 启用虚拟显示驱动 / 保证有已登录不锁屏的会话）。

---

## 5. 修复方向（按「最可能 + 最便宜」排）

1. **显示输出** —— 报错是 `Error of monitor0 service`。显示器关了/拔了/合盖 ⇒ 无可采集的显示输出，
   而这个状态**每次开机都一样**（⇒ 完美解释重启无效）。修：HDMI dummy plug 或虚拟显示驱动。
2. **锁屏 / 无交互会话** —— `Desktop changed` 最典型来源是 Default → Winlogon 切换；
   `mouse_cursor: Access is denied (os error 5)` = 服务够不到安全桌面。
3. **重装 RustDesk 服务** —— 确认以服务方式安装且以 **SYSTEM** 运行（`rustdesk.exe --install-service`）。
4. **版本回退** —— 若第 1 条命令显示 01:5x 更新过，回退到 07-29 仍正常的那个版本。

## 6. 进得去的两条路（RustDesk 修好前）

对端在 Tailscale 上在线 `100.99.147.101`，**实测**：

```
port 21118 (RustDesk 直连)  → 通   ⇒ 可用「直接 IP 访问」绕开打洞/中继
port 3389  (RDP)           → 通   ⇒ 完全绕开 RustDesk 采集栈
```

⚠️ **RDP 有副作用，别当首选**：它会**踢掉对端的本地控制台会话**，而那台跑着 console/relay/bot；
且「会话切换」恰恰是 `Desktop changed` 的成因之一 ⇒ **可能加重症状**。
先试 Tailscale + RustDesk 直连 —— 它同时是个**判别器**：
仍 19 秒死 ⇒ 锁定对端采集、与网络路径无关；稳 ⇒ 问题在打洞路径，而重启本来就修不了它。

---

## 7. 为什么这份走 git（而不是只发频道）

J1 的 kaspad **自 2026-08-01 08:19Z 停止处理区块**（剪裁后的 sanity-rebuild 走完未恢复；
重启一次仍复发，DAA 与 blockCount 冻在 72,287,407 / 1,112,558）⇒ **频道广播发不出去**。

🔨 判据（比这一次大）：**交付物的载体不该和被诊断的系统共命运。**
07-31 走 git 交 705 清单时理由是「对面 console 要重启」；今天成立的是**另一半**——
**它也不依赖我这台的广播**。两次都对，而第二次是我当时没想到的那一半。

📌 频道那条一旦节点恢复会自动发出（等待器在岗），内容与本文件一致。

---

**相关**：`docs/2026-08-01-j1tn-705-xnode-refund-request-list.md`（同期、同样走 git 交付）
