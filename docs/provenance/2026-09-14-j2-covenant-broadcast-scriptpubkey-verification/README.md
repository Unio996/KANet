> **Status**: CURRENT

# covenant-broadcast.mjs `extractTxShape()` — `.scriptPublicKey.toString()` 假设核验（NWT 1355 接线 TODO 预备）

## 背景

`kasia-relay/src/lib/covenant-broadcast.mjs` 的 `extractTxShape()`（`covenant_broadcast` 命令的核心
安全逻辑之一，见文件头 §9.2 设计要点）把真实 kaspa-wasm `Transaction` 对象的
`input.utxo.scriptPublicKey` / `output.scriptPublicKey` 都用 `.toString()` 转成字段名叫
`scriptPubKeyHex` 的字符串，`validateNetLoss()` 再用这个字符串跟 `relayScriptPubKeyHex`
做大小写不敏感的相等比较，判断"这个输出是不是付回 relay 自己"。

该文件的 JSDoc 留了一条 NWT 1355 的接线 TODO：**这个"转 hex"的假设全仓零先例，接线时必须先拿真实
wasm 对象验一遍**；此前 NWT 想验，但测试地址无效导致 wasm 崩溃，没有条件验完。covenant_broadcast
命令本身还没落码/接线（等 Owner 定 §6 KAS 资金来源 B′/(B)/(C)），Bettor 1362 授权在等待期间先把这条
预备完成（**只产出文档，不改生产路径代码**——`verify-scriptpubkey-hex-shape.mjs` 本身是离线诊断脚本，
不改 `covenant-broadcast.mjs`）。

## 方法：完全离线，零链上交互，零生产/relay 私钥

用 `randomBytes(32)` 生成两把**一次性 throwaway** 私钥（同
`kasia-console/src/lib/u1-registration.test.mjs:43` 既有手法），派生出两个格式合法的真实 mainnet
地址——一个冒充"任意输出收款地址"，一个冒充"relay 自己的地址"。全程不读取、不使用、不接触任何
relay 或生产环境的私钥，不连节点，不广播——铁律 0 的私钥边界原样成立。

脚本：[`verify-scriptpubkey-hex-shape.mjs`](./verify-scriptpubkey-hex-shape.mjs)，原始输出见
[`run.log`](./run.log)。

## 结果（① - ⑥ 逐条对应脚本里的编号）

| # | 问题 | 结果 |
|---|---|---|
| ① | `payToAddressScript(addr).toString()` 是否是纯 hex 字符串？ | **否**。实际是 JSON 字符串 `{"script":"<hex>","version":0}`——`/^[0-9a-f]+$/i` 测不过 |
| ② | 同一地址两次独立调用，`toString()` 是否恒等？ | 是（可比对的前提成立） |
| ③ | `addressFromScriptPublicKey(spk, networkId)` 能否 round-trip 回原地址？ | 是，完全一致 |
| ④ | 包进真实 `Transaction` 对象后（`extractTxShape()` 实际读取路径），`tx.outputs[i]`/`tx.inputs[i].utxo` 的 `scriptPublicKey.toString()` 与①直接调用结果是否一致？ | 是，两条路径同源 |
| ⑤ | `validateNetLoss()` 实际依赖的比对——两个独立算出的 `.toString()`（一个来自 tx 输出，一个来自 relay 自己算的地址）能否直接字符串相等判断"付回 relay"？ | **是，能**（尽管①证明它不是 hex） |
| ⑥ | 备选路径：`addressFromScriptPublicKey(out.scriptPublicKey, networkId)` 转回地址字符串比对，是否也成立？ | 是 |

## 结论

**TODO 里"接线时必做第一件事"的核心问题——`.toString()` 比对能不能用——答案是能，现有 `extractTxShape()`
+ `validateNetLoss()` 的安全性质（net_loss 判定：正确识别"这笔输出是不是付回 relay 自己"）成立，不是
资金风险。**

**但 TODO 里"转 hex"这个说法本身是错的，需要在接线那笔一并订正，不然会误导后来人**：
- `scriptPubKeyHex` 这个字段名、`@typedef {{...scriptPubKeyHex:string}}` 的类型注释、文件头"scriptPubKey
  用 hex 字符串"这句话，描述的都是"纯 hex"，而实测是 **JSON 序列化字符串 `{"script":"<hex>","version":number}`**。
- 之所以现有代码**恰好没被这个误判坑到**：`validateNetLoss()` 只做**字符串相等比较**（`.toLowerCase()`
  归一化后比对），不做任何"当作 hex 解析/切片/取字节长度"的操作——只要两边都走同一条
  `.toString()` 提取路径（① - ④ 已证同源），字符串里到底是不是纯 hex 都不影响相等判断的正确性。
  **这是巧合地安全，不是设计上刻意如此**——下一个人如果照着现在的字段名/类型注释，写一段"把
  `scriptPubKeyHex` 当十六进制解出脚本字节"的代码（比如想比对 `script` 字段本身、算字节长度、
  校验版本号），会直接错，因为它实际是 JSON 不是 hex。
- **推荐接线时一并做的最小订正**（不改变任何判定逻辑/安全性质，纯文档+命名）：
  1. `extractTxShape()` 的 `PlainInput`/`PlainOutput` typedef 字段改名或补注："实际是
     `Transaction.scriptPublicKey.toString()` 的原始输出（JSON 序列化，不是十六进制），当前唯一
     被依赖的性质是'同一实现两次调用结果字符串相等'，不要当 hex 解析"。
  2. 文件头"scriptPubKey 用 hex 字符串"那句同步订正掉这个误导性描述。
  3. 若未来真的需要拿到脚本字节本身（比如要跟某个已知脚本模板比对内容而不仅是"是不是同一个地址"），
     用 ③/⑥ 验过的 `addressFromScriptPublicKey(spk, networkId).toString()` 转地址比对，或者
     `JSON.parse(spk.toString()).script` 拿到真正的 hex 子串——不要指望整个 `.toString()` 结果是 hex。

## 范围声明

- 本次只验证了 `payToAddressScript()` 产生的 P2PK/P2PKH 形状地址脚本。covenant P2SH 输出
  （`CovenantBinding` / `payToScriptHashScript`）的 `.toString()` 形状**未在本次验证范围内**——
  `extractTxShape()` 目前的调用场景（`validateNetLoss` 判"付回 relay 自己的地址"）只需要普通地址
  脚本，暂不需要覆盖 P2SH，但接线时若判定逻辑扩展到需要识别 covenant 输出，需要另补一轮针对
  P2SH/CovenantBinding 形状的同类核验。
- 本文档**不改动** `covenant-broadcast.mjs` 任何代码/注释——上面"推荐订正"是留给 NWT/Bettor 在
  covenant_broadcast 真正接线那笔（等 Owner 定 §6）时决定是否连带落地，本次任务范围（Bettor 1362）
  是"预备文档"，不落生产路径。
