> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-batch9-1-code-v0` 的 F4 笔 `fa72891e`，父 F3 `9c2f4dc2`；J2 README `docs/provenance/2026-09-20-j2-batch9-1-f4-c-module-nwt-f1-fixes/README.md`；9-1 最后一笔）

# 批 9-1 F4 笔审（F1-1 / F1-2 落地 + 共享源码扫描器）—— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`fa72891e`，独立 `npm ci`）读 C 模块 diff 与共享扫描器全文；亲跑五套测试与扫描器自测；做 **8 个我自己的 C 模块变异**；用**真实探针文件**（走真实目录遍历，跑完即删、`git status` 空）重测扫描器——包括我 F2 审里全绿的几种，以及我为这次新想的"过度剥离"几种。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN，无 MUST；1 条 SHOULD（扫描器的注释剥离会漏报，而握手 V9 与 9-2b 的 E-3 都将依赖这个扫描器）。**

F1-1、F1-2 都按我建议的方向落地且守得住；F2-1 我上次抓到的三种全绿（`src/data/`、`kasia-console/scripts/`、根 `scripts/*.mts`）现在**全红**。剩下的是扫描器自己的一个同类问题——它的 `stripComments` 是简单正则版，会**过度剥离**。

| 类 | 编号 | 内容 |
|---|---|---|
| SHOULD（强建议） | **F4-1** | **共享扫描器的 `stripComments` 会把真实引用当注释剥掉（漏报）**。它的实现是 `src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"`])\/\/.*$/gm,'$1')`：不识别字符串 / 模板 / 正则。**真实探针文件实测**（`outputs.txt` §2；每个探针都是一行**真实的违规 import**）：<br>• 同一行前面有个含 `//` 的普通字符串：`const p = "a//b"; import { … } from '../lib/proto-chain-parents-fixtures.mjs';` ⇒ **B6 绿（漏）**<br>• 字符串里含 `/*`、行尾有含 `*/` 的字符串：`const s = "/*"; import { … } …; const t = "*/";` ⇒ **绿（漏）**<br>• 模板字面量里含 `//`：``const u = `x//y`; import { … } …`` ⇒ **绿（漏）**<br>• 对照：正则字面量里的 `\/\/`、以及 F2 时的三种（`src/data`、`kasia-console/scripts`、根 `.mts`）**红**。<br>同样的形态对 F1-2 的"`verifyStepInputsOnChainWithTimers` 不得被生产代码引用"守卫也成立（`src/services/` 下直接引用 ⇒ 红、`src/data/` 下 ⇒ 红，但"前面有含 `//` 的字符串"那种 ⇒ **绿**，c1 45/0 不变）。这正是我在 D26-scan v1 抓到、v2.1 已经修掉的那一类问题（识别字符串 / 正则 / 模板的状态机版 `stripComments`，我用 E1 / E2 / E5 / E8–E11 十一种探针验证过）——**现在仓库里有两份 `stripComments`、两种失效面**。为什么现在要紧：这个扫描器不再只守两个"仅测试用"模块——**握手开关设计 v0.3 的 V9（`acceptHandshake` 的调用点钉住）与 9-2b 验收 E-3（chainParents 只能来自 C1 结果）都点名要复用它**，而它们是钱路 / 安全相关的钉住测试。**修法**：把 D26-scan v2.1 里那份状态机版 `stripComments` 移进共享扫描器模块（`test-fixtures/source-scan/`），D26-scan 测试与共享扫描器**都从这一处导入**（单一实现）；在扫描器自测里加三条对照探针（含引号 / 模板 / `/*` 的三种形态）。这不影响本笔"无生产调用方"的现状，所以是 SHOULD。 |

## 一、F1-1 / F1-2 / F2-1 逐项
| 项 | 判 | 依据 |
|---|---|---|
| **F1-1** `ipcTimeoutMs` 交给被调方 | ✅ | `requestFacts(address, payload, { timeoutMs: ipcTimeoutMs })`（`.then(() => …)` 处一行）。变异 k1（丢第三参）、k2（值取 `budgetMs`）、k3（写死 15000）**全红**——J2 的测试用 4 个步骤 × 3 个不同声明值（15000 / 20000 / 17123）逐个检查形态 O 与形态 L 请求收到的第三参，写死或取错都过不了。9-2b 那条"真实 wrapper 发出的超时 == 收到的 `timeoutMs`"仍要在接线时验。 |
| **F1-2** 生产入口不得注入 `timers` | ✅ | 我选的方案①落地：`verifyStepInputsOnChain(opts)` 用 `hasOwnProperty` 拒任何 `timers` 键（含 `{timers: undefined}`），核心逻辑在**未导出**的 `verifyCore(opts, timers)`，生产入口传死全局定时器；注入只存在于仅测试用的 `verifyStepInputsOnChainWithTimers(opts, timers)`（缺 `setTimeout` / `clearTimeout` ⇒ TypeError）。**即使 `opts` 是继承了 `timers` 的原型对象**，`verifyCore` 的解构也不取它，所以继承路径同样无效。变异：拆掉键检查（k4）、只拒"有值的 timers"漏 `{timers: undefined}`（k5）、测试入口不校验 `clearTimeout`（k6 = 我的 f22）、清除定时器改用全局 `clearTimeout` 而不是注入的（k8）**全红**。k7（生产入口改成"有 `opts.timers` 就采用"、但键检查还在）**存活 = 等价变异**：两层保护，单破第二层不可达（与 J2 的 G-06 同一判断；两层同时失效的组合他们已写进脚本且红）。 |
| **F2-1** 扫描器修法 | ✅（+ F4-1） | 共享扫描器：排除**只按仓库根相对路径前缀**、`node_modules` 任意深度跳过、扫**整个仓库**源码树（1234 个文件、9 ms）、扩展名 `mjs|js|cjs|ts|mts|cts|jsx|tsx`、`minFiles` 下限、动态拼接头注为已知边界、自带对照臂自测 **6/0**（我直接跑）。**我 F2 审的四种全绿现在全红**：`kasia-console/src/data/`（B）、`kasia-console/scripts/`（C）、根 `scripts/*.mts`（D）、`src/services/` 的 import（A 控制臂）——探针跑完即删，`git status` 空。剩余见 F4-1。 |

## 二、亲跑与变异
- 亲跑（独立检出）：`proto-settlement-c1` **45/0**、`proto-claim-draw` **57/0**、`chain-checks` **51/0**、`pointers` **26/0**、扫描器自测 **6/0**——与 J2、Bettor 自报一致。
- **我的 8 个 C 模块变异**（`nwt-mutate-f4.cjs`；每个跑 c1 测试；还原后 sha256 一致）：**7 被抓，1 存活（k7，等价，见上）**。
- J2 自报第一轮存活 G-06（"采用注入的 timers"单破第二层不可达）：处置对（改成两层同时失效的组合变异、旧输出改名留存）。
- 扫描器 J2 自带 18 项（8 个真实探针 + 10 个扫描器自身变异）我没有重跑，抽验了上面的探针。

## 三、J2 的 4 条取舍
1. F1-2 选了我给的方案①——**接受**（更强，且有源码扫描守着测试入口不被生产引用；扫描器的漏报见 F4-1）。
2. 拒 `timers` 用 `hasOwnProperty`——**接受**（键存在本身就是"想注入"）。
3. 共享扫描器放 `test-fixtures/source-scan/`、扫描整个仓库——**接受**；扫描器把自己的目录排除在被扫范围之外，`docs/` 等证据目录按根前缀排除（否则变异脚本里的字符串会误报）。
4. `minFiles` 默认 500——**接受**（`kasia-console/src` 单目录 515 个）。

## 没做 / 未证
- 没审握手 v0.3 §7 与 D-028 v0.2（排在后面）；没起 simnet。
- 扫描器的"动态拼接模块名 / 经变量的 `import()`"是文本扫描固有边界，头注已写明，我不要求堵。
