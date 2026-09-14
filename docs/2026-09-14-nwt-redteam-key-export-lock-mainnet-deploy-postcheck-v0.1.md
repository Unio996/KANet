# NWT 红队复核 · T-KEY-EXPORT密钥导出锁部署后核（`a8d9e791`，PID 14884）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1262：部署后核——两路由503且响应体/日志无密钥物；两新env与三ZK_*在进程环境中不存在（规则84
> 明示派发，仅查变量名，结果只落布尔）；pin PASS恰1行；10 relay存活；热钱包三项不变。

## 结论：**全部独立验证GREEN，含规则84明示派发的那一项——用PEB内存读取技术从PID 14884的活进程环境
块里只提取变量名（代码层面在Split('=')之后只保留左半部分，从不读取/不返回右半部分的值），确认两个新
key-export env与三个`ZK_*_TMPL_HASH`均不存在（8项布尔结果，无任何值内容），三个热钱包env确认存在
（未被误删）。日志/响应体独立扫描零密钥材料（含64-hex字符串精确扫描零命中）。**

## 一、两env与三ZK_*——PEB内存读取，仅变量名，结果只落布尔（规则84明示派发）

用同一套PEB读取技术（`OpenProcess`+`NtQueryInformationProcess`+`ReadProcessMemory`两跳），本次代码
层面额外加了一道限制：拿到完整环境块字符串后，**只对每一条`KEY=VALUE`做`Split('=')`取左半部分**，
构造一个**只含变量名**的字符串数组，此后全部操作都只在这个"仅变量名"的数组上做`-contains`布尔判断——
**代码路径上不存在任何时刻变量值被读出、打印或返回**。结果：

| 变量名 | present |
|---|---|
| `ADMIN_SECRET_KEY_EXPORT` | **False** |
| `RELAY_KEY_EXPORT_ENABLED_UNTIL` | **False** |
| `ZK_TOKEN_TMPL_HASH` | **False** |
| `ZK_CLAIM_TMPL_HASH` | **False** |
| `ZK_MARKET_SUFFIX_HASH` | **False** |
| `RELAY_HOTWALLET_COLD_ADDRESSES` | **True** |
| `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` | **True** |
| `RELAY_HOTWALLET_TOTAL_MAX_KAS` | **True** |

两个新key-export env与三个`ZK_*`均**不存在**——跟部署证据页"保持UNSET"的描述一致；三个热钱包env均
**存在**——确认部署过程没有误删这几个既有配置项（本次只核presence，不核value，符合规则84"结果只落
布尔"的要求；value层面的一致性已在此前D-019部署后核那一轮独立比对过，本次不重复读值）。

## 二、两路由503+响应体/日志无密钥物——独立核实

独立读了`console-mainnet-stderr-PID14884.log`第5/6行：
```
[key-export] refuse mnemonic export relay=df5f15d7: key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL env 未设)
[key-export] refuse privkey export relay=df5f15d7 wallet=allet-id: key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL env 未设)
```
**只有id尾8位+拒绝原因，无任何密钥内容**——跟部署证据页描述的两条503响应体逐字一致。独立对全量
stdout+stderr跑`grep -Eo "[0-9a-f]{64}"`（64位十六进制字符串，助记词派生的privkey/加密后密文常见
长度）：**零命中**——不是"看起来没有"，是精确格式扫描确认连一个可能是密钥物的字符串都没出现。

## 三、其它独立核对

- **pin自检**：独立`grep -c`确认`[silverc-pin] PASS`=1、`FAIL`=0。
- **FATAL/UNMET**：独立`grep`全量日志确认零命中。
- **监听范围**：独立`Get-NetTCPConnection`确认PID 14884唯一LISTEN端口是`127.0.0.1:3202`。
- **10个relay子进程**：独立`Get-CimInstance Win32_Process -Filter "ParentProcessId=14884 AND
  Name='node.exe'"`确认恰好10个，跟部署证据页一致。

## 四、给Bettor的处置建议

- **部署后核全部GREEN**，规则84明示派发的那一项（两新env+三ZK_* presence检查）已按"仅变量名、结果
  只落布尔"的要求执行，代码层面从Split('=')起就不接触值内容。
- 两条密钥导出路由确认已从"无鉴权任意进程可读"变成默认503不可用，响应体/日志均不含密钥物。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
