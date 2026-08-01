# 2026-08-01 · RustDesk 定案四条命令结果(服务端 `desktop-da9qq46` 本机跑)

> **Status: CURRENT(EVIDENCE)。** 回应 `docs/2026-08-01-rustdesk-remote-disconnect-diagnosis.md` §4 的四条命令。
> 跑的人 = Bettor(在 `desktop-da9qq46` 本机,即 RustDesk 服务端那台)。
> 频道同样发不出去(本机 relay 到 kaspad 的 WebSocket 断连,与 J1 那台 kaspad 卡死是两件独立的事),故走 git。

---

## 结果(原文贴,未删改)

```
=== 1. RustDesk exe 时间戳 ===
LastWriteTime : 27-Jul-26 21:13:01
CreationTime  : 28-Jul-26 03:52:58
FileVersion   : 1.4.9+67

=== 2. 最近装的补丁 ===
KB5101650   16-Jul-26
KB5120102   14-Jul-26
KB5100998   14-Jul-26
KB5054156   15-Apr-26

=== 3. RustDesk 服务身份 ===
Name      : RustDesk
State     : Running
StartName : LocalSystem
PathName  : "C:\Program Files\RustDesk\RustDesk.exe" --service

=== 4a. 交互登录会话 ===
 SESSIONNAME   USERNAME  ID  STATE   TYPE  DEVICE
 services                0  Disc
>console       ADMIN     1  Active
 rdp-tcp             65536  Listen

=== 4b. 显示输出 ===
NVIDIA GeForce RTX 5090   1920x1080   Status OK
AMD Radeon(TM) Graphics                Status OK
```

## 判读(按 J1 文件 §4 给的判据)

原判据:「第 4 条若 `query session` 无 Active 交互会话、或分辨率读不出 ⇒ 答案是①」。

**实况相反,①②③ 逐条被推翻**:

| 假说 | 判据 | 实况 | 结论 |
|---|---|---|---|
| ① 显示输出/锁屏无会话 | 无 Active 会话 或 分辨率读不出 | `console/ADMIN/Active` + `1920x1080/OK` | 🔴 反证 |
| ② RustDesk 自更新 | 时间戳落在 08-01 01:5x 附近 | LastWriteTime 07-27 21:13(早 3+ 天,装完未变) | 🔴 反证 |
| ③ 服务降权/被卸 | 非 SYSTEM / 非 Running | `Running / LocalSystem / --service` | 🔴 反证 |
| (Windows 更新) | 补丁落在 08-01 01:5x 附近 | 最近一条 07-16 | 🔴 反证 |
| ④ 配置/注册表被改 | 本轮四条未覆盖 | — | ⚪ 唯一未排除 |

## 与本机(服务端)既有诊断的交叉验证

本会话早前(未走这四条命令,独立路径)已测过等价项,结论一致:
- `quser` ⇒ `admin console 1 Active`,`Get-Process LogonUI` ⇒ 不在(不在锁屏)
- `explorer.exe` 持续运行(14:01:32 起)
- 服务侧 `RustDesk_rCURRENT.log` 70/70 次显示器枚举逐字节相同(`DISPLAY1 1920x1080`),编码器每次真初始化(`hevc_nvenc`, `initial quality` 有值)

**⇒ 两条独立路径(J1 客户端读数 + Bettor 服务端命令)在"①②③ 不成立"这一点上互相印证,不是同一个人重复犯错。**

## 服务端侧独有的补充发现(J1 文件未覆盖的角度)

1. **打洞侧全灭**:`Punch tcp hole to <peer>` / `Failed to connect to <peer>` = **44/44**,从未走通;广播中继使用 **0 次**。
2. **关闭原因分布**:`deadline has elapsed` 30 次、`os error 10054` 13 次、`reset by peer` 1 次 —— 与 J1 客户端侧"48/48 全是 10054"的说法在**归因侧**不完全对齐(服务端记录的关闭原因更杂),值得注意但不改变整体方向。
3. **已尝试但未完成的修法**:`force-always-relay='Y'`(强制走中继,绕开打洞失败路径)— 脚本已写好、键名已在 `librustdesk.dll` 字节层验实存在,**卡在需要一次 UAC 管理员确认**,已连续 **3 次被取消**(15:22:08 / 15:24:17 / 15:33:xx-15:35:51,三次报错逐字都是 `The operation was canceled by the user`)。怀疑与本次故障本身相关:如果确认动作是透过这条正在断连的 RustDesk 会话完成的,~19 秒的窗口可能不够点完。**尚未证实,只是怀疑**。
4. **可用绕行已验证**:Tailscale 直连 `100.99.147.101:21118` TCP 可达(`TcpTestSucceeded=True`),`laptop-s6i31sri`(100.111.126.10)今日 14:08 用此路直连成功过一次(服务端日志 `direct access from [::ffff:100.111.126.10]`)。

## ④ 待查(下一步)

四条命令没测注册表。若①②③ 都不是,剩下的候选并入 J1 §3 的框架:**"01:55 前后什么被装上或改掉了"**,范围收窄到「配置/注册表层面的变更」。本机窗口内(07-31 21:00 ~ 08-01 02:30)排查过的候选:
- Windows 更新事件:仅 Xbox/WhatsApp/Store 几个 Store 应用,无系统级更新
- 显卡驱动:NVIDIA 32.0.15.9597(17-Mar-26)/ AMD 32.0.21036.18(12-Nov-25),窗口内无变化
- 唯一在此窗口内真实安装的东西:**NordVPN 8.8.3.0**(`unins000.exe` 时间戳 07-31 13:14,略早于窗口起点,证据强度降级,不能当结论)

**尚未做**:对比 08-01 01:55 前后的注册表变更(Windows 无内建审计,需要 `Get-WinEvent` 拉安全日志里的注册表修改事件,或对照一份更早的注册表快照——本机没有现成快照,这条需要新方法)。

---

**相关**:`docs/2026-08-01-rustdesk-remote-disconnect-diagnosis.md`(J1 客户端侧原始诊断)、`docs/2026-08-01-j1tn-705-xnode-refund-request-list.md`
