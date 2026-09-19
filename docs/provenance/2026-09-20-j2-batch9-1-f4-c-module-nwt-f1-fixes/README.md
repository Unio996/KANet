> **Status**: CURRENT（2026-09-20，J2；9-1 **F4 笔**：NWT 对 F1 笔审（`34e6ae42`）的 F1-1 / F1-2（含 f22）+ 对 F2 笔审（`4beec485`）的 F2-1；基线 = 本分支 F3 `9c2f4dc2`）

# 9-1 F4 笔：C 模块的第二轮 NWT 修正 + B6 扫描器修正

## 逐条落实
| NWT 项 | 改动 | 守它的测试 |
|---|---|---|
| **F1-1** `ipcTimeoutMs` 只被校验、没交给被调方（声明 ≠ 实际） | `requestFacts(address, payload, { timeoutMs: ipcTimeoutMs })`——把**校验过的**数交给被调方；真实 wrapper 必须用它作 IPC 超时（9-2b 验收：wrapper 发出的超时 == 收到的 `timeoutMs`） | F1-1：4 个步骤 × 3 个不同的声明值（15000 / 20000 / 17123），**每个**形态 O 与形态 L 请求收到的第三参都 `== {timeoutMs: 声明值}` |
| **F1-2** `timers` 在生产签名里可注入（一个永不触发的 `setTimeout` 让每步总预算失效） | `verifyStepInputsOnChain(opts)` **生产入口固定用全局定时器，带 `timers` 键（任何值）即 TypeError**；注入只存在于**仅测试用**的 `verifyStepInputsOnChainWithTimers(opts, timers)`（缺 `setTimeout` / `clearTimeout` ⇒ TypeError）；核心逻辑在未导出的 `verifyCore(opts, timers)` | F1-2（生产入口拒 5 种 `timers` 值，含"永不触发"版与 `undefined` 键，且先于任何请求）、**F1-2 / NWT f22**（测试专用入口拒缺 `clearTimeout` / 缺 `setTimeout` / 非对象 / null / undefined / 非函数，并证明注入的定时器真被用到）、F1-2 源码扫描（非测试源码不得引用该标识符） |
| **F2-1** B6 扫描有 D26-scan v1 同类漏洞（`skipDir` 含 `data` 按目录名任意深度跳过——`kasia-console/src/data` 是运行时源码；扫描根不含 `kasia-console/scripts` 与根 `scripts`；扩展名只认 mjs/js/cjs） | **抽共享扫描器** `kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs`（D26-scan v2 思路）：①排除**只按仓库根相对路径前缀**（`docs/ scratch/ logs/ artifacts/ test/ tests/ .git/`、`kasia-console/{test-fixtures,test-framework,test,data,logs}/`），`node_modules` 任意深度跳过（依赖，对）；②扫**整个仓库**源码树；③扩展名 `mjs\|js\|cjs\|ts\|mts\|cts\|jsx\|tsx`；④`minFiles` 下限（默认 500）防扫描根失效成空判据；⑤动态拼接写进头注为**已知边界**。B6（夹具文件）与 F1-2 扫描都改用它 | 扫描器**自测**（6 项，临时树造真实文件、带对照臂）+ 真实树健全检查；本笔的探针回归与变异（下） |

## 测试与变异（`test-outputs/`、`mutation-f4-raw-part{1,2}.txt`、`mutation-f4-scan-raw.txt`；仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
| 文件 | 结果 |
|---|---|
| `proto-settlement-c1.test.mjs` | **45/0**（原 41，新增 4：F1-1、F1-2 ×3；F1-2 扫描改用共享扫描器；既有 C4 / C-5 用例改走测试专用入口） |
| `scan-non-test-sources.test.mjs`（新） | **6/0** |
| `proto-claim-draw.test.mjs`（B6 改用共享扫描器，−17 行内联扫描代码） | 57/0 |
| chain-checks 51/0、pointers 26/0 | 全绿（未动） |
lint：7 个文件 0 errors。
- **c1 变异 90 个全部至少一条 FAIL，0 存活，0 锚点失配**（`mutate-f4.mjs` = F1 笔的 80 个旧变异全部保留，仅 M-22 的锚点因 `requestFacts` 多了第三参而更新 + F4 新增 10 个 `G-xx`；分两批各自还原并核 sha256）：第三参缺失 / 值取成 `budgetMs` / 写死 15000 / 键名错；**生产入口不再拒 `timers`**；**生产入口既不拒又采用注入的 timers**（组合，见下）；**测试专用入口不校验 `clearTimeout`（NWT f22）** / 不校验 `setTimeout` / 完全不校验 / 忽略注入。
- **探针回归 + 扫描器变异 18 项全红**（`mutate-f4-scan.mjs`）：**A 部分 8 个真实探针文件**——在真实仓库树里种引用违规标识符的文件（`kasia-console/src/data/`、`kasia-console/scripts/`、根 `scripts/*.mts`、`packages/*.tsx`、`require` 形态、以及 3 个引用仅测试用入口的），跑对应测试**全部变红**（这正是 NWT 探针里曾经全绿的那几种），探针跑完即删且核对已删；**B 部分 10 个扫描器自身变异**（按目录名任意深度跳 data / 跳 scripts / 扩展名只认 mjs / 不去注释 / 不排除 .test / node_modules 只在根跳 / minFiles 失效 / exceptRel 失效 / 前缀改"任意位置包含" / 排除清单缺 docs）**全红**；还原后 sha256 一致。
- **第一轮有 1 个存活（G-06：生产入口"采用注入的 timers"）**——它单改一处不可达：生产入口有**两层**保护（拒 `timers` 键 + 固定使用全局定时器），单破一层另一层仍挡住。我把 G-06 改成**两层同时失效**的组合变异（脚本新增"多锚点变异"支持）并整套重跑，全红；旧输出改名留存 `mutation-f4-raw-round1-part{1,2}.txt`。"只破第二层"是等价变异，没写进脚本（写进去只会制造一个已知必存活的噪声）。
- "全被抓"只覆盖我选的这些变异与探针。

## 超出 NWT 原文的取舍（请 NWT 审时判）
1. **F1-2 选了 NWT 给的方案①**（测试专用内部导出，生产入口固定用全局定时器），而不是方案②（保留 + 9-2b 源码扫描）：更强，且已有源码扫描守着测试专用入口不被生产代码引用。
2. **生产入口对 `timers` 键的拒绝用 `hasOwnProperty`**：`{timers: undefined}` 也拒——键存在本身就是"想注入"的信号。
3. **共享扫描器放 `kasia-console/test-fixtures/source-scan/`**（与既有 `test-fixtures/proto-close-commit`、`proto-mass` 同处，扫描器自己把该目录排除在被扫描范围之外）；扫描器**扫整个仓库**而不是白名单根（比 NWT 建议的"加两个根"更宽）——代价是扫描文件数变多（约几千个，单次数百毫秒），且 `docs/` 等证据目录按根前缀排除（否则变异脚本里的字符串字面量会误报）。
4. **`minFiles` 默认 500**（`kasia-console/src` 单目录就 515 个）：防扫描根失效成空判据；调用方可覆盖。

## 记入 9-2b 清单的（NWT / Bettor 已提，本笔不做）
真实 wrapper 的 IPC 超时 == 收到的 `timeoutMs` 验收；`unrecognized_error` 报警带 `err.name` / 消息前缀；意图终态清分级器该 key；大写 txid（NWT 判不另开票）：接线边界统一 `toLowerCase` 一处 +「DB 大写 txid ⇒ 规范化通过或大声失败、不静默错花」测试；c1 / chain-checks 测试里多余的临时 DB bootstrap 清理。
