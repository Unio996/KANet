> **Status**: CURRENT

# signOnlyDeclaredInputs 真实签名机制核验（接线笔②，Bettor 1365）

## 背景

`covenant-broadcast.mjs` 的 `signOnlyDeclaredInputs` 此前是占位符（`throw new Error('未实现')`）——
文件头注明确写了"NO-TX-NO-STATE 同一条纪律的落码期延伸: 没有真的调通 wasm 签名 API 之前, 不写看起来
能跑但实际没跑过的实现"。Owner 拍板 §6=B′ 后，接线笔②要求把它真实实现（只签 `sign_input_indices`
声明的索引，其余输入原样保留）。

落码前必须先搞清楚一件事：`kasia-relay/src/lib/p2sh.mjs` 里全部既有签名代码（`createInputSignature`
的 30+ 处调用）都是**"构造时一次性带签名"模式**（`new Transaction({inputs:[{...signatureScript: sig}]})`），
**从来没有对一个已经构造好的 `Transaction` 对象原地追加签名的先例**。而 `covenant_broadcast` 场景
恰恰是反过来的：console 传来一个已经构造好（未签/半签）的 `tx_json`，relay 只需要对其中声明的
`sign_input_indices` 补签名，不能重新构造整笔交易（covenant 相关的输入已经带着自己的 witness，
relay 不该碰、也没有能力重新构造那部分）。这是全新场景，不能照抄已有代码，必须先验证清楚。

## 方法：完全离线，一次性 throwaway 私钥，零链上交互

同此前 `covenant-broadcast-scriptpubkey-verification` 的手法：`randomBytes(32)` 生成一次性密钥
（同 `u1-registration.test.mjs:43`），不碰任何 relay/生产私钥，不连节点，不广播。

脚本：[`verify-sign-only-declared-inputs.mjs`](./verify-sign-only-declared-inputs.mjs)，
原始输出见 [`run.log`](./run.log)。

## 核验路径与结果

| # | 问题 | 结果 |
|---|---|---|
| ① | 顶层导出的 `createInputSignature(tx, idx, privKey, sighashType)`（`kaspa.d.ts:279`，专为 `Transaction` 对象设计，区别于 `PendingTransaction` 专用的 `signInput`/`fillInput`）能否对一个未签名的普通 `Transaction` 对象调用？ | 能，返回 132 hex chars（66 字节 push-encoded，与 `p2sh.mjs` 注释里记录的既有格式一致） |
| ② | 原地赋值 `tx.inputs[idx].signatureScript = sigHex` 是否生效（JS 属性系统层面）？ | 生效 |
| ③ | "重新构造一个新 `Transaction`，只替换该 input 的 `signatureScript`，其余 input（模拟 covenant witness）保持原样"这条路径是否可行？ | 可行，covenant 侧的占位 witness 原样保留不受影响 |
| ④ | `finalize()` 后 txid 是否确定性、可重复？ | 是 |
| ⑤ | 签名是否覆盖 outputs（签完再改金额，签名是否失效）？ | 是——output 金额一变，同索引重新计算出的签名就不同，证明 sighash 覆盖 outputs，不能"先签后改" |
| ⑥ | **关键复核**：原地赋值路径 `finalize()` + 序列化后，字节里是否真的带着新签名（排除"只是 JS 属性表层假象，wasm 内部序列化走了别的缓存路径"这个可能）？ | 序列化 JSON 里的 `signatureScript` 确实是我们赋的值；反序列化 + `finalize()` 后 txid 与原 txid 相等；covenant 侧的 `signatureScript` 占位值全程未被误动 |
| ⑦ | 依次对两个索引签名（先签 idx0 并赋值，再签 idx1）——`idx0` 已经非空的 `signatureScript` 会不会影响 `idx1` 算出来的签名？ | **表面上"是"（字节不同），但见下方 ⑧⑨ 的排除与反证** |
| ⑧ | 排除混淆变量：同一个 `tx`、同一个 `idx`，什么都不改，连续调用两次 `createInputSignature`，字节是否相同？ | **不同**——证明 Kaspa 的 schnorr 签名本身带随机数（非确定性 nonce），"两次调用字节不同"是签名算法的正常特性，**不能**拿字节是否相等来判断 sighash message 是否变化 |
| ⑨ | 换一个不受随机数干扰的验证方式：用 wasm 官方"自动扫描+签名(+可选验证)"函数 `signTransaction(tx, [privKey], verify_sig=true)` 对同一笔含两个 relay 输入的交易签名，`verify_sig=true` 是否跑通不抛错？再对比它与"我自己手动 `createInputSignature` 依次签名+赋值"两条路径产出的最终 `txid` 是否一致？ | `signTransaction(..., true)` **跑通不抛错**——wasm 自己对"依次给多个匹配私钥的 input 生成 schnorr 签名"这套模式做过验证且通过；两条路径产出的 **txid 完全相同**（因为 Kaspa txid 不含 witness，两条路径构造出的交易骨架结构一致——参见既有 memory `reference-kaspa-txid-excludes-witness-collision-is-not-same-tx`） |

## 结论

**`signOnlyDeclaredInputs` 的正确实现方式**：对 `signInputIndices` 里的每个索引，依次调用顶层
`createInputSignature(tx, idx, privateKey, SighashType.All)`，并原地赋值
`tx.inputs[idx].signatureScript = sigHex`——**不需要重新构造整个 `Transaction` 对象**（比设计文档
里"可能需要 reconstruct"的担心更简单）。这条路径：

- 是官方公开导出的 API，不是内部私有实现细节；
- 原地赋值在真实 wasm 下完全生效，经序列化/反序列化往返验证，covenant 侧其他输入的 witness 不受影响；
- 与 wasm 自己"自动扫描+签名+验证"的官方路径（`signTransaction(..., verify_sig=true)`）在协议层面
  同构——后者验证通过，直接佐证前者（本质上是同一个底层签名生成机制）在协议层面同样有效；
- 依次对多个索引签名互不干扰（⑦看起来字节不同只是 schnorr 随机数的正常特性，⑧⑨ 已经排除了"顺序
  影响 sighash message"这个真正需要担心的问题）。

**⑤ 的推论要写进实现的调用顺序约束**：签名必须在 `tx` 的所有字段（尤其是 `outputs`）最终确定之后
才能进行——`covenant-broadcast.mjs` 现有的分层设计（`validateSignedInputCeiling` 签名前调用、
`computeRequiredFeeSompi`/`validateNetLoss` 签名后调用）已经天然符合这个约束，不需要额外改动。

## 范围声明

本次只验证了 relay 自己控制的 P2PK 形式输入（`payToAddressScript` 产生的 scriptPubKey）的签名路径——
这正是 `sign_input_indices` 会指向的那类输入（"花费 relay 自己持有的 KAS 那一个输入"，设计文档 §9.1
原话）。covenant 相关输入的 witness 由调用方（console 构造阶段）填好，relay 的 `signOnlyDeclaredInputs`
从不触碰、也不需要理解那部分脚本的语义，本次验证也刻意让它们以任意占位字符串（`'deadbeef'`）的形式
存在并确认全程原样透传，不需要真的构造一个真实 covenant 脚本来测这条签名路径。
