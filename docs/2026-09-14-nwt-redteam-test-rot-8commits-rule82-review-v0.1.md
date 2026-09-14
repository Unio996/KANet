# NWT 红队复核 · `coord/kanetui-test-rot` 8笔（rule 82 + discovery-loop隔离 + 3个断言修正）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1265/1274：逐笔审白名单精确路径、rule 82①②默认激活不可静默关闭、探测确为裸socket零字节、
> discovery循环单文件隔离+非零退出、KANET_TEST_CASES_DIR默认不变、三处断言修正是对齐合法代码变更
> 而非放宽。

## 结论：**8笔全部GREEN，独立复现每一项测试+每一条关键代码路径，merge-tree对当前主线零冲突。**

## 一、770957af/acc2b5bb（两个fixture修复）

独立读diff+独立对照`migrate.js`真实schema定义：`kaspa_tx_log`补的`closeTxid:0`行、
`pool_bettor_sides`补的`id INTEGER PRIMARY KEY AUTOINCREMENT`列，均逐字匹配生产真实结构，只加
fixture数据/补齐既有陈旧的手搓schema缺列，未touch任何被测生产代码（`bshard-auto-settler.mjs`/
`pool-bettor-sides-query.mjs`）一行——独立核对`bshard-auto-settler.mjs:438`附近代码确认
`verifyRedeemMatchesChainObservedOutput`的`outpointTxid=closeTxid/outpointIdx=0`调用方式与commit
message描述一致，`migrate.js:4059-4071`确认`pool_bettor_sides`真实首列即`id INTEGER PRIMARY KEY
AUTOINCREMENT`。是修fixture，不是放宽断言。

## 二、9c340504（lint白名单精确路径）

独立读diff确认`TEST_RUNNER_ENTRY_WHITELIST = new Set(['kasia-console/scripts/test.mjs'])`只加了
一个精确字符串，`isTestContextPath`用`.has(relPosix)`（Set精确匹配，非模式/前缀匹配），独立核对
调用方`rel = path.relative(ROOT, abs).split(path.sep).join('/')`确认传入格式与白名单项格式一致。
独立在正确worktree（含此笔）跑`node scripts/lint-kanet.mjs kasia-console/scripts/test.mjs`：
**0 errors**（此前在未含此笔的主线上跑同一文件仍是4处命中，两次对照证实白名单真的生效、且只影响
这一个文件）。

## 三、dbb4ffe1（rule 82①：`--case=`尊重skip_in_batch/skip_in_cron）

独立读代码确认`allowManualOnly = args.includes('--allow-manual-only')`——**唯一**判定来源是显式CLI
参数，全文件grep确认无任何`process.env.*`读取路径能影响这个变量，不存在"环境变量静默关闭保护"的
后门。`skipGateActive = !allowManualOnly`与原`isBatch`变量完全解耦（`isBatch`保留原语义用于其它既有
用途不变）。`willRunCases`/主循环判据统一用`skipGateActive && (skip_in_batch || skip_in_cron)`同一条
表达式（未各写一份互相漂移的重复判据）。

## 四、beb9f3c9（rule 82②：console-url探测+LOUD）

独立跑通新增13/13测试（四场景：空端口零摩擦/非显式监听拒绝exit(1)/显式监听非real_chain中等LOUD/
显式监听含real_chain最高级LOUD但仍不拦截）。独立写了一个不使用任何mock、直接调用真实
`checkConsoleUrlListening`（只覆盖`exit`/`consoleUrl`/`explicit`三个DI点，**探测函数本身用真实
实现**）的验证脚本，起一个真实`net.createServer`统计接收字节数：**独立确认服务端收到0字节**，
不是只信测试自己注入的mock server断言。核对(a)(b)两点均已落地：显式URL不再无条件放行，而是按
real_chain分级LOUD；探测机制确认是裸`net.connect`+`destroy`，不发任何HTTP字节。

## 五、67beb09e（discovery循环错误隔离——最高价值的一笔）

独立复现了这个bug在修复前的真实规模：`predictions`域现有82个测试文件，触发自我保护式`throw`的
`p1_refund_authorization_gate.test.mjs`排在字母序第69个（index 68），**它之后还有13个文件**——
独立读该文件源码确认这个`throw`是真实的、设计意图内的自我保护（"生产结构变了就拒绝放行"，不是意外
bug），独立核对确认它在**修复后**的discovery循环里被正确捕获、报告文件名+错误文本，且不影响它
之后的13个文件继续被discover/执行。独立跑`--domain=predictions`：进程正确以退出码**1**结束（不是
旧行为的exit(2)，也不是被误读成"全部PASS"的0）；日志正确列出`IMPORT FAILED`+文件全路径+错误文本。
独立跑新增永久回归`discovery-loop-resilience.test.mjs`（子进程隔离，用`KANET_TEST_CASES_DIR`指向
临时fixture，不碰真实cases树）：**1/1 PASS**。`KANET_TEST_CASES_DIR`未设时的默认路径分支未改动
（三元表达式，未设=原`FRAMEWORK_ROOT/cases`路径不变）。

## 六、65d9be13/a85ba992（两处断言修正）

均独立核对"生产代码本身没变，只是断言指错了变量名/语法边界"这条关键判断：
- `LITELLM_EXE`→`PROXY_SCRIPT`：独立grep确认`scripts/llm-watchdog.mjs`全文件`process.env.LITELLM_EXE`
  零命中（只在头部注释提过这个历史名字），`process.env.PROXY_SCRIPT`真实存在且在`spawnProxy()`里
  被`spawn('node', [PROXY_SCRIPT], ...)`使用——确认是合法重构后断言没跟上，不是放宽标准（换的是变量
  名，不是删检查）。
- `5000\)`→`5000[,)]`：独立核对`relay-manager.js:491`真实调用`sendCommandAsync(relayNodeId,
  {type:'get_rpc_state'}, 5000, 'legacy-unmigrated')`——5000本身一直都在，只是T-J2-2026-05-12合法
  加了第4个溯源参数导致正则锚点失配。新正则仍要求"5000"紧跟在options对象闭括号后面（不接受
  50000这类误配），只放宽了"5000后面是逗号还是右括号"这一无关语法边界。

两处均独立跑通对应测试文件全PASS（llm-health 8/8，ws-proxy-hijack-detection 6/6）。

## 七、全branch汇总核对

- 独立lint全部8个改动/新增文件（`test.mjs`/`env-bootstrap.mjs`/`env-bootstrap-console-url.test.mjs`/
  `discovery-loop-resilience.test.mjs`/`thread-walk.test.mjs`/`windir-infer.test.mjs`/
  `llm-health.test.mjs`/`ws-proxy-hijack-detection.test.mjs`）：**0 errors**。
- 独立`git merge-tree`对当前主线（分叉点`b6330ad6`）：**零冲突标记**，可直接合并。

## 八、给Bettor的处置建议

- **8笔全部GREEN，可以`--no-ff`合并，不需要重启console**（纯测试框架/lint改动，不涉运行时）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
