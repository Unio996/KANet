> **Status**: CURRENT（2026-09-20，J2；**F5 笔**：NWT F4-1——共享扫描器的 `stripComments` 换成 D26-scan v2.1 的状态机版；基线 = 主线 `f027f947`，独立分支 `coord/j2-batch9-f5-scan-strip-comments-v0`）

# F5：共享扫描器的 `stripComments` 换成状态机版

## 问题（NWT F4-1，真实探针证实）
共享扫描器 `kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs` 的 `stripComments` 是简单正则版，在三种形态会**漏报真实引用**（吞掉真代码是不安全的方向；对 F1-2 的 `verifyStepInputsOnChainWithTimers` 守卫同样成立）：① 同行前有含 `//` 的字符串（`'a//b'; 真调用`）；② 一个字符串里含块注释起始符、另一个字符串里含块注释结束符（两者之间的真调用被当成块注释）；③ 模板字面量含 `//`。

## 改了什么
- 把 KANet-UI **D26-scan v2.1** 的状态机版 `stripComments`（`f72b0cdb`，NWT 三审 `16899661` §四 N-4；识别字符串 / 模板字面量 / 正则字面量，含类内 `[ ]` 与转义处理，除法不是正则）**原样**移进共享扫描器：用脚本从该提交**程序化提取**函数体（不手打，避免转录错误），除头注外逐字相同。导出名不变（`stripComments`），`findReferencesInNonTestSources` 调用点不变。
- **只改这一个文件 + 它的自测**（`scan-non-test-sources.mjs` +37/−2，自测 +55）。生产代码零改动。

## 自测（`scan-non-test-sources.test.mjs`：6 → 9 项）
- **F5 ▲ 三种形态对照探针**：**对照臂 `oldStrip` 就是旧的简单正则实现**——断言它对三种形态都**漏掉**真调用（证明探针是真的会漏的形态），而状态机版保留；真注释里的同名仍被去掉。
- **v2.1 向量**：正则字面量里的块注释起始符不吞后面的真调用（字符类 / 转义斜杠 / `/[/]/` / 转义 `//` 对 / `return` 之后）、除法不是正则（其后两个注释仍是注释）、转义字符、模板 `${}` 表达式保持可见；另补 4 条（多行模板含 `//` 与 `/*`、字符串里的转义引号、**正则字符类里的 `//` 后接 `*`**、**代码态的转义斜杠对 `if (x) /a\//.test(s)`）。
- **真实文件探针**：三种形态各放一个文件，走 `findReferencesInNonTestSources` 全链路，状态机版全部发现，同一批文件旧实现会漏。

## 变异对照（`mutation-f5-raw.txt`，脚本 `mutate-f5.mjs`；F4 笔的探针回归 + 扫描器变异原样重跑存为 `mutation-f4-scan-rerun-raw.txt`）
- **10 个状态机变异全部至少一条 FAIL**：整个退回旧正则、不识别字符串、模板按单行、不识别正则字面量、除法当成正则、字符类不处理、字符串态不处理转义、块注释不识别、行注释不识别、代码态转义不处理；还原后 sha256 一致。
- **第一轮有 2 个存活（R-6 字符类不处理、R-10 代码态转义不处理）**——现有向量下这两条路径不可达（例如 `/[/*]+/` 里类内的 `/` 提前结束正则后，`*` 并不与任何 `/` 拼成注释起始符）。我补了能触发它们的向量（`/[//*]/`、`if (x) /a\//.test(s)`）并整套重跑；旧输出改名留存 `mutation-f5-raw-round1.txt`。
- **F4 的 18 项（8 个真实探针文件 + 10 个扫描器变异）原样重跑全红**：换了 `stripComments` 之后 B6 / F1-2 的扫描回归没有退化。
- "全被抓"只覆盖我选的这些变异与探针。

## 关于"D26-scan 与共享扫描器都从这一处导入"（请 Bettor / KANet-UI 判）
**D26-scan 不在主线**：v2.1 的 `stripComments` 目前只存在于 KANet-UI 的未合入分支（`origin/coord/kanetui-boot-autostart-and-memory-alert-design`，`kasia-console/src/lib/broadcaster-utxo.test.mjs`），我改不了那个分支。本笔提供**单一来源**（共享扫描器的 `stripComments` 与 v2.1 逐字相同）；D26-scan 合入时应把它本地那份 `stripComments` 删掉、改为
`import { stripComments } from '../../test-fixtures/source-scan/scan-non-test-sources.mjs';`（路径自 `kasia-console/src/lib/` 起）。此前"两处各留一份"的风险仍在，直到那次合入。
**另一处主线内的旧版副本**：`kasia-relay/src/lib/utxo-facts.test.mjs:73` 有一份**简单正则版** `stripComments`（9-0 的 S1 源码扫描用它），与本笔修掉的是同一类弱点。我**没动它**（不在 F5 范围、且会让 relay 测试依赖 console 的 test-fixtures 目录）；建议后续要么让它 import 共享扫描器，要么把扫描器提到两个包都能引用的位置——请裁。

## 不在本笔
握手自动接受开关（Bettor 排在 F5 之后）、9-2 设计细化。
