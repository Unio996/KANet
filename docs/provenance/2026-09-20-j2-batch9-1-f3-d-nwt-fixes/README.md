> **Status**: CURRENT（2026-09-20，J2；9-1 **F3 笔**：NWT 对 D 笔审（`7afd66c1`）的 D-1 / D-2；基线 = 本分支 F2 `34bd831a`）

# 9-1 F3 笔：D 笔的 NWT 修正（D-1 wasm 释放、D-2 import 图脱离 DB 客户端）

## D-2：NWT 的修法解决不了问题——我做了真修法（请特别审这一条）
NWT D-2 的诊断成立（`import` 指针模块即打开默认库，被 M0a 拒），修法建议是"把 `deriveWinnerBet` 移到不 import DB 客户端的新文件"。**我先在改动前实测了导入图**（`import-graph-BEFORE-on-34bd831a.txt`，无 `DB_PATH` 下逐个真 import）：只搬 `deriveWinnerBet` **解决不了**——`proto-tx-assembly.mjs → proto-leaf-state.mjs → db/client.js` 这条链同样把 tx-assembly、chain-checks、C1、指针模块全拖进默认库（tx-assembly 只为 leaf-state 里的一个纯函数 `encodeLeafStateBytes` 而 import 它）。所以本笔做两件事：
1. **`proto-winner-bet.mjs`（新，不 import 任何东西）**：`deriveWinnerBet` 的本体（**db 必填、无默认库**）。指针模块直接从这里取；`proto-settlement-inputs.mjs` **保持原导出 `deriveWinnerBet(marketId,{db=sqlite,who})`** 并委托给它（既有调用方 / 测试不变），`deriveCloseCommitInputs` 也调同一份——close_commit 与 claim_draw 仍是**同一份**判定。
2. **`proto-leaf-state-encode.mjs`（新，纯函数）**：把 `encodeLeafStateBytes` 从 `proto-leaf-state.mjs` 拆出；leaf-state 仍 `re-export` 它（既有 import 方不变，测试断言两处是同一个函数）；`proto-tx-assembly.mjs` 改从新文件取。顺带**消除了 tx-assembly ↔ leaf-state 的循环 import**。
**结果**（`import-graph-AFTER.txt`，同一条命令）：tx-assembly、tx-assembly-settlement、chain-checks、**C1、指针模块**、winner-bet、leaf-state-encode 在**无 `DB_PATH`** 下都能真 import；仍受 M0a 拒绝的只剩本就带 DB 的 `proto-leaf-state.mjs` 与 `proto-settlement-inputs.mjs`。**测试**用子进程真 import 来证明（不是只扫本文件的 import 行）并带**对照臂**（带 DB 客户端的两个模块在同样条件下必被拒，证明探测手段有效）。
🟡 **代价与边界**：`proto-leaf-state.mjs` 少了一个函数本体（+3/−11，改为 import + re-export）；`proto-tx-assembly.mjs` 改一行 import。既有 c1 / chain-checks 测试文件里"起临时 DB 只为过 import 链"的 bootstrap 现在不再必要，**本笔没删**（不扩大范围，留给以后清理）。

## D-1：wasm 对象释放
- 测试包一层 `kaspa.Transaction` 与 `kaspa.TransactionOutput` 并计数：**成功路径四步**（装载 1/2/3/5 笔）`Transaction` 创建数 == 释放数；genesis 独立重算用的 `TransactionOutput` **显式 `free()`**（源码改动：造一个探针对象，`finally` 里释放，而不是每次 `new` 了就丢给 GC）；**错误路径**同样释放——`finalize()` 抛错、id 不符（篡改）、谱系断开、covenant 不一致、输出缺失、票不一致（此前已装载的交易全部释放）。

## 测试与变异（`test-outputs/`、`mutation-f3-raw-part{1,2}.txt`；仅把本机临时目录前缀替换为 `%TEMP%`，D-021）
| 文件 | 结果 |
|---|---|
| `proto-settlement-pointers.test.mjs` | **26/0**（原 23，新增 3：D-1 ×2、D-2 ×1；模块边界的导入清单改为 `proto-winner-bet.mjs`） |
| `proto-settlement-inputs.test.mjs` | **23/0**（原 21，新增 2：winner-bet 纯函数 db 必填与委托一致、who 透传） |
| leaf-state 33/0、broadcast-ops 16/0、claim-draw 57/0、settlement 43/0、golden 12/0、c1 41/0、chain-checks 51/0 | 全绿（消费被改文件的所有既有套件；**golden 12/0 说明 tx-assembly 字节不变**） |
lint：9 个文件 0 errors。
- **变异 56 个全部至少一条 FAIL，0 存活，0 锚点失配**（`mutate-f3.mjs`，由 D 笔的 `mutate-d.mjs` 演化：`deriveWinnerBet` 本体搬走后，相关旧变异改目标为 `proto-winner-bet.mjs`、`deriveCloseCommitInputs` 的调用点锚点更新；分 `--part=1/2`，每批各自还原五个目标文件并核 sha256）。F3 新增 12 个：Transaction 从不 free / TransactionOutput 从不 free / 只在成功路径 free / free 两次 / **指针模块又经 inputs 取 `deriveWinnerBet`** / **指针模块直接 import DB 客户端** / **tx-assembly 又从 leaf-state 取纯函数** / leaf-state 不再 re-export / winner-bet 的 db 不再必填 / inputs 的委托丢默认库 / 不透传 who / 默认前缀被改。D 笔的 M-35（`deriveCloseCommitInputs` 不再调共享函数而自己重写必红）**继续有效**。
- **第一轮有 1 个存活（F-09：winner-bet 的 db 必填守卫拆掉）**：拆掉后 `db.prepare` 的自然 `TypeError` 仍满足"instanceof TypeError"——测试没区分报文。我把断言收紧为"报文须是本函数的 `db 必填`"，整套重跑；旧输出改名留存 `mutation-f3-raw-round1-part1.txt`。
- "全被抓"只覆盖我选的 56 个变异。

## 超出 NWT 原文的取舍（请 NWT 审时判）
1. **D-2 的修法范围**：比 NWT 建议多拆了 `encodeLeafStateBytes`（理由见上，有改动前后实测）。若 NWT 认为只搬 `deriveWinnerBet` 就够，请指出——我实测它不够。
2. `proto-settlement-inputs.mjs` 里 `deriveWinnerBet` 变成一个带默认库的薄委托（保持原导出与全部既有调用方）；`who` 参数原样透传。
3. `deriveWinnerBet` 纯函数版对缺 db 抛 `TypeError`（"db 必填"）——原先默认库的行为只在 inputs 层保留。
4. 既有 c1 / chain-checks 测试的 DB bootstrap 现已多余，本笔不删（留待清理）。

## 记入 9-2b 清单的（NWT 已提，本笔不做）
D-3：`pointer_covenant_inconsistent` 三种语义靠 `.detail` 区分，9-2b 报警别按 code 分处理或给 `.kind`。
