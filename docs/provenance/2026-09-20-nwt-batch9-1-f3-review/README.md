> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-batch9-1-code-v0` 的 F3 笔 `9c2f4dc2`，父 F2 `34bd831a`；J2 README `docs/provenance/2026-09-20-j2-batch9-1-f3-d-nwt-fixes/README.md`）

# 批 9-1 F3 笔审（D 笔的 NWT 修正：D-1 wasm 释放、D-2 import 图脱离 DB 客户端）—— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`9c2f4dc2`，独立 `npm ci`）读全部源码 diff；亲跑九套回归；**自己重做 D-2 的导入图测量**（在 F2 与 F3 上各跑一遍，不引用作者的 BEFORE/AFTER 表）；做 **10 个我自己的变异**。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN，无 MUST；1 条 SHOULD + 1 条观察。且我承认：J2 的 D-2 修法比我建议的对——我的原建议不够。**

| 类 | 编号 | 内容 |
|---|---|---|
| SHOULD | **F3-1** | **重算探针在"出错分支"的释放没有测试守着**：我的变异 i9（把 `probe.free()` 从 `finally` 挪进 `try` 内、只在 `covenantId` 成功后释放）**三套测试全绿**。生产行为上：`kaspa.covenantId(...)` 抛错时 `probe` 泄漏一个 `TransactionOutput`。J2 的 D-1 错误路径向量覆盖了 `Transaction` 对象在 `finalize()` 抛错 / id 不符 / 谱系断开等情形下的释放，但**没有让 `kaspa.covenantId` 本身抛错**。补一条：用包装过的 `kaspa` 注入一个会抛的 `covenantId`，断言 `TransactionOutput` 创建数 == 释放数（同时该路径仍应产生 `pointer_covenant_inconsistent`，因为 `genesisId = null`）。 |
| 观察 | — | D-1 的计数只包了 `kaspa.Transaction` 与 `kaspa.TransactionOutput` 两个**构造器**。`loadProducedTx` 里还有由 getter 隐式返回的 wasm 包装对象（`tx.inputs` / `tx.outputs` 数组元素、`i.previousOutpoint`、`o.covenant`、`o.scriptPublicKey` 各次访问）——它们不是 `new` 出来的，计数看不到，也没有被显式 `free()`，靠 wasm-bindgen 的 FinalizationRegistry 回收。这不是本笔引入的、也不属 D-1 原要求（我当时要的正是 `tx.free()` 有测试、`TransactionOutput` 显式释放）；我**没有测**这些隐式包装在长驻进程里的实际累积量，所以只记为观察，供 9-2b 接线后在 console 里盯 `wasmBytes`。 |

## 一、Bettor / J2 让我特别审的四点
1. **拆法是否接受（D-2）——接受，且我独立实测确认我的原建议不够**。我在**无 `DB_PATH`**、每个模块**各自一个新子进程**里做真 `import`（同一条命令在 F2 与 F3 上各跑一遍，`outputs.txt` §1）：
   - **F2（`34bd831a`）**：7 个模块**全部被拒**——`proto-tx-assembly`、`proto-tx-assembly-settlement`、`proto-settlement-chain-checks`、`proto-settlement-c1`、`proto-settlement-pointers`、`proto-leaf-state`、`proto-settlement-inputs`。也就是说**光把 `deriveWinnerBet` 搬走确实解决不了**：`proto-tx-assembly.mjs → proto-leaf-state.mjs → db/client.js` 这条链本身就把 tx-assembly、chain-checks、C1、指针模块全拖进默认库。我 D 笔审只看了指针模块自己的 import，**漏了这条传递边**。
   - **F3（`9c2f4dc2`）**：`proto-tx-assembly`、`proto-tx-assembly-settlement`、`proto-settlement-chain-checks`、`proto-settlement-c1`、`proto-settlement-pointers`、`proto-winner-bet`、`proto-leaf-state-encode` **都能 import**；仍被拒的**只有**本就带 DB 的 `proto-leaf-state` 与 `proto-settlement-inputs`（同一个 M0a 拒绝，作为对照臂，说明探测手段本身有效）。
   拆出的两个新文件（`proto-winner-bet.mjs` 不 import 任何东西、`db` 必填；`proto-leaf-state-encode.mjs` 纯函数）我都读了：内容与原实现逐行等价（`deriveWinnerBet` 本体一字未改，仅加 `db` 必填守卫；`encodeLeafStateBytes` 原样搬走），并**顺带消除了 tx-assembly ↔ leaf-state 的循环 import**。
2. **tx-assembly 字节不变**：`proto-tx-assembly-settlement-golden` **12/0**、`proto-tx-assembly-settlement` **43/0**（我亲跑）；`proto-tx-assembly.mjs` 只改一行 import 路径。
3. **re-export 是否让既有 import 方零改动**：**是**。全仓非测试代码里 `encodeLeafStateBytes` 只有两处引用（`proto-tx-assembly.mjs`、`proto-leaf-state.mjs` 自己）；`proto-leaf-state.mjs` 仍 `export { encodeLeafStateBytes }`（`:13-14`）。我的变异 i4（去掉这句 re-export）**被两套测试抓红**（pointers 与 leaf-state），说明既有导入方的兼容性有测试钉住；`deriveWinnerBet` 在 `proto-settlement-inputs.mjs` 保持原导出与原签名 `(marketId, { db = sqlite, who })`，委托给纯版本，`who` 透传——变异 i5 / i6（默认前缀被去掉、委托丢 `who`）**被抓红**。
4. **BEFORE 表转录自改动前那次运行（当时没存文件）算不算证据**：**不需要它当证据**。我在 F2 上**重新跑了同一条命令的等价物**（§1，7/7 被拒），与 J2 的 BEFORE 转录一致；所以这张表的结论已被我的独立复测取代。建议 J2 不必再补文件，但在 README 里把"转录自当时输出、未另存"这句保留（已保留）。

## 二、亲跑与变异
- 亲跑（独立检出）：`proto-settlement-pointers` **26/0**、`proto-settlement-inputs` **23/0**、`proto-leaf-state` **33/0**、`proto-broadcast-ops` **16/0**、`proto-claim-draw` **57/0**、`proto-tx-assembly-settlement` **43/0**、`golden` **12/0**、`proto-settlement-c1` **41/0**、`chain-checks` **51/0**——与 J2、Bettor 自报逐项一致。
- **我的 10 个变异**（`nwt-mutate-f3.cjs`；每个跑 pointers + inputs + leaf-state；还原后 sha256 一致、`git status` 空）：**9 被抓，1 存活**——
  - D-2 各条边：指针模块又经 inputs 取 `deriveWinnerBet`（i1）、tx-assembly 又从 leaf-state 取纯函数（i2）、winner-bet 引入 DB 客户端（i3）、leaf-state 不再 re-export（i4）**全红**；
  - `who` 默认前缀被去掉（i5）、inputs 委托丢 `who`（i6）**全红**；
  - D-1：探针 `TransactionOutput` 从不释放（i7）、`Transaction` 从不释放（i8）、`Transaction` 释放两次（i10）**全红**；
  - **i9（探针只在成功路径释放）存活** = **F3-1**。
- J2 自报第一轮存活 F-09（`winner-bet` 的 `db` 必填守卫拆掉后自然 `TypeError` 仍满足 `instanceof`）：处置对（收紧成"报文须是本函数的 `db 必填`"），与我 C / F2 审里看到的"被后面的检查兜住"是同类。

## 三、J2 的 4 条取舍
1. D-2 修法范围比我建议的更大（多拆 `encodeLeafStateBytes`）——**接受，且必须**（§一-1）。
2. `proto-settlement-inputs.mjs` 里 `deriveWinnerBet` 变成带默认库的薄委托——**接受**。
3. 纯函数版对缺 `db` 抛 `TypeError`——**接受**（默认库属于 inputs 那一层）。
4. 既有 c1 / chain-checks 测试里"起临时 DB 只为过 import 链"的 bootstrap 现已多余、本笔不删——**接受**；建议 9-2b 之前清一次，否则这些测试会继续对 M0a 拒绝路径做无谓依赖。

## 没做 / 未证
- 没测 getter 隐式包装对象的累积（见观察）；没在 console 长驻进程里量 wasm 内存。
- 没审 F4；没起 simnet。
