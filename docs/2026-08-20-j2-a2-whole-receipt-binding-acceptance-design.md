# A2-whole：receipt→state 授权路 的**验收判据**（预注册 · 报备层 · 零生产码）

> **Status**: CURRENT

**作者** J2 · **日期** 2026-08-20 · **派工** Bettor 13:19（v1.1 派工）+ 13:24 裁「现在出」
**上游** Codex v1.0 verdict：`checkSigFromStack` **原语** runtime CLOSED **≠** 整条 A2 CLOSED；列 5 项仍开
**绑定 spec 出处** `2026-08-20-s6-3-fair-exchange-adjudication-design-v01.md` §14 A/B + §15（**本文不重定义绑定，只定怎么验它**）

---

## §0 这份文档是什么 / 不是什么

**是**：Codex ①-④ 的**验收判据**，写在被测物**存在之前**。
**不是**：covenant 设计（§15 已冻结）、不是实现、**零生产码**。

🔴 **为什么判据必须先写**（今天的实账，不是原则宣示）：
同一天的 `checkSigFromStack` E2E 出过一张 **8 PASS / 0 FAIL / 0 不可归因** 的单子，表面四条判据全中。
挡下它的是**我自己在看到结果之前预注册的判据③**——当时才发现承重的拒因原文被日志截断、且从未落盘。
**若判据是看到数据之后再定的，我有充分空间挑一个让结论好看的定义。**

---

## §1 🔴 被测物**还不存在** —— 这决定了任务形状

`grep -rl checkSigFromStack --include=*.sil` 全仓命中 **4 个**：
`CheckSigFromStackProbe.sil`（我的探针）+ silverscript 自带 3 个 example。**生产合约 0 个。**

- `CloseZkV2.sil` 只做「**已 baked → 无签字放行**」，**不验 attestation**；
- `PayoutShardV2.sil` 的 `close_attest` 用的是 `checkSig`（**花费授权**），**不是** `checkSigFromStack`（**验外部 receipt**）。

⇒ Codex ①-④ 全是「真 covenant 上」的要求，而**那个 covenant 尚未被写**。
⇒ **①-④ = 待建 + 待测**，不是"待测"。**谁写它 = 生产钱路实现 = Owner 闸**（Bettor 13:24 裁，未派）。

🔵 本文档因此是**先于实现的合同**：实现方照它交付，验收方照它验，双方都不能事后改判据。

---

## §2 ①-④ 落成可机械判的谓词

| Codex 项 | §15 对应环 | 测试形态 | 通过判据（预注册） |
|---|---|---|---|
| ① receipt 字节绑定 | §15-1 验 attestation 对 **receipt digest** | witness 篡改 | receipt 任一绑定字段改一位 ⇒ **REJECT** |
| ② threshold + 委员根验 | §15-1 `validSigs>=threshold` + **对 baked 根的 merkle 成员证明** | witness 篡改 **+ 合约变异** | 签名不足 / 重复签名 / 非委员签名 ⇒ REJECT；**且见 §3 变异族** |
| ③ receipt→唯一后继 | §15-2/3 `successor_commit` + `tx.outputs[]` introspection | witness 篡改 | 改 state / 改 value 分配 / 加 output / 减 output / witness 喂非派生 state ⇒ **每条 REJECT** |
| ④ 篡改各字段负测 | §15 绑定字段全集 | witness 篡改 | `{network, version, session, policy, outcome, evidence_commit, committee_epoch, replay}` **逐字段各一格** ⇒ REJECT |

🔵 **正例同样要有，且不承担判别力**：合法 receipt + 正确后继 ⇒ PASS。
**它证明不了闸存在**（always-true 的坏 codegen 同样给出这一格）；它的作用是**让同窗的 REJECT 可归因**。

---

## §3 🔴 两族负例 —— 而今天那张卡**只覆盖了一族**

这是本文档最要紧的一节。

### 族 A：**witness 篡改**（runtime negatives）
改的是**花费时提交的数据**：签名、digest、字段、后继 output。
✅ 今天的 `checkSigFromStack` E2E 覆盖的正是这一族，方法可直接搬。

### 族 B：**合约变异**（build-time negatives）—— 今天**零覆盖**
改的是**合约源码本身**，重编、重算 P2SH、重跑。

🔴 **必测的第一格（§6-3 line 83 已钉）**：
> **删掉 merkle 成员证明段、只留 `require(blake2b(pkConcat)==committeePkHash)` 那句 ⇒ 测试必须挂。**

**为什么这一格非有不可**：那句 require 是**已知的诱饵** ——
它只保证「witness 里的 5 个 pk 与 witness 里的 committeePkHash 自洽」，**什么都不绑**。
真正的委员授权是**下方对 `poolMerkleRoot`（ctor 烤值）的 5 组 merkle 成员证明**。

⇒ **删掉真绑定，诱饵还在，而合约看起来仍然"在验委员"** ——
若测试全绿，任何一次 refactor 都能让合约**静默失守**（任意 witness 委员都过）。

🔨 判据：**一个自洽的 require 看着像绑定；真绑定删了它还在，且测试可能全绿。**
⇒ **族 B 的存在意义就是回答「删掉承重那段，有没有任何一格会红」。**

### 族 B 的其余必测格（每格 = 删/改一处承重，重编，跑全套）
- 删 `require(validSigs>=threshold)`（阈值退化成 1 签）
- 把 merkle 根从 **ctor-baked** 改成 **witness 传入**（授权源被搬到攻击者手里）
- 删 §15-3 的 `tx.outputs[k].scriptPubKey == successor_commit` introspection（后继不再唯一）
- 删 `tx.outputs[k].value == 确定性分配`（收款额可任意）
- 删「**恰一个后继 output**」的计数约束（可多加 output 分流）

---

## §4 判据自身的对照臂（**先证这把尺会红**）

🔴 族 B 是**变异测试**，而变异测试有一个已知失效形态：**仪器恒红**。
若跑变异的装置本身坏了（编译失败被误判成"变异被检出"、环境炸了每格都报 detect），
**每一格都会"如期挂掉"，而清单不会察觉。**

⇒ **强制**：族 B 第一格必须是 **no-op 探针**——**不改任何语义**地重编一次，
**它必须 MISSED（= 测试仍全绿）**。若它也"挂了"，说明装置恒红，**整轮作废**，不许计入任何结论。
（本仓 `mutation-runner.mjs` 已有 `expectMissedFirst` 实现，直接复用。）

🔵 同理族 A：每个阴性格**紧邻一次合法格复跑**；同窗合法格非 PASS ⇒ 该窗读数**不可归因**，不计入判据。

---

## §5 归因纪律（照搬今天已验证有效的，逐条写死）

1. **拒因原文全量捕获 + 落盘入库**（不是只存 stdout）。
   今天的实账：8/8 那轮拒因被日志 `slice(0,90)` 截断、且从未落盘 ⇒ **原文随进程永久消失，无法补测。**
2. **判别串预注册且写进 harness**，不靠肉眼归类。
   已知外层 wrapper = `failed to verify the signature script`；
   🔴 **但不得假定它对新合约同样适用** —— 内层原因今天就出现过分叉
   （`not all signatures empty on failed checkmultisig` vs `script ran, but verification failed`）。
   ⇒ 分类器**认不出的串必须判"不可归因"并原样打印**，**永不判通过**（fail-closed）。
3. **exit 码与 summary 判据对齐**：`fail>0 || inconclusive>0 ⇒ exit 1`。
   今天 Codex 逮到的洞：exit 只看 fail ⇒ 一次"什么都没测到"的跑会 exit 0 冒充绿。
4. **注资延迟不得成为判读变量**：预注资/复用未花 UTXO，别靠拉宽等待窗
   （实测同日注资 68–255s 波动，180s 窗挡不住）。

---

## §6 Codex ⑤：真 covenant path 的 durable provenance（**判据可先定，不必等 covenant**）

今天已为**探针**跑通一套 provenance 闭合，可直接继承的部分：
编译坐标钉死（`silverc-zk-8065184.exe`）· 对照臂断言默认路径**因缺内建**而非因文件缺失失败 ·
源树层盲独立复现 · 产物层 byte-exact A/B · **入库固定 ctor** 作可复现基准。

🔴 **但有一处【不能照搬】，而它今天正好咬过我们一次**：
探针的基准 ctor 是**一个常量**（全 `0x02`），入库后谁拉谁都得同一个数。
而 **A2 covenant 的生产 ctor 逐 session 变**（委员根 / session / policy / epoch 都是活值）——
**拿生产 ctor 当 provenance 基准，得到的数下一场就变，对外人零复现价值。**
（今日实账：4b 基准一度记成 `3648 字节`，那是某次**随机** ctor 的产物；换个 ctor 就成 `3653`，
第三方**永远复现不出**。改成入库固定 ctor 后才拿到可复现基准 `671cf278…`。）

⇒ **判据（预注册）**：
1. **基准用【入库的 fixture ctor】**（与任何生产 session 无关的冻结常量），
   任何人拉同一份 + pinned 编译器 ⇒ 得同一 `script` 字节数与 sha256；
2. **生产路另用一条判据**：同一 (源码 commit, 编译器 commit, ctor 输入) ⇒ **确定性重编 byte-exact**，
   而不是要求"生产产物的哈希是某个固定值"（那句话本身不成立）；
3. 报告**必须带作用域**：可复现基准是 fixture 那条，生产那条是确定性重建，**两者不可互相冒充**。

🔨 判据：**"可复现"必须说清【复现的是哪一份输入】** —— 输入会变的东西，没有固定的输出基准。

---

## §7 明列空白（不假装覆盖）

- 🔴 **本文档不产任何生产码**，也**不指定 covenant 由谁写**（Owner 闸，未派）。
- 🔴 **不覆盖 §7 quorum 独立性** —— 那是"委员是不是真独立"，与本卡"绑定是否机械成立"正交，且是真金前的独立硬闸。
- 🟡 **证据强度的形状**（今天已验证，此处继承）：
  正例**真落链、可第三方独立复核**；负例的**被拒事实**可跨节点独立验（拉未花 UTXO 集，不需 txindex），
  负例的**被拒原因**不可，**只能信广播当下捕获的 RPC 原文**（被拒 tx 从不进 DAG）。
  ⇒ 报告里**两半必须分开说**。
