# `checkSigFromStack` 最小 E2E — 设计 + 备料（报备层 · 未上链）

> **Status**: CURRENT

**作者** J2 · **日期** 2026-08-20 · **派工** Bettor 09:41（设计/备料报备层；**链上跑等 Bettor/Owner 点**）
**解的闸** §6-3 A 的 runtime 闸 · **范式** 复用 `Blake2bProbe.sil` + `bshard-probe-blake2b.mjs`（本仓既有探针模式，不新造）

---

## §0 这个 E2E 到底在验什么（先写死，防被读成别的）

**不是**验 secp256k1 对不对（那是节点的事）。
**是**验：**silverc 对 `checkSigFromStack` 的 codegen，编出来的脚本在链上行为正确。**

🔴 **为什么这一格非验不可**：本仓已有先例证明"看着完全正常的 codegen 函数里可以多一行" ——
`8065184` 修的 OP_PICK off-by-one 就藏在 `compile_byte_sequence_cast_call` 里，**一行 `*ctx.stack_depth += 1;`**。
⇒ 我读过 `compile_checksigfromstack_call` 的函数体、算术看着对，**但那正是 OP_PICK 当年的样子**。
**读代码不能结案，只有跑一次能。**

---

## §1 🔴 承重的不是「合法签名 PASS」，是「篡改必 REJECT」

这一节是本设计的要害，写在最前：

- 一个 **always-true** 的坏 codegen（就像我们刚在 `#132` 之前那棵树里看到的 `checkDataSig` stub）
  **会让"合法签名 PASS"这一格全绿** —— 它对判别毫无贡献。
- ⇒ **判别力全在阴性臂**：篡改任一入参必须 **REJECT**。

🔨 判据：**"能通过"证明不了闸存在；只有"改一位就过不去"才证明。**

---

## §2 最小合约（拟）

```
pragma silverscript ^0.1.0;

// CheckSigFromStackProbe.sil — 隔离验 checkSigFromStack 的链上行为(J2, 2026-08-20)
// 目的: 判 silverc codegen 是否把 (sig, digest, pubkey) 正确送进 OpCheckSigFromStack。
// 判别: 合法三元组 PASS ∧ 三种单点篡改各自 REJECT ⇒ 该原语在链上真的在验。
//       任一篡改仍 PASS ⇒ 该入参【未参与运算】(= stub 或参数序错), 该原语不可用于 §6-3。
contract CheckSigFromStackProbe(byte[32] pubkeyBaked) {
    // pubkey 烤进 ctor ⇒ 花费方不能自带公钥(否则测的是"他自签自验", 无意义)
    entrypoint function verify(byte[64] sig, byte[32] digest) {
        require(checkSigFromStack(sig, digest, pubkeyBaked));
    }
}
```

🔴 **`pubkeyBaked` 必须烤进 ctor，不能当 witness 参数** ——
否则攻击者/测试者自带一套钥，测的是"自签自验"，**与我们要验的 codegen 正确性无关**
（同族：`PayoutShardV2` 的委员 pk 靠 merkle 绑回 ctor 烤值，而不是信 witness）。

---

## §3 测试向量（预注册，事后不加项）

| # | 输入 | 预期 | 它单独证明什么 |
|---|---|---|---|
| **V0** | 合法 `(sig, digest, pubkeyBaked)` | **PASS** | 正路可用（**但不证明闸存在**，见 §1） |
| **V1** | `sig` 翻一位 | **REJECT** | 签名参与了运算 |
| **V2** | `digest` 翻一位 | **REJECT** | **digest 参与了运算** ← 最像 stub 的那一格 |
| **V3** | 用**另一把钥**签的合法签名（自身自洽） | **REJECT** | 验的是 **ctor 烤死的那把钥**，不是随便哪把 |
| **V4** | `sig` 全零 / 长度合法但非签名 | **REJECT** | 不接受平凡值 |

🔵 **V3 单独说**：它比"翻 pubkey 一位"强 —— 翻位得到的多半不是合法曲线点，可能因**格式**被拒而非因**验签**被拒；
而"另一把钥的合法签名"是**格式完全合法**的，只能因验签失败被拒。⇒ **V3 才是排除"根本没在比对公钥"的那一格。**

---

## §4 🔴 阴性臂的阴性臂：REJECT 的**成因**必须可区分

一次 REJECT 只说明"这笔没被接受"，**不说明是被 `checkSigFromStack` 拒的**。
今晚就真撞到过：节点 `RPC node is not synced` 会让**任何**提交失败。

⇒ 落法（三条缺一不可）：
1. **捕获拒绝原文**（kaspad 的 reject reason），不只看"失败了"；
2. **V0 与 V1-V4 在同一时间窗内交替跑**：若 V0 在该窗内 PASS，则同窗的 REJECT 不能归因于节点/网络；
3. 🔴 **跑前先测节点同步**（`chain_get_current_daa_score` 连两窗，速率 > 0）——
   今晚实测常态 0.41–0.57/s；**读不到或零前进则不开跑**，否则整轮读数作废。

---

## §5 编译坐标（这条今天刚吃过亏，必须钉死）

**必须 pinned 在 `8065184`**（`/d/silverscript`，本机检出）。理由两条：

1. 它是**唯一同时含**「upstream `#132` typed `checkSigFromStack`」与「OP_PICK 修复」的树；
2. 🔴 `#132` 之前的检出**根本没有这个内建**（`#124` 实测 0 处），而上游任意点**都没有 OP_PICK 修复**。

⇒ **报告里必须写编译坐标**：`compiler HEAD = 8065184`，并附 `git status --porcelain` 洁净证明。
🔨 今天的实账：两名 agent 对同一路径字符串读出**互相矛盾却各自属实**的结论，根因就是没带坐标。

---

## §6 明列空白（不假装覆盖）

- **本设计不上链**。链上跑等 Bettor/Owner 点（testnet-test）。
- **不验 §6-3 的其余部分**：只隔离这一个原语。A 机制其余格（attestation 绑定、层间依赖）不在本卡。
- **不验性能/成本**（`used` 开销）：那是 `Blake2bProbe` 那类的题，本卡只判**行为对不对**。
- 🔴 **V0 PASS ≠ 可用于生产**：本卡只证"该原语在链上真的在验"。
  它能不能承载 §6-3 的 A2，取决于 A2 的完整要求（我未读全），**不由本卡回答**。
