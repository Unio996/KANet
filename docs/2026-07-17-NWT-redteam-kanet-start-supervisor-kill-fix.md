# NWT 红队 — kanet-start.sh 误杀 console-supervisor 修复设计(2026-07-17)

> **Status**: CURRENT
> **对象**: `docs/2026-07-17-kanet-start-supervisor-kill-fix-design.md`(5781d7a9, KANet-UI)
> **verdict**: **✅ GREEN — 可落码, 排下个重启窗跟 H2 一起装**

## Bettor 点名两点逐条打

### 点①(a)跳过判断的匹配精度——不宽不窄, 现场核实过, 不是纸面判断

`[ "$name" = "console-supervisor" ]` 是精确字符串相等匹配, 不是子串/前缀/通配。担心"太宽误跳过别的该杀进程"或"太窄没真跳到"这两个方向都实测查了:

- **是否太窄(还有其它独立生命周期进程也写进同一个 `logs/pids/` 却没被这次修法覆盖)**: grep 了 `kaspad-watchdog.ps1`/`tn12-mining-watchdog.ps1` 有没有往 `logs/pids/` 写自己的 pidfile——**没有**, 这两个 watchdog 是 PowerShell 管的进程, 不走这套共享 pidfile 目录约定, 天然不受 `kanet-start.sh` 这条 kill 循环影响, 不是这个 bug 的第二个受害者。另外扫到 `scripts/lan-ip-health.mjs` 也碰 `logs/pids/`, 查了一下**不是同类问题**——它只是读写既有的 `kaspa-ws-proxy.pid`(那个本来就归 `kanet-start.sh` 管, 属于"该被这套流程管理"的服务), 不是又一个"独立生命周期但被误杀"的孤儿。**当前代码库里 `console-supervisor` 确实是这一类问题唯一的实例, 这次修法范围没有漏掉兄弟案例。**
- **是否太宽(会不会误伤真正该杀的进程)**: 精确相等匹配, 当前代码库里只有 `kanet-console-supervisor.sh:25` 一处硬编码这个文件名, 没有第二个进程会产生同名 pidfile, 不存在"精确匹配也伤到不该伤的"的场景。

### 点②(隐含在 Bettor 消息里, 之前的家族关联)——设计稿正确划定了"不做什么"边界, 且跟今天早些时候的另一处修复互补而非重叠

设计稿明确"不改 `kanet-boot-sequence.ps1` 步骤⑤"。这个判断在**今天**是站得住的——步骤⑤本身依赖的 `Start-Watched` 调用(`bash.exe -lc "...console-supervisor.sh start"`)今天已经被另一条独立的红队线(`4e9bd39f`+`b84f5ebd`, 我自己审的那条 ArgumentList 数组转单字符串+围栏)修过, 那条修复解决的是"boot-sequence.ps1 派发命令能不能真正送达 bash"这一层, **跟本设计修的"kanet-start.sh 会不会误杀已经在跑的 supervisor"是两个不同层面的问题, 不是同一个坑的两次报账**——一个管"开机路径能不能正确起它", 一个管"手动重启路径会不会误杀它", 两条路径互补, 合起来才是完整闭环。这两条我今天都亲自审过, 确认没有重叠/矛盾。

## 真对抗: 逐段实读代码, 非信设计稿转述

**核实 `continue` 位置真的会跳过 `rm -f "$pidfile"`**: 设计稿贴的代码片段用 `...` 省略了循环体后半段, 我去读了 `kanet-start.sh` 现有源码(第 54-64 行)确认原始循环结构是 `pid=$(cat)` → `if kill -0; then ...; fi` → `rm -f "$pidfile"`(`rm` 在 `if` 块外, 每次迭代无条件执行)。按 bash `continue` 语义(跳到 for 循环下一次迭代, 跳过当前迭代里 `continue` 之后的所有语句), 修法把 `continue` 放在 `name` 判断之后、`pid=$(cat)` 之前, **确实会连 `rm -f "$pidfile"` 一起跳过**——不会出现"进程没被杀但 pidfile 被删掉"这种更隐蔽的坏状态(那种状态会让 supervisor 自己的 `start` 存活检查读不到 pidfile、误判"没在跑"、意外拉起第二个实例, 是比"直接杀掉"更难查的坑, 这次修法没有踩进去)。

**核实 (b) 的幂等性声明属实**: 读了 `kanet-console-supervisor.sh:111-120`(`start` 子命令), 第 113 行 `if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then echo "already running"...` 逐字对得上设计稿的引用, 不是编的。

## 非阻塞观察

如果将来 `kanet-console-supervisor.sh` 自身代码有更新, 这次修法生效后, 单纯跑一次 `kanet-start.sh` **不会**让运行中的旧 supervisor 进程换成新代码(它现在只在"死了"的情况下才会被 (b) 的 `start` 拉起新实例; 活着就直接判定"already running"跳过)。**这不是修法引入的退化**(修之前的行为——误杀+从不重启——同样没有"顺带刷新代码"这个属性, 只是巧合地表现为"杀了之后靠别人手动救活时可能用了新代码"), 但值得在部署文档里提一句: 以后更新 `kanet-console-supervisor.sh` 本体代码, 需要显式跑一次 `kanet-console-supervisor.sh restart`(如果有这个子命令)或手动杀掉旧进程, 不能指望常规的 `kanet-start.sh` 重启顺带换代码。不阻塞本次落码。

## Verdict

**GREEN, 可落码, 排下个重启窗跟 H2 一起装。** 两个红队重点(匹配精度/跟 boot-sequence 那条修复的关系)都实测/实读代码验证过, 没有找到反例。修法本身(a)+(b)组合逻辑自洽, 双保险的两层是真的覆盖不同故障模式(治本 vs 兜底), 不是重复劳动。

— NWT 2026-07-17
