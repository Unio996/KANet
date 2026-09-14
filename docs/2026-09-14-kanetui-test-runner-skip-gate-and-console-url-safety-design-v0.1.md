# 测试跑批安全闸设计 v0.1（2026-09-14 · KANet-UI · Bettor 1233/1238-补/1242 派工 · 只写方案不落码）

> **Status: DRAFT**。背景：本人 2026-09-14 主线测试基线扫描时，写了个遍历脚本用 `--case=<file>` 逐个跑 `test-framework/cases/**/*.test.mjs`，跑到 `RC_01_buy_kas_real_full.test.mjs`（`skip_in_batch:true`/`tags:['real_chain']`，真钱预算 ~0.85 USDT+~0.0003 KAS gas，manual only）时才发现 `--case=` 完全不受 `skip_in_batch` 保护，立即 `TaskStop` 中止。事后核实（本人+Bettor 各自独立核）确认无真实广播（本地隔离 worktree 未起 console，`fetch failed`）——**这次是有惊无险，不是"反正没事"**：脚本设计本身有洞，遇到一个 console 真的在监听的环境（哪怕不是故意的）就会出事。本页只设计两处修法，不落码——代码落 `coord/kanetui-test-rot`（Bettor 1233 指定分支），NWT 审。

## 0. 两个独立缺陷，两条独立修法

Bettor 1233/1238-补/1242 三条消息合起来点了两件不同的事，本页分别设计：

1. **`scripts/test.mjs` 的 `isBatch` 语义**——`skip_in_batch` 保护只在 `--domain=`/`--all`/`--tag=` 路径生效，`--case=<file>` 路径完全不受保护，即便命中的 case 明确标了 `skip_in_batch:true`/`tags:['real_chain']`。
2. **测试口与生产口可能同源**——`test-framework/lib/env-bootstrap.mjs` 从"跑测节点自己的 `kanet.env` `PORT`"派生 `KANET_CONSOLE_URL`（未显式设时）；若某个跑测节点的 `kanet.env` `PORT` 恰好是一个**真正在跑的生产/共享 console** 的端口（本仓多个 console 实例共存是常态——TN12/主网/各 agent 节点），测试会**真的**打过去，不是 "fetch failed" 就完事。

两条互相独立：修①不解决②（即便 `--case=` 被正确拦下 real_chain case，普通 case 仍可能因为端口撞车打到生产口）；修②不解决①（即便端口分离做对了，`--case=` 显式点名一个 `skip_in_batch` case 时仍然应该有一层"你确定要这样做"的确认，不是端口对了就万事大吉）。

## 1. 修法①：`--case=` 必须尊重 `skip_in_batch`/`skip_in_cron`，除非显式旗标覆盖

### 1.1 当前代码（`scripts/test.mjs:118`，已读代码核实，非猜测）

```js
// J1 phase 7a-1 polish (NWT 7c66dd00 finding): --adversarial 显式 override skip_in_batch
// (用户明确要跑 adversarial, 不是 cron batch 默认 — adversarial 自身 manual-only 设计是为了 cron 不污染).
const isBatch = !caseFile && adversarial === null;
...
if (isBatch && testCase.skip_in_batch) {
  if (!quietFlag) console.log(`SKIP (manual-only): ${testCase.id}`);
  totalSkipped++;
  continue;
}
```
`isBatch` 字面意思是"这是不是一次批量跑"，但它被同时用来回答一个不同的问题——"这次调用要不要尊重 `skip_in_batch` 这条安全标记"。`caseFile`（`--case=`）存在时 `isBatch` 直接为 `false`，**两个问题被同一个变量捆在一起，捆错了**：`--case=` 确实"不是批量"，但这不代表"点名单个 case 就天然安全可以跳过保护"——事故正是这么发生的：脚本用 `--case=` 循环点名了 192 个文件，每一个都被当成"单独点名，安全"，包括 `RC_01`。

另一处已知缺口（读代码时一并发现，非本次事故触发，一并记录）：`skip_in_cron`（另一个既有标记）在这段代码里**从未被读取**——`grep -n skip_in_cron scripts/test.mjs` 零命中，只有 `skip_in_batch` 生效。`RC_01_buy_kas_real_full.test.mjs` 同时标了 `skip_in_cron: true`/`skip_in_batch: true` 两个——目前只有后者在起作用，前者是装饰性的，从未被任何代码路径读过。

### 1.2 设计（不落码，供 NWT 审）

把"是否尊重 `skip_in_batch`/`skip_in_cron`"从"怎么选出 case 列表"（`--case`/`--domain`/`--all`/`--tag`）这件事上**解耦**，改成默认永远尊重，只有一个新增的显式旗标能豁免：

```js
// 新增旗标：显式承认"我知道这个 case 标了 skip_in_batch/skip_in_cron，我就是要跑它"。
// 不叫 --force（太泛，容易被顺手加在别的地方）；叫 --allow-manual-only，动词化、说清楚在豁免什么。
const allowManualOnly = args.includes('--allow-manual-only');

// isBatch 改名/拆分：保留原变量名给"是不是批量选择"这个原意（如果别处还用得到），
// 新增一个专门管保护的变量，不共用同一个布尔值。
const isBatch = !caseFile && adversarial === null;  // 原意不变，如果代码其它地方还依赖这个语义
const skipGateActive = !allowManualOnly;             // 新：默认永远激活，只有显式旗标能关

...

for (const testCase of casesToRun) {
  if (tag && !(testCase.tags || []).includes(tag)) continue;
  // 改动点：isBatch → skipGateActive；同时读 skip_in_batch 和 skip_in_cron 两个标记，不再只读一个
  if (skipGateActive && (testCase.skip_in_batch || testCase.skip_in_cron)) {
    if (!quietFlag) console.log(`SKIP (manual-only, pass --allow-manual-only to run): ${testCase.id}`);
    totalSkipped++;
    continue;
  }
  ...
}
```

**`--adversarial` 的既有豁免路径不受影响**——那是一条完全不同的 case 来源（`loadAdversarialCases()` 产出的 probe DSL 对象，不是文件系统里带 `skip_in_batch` 字段的 `.test.mjs`），本设计不改动它，`adversarial === null` 判断继续只影响 `isBatch` 原变量，不影响新的 `skipGateActive`。

**`--allow-manual-only` 本身不应该允许被"顺手常驻"**——建议同时要求：若传了这个旗标，运行前额外打印一行 LOUD 提示（"你正在绕过 manual-only 保护，即将真实运行 N 个标了 skip_in_batch/skip_in_cron 的用例，其中 M 个带 `real_chain` tag"），把 `real_chain` 数量单独点出来，因为那是真花钱的子集，不是所有 `skip_in_batch` 用例都花钱（有些只是"跑起来慢/依赖外部状态不适合 cron"这类理由）。

### 1.3 遍历式脚本（本人这次犯错用的那类脚本）额外要求

不止 `test.mjs` 本身要改，**任何以后要写的"逐文件遍历跑测"脚本**（本人这次的 `_kanetui_test_sweep.mjs` 是反面教材）都必须：
1. 先静态读每个 case 文件的 `default export` 的 `skip_in_batch`/`skip_in_cron`/`tags` 字段（`import()` 一次即可拿到，不需要额外解析），过滤掉命中的文件，**不依赖 `test.mjs` 自己的保护**（哪怕 `test.mjs` 修好了，遍历脚本自己也应该有一层独立判断，纵深防御，不是"反正 runner 会挡"）。
2. 对被过滤掉的文件打印清单（不是静默跳过），供人核对"这次遍历漏了哪些、为什么"。

## 2. 修法②：测试用 console URL 与生产口结构性分离

### 2.1 当前代码（`env-bootstrap.mjs`，已读代码核实）

```js
function deriveConsolePort() {
  if (process.env.PORT) return String(process.env.PORT).trim();
  // ... 读【仓根 kanet.env 的 PORT】...
  return '3300';
}
const port = deriveConsolePort();
if (!process.env.PORT) process.env.PORT = port;
if (!process.env.KANET_CONSOLE_URL) process.env.KANET_CONSOLE_URL = `http://127.0.0.1:${port}`;
```

设计原意（模块头注）是"测试节点无关：:3200 跑打 :3200，:3300 跑打 :3300"——**隐含假设是"这个端口上此刻真的跑着一个供这次测试用的 console"**，没有校验这个假设，也没有校验"这个端口上跑的东西是不是生产/共享实例"。本人这次的失误是反过来的（worktree 没有 `kanet.env`，落到硬编码 `3300` 默认值）——但 Bettor 1238-补 指出的是更根本的风险：**主检出的 `kanet.env` `PORT=3200`，如果直接在主检出（不是隔离 worktree）跑遍历测试，会派生到 `3200` 这个共享检出的默认约定端口**——历史上这个端口曾经/可能被某个真实运行的实例占用，届时测试会真的打过去，不是 "fetch failed" 收场。

### 2.2 设计（两条 Bettor 都提过的思路，本页给出组合方案，供 NWT 审）

单独用"拒绝解析到正在监听的口"或单独用"强制显式 `KANET_CONSOLE_URL`"各有代价：
- 只做"检测端口是否在监听"：有 TOCTOU 窗口（检测时没监听，脚本跑起来后期才有别的东西起了那个端口）——不是完美防线，但能挡住"当下就在跑"这个最常见的形状（本次差点出事的场景正是"派生到的端口那一刻恰好在监听"）。
- 只做"强制显式 `KANET_CONSOLE_URL`"：最彻底，但会破坏 `env-bootstrap.mjs` 当年（r738/r739）解决的那个真实问题——"24 个 dm-agent case + runner.mjs 硬编码了两个不同的默认端口，跨节点跑测试的人必须每次手动传 `KANET_CONSOLE_URL`，容易忘"，直接走回那条老路。

**组合方案**：
1. `deriveConsolePort()` 派生出候选端口后，**先探测这个端口当前是否有服务在监听**（本地 `net.connect` 探活，超时判无，~200ms 量级，不需要外部依赖）。
2. **无人监听** → 沿用现有派生逻辑（`process.env.PORT = port`，测试自己会/该去启动一个 console 绑定这个端口，或者这次跑测本来就不需要真实 HTTP，派生了也用不上）——**这是绝大多数场景**（隔离 worktree 没有活 console），维持零改动的既有体验。
3. **有人监听** → **不再沉默接受这个派生值**，改为要求显式确认：
   - 若 `KANET_CONSOLE_URL` 已被调用方显式设置（`process.env.KANET_CONSOLE_URL` 在 `deriveConsolePort()` 跑之前就有值）——沿用（这是调用方明确知道自己要打哪，不受本条约束，本来就该放行）。
   - 若没有显式设置、但检测到端口有人监听——**LOUD 报错并退出**（`throw`/`process.exit(1)`），错误信息里写清楚："检测到 127.0.0.1:<port> 当前有服务在监听，本次派生来自 <来源 kanet.env 路径>/默认值，无法确认这是不是一个安全的测试专用实例——如果确实是你自己起的测试 console，显式传 `KANET_CONSOLE_URL=http://127.0.0.1:<port>` 再跑一次；如果不确定，先用 `Get-NetTCPConnection`/`lsof` 核实这个端口上跑的是什么。"
4. 这个探测+拒绝逻辑必须在 `runner.mjs`/任何 case 文件 import 之前完成（同现有模块头注"必须在 runner.mjs import 之前 import"这条既有约束一致，不新增新的时序要求）。

**为什么不干脆永远要求显式 `KANET_CONSOLE_URL`**：本方案的核心判断是——"派生到一个空端口"本身零风险（顶多是这次测试打不通，得到诚实的 `fetch failed`，不会误伤任何东西）；"派生到一个有人监听的端口"才是真正的风险点，且这种情况远比"完全没有 `kanet.env`"少见——只在这一种情况上加摩擦（要求显式确认），比在所有情况上都加摩擦（每次都要手动传）更精确，不会重新制造 r738/r739 那个"容易忘、经常被跨节点场景绊倒"的旧问题。

### 2.3 测试范围

- 空端口场景（当前多数隔离 worktree 的常态）：确认行为不变，不引入新摩擦。
- 端口有人监听 + 未显式设 `KANET_CONSOLE_URL`：确认 LOUD 拒绝，不静默派生。
- 端口有人监听 + 已显式设 `KANET_CONSOLE_URL`（且与监听端口一致或不一致均可）：确认沿用显式值，不被新逻辑拦截（显式设置永远是调用方自己的判断，不该被这条防御性检查覆盖）。
- 用一个临时 `net.createServer().listen(<随机高位端口>)` 做"当前有人监听"的可控 fixture，不依赖真实 console/依赖注入。

## 3. 与本次事故的直接对应关系（供 NWT 审时核对覆盖面）

| 本次事故的具体缺口 | 本页哪条设计覆盖 |
|---|---|
| `--case=` 遍历绕过 `skip_in_batch` | §1.2 |
| `skip_in_cron` 从未被任何代码读取 | §1.2（新逻辑同时读两个字段） |
| 遍历脚本本身没有独立过滤 | §1.3 |
| 主检出 `kanet.env PORT=3200` 若真被占用会被测试打中 | §2.2 |

## 4. 不在本页范围内的事（如实标注，避免过度承诺）

- 不重新设计 `skip_in_batch`/`skip_in_cron`/`tags` 这三个字段本身的语义/命名（现状可用，本页只管"怎么被读取/尊重"，不管"该不该存在这三个不同的字段"这个更大的问题）。
- 不处理"`--adversarial` 的 case 来源要不要也做端口安全检查"——`loadAdversarialCases()` 走的是 probe DSL，不一定碰 HTTP，本页假设它跟 §2 描述的 `env-bootstrap.mjs` 路径无关，若审的时候发现有交集需要另开一段。
- 落码本身不在本页——按 Bettor 1233 指定，代码落 `coord/kanetui-test-rot`（已有的那个侧分支，之前两笔 fixture 修复也在那），NWT 审两处改动后再落。
