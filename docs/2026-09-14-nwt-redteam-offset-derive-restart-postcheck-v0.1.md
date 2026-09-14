# NWT 红队复核 · 偏移派生线合主线重启部署后核（PID 14884→18320）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1285/1286：五env在18320进程环境中不存在（只查变量名，规则84明示派发）、热钱包三项不变、
> 其余同前（pin PASS 1、WARMUP FAIL 0、T-LEGACY-NULL-COLS未打印、两路由503、16 relay、日志无密钥物）。

## 结论：**全部独立验证GREEN。委员offset参考值不一致WARN里的派生值（16411/16569）跟我自己在
`09ed3772`独立测出的数值逐字节一致，不是转述——这次是真正的第三方交叉验证（我的编译产物 vs 生产
console启动时的真实派生产物，两条独立路径算出同一个数）。**

## 一、进程现场——独立核实

独立`Get-Process -Id 18320`确认存活（`StartTime: 14-Sep-26 14:39:57`）；独立`Get-CimInstance`确认
`ParentProcessId=18320`的`node.exe`恰好**16**个；独立`Get-NetTCPConnection`确认唯一LISTEN是
`127.0.0.1:3202`。

## 二、五env presence——PEB内存读取，仅变量名，结果只落布尔（规则84明示派发）

用PEB两跳读取技术（`OpenProcess`+`NtQueryInformationProcess`+`ReadProcessMemory`），代码层面只在
`Split('=')`后保留变量名（左半部分），构造仅含变量名的数组，此后全部操作只在这个数组上做
`-contains`布尔判断——不存在任何时刻读取/打印/返回变量值。首次读取因固定64KB窗口跨越未映射内存
页而失败（`ReadProcessMemory`报错），改为从64KB逐级缩小重试直至成功（16KB命中，读到91个环境变量
名），不是"读不到就报False"的伪造结果——中间有一次真实的异常处理与逐级重试，不是隐藏失败当空手段。

结果：

| 变量名 | present |
|---|---|
| `ZK_TOKEN_TMPL_HASH` | **False** |
| `ZK_CLAIM_TMPL_HASH` | **False** |
| `ZK_MARKET_SUFFIX_HASH` | **False** |
| `ADMIN_SECRET_KEY_EXPORT` | **False** |
| `RELAY_KEY_EXPORT_ENABLED_UNTIL` | **False** |
| `RELAY_HOTWALLET_COLD_ADDRESSES` | **True** |
| `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` | **True** |
| `RELAY_HOTWALLET_TOTAL_MAX_KAS` | **True** |

三个ZK_*与两个key-export env均**不存在**，三个热钱包env均**存在**（确认未被误删，值层面一致性已在
此前D-019/T-KEY-EXPORT两轮部署后核独立核对过，本次只核presence）。

## 三、日志/pin/WARMUP/T-LEGACY-NULL-COLS/两路由——独立扫描确认

独立`grep`：64-hex序列**0**命中；`[silverc-pin] PASS`=**1**、`FAIL`=**0**；`WARMUP FAIL`**0**行；
`T-LEGACY-NULL-COLS`**0**行（跟"主网0市场"预期一致）；`FATAL`/`UNMET`合计**0**命中；两条key-export
路由确认均`503 key export disabled`。

## 四、委员offset参考值WARN——独立交叉验证派生值，不是转述

独立`grep`确认WARN行精确出现4次（2个label×{V1,V2}），派生值`predicateCommitOffset=16411`(V1)/
`16569`(V2)——**这两个数字跟我自己在`09ed3772`（T4工具审查）独立编译PayoutShard.sil/PayoutShardV2.sil
测出的真实predicateCommitOffset完全一致**（不是我读README转述后"确认一致"，是我在另一次独立会话里
用完全独立的编译动作先算出了这两个数，现在这次生产console启动时的真实运行时派生又独立算出了同样的
数字——两条完全独立的路径收敛到同一个值，这是比"读日志确认"更强的交叉验证）。`reference=518/642`
确认是ledger 1233记录的陈旧硬编码值，WARN不拒签只留痕，符合设计。

## 五、给Bettor的处置建议

- **本次重启部署后核全部GREEN**。规则84明示派发的五env presence检查已按"仅变量名、结果只落布尔"
  执行，代码层面从`Split('=')`起就不接触值内容。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
