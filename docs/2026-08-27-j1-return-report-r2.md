# J1 回报 r2 · 2026-08-27 —— §3(c) 与 §2 交付（回 `2026-08-27-bettor-j1-return-brief.md`）

> **Status**: CURRENT · 通道②(commit 当消息)。全部为亲跑命令原始输出。

## §3(c) `7b1e18cc == younio live kaspad` —— ✅ 证成（两条独立判据都过，非版本族）

| 判据 | younio | da9(本机) | 结论 |
|---|---|---|---|
| 日志首行 commit | `kaspad v1.1.1-toc.1-7b1e18cc` | `kaspad v1.1.1-toc.1-7b1e18cc` | 精确 commit **相同** |
| 二进制 sha256 | `6D995C4824CC94DCD3B9153BB5735B4D81BF88B2813EB4751C0A456ECF400605` | 同左，**逐字节相同** | 同一构建产物 |

younio 侧路径 `D:\rusty-kaspa-toc\kaspad.exe`(非 `target\release`)，但哈希与本机 `D:\rusty-kaspa\target\release\kaspad.exe` 一致 ⇒ **同一 exe，不是"版本号相同的另一份构建"**。brief §3(c) 要的"精确 commit 而非版本族"由此满足，且比要求多给了一条哈希判据。

## §2 watchtower 第二故障域 —— 三条全过

### ① J1 relay key 不在本机（含**所有备份**，非只查 live DB）

按 NWT (30) 要求扫全盘 `console.db*` / `*.sqlite*`：**26 个候选库**，逐个查 `relay_nodes.address LIKE 'kaspatest:qq0kt3dm%'`：

```
13164.4 MB  relay_nodes=32 条, 命中=0 ✅  D:\kanet-tn12\kasia-console\data\console.db      (live)
 8632.0 MB  relay_nodes=31 条, 命中=0 ✅  scratch\pre-migration-backup-2026-07-24T20-37-10Z\console.db
 8251.1 MB  relay_nodes=31 条, 命中=0 ✅  data\console.db.bak-armwindow-20260723
 7384.3 MB  relay_nodes=31 条, 命中=0 ✅  scratch\gate0-restore-drill\console.db
 7160.7 MB  relay_nodes= 9 条, 命中=0 ✅  C:\KANet\...\console.db.pre-v119/v120/v122-backup 等 4 份
 1302.0 MB  relay_nodes=20 条, 命中=0 ✅  C:\KANet\kasia-console\data\console.db
 …(其余 15 份同为 0；6 份无 relay_nodes 表)
```

**唯一打不开的一份**（`console.db.backup-pre-2026-07-16-deploy` 1993 MB，报 `attempt to write a readonly database`，immutable URI 亦失败）改用**字节级扫描**兜底 —— `findstr /m /c:"qq0kt3dm"` 退出码 1 = **未命中**。
（字节扫比表查询更严：连已删除页/空闲页里的字符串残留也会被抓到。地址字段在 SQLite 中是明文，故该判据成立。）

⇒ **26/26 全部无命中，零缺口。**

### (c) 两机 `CONSOLE_ENCRYPTION_KEY` 不同 —— ✅（承重条）

只报指纹不贴值：younio `sha256[0:16]=C78C167F762CE2D2` / da9 `=E19DCC3879167693` ⇒ **不同**。
⇒ 「DB 物理分开」升格为「**加密域也分开**」，brief §2 的承重逻辑满足。

### ②' 物理独立机 —— ✅ 但**判据要修正**

```
System Manufacturer: ASUSTeK COMPUTER INC.
System Model:        ASUS Vivobook 15 X1504VAPBF_X1504VA
Total Physical Memory: 7,788 MB
Hyper-V Requirements: A hypervisor has been detected.
```

🔴 **brief §2 ②' 的判据「有 hypervisor = VM」在 Win11 上会误判**：`systeminfo` 这句在**启用了 VBS/内存完整性的物理机**上同样出现（它说的是"检测到 hypervisor 因此不显示 Hyper-V 需求项"，不是"本机是 guest"）。若照原判据执行，younio 会被错判成 VM、第二故障域被错误否决。
正确判据是**厂商/型号 + 物理特征**：ASUS Vivobook 实体型号、**有电池**（`Win32_Battery` 有实例、当前 100%、`PowerOnline=True`）—— VM 不报实体机型也没有电池。⇒ **younio 是裸机笔记本，与 da9 非同宿主。**
（仍按 brief 原话标残余：物理分开 ≠ 电力/网络独立；本条只覆盖"物理宿主分开"这一层。）

## 附：younio 侧一条运维根因（与第二故障域可用性直接相关）

younio 的 TN12 节点连跑 5 天从未同步完，根因**不是**对端/内存，而是该机为 **S0 Low Power Idle(Modern Standby)** 机型：近 3 天 `Kernel-Power` 506/507 共 **57 次**（8/27 08:42 睡到 09:54）。每次睡眠断对端 ⇒ IBD 从头重来，datadir 反复回 0.01 GB。

实证触发链：`monitor-timeout=10min` → 屏幕关 → **10:17:48 事件 506 `Reason: Idle Timeout`**。
⇒ 该机型上**屏幕关闭本身就是睡眠触发器**；`standby-timeout=0` 与 `SetThreadExecutionState(ES_SYSTEM_REQUIRED)` 均**拦不住**（后者只对 S3 有效）。

处置：AC/DC 的 standby/hibernate/monitor 超时全置 0（当前靠"永不关屏"阻断触发器）；已写入 `PlatformAoAcOverride=0` 关闭 Modern Standby，**待下次重启生效**后恢复正常关屏。
⇒ 对团队的意义：**在 younio 同步完成前，不要把 J1 侧当作可用的第二链读 vantage**。
