# NWT 红队复核 · 合并四线主网重启部署后核（PID 18320→29872）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1313：六个env在进程环境中不存在（三ZK_*、两key-export、ADMIN_SECRET_SYSTEM_ACTIONS）、
> 热钱包三项不变、只查变量名，规则84明示派发。

## 结论：**全部独立验证GREEN。**

## 一、进程/relay——独立现场核实

独立`Get-Process -Id 29872`确认存活（`StartTime: 14-Sep-26 15:43:18`）；独立`Get-CimInstance`确认
`ParentProcessId=29872`的`node.exe`恰好**17**个。

## 二、两条system-actions路由——独立现场curl，不只信日志

独立直接`curl -X POST`打`http://127.0.0.1:3202/api/system/run`与`/api/system/download`（带
`actionId`合法body，排除因400而不是503造成的误判）：**两条均实测503**——不是只信README转述，是这次
自己现场发的请求。

## 三、六env presence——PEB内存读取，仅变量名，结果只落布尔（规则84明示派发）

同款PEB两跳读取技术，代码层面只在`Split('=')`后保留变量名，全程不接触值内容。结果：

| 变量名 | present |
|---|---|
| `ZK_TOKEN_TMPL_HASH` | **False** |
| `ZK_CLAIM_TMPL_HASH` | **False** |
| `ZK_MARKET_SUFFIX_HASH` | **False** |
| `ADMIN_SECRET_KEY_EXPORT` | **False** |
| `RELAY_KEY_EXPORT_ENABLED_UNTIL` | **False** |
| `ADMIN_SECRET_SYSTEM_ACTIONS` | **False** |
| `RELAY_HOTWALLET_COLD_ADDRESSES` | **True** |
| `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` | **True** |
| `RELAY_HOTWALLET_TOTAL_MAX_KAS` | **True** |

六个目标env全部**不存在**，三个热钱包env全部**存在**（确认未被误删）。

## 四、日志/pin/WARMUP/参考值WARN/T-LEGACY-NULL-COLS——独立扫描确认

独立`grep`：64-hex序列**0**命中；`[silverc-pin] PASS`=**1**、`FAIL`=**0**；`WARMUP FAIL`**0**行；
`[committee-offset-derive] WARN`**0**行（跟上次偏移线重启的4行相反，独立确认T-REF-OFFSETS-REFRESH
真的生效，不是巧合性未触发——这次预期本身就是"0行才对"，跟上次的判据方向相反，已核对没有套错上次的
预期）；`T-LEGACY-NULL-COLS`**0**行；`FATAL`/`UNMET`合计**0**命中；两条密钥导出路由日志确认仍是
`refuse ... key export disabled`。

## 五、给Bettor的处置建议

- **本次重启部署后核全部GREEN**。规则84明示派发的六env presence检查已按"仅变量名、结果只落布尔"
  执行。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
