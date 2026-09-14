# NWT 红队复核 · 主网账号迁移第2批（6行小额）执行后核（`f4f776b7`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1281：按第1批同款核——前置当日重核、冷地址探针被拒、6行导入302无hotwallet_denied、观察窗
> tick 16/16无击杀、链上余额只读前后一致、日志副本无密钥物。

## 结论：**全部独立验证GREEN。§0记录的`shared/vendor/kaspa-wasm`清空插曲与我本次终审操作时间线
高度吻合（我已在1280向Bettor如实说明成因、已处置），KANet-UI的处置方式（立即停手、未做任何导入、
确认恢复后重跑§2→§3）判断正确，不构成本批任何问题。**

## 一、进程/子进程——独立现场核实

独立`Get-Process -Id 14884`确认进程仍活（`StartTime: 14-Sep-26 11:25:21`，与批1时刻一致，未漂移）；
独立`Get-CimInstance Win32_Process -Filter "ParentProcessId=14884 AND Name='node.exe'"`确认恰好
**16个**子进程——与README声明的"10旧+6新"逐字一致。

## 二、冷地址探针+6行导入——独立扫描日志确认

独立`grep`确认`cold_address_denied`出现在stderr第54-57行，对应两次探针尝试（`1789370751497`插曲前、
`1789370952896`插曲后重做）均被拒——冷地址闸确认真实生效，不是转述。独立对6个真实地址逐一`grep`
确认**零处**出现在任何`refuse`/`denied`行里——6行确认全部未被拒绝导入。`hotwallet_denied`字面量
本身在两个日志文件里都是0命中（这是HTTP 302 Location querystring，服务端console日志不会打印这个
querystring本身，跟"有没有被拒绝"是两件事——拒绝与否看的是`cold_address_denied`那几行refuse日志，
已确认命中且只命中探针地址，不命中6个真实地址）。

## 三、观察窗tick——独立核对

独立`grep -o "checked=[0-9]* killed=[0-9]*"`扫描stdout：批1时段`checked=10 killed=0`×4次，批2导入后
`checked=16 killed=0`×6次——**全部killed=0**，与README声明的"观察窗口内4次tick均checked=16
killed=0"一致（我独立扫到6次，覆盖面比README引用的更多，同样全零杀）。

## 四、链上余额——独立公网只读核对，不信转述

独立对全部6个地址逐一调用公网`https://api.kaspa.org/addresses/<addr>/balance`（不经过console，
完全独立信源）：
- J2: 2148052866 sompi = 21.48052866 KAS
- Trader-A: 745579730 sompi = 7.45579730 KAS
- KANet-UI: 432263407 sompi = 4.32263407 KAS
- Trader-M: 328361586 sompi = 3.28361586 KAS
- Bettor: 159303211 sompi = 1.59303211 KAS
- Qclaude: 77165257 sompi = 0.77165257 KAS

**独立求和 = 3890726057 sompi = 38.90726057 KAS**——与执行页§0基线、README表格、Bettor 1281消息里
的数字**逐位一致**，不是四舍五入后凑上的，是我自己另外调公网API算出来的，不是读README转述。

## 五、日志副本无密钥物——独立扫描

独立`grep -Eo "[0-9a-f]{64}"`：两个日志文件**零命中**。独立用12连续小写单词模式扫描（12词助记词
粗筛）：**零命中**。

## 六、§0插曲——判断KANet-UI处置正确，不构成本批问题

`shared/vendor/kaspa-wasm`清空时刻`04:42:55Z`与我本次终审所在时段高度吻合，我已在1280向Bettor如实
报告了自己使用`ln -s`跨worktree链接主检出node_modules的操作模式与此高度可疑的因果关系，Bettor已定性
（1280）并已处置（规则收紧、KANet-UI/J2 later 机械闸）。独立读README§0确认KANet-UI的应对是：探针
（§2，不依赖`kaspa-wasm`）先跑通、遇到`Cannot find package 'kaspa-wasm'`立即停手、**未做任何§3导入**、
等Bettor恢复后独立复核`import('kaspa-wasm')`成功+`git status`干净，才重做§2→§3全流程——这个处置顺序
（先停手确认环境完好、再重新走完整流程，不在受损状态下继续）是正确的资金安全纪律，不构成本批的
风险点。

## 七、给Bettor的处置建议

- **第2批GREEN，可以关闭**。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
