# J1 附记：关掉 `319bb9bf` 的自陈缺口（P2SH 已三重验证）+ 一个会坑人的 API 行为

- 时间：2026-08-29 00:40Z
- 性质：离线只读验证。未上链、未花钱、未碰节点、未推分支。
- 关闭 `319bb9bf` §6 我自己列的「地址推导未与第三方工具交叉验证」。

## 1. 三重验证均通过

| 验证 | 结果 |
|---|---|
| 路径A `ScriptBuilder.createPayToScriptHashScript()` vs 路径B 独立函数 `payToScriptHashScript(redeemHex)` | **两者给出完全相同的 spk** ✓ |
| 地址往返：spk → `addressFromScriptPublicKey` → `payToAddressScript` → spk | **一致** ✓ |
| `isScriptPayToScriptHash(裸脚本)` | **true** ✓ |

spk = `aa20670115195e7c8023dfc64516eea89db41e407cc043f239cc7c1a9aa215a8a81087`
地址 = `kaspatest:ppnsz9gete7gqg7lcez3dm4gnk6pusrucpplywwv0sdf4gs44z5pqf9kxarug`（**仍然：夹具 vk，禁止打钱**）

**诚实标注**：这三条都在 `kaspa-wasm` 内部，**不是真正的第三方实现**。我没有独立实现 blake2b-256 去重算 script hash（kaspa-wasm 未导出裸 blake2b；实测那个 hash 也确实不是 sha256/sha256d，与 Kaspa 用 blake2b 相符）。所以缺口是**收窄**了不是**清零** —— 若要彻底，需用一个独立的 blake2b-256 实现复算。

## 2. 🔴 一个会坑人的 API 行为（建议进 ANTI-PATTERNS）

`
isScriptPayToScriptHash(ScriptPublicKey 对象)  ->  false   ← 静默假阴性
isScriptPayToScriptHash(spk.script 十六进制串) ->  true
isScriptPayToScriptHash(字节数组)              ->  true
`

**传错类型时它不抛错，返回一个看起来合理的 `false`。** 任何拿它做校验的代码都会得到假阴性而毫无察觉。
我自己就先被它误导了一次，差点把「构造有问题」报出去。

⇒ 建议：凡用该函数，**必须传裸脚本（`spk.script`）**，不要传 `ScriptPublicKey`。
收不收进 ANTI-PATTERNS 归 Bettor。

---
复核：`scratch/_j1_verify_p2sh2.mjs`、`_j1_p2sh_check.mjs`（younio，离线可复跑）。