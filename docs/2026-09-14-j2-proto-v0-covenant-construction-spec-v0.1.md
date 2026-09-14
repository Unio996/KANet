> **Status**: CURRENT

# 原型 v0 covenant 构造设计 v0.1（每个 kind：合约/entry/ctor/witness/签名/找零/T4-lite/回滚）

出处：Bettor 派工（1379 附近，"业务级 covenant 构造要不要现在继续"的答复）——**继续，但设计先行**（合约层，猜错烤死不可回滚）。依赖前置交付：`docs/2026-09-14-j2-mainnet-sil-ctor-fields-v0.1.md`、`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md`（§0-§9.5，业务级端点×合约×entry映射，本文档补的是**代码级**精度：字节从哪来、谁签什么、净损耗怎么算、崩了怎么办）、`kasia-console/scripts/mainnet-sil-set.json`（11 合约权威声明）。

本文档只覆盖 §1-§6（market_genesis 全流程 → withdraw），**不覆盖 resolve 之后的合约级正确性证明**（RootClose/RootClaim/RefundClaim 的 require 逻辑本身早已由 T3 既有 provenance 向量验过，这里只回答"proto v0 后端怎么调它们"）。

## §0 先说清楚：本文档解决的是哪一层问题

`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §2 已经给出了业务级映射（哪个端点调哪个合约的哪个 entry，ctor 字段按 USER/BACKEND-BAKED/BACKEND-DERIVED/GENESIS-ZERO 四类分类）——**这一层没有过时，本文档不重复它，是往下钻一层**：

1. **编译工具链选型**（§1.1，本文档最重要的发现）：proto v0 要用的全部 11 个合约都是 **v1.0.0 语法**（`entry` 关键字，不是 `entrypoint function`），但 `pool-bshard-artifacts.mjs` 里现成的、被生产 `pool-shard-register.mjs` 等大量复用的 `compileSil`/`computeSpineArtifact`/`computePoolRootArtifact`/`computePoolSideArtifact` 这一族 wrapper **全部是为 legacy 语法设计的**——直接复用会撞坑（细节见 §1.1），proto v0 的 handler **不能抄这些现成函数**，必须自己拼装 `compileSilV100` + `extractTemplateArtifact` 这条路径（正是 NWT (1345) 对 `PoolSideTicket.sil` 单个合约的裁定，本文档把它推广到全部 11 个合约）。
2. **每个 kind 的交易结构**：真实构造出来的 `tx_json` 长什么样——哪些输入是 covenant 自己解锁（不需要 relay 签，只需要满足 require 条件+正确的 witness 参数）、哪些输入是 relay 自己出资的手续费 input（需要 `sign_input_indices` 声明+`signOnlyDeclaredInputs` 真实签名）、committee/bettor 的 witness 签名机制是什么（§1.3，容易和 relay 签名混淆，必须先讲清楚）。
3. **每个 kind 的净损耗形状**：怎么保证 `validateNetLoss`（`kasia-relay/src/lib/covenant-broadcast.mjs`）算出来的 `net_loss` 不会因为"这笔交易本来就该花掉一些 KAS 铸造/续约 covenant"而被误判超限。
4. **T4-lite 人工核清单**：创世/花费广播前，operator 该逐字节核对哪几个值——这是"猜错烤死不可回滚"这句话的操作化：给出一份**具体核对哪几个字段**的清单，不是空喊"仔细检查"。
5. **失败态回滚**：`buildAndBroadcast` 内部任何一步失败，DB 状态该停在哪、下次重试怎么判断"从哪一步继续"（复用 §2.3.1 已经设计好的 `proto_bet_intents`/两阶段回执/`resumeStaleBetIntents` 机制，本文档只补每个 kind 具体怎么套进这套机制）。

## §1 五个 kind 共通的架构性发现（读完这节再看后面每个 kind 的具体设计）

### §1.1 全部 11 个合约必须走 `compileSilV100`，禁止复用 `compileSil` 系 legacy wrapper

**实测依据（`kasia-console/src/lib/pool-bshard-artifacts.mjs` 源码原话，第 96-107 行）**：

> 产物 schema: 旧 = 顶层 `{script:number[], state_layout:{start,len}}`；v1.0.0 = 嵌套 `{contracts:{<ContractName>:{compiled:{bytecode,template_hash,state_span}}}}`。
> ctor JSON 节点方言: 旧 = `{kind:'array',data:[...]}`/`{kind:'int',data:n}`；v1.0.0 = `{kind:'bytes',value:[...]}`/`{kind:'int',value:n}`(**实测: 旧方言喂 v1.0.0 CLI 直接 "missing field `value`" 拒收**，不是能凑合用旧格式)。
> 编译器本身: 旧二进制对当前(v1.0.0 语法迁移后)主网集 `.sil` 文件已经结构性作废(`entry` 关键字不认识，parse error)。

这两条问题是**独立的、都会导致失败**：① 如果 `silvercPath` 参数没显式传、退回默认值（legacy 二进制），会在**源码语法解析**这一步直接 parse error（NWT (1345) 已经实测过这条，喂 `PoolSideTicket.sil` 直接崩）；② 即使显式传了 `silvercPath` 指向 v1.0.0 二进制，**如果 ctor 还是用 `ctorBytes32`/`ctorInt`（`pool-bshard-artifacts.mjs` 里给 `compileSil` 系函数用的旧 dialect helper）构造的，v1.0.0 CLI 会因为 JSON 字段名是 `data` 而不是 `value` 直接拒收**——这是一个**独立于 (1345) 字面裁定之外、我自己核对源码发现的坑**：(1345) 的裁定原文只提到"handler 必须显式传 `silvercPath`=v100 pin、`poolSideSilPath`=新文件"，字面上没提"不能用 `computePoolSideArtifact` 这个函数本身"——但 `computePoolSideArtifact` 内部硬编码调用的是 `compileSil(poolSideSilPath, poolSideCtor, silvercPath)`，`compileSil` 只是把 `silvercPath` 转发给 `_runSilverc`，**不会把 ctor 数组的 dialect 转换**。也就是说，即使按 (1345) 字面要求传对了 `silvercPath`/`poolSideSilPath` 两个路径参数，只要 `poolSideCtor` 还是用 `ctorBytes32`/`ctorInt` 构造的，仍然会在编译这一步直接报错。

**⇒ 结论（本文档的架构决策，覆盖全部 5 个 kind）**：proto v0 的 `buildAndBroadcast` **完全不导入、不调用** `compileSil`/`computeSpineArtifact`/`computePoolRootArtifact`/`computePoolSideArtifact`/`computeMarketCreateArtifacts`/`ctorBytes32`/`ctorInt` 这一整族 legacy 符号。全部编译走：

```js
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../lib/pool-template-artifact.mjs';

const compiled = compileSilV100(silPath, ctorArrayOfV100Nodes, 'ExactContractName', v100PinPath);
const artifact = extractTemplateArtifact(compiled); // { templatePrefix, templateSuffix, templatePrefixLen, templateSuffixLen, expectedTemplateHash, expectedTemplateHashHex }
```

`v100PinPath` 单一来源 = `process.env.SILVERC_V100_PATH || DEFAULT_SILVERC_V100_PATH`（`compileSilV100` 默认参数已经这么接，proto handler **不需要自己再传一次**，除非要覆盖——**永远不要覆盖成别的路径**，这正是 (1345) 硬条件"不得为先能跑退回旧文件+legacy"的字面意思）。`contractName` 参数必须与 `.sil` 文件里 `contract` 关键字后面的名字精确一致（`ShardLeaf_direct`/`KanetTestToken`/`RootClose`/`RootClaim`/`RefundClaim`/`KanetTokenClaim`/`PoolSideTicket`），大小写/下划线一个字符都不能错——`compileSilV100` 内部会在 `contracts[contractName]` 找不到时 fail-loud（`silverc v1.0.0 产物里没有 contracts["${contractName}"].compiled`），这是好事，不是需要绕过的障碍。

**唯一可信的模板 hash 来源是 `extractTemplateArtifact(compiled).expectedTemplateHashHex`，绝不是 `compileSilV100` 返回值里的 `template_hash_bytes` 字段**——这是 2026-09-14 已经发现并写进 `pool-bshard-artifacts.mjs` 头注的既有坑（`docs/provenance/2026-09-14-j2-covenant-broadcast-scriptpubkey-verification/` 附近同一批发现），本文档不重复论证，只提醒：**任何一处需要"这个合约的模板 hash 是多少"的地方，一律走 `extractTemplateArtifact`，不要偷懒直接读 `compiled.template_hash_bytes`**。

### §1.2 三层不同的"签名"，不要混在一起

这是最容易在实现阶段搞混、进而写出资金安全 bug 的地方，先把三层分清楚：

| 层 | 谁签 | 签的是什么 | 值放在交易的哪里 | 谁负责计算 |
|---|---|---|---|---|
| **① relay 费用输入签名** | proto relay 自己的私钥（`wallet.getPrivateKey()`） | 对整笔交易的某个 **input index** 的标准 Kaspa 签名（`createInputSignature(tx, idx, privateKey, sighashType)`） | `tx.inputs[idx].signatureScript`（原地赋值，见 `covenant-broadcast.mjs` `signOnlyDeclaredInputs` 已验证的路径） | **relay 侧**，`covenant-broadcast-relay.mjs` 走 `sign_input_indices` 声明的索引，命令定案后自动做 |
| **② committee/bettor witness 签名** | `proto-committee-key.mjs` 管理的那把 v0 单 keypair（committee 5 槽 + bettor 兼任，§5 简化） | 同样是**对整笔交易某个 input index 的标准 Kaspa 签名**——`checkSig(sig, pubkey)` 这个 silverscript 原语验证的就是"这个 `sig` 是否是对本笔交易 sighash 的合法签名"，机制上与①完全同源（都是 `createInputSignature`），**差异只在"谁的私钥"和"塞进交易的哪个位置"** | 作为 **entry 调用参数**（`c0Sig`..`c4Sig` / `bettorSig` / `sig s`），被 ABI 编码进触发这次 entry 的那个 covenant 输入自己的 `sigScript`——**不是** `tx.inputs[idx].signatureScript` 那种"外部签名脚本"，是"entry 参数列表的一部分" | **console 侧**，`buildAndBroadcast` 在构造 `tx_json` 时，用 `decryptCommitteePrivkey()` 解出明文私钥、就地调用 `createInputSignature`、算完立刻让引用出作用域（`proto-committee-key.mjs` 三项纪律），relay 侧完全不碰这层 |
| **③ PoolSideTicket 票据授权** | 同②（v0 单操作员，bettor=committee 复用同一把） | `authorize_spend(sig bettorSig)`——`checkSig(bettorSig, pubkey(bettorPk))`，机制同②，只是这次签名对应的 input index 是"被消费的那张票据自己" | 同②，票据输入自己的 `sigScript` | 同②，console 侧 |

**⇒ 结论**：`covenant-broadcast-relay.mjs` 的 `sign_input_indices` **只会包含①这一类索引**（relay 自己出资的手续费 input），**永远不会包含②③**（那些在 console 侧构造 `tx_json` 时就已经算好签名、编码进对应输入的 `sigScript` 里了——到 relay 手上时已经是"半签"状态：committee/bettor 那部分已签好，只差 relay 自己的费用输入）。这跟 `covenant-broadcast.mjs` 文件头注"covenant 相关的输入已经带着自己的 witness，relay 不需要签"完全吻合，本节只是把"谁在什么时候算这个 witness"说清楚。

**待实现阶段验证的技术点（如实标注，不假装已确认）**：`checkSig` 具体验证的 sighash 覆盖范围（`SighashType.All` 还是别的）、以及 entry 参数 ABI 编码的精确字节序列构造方式（`silverc` 编译产物的 `.sil` 源码本身不直接告诉我们"调用 entry 时 witness 参数怎么序列化进 `sigScript`"，这需要在真正写 `buildAndBroadcast` 代码时，用 `cli-debugger` 或类似工具跑一条离线向量核实，同 `docs/provenance/2026-09-14-j2-poolsideticket-real-cospend-vectors/` 那一批向量的验证方法）——这不是本设计稿能纸面回答的问题，是"设计先行"里"先行"的边界：本文档负责把"结构对不对、字段从哪来"钉死，"字节怎么拼"仍然要靠离线向量核实，落码那一笔会做。

### §1.3 `pool-payout-root.mjs` 深度不匹配（resolve/claim 用）

`pool-payout-root.mjs` 的 `payoutRoot()`/`merkleProof()` 硬编码 `DEPTH = 10`（最多 1024 个赢家叶子），而 `RootClaim.sil` 的 `claim_draw` entry 硬性要求 `tree_depth >= 0 && tree_depth <= 1`（源码注释：depth-2 + claimed_bitmap 模板 ~892B 超 790 预算 bust，depth-1 才是 v0 能塞进预算的上限，最多 2 个赢家叶子）——**两者深度不一致，直接调用现成的 `payoutRoot(winners)` 会产出一棵 depth-10 的树，喂给只做 depth≤1 climb 的合约验不出来匹配的 root**。

**⇒ resolve/claim 两个 kind 不能直接复用 `pool-payout-root.mjs` 现成函数**，需要一个新的、depth-1 专用的最小实现（v0 单操作员场景最多两个"赢家聚合位置"——YES 边一个聚合叶子、NO 边一个聚合叶子，`payout` 是聚合到该位置的应得总额，不是逐笔）。这个新函数很小（depth-1 只有 0 或 1 层 climb），本设计稿 §4 给出具体形状，不复用 `pool-payout-root.mjs` 也不改它（它是生产 payout 模块，改了影响面不可控）。

### §1.4 手续费/净损耗通则

Covenant genesis/spend 本身不产生 KAS——每一笔 `covenant_broadcast` 交易都至少需要一个 **relay 自己出资的手续费 input**（下称"fee input"），因为：① genesis 输出需要有人提供 UTXO 作为交易的"燃料"（哪怕只是构造一个新的 P2SH 输出，交易本身仍然需要至少一个输入）；② 即使是纯 covenant-to-covenant 的 spend（比如 `register_append`），交易的 KIP-9 storage mass/手续费仍然需要一个额外的、能覆盖 mass 费率的输入来源（covenant 自己的 UTXO 金额是被 `validateOutputState`/`validateOutputStateWithTemplate` 精确焊死的，不能从里面"顺便"抠一点出来当手续费，那样会打破对应的 value-weld require）。

这个 fee input 是 `sign_input_indices` 声明的索引，`validateNetLoss` 的判定对象就是它：

```
net_loss = Σ(relay 签名的 input.value) − Σ(outputs 中 scriptPubKey == relay 自身地址 的 value)
require(net_loss ≤ min(required_fee × 2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI))
```

> 📌 **修订（Bettor 1386①/NWT 1387 架构裁定，2026-09-14，落码见 `kasia-relay/src/lib/covenant-broadcast.mjs` 提交 14c9cf22）**：原公式里的 `ABS_FEE_CAP` 是**单一全局常量**（0.05 KAS）——mass 实验（`docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/`）证明这对 `ShardLeaf_direct` 这类大脚本 covenant **完全不够用**（理论最小 net_loss ≈0.4 KAS，是旧硬顶 8 倍）。现改为**两条独立生效的防线**（详见新增 §9.4）：`absFeeCapSompi` 是 per-kind 精细上限（各 kind 自己的 mass 实验结果算出、由 console 侧硬编码传入，`validateNetLoss` 现在**要求**调用方显式传这个参数，不再有隐式默认值），`GLOBAL_ABS_FEE_CAP_SOMPI = 1.0 KAS` 是 relay 侧硬编码的、与 kind 无关的最终硬顶。三者取最小。

**每个 kind 的"找零/手续费形状"一节，回答的就是**：这个 fee input 出多少钱、找零多少回 relay 自己、net_loss 是不是只等于真实 mass 费（不多不少）。**通则**：fee input 金额 = `估计所需 KAS`（覆盖 mass 费 + 给 covenant 输出的 dust 最小值，如果这笔交易恰好需要给某个新建/续约的 covenant 输出补 `DUST_MIN=1000` sompi 级别的垫底 KAS），找零 = fee input 金额 − 真实花掉的部分，找零输出的 `scriptPubKey` 必须等于 relay 自己地址的 `payToAddressScript`（这样 `validateNetLoss` 才能正确识别"这是找零，不是净损耗"）。**fee input 的 UTXO 选择本身也有约束，见 §9.5**：不能随手抓一个能用的大额 UTXO，必须选面值最小但仍够用、且找零形状合法（0 或 ≥DUST_MIN）的 UTXO，没有合适的 fail-loud 报 `no_suitable_fee_utxo`（v0 范围不含自动拆分，见 §9.5 范围裁定）。

## §2 market_genesis（`POST /api/proto-markets/create`）

### 合约/entry

无 entry——genesis。合约 `ShardLeaf_direct`（`src/lib/ShardLeaf_direct.sil`，`sha256` 见 `mainnet-sil-set.json` 第 9 条）。

### ctor 字段清单（12 项，按源码原序）

> 📌 **勘误（NWT GREEN-with-notes 第 5 点，2026-09-14）**：本节标题原写"10 项"，实际逐行清点是 **12 项**（`init_local_yes`/`init_local_no`/`init_count`/`init_pool_value` 这一行是 4 个字段合并展示，容易数漏）——按本文件通则"它就是唯一记录 ⇒ 配一条自查命令"：`grep -c '^|' <(sed -n '86,96p' 本文件)` 数据表行数 + 展开合并行即得 12，不是重新定义字段，只是把标题数字改成和下表一致。

| ctor 字段 | 类型 | 来源 |
|---|---|---|
| `market_id` | `byte[32]` | BACKEND-DERIVED：后端 `randomUUID()` 转 32 字节（UUID 本身 16 字节，需要一个确定性的扩展方式——建议 `blake2b(uuidBytes)` 取满 32 字节，而不是简单零填充，避免"高位恒零"这种可预测结构） |
| `ps_tmpl_hash` | `byte[32]` | BACKEND-DERIVED：`PoolSideTicket.sil` 的模板 hash——**先编译 `PoolSideTicket` 拿到 `extractTemplateArtifact(...).expectedTemplateHash`**，ctor 是 `[ctorBytes32V100(bettorPk占位), ctorIntV100(direction占位), ctorIntV100(stake占位), ctorBytes32V100(shardPoolId占位)]`（占位值任意，模板 hash 与具体值无关，因为 `extractTemplateArtifact` 排除的正是 state 区域——同既有"模板锚"手法，`market_genesis` 阶段编译一次即可复用于所有市场，是**协议常量**，不必每个市场重算，除非 `PoolSideTicket.sil` 本身换了版本） |
| `shard_pool_id` | `byte[32]` | BACKEND-DERIVED：同 `market_id`（v0 一个市场一个 pool，两者取同一个值即可，设计稿 §2.2 原文写"同 `market_id` 或独立生成"——本文档裁定：**取同一个值**，减少一个需要额外记录的字段） |
| `seal_count` | `int` | BACKEND-BAKED：**2**（v0 固定） |
| `min_bet` | `int` | USER：市场创建表单填写 |
| `rootclose_tmpl_hash` | `byte[32]` | BACKEND-DERIVED：**先完整编译一份携带本市场真实 ctor 值的 `RootClose`**（`committee_hash`/`deadline_ms`/`token_tmpl_hash` 等，见 §2.4 的 RootClose ctor），取 `extractTemplateArtifact(...).expectedTemplateHash`——RootClose 此时并不上链，只是算出它未来存在时的模板锚（这一步意味着 `market_genesis` 内部要先算好 committee keypair、算好 `committee_hash`，即使 RootClose 真正 genesis 要等 `convert_to_rootclose` 那一步才发生） |
| `rootclose_init_payoutRoot` | `byte[32]` | GENESIS-ZERO：`ZERO32` |
| `token_tmpl_hash` | `byte[32]` | BACKEND-DERIVED：`KanetTestToken` 编译产物的模板 hash——**协议常量**，与选中哪个代币定义无关（所有 KTT 实例共用同一份编译模板；代币定义只影响 DB 展示元数据），跟 `ps_tmpl_hash` 一样只需要算一次、可复用于所有市场 |
| `init_local_yes` / `init_local_no` / `init_count` / `init_pool_value` | `int` ×4 | GENESIS-ZERO：全部 `0` |

**关键依赖顺序（必须先算好才能编译 `ShardLeaf_direct`）**：`token_tmpl_hash` 和 `ps_tmpl_hash` 是协议常量，市场创建时直接复用（建议做成一次性计算脚本 `scripts/proto-v0-template-anchors.mjs`，产出写 `kasia-console/scripts/proto-v0-template-anchors.json`，同旧设计稿 §4 已提议的手法）；`rootclose_tmpl_hash` 则**每个市场不同**（因为烤了这个市场自己的 `committee_hash`/`deadline_ms`），必须在 `market_genesis` 这个端点内部现算，顺序是：① 生成本市场的 committee keypair（`generateCommitteeKeypair()`）→ ② 算 `committee_hash = blake2b(pk‖pk‖pk‖pk‖pk)`（v0 五槽同一把公钥）→ ③ 编译一份带真实 `committee_hash`/`deadline_ms`/`token_tmpl_hash`/`claim_tmpl_hash`/`refundclaim_tmpl_hash` 的 `RootClose`（`claim_tmpl_hash`/`refundclaim_tmpl_hash` 也是协议常量，`RootClaim`/`RefundClaim` 的编译产物模板 hash，与具体市场无关）→ ④ 取其 `rootclose_tmpl_hash` → ⑤ 才能编译 `ShardLeaf_direct`。

### sign_input_indices

一个 fee input（relay 自己出资，覆盖 genesis 交易的 mass 费 + 给新建 `ShardLeaf_direct` 输出补的 dust）。`ShardLeaf_direct` genesis 本身不需要任何 entry 调用、不需要 committee/bettor witness 签名——genesis 输出的合法性完全由"这个 P2SH 脚本字节是不是正确编译产物"决定，不需要签名证明。

### 找零/手续费形状

Fee input 金额 = `estimatedFee + genesisOutputValue`。

> 📌 **修订（Bettor 1386①，2026-09-14，出处 `docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/`）**：原文这里建议 `genesisOutputValue` 定在"几千到一万 sompi"、认为越小越省——**实测证伪**：真实 `calculateTransactionMass` 对 `ShardLeaf_direct`（15687 字节的编译产物）跑出的 KIP-9 storage mass 惩罚，让 `required_fee` 与 `genesisOutputValue` 精确成反比（`required_fee × genesisOutputValue ≈ 4×10^14` 常数），`net_loss(v) = v + required_fee(v)` 是 U 形曲线，**越小的 `genesisOutputValue` 反而 `net_loss` 越大**（1000 sompi 时 net_loss ≈4000 KAS，荒谬地大）。全局最优点在 **`genesisOutputValue = 20,000,000 sompi（0.2 KAS）`，此时 `required_fee ≈ 20,000,000 sompi`，`net_loss ≈ 40,000,000 sompi（0.4 KAS）`**——与生产代码 `pool-shard-register.mjs:85` 独立选定的 `SHARD_GENESIS_SEED = 20_000_000` 完全吻合，交叉验证了这个值。`genesisOutputValue` 应**定死为 20,000,000 sompi**，不是"越省越好"的可调参数。

输出 = `[genesis ShardLeaf_direct 输出, 找零回 relay 自己地址]`。`net_loss` = fee input 金额 − 找零金额 = 真实花掉的部分（mass 费 + genesis output value）——**这里 `genesisOutputValue` 本身也会被算进 `net_loss`**，因为它离开了 relay 自己的地址、进了一个新建的 covenant，这是**预期之中的花费**，不是"净损耗超限"的异常。`genesisOutputValue=20,000,000` 对应的最优 `net_loss≈0.4 KAS` 需要 console 侧 `CAP_MARKET_GENESIS` 覆盖（候选值 0.4/0.5/0.8 KAS，见 provenance README，最终数值由该 kind 落码提交时定），且必须 `≤ GLOBAL_ABS_FEE_CAP_SOMPI = 1.0 KAS`（见 §1.4 修订、§9.4）。

### T4-lite 人工核清单（创世前逐字节对照）

1. `token_tmpl_hash` / `ps_tmpl_hash` 两个协议常量与 `proto-v0-template-anchors.json` 里记录的值逐字节一致（防止"用了一次性算错的值"）。
2. `committee_hash` = `blake2b(pk‖pk‖pk‖pk‖pk)` 手工重算一遍，与 ctor 里传入 `RootClose` 编译的值一致。
3. `rootclose_tmpl_hash` 用**独立**一次 `compileSilV100(RootClose.sil, sameCtor, 'RootClose')` + `extractTemplateArtifact` 重算，与 `ShardLeaf_direct` ctor 里烤的值逐字节一致（防止"编译了两次但用错了哪一次的产物"这类低级错误——同 CP3 §4 既有纪律"跨边界的比较不能自己跟自己比"）。
4. `seal_count == 2`、`init_local_yes/no/count/pool_value == 0`、`rootclose_init_payoutRoot == ZERO32` 字面值核对（这几个字段错了不会立刻报错，但会让后续 `register_append`/`convert_to_rootclose` 的 require 永远算不出正确结果，属于"看起来广播成功、后面才发现全废"的类型）。
5. `committee_privkey_enc` 落库前，**先解密一遍验证能拿回同一把公钥**（`decryptCommitteePrivkey(encryptCommitteePrivkey(privKeyHex)) === privKeyHex` 的运行时自检，不是纸面假设"加密函数应该没问题"）。

### 失败态回滚

`market_genesis` 是单笔交易（不像 bet 是两步），失败态矩阵简单：广播失败 ⇒ 不写任何 `proto_markets` 行（NO-TX-NO-STATE，`buildAndBroadcast` 抛错，`notImplemented`/未来的真实错误处理直接反馈给前端，允许原样重试）；广播成功 ⇒ 才 `INSERT proto_markets`（`shardleaf_txid`/`vout` 已知）。这个 kind 不需要 `proto_bet_intents` 两阶段机制（TRANSFER/covenant_broadcast 命令本身自带 prepared/submitted 两阶段+`/ingest/proto-bet-intent-phase` 落表，但 `market_genesis` 只有一步，`intent_key` 可以直接是 `proto-market-genesis:<marketId>`，不需要额外的 `depends_on` 链式依赖）。

## §3 bet_mint（`POST /api/proto-markets/:id/bet`）—— 两步复合动作

这是唯一一个内部两步的端点，`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §2.3/§2.3.1 已经把失败态矩阵、`proto_bet_intents` 状态机、两个已知限制（`register_append` 无签名绑定的抢跑竞态 T-PROTO-BETTORPK-BINDING、`count` 耗尽导致的孤儿筹码 T-ORPHAN-CHIP-RECOVERY-ENTRY）讲得很完整，本节只补代码级细节，**不重复那份文档已经讲清楚的部分**。

### 步骤 A — 铸定向筹码（`KanetTestToken` genesis）

**ctor 字段**（9 项）：`init_amount`=下注金额（USER）；`init_owner`=本市场 `ShardLeaf_direct` 的 covenant id（**注意是 covenant id，不是脚本 hash**——`OpInputCovenantId`/`OpOutputCovenantId` 返回的是链上真实分配的 covenant id，只有在 `ShardLeaf_direct` 已经上链之后才能查到；如果这是"market_genesis 刚广播完、bet 立刻跟上"的场景，covenant id 需要从刚广播的那笔交易的输出里查——这是一个需要在实现阶段确认"covenant id 怎么从一笔刚广播的 genesis 交易输出里算出/查出"的技术点，理论上 covenant id 是输出脚本的确定性函数，不需要真的等链上确认，但**没有实测验证过**，标注为待验证）；`init_owner_scheme`=`0x04`（`SCHEME_COVENANT_ID`）；`init_borrow_scheme`=`0x00`；`init_borrow_guard`/`init_extension_commitment`=`ZERO32`；`market_tmpl_suffix`/`market_tmpl_suffix_len`=协议常量（`ShardLeaf_direct` 编译产物的字节码尾部——需要先编译一份 `ShardLeaf_direct` 拿到这个尾部字节，本身与具体市场无关，可以在 §2 算协议常量那批一起算）；`max_ins`/`max_outs`=协议常量。

**sign_input_indices**：一个 fee input（relay 出资，覆盖这笔 genesis 交易 mass 费 + KTT 输出的 dust）。genesis 不需要签名。

**找零/手续费形状**：同 §2 market_genesis 的通则——fee input 覆盖 mass 费 + `init_amount` 对应的... **不对，`init_amount` 不是 KAS，是代币的内部计数值**（`KanetTestToken` 的 `amount` 字段是代币数量，不是 sompi）。这笔 genesis 交易真正花掉的 KAS 只是 mass 费 + 给 KTT 输出的 dust 垫底（同 §2 的量级建议），`init_amount` 这个数字只出现在 covenant 的 state 里，不对应真实转移的 KAS。

### 步骤 B — spend 进市场（`ShardLeaf_direct.register_append`）

**entry 参数**（11 项，按源码原序）：`side`（下注方向，来自请求体 `direction`）、`stake`（来自请求体 `amount`）、`leafOutIdx`（本交易输出里哪一个是续约的 `ShardLeaf_direct`，后端构造交易时自己排布，通常是 0）、`psOutIdx`（哪一个输出是新铸的 dust ticket）、`bettorPk`（v0 单操作员：复用 committee keypair 的公钥，见 §5 裁定）、`ps_prefix`/`ps_suffix`（`PoolSideTicket` 模板的 witness 前后段，来自 §2 算好的协议常量编译产物——`extractTemplateArtifact` 返回的 `templatePrefix`/`templateSuffix`）、`stakeInIdx`（步骤 A 铸的 KTT UTXO 在本交易输入里的索引）、`tok_out`（哪个输出是续约后的代币总量）、`tok_prefix`/`tok_suffix`（`KanetTestToken` 模板的 witness 前后段，同样是协议常量）。

**关键 require（已在 §1 前置材料摘录，这里只强调实现要点）**：`validateOutputStateWithTemplate(psOutIdx, Tk{...}, ps_prefix, ps_suffix, ps_tmpl_hash)`——这一行要求输出 `psOutIdx` 的脚本字节精确等于 `ps_prefix ‖ 编码后的 Tk state ‖ ps_suffix`，**`ps_prefix`/`ps_suffix` 必须与 `ps_tmpl_hash`（`ShardLeaf_direct` genesis 时烤进 ctor 的那个协议常量）来自同一次编译**，不能"编译两次、用串了"。`leafOutIdx` 那个输出是**手写 AB11 state 编码**（不走 `validateOutputState`，源码注释明写"leaf 自身续约手写编码"）——这部分字节拼接逻辑（`byte[](8 as byte[1]) + byte[]((local_yes+...) as byte[8])` 那种手写状态序列化）**必须逐字节照抄 `ShardLeaf_direct.sil` 源码里 `register_append` 的那段 `stateBytes` 构造，不能凭理解重新实现**——这是 T4-lite 检查的重点对象（见下）。

**sign_input_indices**：这笔交易**理论上不需要 fee input**——如果步骤 A 铸的 KTT 输出金额已经覆盖了这笔 spend 交易的 mass 费，且 `ShardLeaf_direct`/dust ticket 两个 covenant 输出都只需要 `DUST_MIN` 量级的 KAS（这些 KAS 是从"消费的 covenant 输入"里继承来的，`ShardLeaf_direct` 输入本身带着的 KAS 金额 + 步骤 A 那笔 KTT 输出附带的少量 dust，理论上够覆盖续约后两个输出的 dust 需求）——**但这需要精确的 KAS 记账验证，如果不够，仍然需要一个 relay fee input**。**本文档裁定**：为了不在"精确算清楚 covenant 自带的 KAS 够不够"这件事上冒险（算错 = 交易因为 mass 费不足或某个输出低于 dust 而被 kaspad 拒绝），**步骤 B 也带一个小额 relay fee input**，即使可能多余，换取"不会因为 KAS 记账算错而广播失败"的确定性——这是原型期的保守选择，不是最优 gas 效率选择。

**找零/手续费形状**：同上，fee input 小额覆盖 mass 费余量，找零回 relay。

### T4-lite 人工核清单（步骤 A + B 各自广播前）

1. 步骤 A：`init_owner` 确实是本市场 `ShardLeaf_direct` 的真实 covenant id（不是随手填的市场 `id` 字符串本身，也不是脚本 hash）。
2. 步骤 B：`ps_prefix`/`ps_suffix`/`ps_tmpl_hash` 三者来自**同一次**编译产物（不是分别调用两次编译取的不同结果）；`tok_prefix`/`tok_suffix`/`token_tmpl_hash` 同理。
3. 步骤 B：手写 `stateBytes` 序列化的字段顺序、字节长度（每个 `int` 8 字节前缀+8 字节值）与 `ShardLeaf_direct.sil` 源码逐字节对照，**这是最容易凭"应该差不多"写错的地方**，必须真的打开源码文件并排对照，不能凭记忆写。
4. 步骤 B：`bettorPk` 传的是 committee keypair 的公钥（v0 单操作员裁定），不是随便生成的一次性值——这个字段虽然合约不校验签名绑定（`T-PROTO-BETTORPK-BINDING` 已知限制），但如果传错，claim 阶段 `RootClaim.claim_draw` 的 `tk.bettorPk` 会读到错误值，导致后续 payout merkle leaf 算不对。

### 失败态回滚

`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §2.3 的失败态矩阵表 + §2.3.1 的 `proto_bet_intents` 状态机（A/B 两个 intent_key，B 的 `depends_on` 指向 A）**已经是完整设计，直接套用**，本文档不重复。落码时的具体 `intent_key` 格式 = `proto-bet:<betId>:mint`（A）/`proto-bet:<betId>:append`（B），与已经落码的 `proto-bet-intent.mjs`（`betIntentKeyFor`）字面对齐，不需要新设计。

## §4 market_resolve（`POST /api/proto-markets/:id/resolve`）

### 合约/entry

`entry close_commit(c0Pk..c4Pk, c0Sig..c4Sig, rootOutIdx, new_winningSide, new_payoutRoot, tok_prefix, tok_suffix)` on `RootClose`。

**前置**：这个端点假设市场已经走过 `convert_to_rootclose`（§3 描述的"达到 seal_count 后单独一次操作员触发的动作"，`docs/...v0.1.md` §2.3 末尾提到但没有独立编号——**本文档补一个明确编号 §3.5 `market_seal`**，见下）。

### §3.5（补编号）market_seal — `entry convert_to_rootclose` on `ShardLeaf_direct`

原设计稿把这一步写在 §2.3 末尾、没给独立端点编号，容易被漏掉——**本文档明确它是一个独立的、需要单独触发的动作**（不是 resolve 端点内部自动做的，因为"下注"和"封盘"是不同权限/时机的动作，不应该揉进一个请求，原文已经这么裁定，这里只是补齐编号让它在实现清单里不会被漏掉）。

`entry convert_to_rootclose(rcOutIdx, rc_prefix, rc_suffix, tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix)` on `ShardLeaf_direct`。`rc_prefix`/`rc_suffix` 来自 §2 market_genesis 阶段已经算好并烤进 `ShardLeaf_direct` ctor 的 `rootclose_tmpl_hash` 对应的那次编译产物（同一份，不要重新编译一次不同 ctor 的 `RootClose` 然后用错前后段）。**sign_input_indices**：一个 fee input（覆盖 mass 费——这笔交易把 `ShardLeaf_direct` 转成 `RootClose`，KAS 从 `pool_value` 继承过去，理论上不需要额外注资，但同 §3 的保守裁定，带一个小额 fee input）。

### close_commit 的 ctor 无关字段——entry 参数

`c0Pk..c4Pk` 全部填 committee keypair 的同一个公钥（§5 裁定）；`c0Sig..c4Sig` 全部是**用同一把私钥、对本笔交易签 5 次**——这不是"抄 5 份同一个签名字节"，`checkSig` 每次调用可能因为 nonce 随机性产出不同的签名字节（同 `docs/provenance/2026-09-14-j2-sign-only-declared-inputs-verification/` 已经验证过的 schnorr 随机数事实——但由于验证的是**同一笔交易同一个 index** 的签名，5 次调用如果用的是同一个 `createInputSignature(tx, activeInputIndex, committeePrivKey, sighashType)`，理论上可以就用**同一个签名值填 5 遍**，不需要真的调用 5 次——**这是一个需要在落码时确认的技术细节**：`checkSig` 是否要求 5 个 `sig` 参数字节不同？源码里没有 distinctness 检查（§5 裁定的前提），所以填同一个签名值 5 遍应该是合法的，但**没有实测验证过合约是否会因为"5 个 sig 字节相同"而有什么隐藏的问题**，标注为落码时用离线向量核实的点）；`new_winningSide`=用户在请求体传的 `outcome`；`new_payoutRoot`=见下 §4.1。

### §4.1 new_payoutRoot 计算（depth-1 专用，不复用 `pool-payout-root.mjs`）

按 §1.3 的发现，需要一个新的、depth-1 专用最小实现。v0 单操作员场景下，一个市场里赢的一方可能有 0、1 或多笔下注（`proto_bets` 表里 `side == winningSide` 的所有 `confirmed` 行）——但 `RootClaim.claim_draw` 的 merkle 验证是"每一笔独立 claim"（`claim_draw` entry 一次只处理一张 `PoolSideTicket`，`payout` 参数是这一张票的应得金额，不是聚合金额），所以 **depth 实际对应的是"最多同时有几个不同的 `payout` 取值需要落进同一棵 merkle 树"**——如果 v0 场景就是"每个赢家各自的 `payout` 各不相同"（因为按下注比例分账），最多 2 个赢家时 depth-1 恰好够用；**如果赢家数量超过 2，depth-1 不够**，需要在 `market_resolve` 端点里显式校验"赢的一方下注笔数 <= 2"，超过则拒绝 resolve（**这是一个 v0 范围限制，需要写进已知限制清单，不是本文档能修的合约层容量问题**）。

最小实现（新文件建议 `proto-payout-root-depth1.mjs`，不改 `pool-payout-root.mjs`）：

```js
// leaf = blake2b(bettorPk(32B) ‖ payout serialized as i64(8B))，与 RootClaim.sil 的
// `cur = blake2b(tk.bettorPk + serialize(payout,8))` 完全一致的序列化方式(必须逐字节对照源码,
// 不是"应该差不多"的 int→bytes 转换——8 字节大端/小端、有无符号扩展都要跟合约的 `as byte[8]` 转型
// 规则核对一致, 这是落码阶段的 T4-lite 重点)。
// depth-1: 0 个赢家 leaf ⇒ payoutRoot = ZERO32(理论上不应该发生, 但要有确定行为); 1 个 ⇒ root = leaf 本身
// (tree_depth=0, merkle_index=0, siblings=[]); 2 个 ⇒ root = blake2b(leaf0 ‖ leaf1)(tree_depth=1,
// merkle_index=0/1, siblings=[leaf1]/[leaf0])。
```

### T4-lite 人工核清单

1. `committee_hash` 的 5 个 `c0Pk..c4Pk` 与市场创建时烤进 `RootClose` ctor 的那把公钥逐字节一致（不是"看起来对"，是真的复制粘贴/程序化比较）。
2. `new_payoutRoot` 用**独立**代码路径重算一遍（比如手工 `blake2b` 一次，不调用同一个函数两次自证），与 `buildAndBroadcast` 里实际要广播的值比较。
3. `rc_prefix`/`rc_suffix`（`market_seal` 那笔）与市场创建时烤进 `ShardLeaf_direct` ctor 的 `rootclose_tmpl_hash` 来自同一次编译。
4. 赢的一方下注笔数 <= 2（depth-1 容量上限），超过时端点应该拒绝而不是静默截断/出错的 payoutRoot。

### 失败态回滚

单笔交易（`market_seal`）+ 单笔交易（`close_commit`），各自独立走 NO-TX-NO-STATE：`market_seal` 广播失败不推进 `proto_markets.status`；`close_commit` 广播失败不推进到 `resolved`。两笔之间不需要 `proto_bet_intents` 式的依赖链（这是操作员显式分两次点击的动作，不是自动串联的复合动作，用简单的"检查当前 `status` 字段决定下一步允许做什么"就够）。

## §5 claim（`POST /api/proto-markets/:id/claim`）

### 合约/entry

赢家路径：先 `RootClose.convert_to_claim(claimOutIdx, claim_prefix, claim_suffix, tokenInIdx, tokenOutIdx, tok_prefix, tok_suffix)`（新建 `RootClaim`），再 `entry claim_draw(rootOutIdx, claimOutIdx, tokenInIdx, tokenOutIdx, remainTokenOutIdx, payout, merkle_index, tree_depth, siblings, ticketInIdx, ticket_prefix_len, ticket_suffix_len, tok_prefix, tok_suffix, claim_prefix, claim_suffix)` on `RootClaim`。退款路径对称，`RootClose.convert_to_refundclaim` → `RefundClaim.refund_payout(...)`（参数序见 §1 前置材料，无 merkle 相关参数，退款金额直接等于票据 `stake`）。

`claim_prefix`/`claim_suffix`/`refundclaim_tmpl_hash` 这些字段全部来自 §2 market_genesis 阶段已经烤进 `RootClose` ctor 的协议常量（`claim_tmpl_hash`/`refundclaim_tmpl_hash` 编译一次即可复用于所有市场，因为 `RootClaim`/`RefundClaim` 的 ctor 本身除了这几个协议常量之外全是 `GENESIS-ZERO`/由 `convert_to_claim`/`convert_to_refundclaim` 现场填的值，不因具体市场而异）。

### sign_input_indices

`claim_draw`/`refund_payout` 都需要消费 `PoolSideTicket` 票据输入（`ticketInIdx`），这个输入的 `authorize_spend(sig bettorSig)` 需要 bettor（v0 = committee keypair）签名——属于 §1.2 表格里的**②层**，console 侧算好编码进票据输入自己的 `sigScript`，**不是** relay 的 `sign_input_indices`。`sign_input_indices` 仍然只对应 relay 自己出资的 fee input（同样是保守裁定，带一个小额）。

### 找零/手续费形状

同前几节通则。`convert_to_claim`/`claim_draw`（或对称的 refund 路径）建议分两笔广播（原设计稿已经建议"先 `convert_to_claim`，界面显示可领取，再 `claim_draw`，分两步更好排错"），两笔各自独立的 fee input + 找零。

### T4-lite 人工核清单

1. `ticketInIdx` 指向的确实是这个 bettor 自己那张票据的 UTXO（不是别人的票——v0 单操作员场景理论上只有一张票在场，但仍然要程序化核对 `ticketInIdx` 对应的 UTXO outpoint 与 `proto_bets.ticket_txid`/`ticket_vout` 一致，不是靠"应该是这个"的假设）。
2. `payout`/`merkle_index`/`tree_depth`/`siblings` 与 §4.1 独立重算的结果逐字节一致。
3. `claim_prefix`/`claim_suffix`/`claim_tmpl_hash`（或 `refundclaim_*`）三者来自 market_genesis 阶段的同一次编译产物。
4. `remainTokenOutIdx` 那个续约输出（如果 `pool_value != payout`）的金额 = `pool_value - payout`，与手工核算一致——这是"部分 claim，市场池继续存在"分支，容易漏算或算错剩余金额。

### 失败态回滚

同 resolve，两笔（`convert_to_claim` + `claim_draw`）各自独立 NO-TX-NO-STATE，`proto_claims` 只在 `claim_draw`（或 `refund_payout`）确认后才 `INSERT`。

## §6 withdraw（`POST /api/proto-markets/:id/withdraw`）

### 合约/entry

`entry spend(sig s, tok_in_idx, tok_out_idx, to_market_input, dest_idx, tok_prefix, tok_suffix, market_suffix_witness)` on `KanetTokenClaim`。v0 场景 `to_market_input=false`（提到自己名下，不是转进另一个市场输入），`dest_idx` 指向输出里赢家自己的目的地脚本（一个普通的 P2PK 地址，不是 covenant）。

### sign_input_indices

`sig s` 是赢家（v0 = committee keypair）对这笔交易的签名，属于 §1.2 表格**②层**，console 侧算好编码进 `KanetTokenClaim` 输入自己的 `sigScript`。`sign_input_indices` 只对应 fee input。

### 找零/手续费形状

同通则。这是链条终点，`tok_out_idx` 对应的输出直接是赢家可花费的普通地址输出（不再是 covenant），金额 = `amount`（`KanetTokenClaim` state 里烤的应得数量，注意这仍然是**代币数量**，不是 KAS——这笔 `spend` 交易本身的 KAS 侧仍然是 mass 费 + fee input 找零的逻辑，代币数量的转移是 covenant state 层面的事，两者不要混）。

### T4-lite 人工核清单

1. `dest_idx` 对应的输出脚本确实是赢家自己控制的地址（不是随手填的占位地址——v0 没有真正的"赢家自己的钱包"概念，界面持有的就是 committee keypair，所以这里的"赢家地址"实际上是从 committee keypair 派生的一个地址，需要在实现时明确这个派生关系，不能凭空造一个新地址）。
2. `tok_prefix`/`tok_suffix`/`token_tmpl_hash` 与协议常量一致。

### 失败态回滚

单笔交易，NO-TX-NO-STATE，广播成功才更新 `proto_claims.withdrawn_at`/`withdraw_txid`。

## §7 已知限制清单（汇总，不得漂成"已处理"）

除了 `docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §8 已经记录的 `T-PROTO-BETTORPK-BINDING`（`register_append` 无签名绑定竞态）、`T-ORPHAN-CHIP-RECOVERY-ENTRY`（孤儿筹码无回收入口）之外，本文档新增：

- **T-PROTO-COVENANT-ID-TIMING**：§3 步骤 A 的 `init_owner`（本市场 covenant id）是否需要真的等 `market_genesis` 交易确认后才能查到、还是可以在广播前就确定性算出——未实测验证，标注待落码核实。
- **T-PROTO-PAYOUT-DEPTH-CAP**：§4.1 的 depth-1 上限导致 v0 最多支持每个市场 2 个"不同 `payout` 取值"的赢家（不是 2 个赢家笔数，是 2 个不同金额）——超过需要显式拒绝 resolve，不是静默出错。
- **T-PROTO-COMMITTEE-SIG-DISTINCTNESS**：§4 的 `close_commit` 5 个 `sig` 参数是否可以填同一个签名值 5 遍（合约没有 distinctness 检查是前提条件，但"5 个相同字节"这个具体场景没有实测过），标注待落码时用离线向量核实。
- **T-PROTO-WITHDRAW-DEST-ADDRESS**：§6 "赢家自己的地址"在 v0 场景下实际上是 committee keypair 派生的地址，不是真正独立的用户钱包——这是 v0 单操作员模型的自然延伸，不是新发现的漏洞，但界面上不能暗示这是"用户自己的钱包地址"，需要如实展示。
- **T-PROTO-ENTRY-WITNESS-ABI-UNVERIFIED**（NWT GREEN-with-notes 第 5 票，1385，须在 resolve 落码前 close）：§1.2 表格②层"委员会/bettor witness 签名"作为 entry 调用参数传入这件事，本文档只描述了机制（`createInputSignature` 算出的签名字节编码进 entry 调用参数），**没有实测验证 silverscript entry 的具体 ABI 编码方式**（参数顺序、`sig` 类型在字节码层面期望的确切编码——是否等价于 `checkMsgSig` 直接接受的形状、还是需要额外包装）与本文档假设的编码方式逐字节一致。落 `market_resolve`（`close_commit` 5 个 `sig` 参数）代码前，必须先用离线 cli-debugger 向量核实一遍真实签名字节能被合约 `entry` 正确校验通过，不能只凭本文档的文字描述就假设 ABI 对得上。
- **T-PROTO-FEE-UTXO-SELECTION-UNIMPLEMENTED**（NWT 1387 架构裁定②，见 §9.5，未落码）：`buildAndBroadcast` 选 fee input UTXO 的"最小满足面值 + 找零形状校验 + fail-loud"选择器逻辑尚未实现（v0 范围不含自动拆分，见 §9.5 范围裁定，种子已改 4×0.5 KAS 规避首次金丝雀对拆分的依赖）——落码前如果误用"随手抓一个能用的 UTXO"会绕开这条设计意图，即使技术上暂时能广播成功。

## §8 关于"生产 daemon 复用现有 legacy wrapper 会不会因为这次改动受影响"——不会

本文档 §1.1 的裁定（proto v0 全部走 `compileSilV100`，不碰 `compileSil` 系函数）**只影响 proto v0 自己新写的代码**，不改动 `pool-bshard-artifacts.mjs` 里任何一个既有函数的实现——`pool-shard-register.mjs`/`pool-bshard-market-setup.mjs`/`pool-refund-builder.mjs`/`pool-register-builder.mjs` 等生产代码继续用它们现在用的 `compileSil`/`computeSpineArtifact`/`computePoolSideArtifact`（那些合约是 legacy 语法，本来就该用这条路径），proto v0 只是**新增调用**，不修改、不共享任何既有生产调用点。

## §9 `buildAndBroadcast` 实现规范（NWT 三条落地要求，1382 追加，覆盖全部 5 个 kind）

### §9.1 总余额复核接进执行路径（不只在启动查一次）

`assertProtoRelayHealthy()`（`proto-relay-guard.mjs`）目前只在 console 启动时调一次——**这不够**：market_genesis 之后每一笔 covenant_broadcast 都会花掉 relay 自己的 KAS（fee input），如果不重查，`<5 KAS` 这条硬顶只在启动那一刻成立，运行一段时间后可能早已超标而没人发现，只有下次重启才会被重新检查到。

**⇒ `buildAndBroadcast` 每次真正发起 `covenant_broadcast` 之前，必须重新查一次 proto relay 的链上余额**，仍然是 `<PROTO_MAX_BALANCE_KAS` 才允许继续，超标 fail-closed（不广播，报错）。**节流**：距上次检查 `>60s` 才重查（不是每笔都打一次 RPC/REST，既有 `assertProtoRelayHealthy` 的 `getBalanceFn` 注入点可以直接复用，`buildAndBroadcast` 内部维护一个 `lastBalanceCheckAt`/`lastBalanceCheckResult` 的模块级缓存，60s 内命中缓存不重查）。这是每个 kind 广播前的共同前置步骤，不单独在某一节重复写。

### §9.2 私钥生命周期（明文私钥的作用域纪律）

`proto-committee-key.mjs` 这批只批了**加密/解密原语**（`generateCommitteeKeypair`/`encryptCommitteePrivkey`/`decryptCommitteePrivkey`），**真正调用 `decryptCommitteePrivkey` 拿到明文去算 §1.2 表格②层签名的调用点还没写**——写这部分代码时：

- 明文私钥**只存局部变量**，不赋值给任何会被闭包捕获、被序列化（`JSON.stringify`）、被写进日志、被塞进错误对象/错误消息的地方。
- 算完签名（`createInputSignature` 返回的签名字节本身不是私钥，可以正常使用/传递）后，**立即让明文私钥的局部变量引用置空/丢弃**（JS 没有真正的"内存置零"，但至少不再持有引用，不让它意外地在后续代码路径里被重新读到或被垃圾回收前长时间存活在可达的作用域链上）。
- 这条 NWT 到时候会专门核（同 `proto-committee-key.mjs` 已经落地的"源码零 `console.*` 调用"静态自审手法，届时可能会扩展到"真正使用明文私钥的调用点"这一层）。

### §9.3 代码风格：避免撞上 `R-PROTO-RELAY-ID-CONST` 的"40 行未闭合"误报

`sendCommandAsync` 调用的 `cmd` 参数，**先构造成一个具名变量再传，不要内联一个跨越很多行的字面量对象**——lint 规则 `R-PROTO-RELAY-ID-CONST`（`scripts/lint-kanet.mjs` 的 `extractCallArgSpanShared`）扫描调用实参时有一个 40 行的截断上限，NWT 实测：把 `cmd` 对象内联写在 `sendCommandAsync(...)` 调用括号里、跨度超过 40 行时，会被误判成"实参 40 行内未闭合(可疑)"而报错，即使第一个实参明明就是正确的 `PROTO_RELAY_ID` 常量。

**⇒ 写法约定**：

```js
// ✅ 推荐
const cmd = { type: 'covenant_broadcast', intent_key: key, tx_json: txJson, sign_input_indices: [0], expected_txid: txid };
await sendCommandAsync(PROTO_RELAY_ID, cmd, 30000, 'internal');

// ❌ 避免：cmd 字面量内联跨度大, 撞 40 行扫描上限
await sendCommandAsync(PROTO_RELAY_ID, { type: 'covenant_broadcast', /* ... 40+ 行 ... */ }, 30000, 'internal');
```

本条是纯代码风格规范，不改动 lint 规则本身（40 行上限是 `R-SCA-ALIAS-ORIGIN`/`R-SENDCMD-ORIGIN-REQUIRED`/`R-PROTO-RELAY-ID-CONST` 三条规则共用的既有引擎 `extractCallArgSpanShared`，改它的扫描窗口影响面超出本次范围，写代码时避开触发条件即可）。

### §9.4 fee cap 两层架构：relay 硬编码 GLOBAL vs console 硬编码 per-kind（NWT 1387 架构裁定，回应"写进 §9.2 修订"要求）

> 📌 本节回应 NWT 消息原文"两层各自独立，写进设计稿 §9.2 修订"——**编号落在 §9.4 而不是 §9.2**：既有 §9.2 是"私钥生命周期"（不同主题，Bettor 1382 裁定的既有编号，不能挪位/覆盖），本条按内容归入 §9（buildAndBroadcast 实现规范）新增一节，避免编号冲突覆盖既有正文；内容完整落实 NWT 的要求，只是章节号不同，特此说明避免"号对不上"的误解。落码见 `kasia-relay/src/lib/covenant-broadcast.mjs` + `covenant-broadcast-relay.mjs` 提交 `14c9cf22`。

`validateNetLoss` 的 fee ceiling 现在是**两条独立生效的防线**取最小值（§1.4 已更新公式），职责严格分层，**任何一层都不能依赖另一层的正确性**：

1. **per-kind 精细上限（`absFeeCapSompi`）——职责在 console 侧**：每个 kind 各自的 mass 实验（§1.4、genesis 见 provenance `2026-09-14-j2-proto-v0-genesis-mass-fee-estimate`）算出 `cap[kind] = measured_min_net_loss[kind] × 2`，**硬编码**在 console 侧 `buildAndBroadcast` 里各 kind 自己的代码路径（例如 `const CAP_MARKET_GENESIS = 80_000_000n; // 0.4 KAS × 2, 见 provenance`），调用 `validateNetLoss(..., absFeeCapSompi: CAP_MARKET_GENESIS)` 时直接传常量字面量。**这个值绝不能来自请求体/命令字段/任何调用方可控的输入**——若来自外部输入，攻击者可以给任意一笔交易贴上"cap 最宽的 kind"标签绕过更严格限制（这正是 NWT 指出的攻击面）。
2. **全局硬顶（`GLOBAL_ABS_FEE_CAP_SOMPI = 1.0 KAS`）——职责在 relay 侧**：relay（`covenant-broadcast-relay.mjs`）调用 `validateNetLoss` 时，`absFeeCapSompi` 参数**硬编码**为 `GLOBAL_ABS_FEE_CAP_SOMPI` 字面量，**绝不读取 `cmd` 对象里任何"这次该用哪个 cap"的字段**（哪怕未来某天有人想加一个 `cmd.abs_fee_cap_sompi` 字段图方便，也不能让 relay 信任它——relay 完全不知道、也不需要知道"这是哪个 kind"，它只做与 kind 无关的最终兜底）。

**两层不是"选一层就够"，是缺一不可的 defense in depth**：即使 console 侧某个 kind 的 per-kind cap 写错（比如手滑复制粘贴了别的 kind 的值、或者以后新增 kind 忘了单独硬编码），relay 侧的 GLOBAL 硬顶仍然兜底防止 net_loss 无限增长；即使 relay 侧的 GLOBAL 硬顶定得比较宽松（1.0 KAS 远大于任何单个 kind 的真实需求），per-kind cap 仍然把每个 kind 收紧到它自己真正需要的范围，不会因为"反正 relay 兜底"就疏于给每个 kind 单独算数。

**自验证记录（提交 `14c9cf22` commit message 已附，此处摘要供设计稿读者不必翻 commit）**：注入回归模拟"relay 信任 cmd 传来的 cap"，用一笔合法交易 + 恶意极小 `cmd.abs_fee_cap_sompi='1'` 验证：注入态下合法交易被错误拒绝（证明这条攻击面真实可触发），revert 后测试全绿。另发现当前参数下 `SIGNED_INPUT_CEILING_SOMPI` 与 `GLOBAL_ABS_FEE_CAP_SOMPI` 数值恰好相等（都是 1.0 KAS），使得"cmd 贴恶意大 cap 让 net_loss 超 GLOBAL"这条具体路径被更早的独立闸门顺带挡住——这是当前数值配置下的巧合重叠，不代表硬编码 GLOBAL 这条修复本身没必要（两个上限未来分离后，重叠保护会消失）。

### §9.5 fee input 的 UTXO 选择（NWT 1387 架构裁定②，Bettor 复核后简化范围，实现期硬要求，未落码）

`SIGNED_INPUT_CEILING_SOMPI` 提到 1.0 KAS 后，relay 手头如果只有一个大额 UTXO 被当作某个小额 kind 的 fee input 使用，**这个 UTXO 自己的面值就会撞上 `SIGNED_INPUT_CEILING`/`GLOBAL_ABS_FEE_CAP_SOMPI` 而被误拒**——即使这笔交易真正花掉的 `net_loss`（扣掉找零后）远低于上限，因为 `validateSignedInputCeiling`/`validateNetLoss` 都是看"签了名的 input 面值"而不是"净损耗"来判定其中一部分逻辑（`validateSignedInputCeiling` 明确是看面值）。

> 📌 **范围裁定（Bettor 复核 14c9cf22 后，2026-09-14）**：原文这里设计的"面值匹配 + 无匹配先自找零拆分"**范围收窄**——本节只做**选择器**，**不做自拆分**（自拆分本身也受 1.0 KAS 上限约束、单个大额 UTXO 拆分逻辑留到之后单独设计，不在这批实现范围内）。配合此收窄，**执行页种子形状改为 4 笔 × 0.5 KAS**（KANet-UI 出，v0.4）——到账即是四个独立的 0.5 KAS UTXO，`market_genesis`（net_loss≈0.4 KAS ≤ cap 0.8 KAS，签名输入 0.5 KAS ≤ 1.0 KAS 上限）、bet_mint 步骤 A/B 各用一个即可，首次金丝雀不需要拆分就能跑通。

**⇒ `buildAndBroadcast` 选 fee input UTXO 时不能"随手抓一个能用的"**，选择算法（v0 简化版）：

1. 从 relay 自己的 UTXO 集合里，**选面值最小但仍 ≥ 本次所需金额（`estimatedFee + genesisOutputValue` 或对应 kind 的净花费）的那一个**——不是"选面值匹配的"这种模糊描述，是确定性算法：按面值升序排列，取第一个 `utxo.amount ≥ needed` 的 UTXO。
2. **找零形状约束（Bettor 复核新增要求）**：选中 UTXO 后算出的找零金额，**必须要么恰好为 0（UTXO 面值精确等于所需金额，无找零输出），要么 ≥ `DUST_MIN`（1000 sompi 量级）**——只判断"面值 ≥ 所需"不够：如果某个 kind 的所需金额与某个 UTXO 面值贴得很近，找零会落在 `(0, DUST_MIN)` 这个 kaspad 会拒绝的区间（低于 dust 下限但又不是恰好 0）。选择器必须把这种"会产生卡在 dust 附近的找零"的候选 UTXO 也排除掉，不能只看面值够不够。本批 4×0.5 KAS 的种子形状不会撞到这条（genesis 找零 ≈0.5−0.4=0.1 KAS，远高于 DUST_MIN），但规则现在就写进选择算法，不等未来某个贴近面值的 kind 撞上才补。
3. **如果没有任何 UTXO 同时满足①面值 ≥ 所需 ②找零形状合法**，**`buildAndBroadcast` 必须 fail-loud，返回明确的 `no_suitable_fee_utxo` 错误**，不静默降级、不随手抓一个凑合用的 UTXO、不自动拆分（自拆分逻辑见下方 T-PROTO-FEE-UTXO-SELECTION-UNIMPLEMENTED 票，留给之后单独实现）。

**T-PROTO-FEE-UTXO-SELECTION-UNIMPLEMENTED**（新增已知限制，本节机制未落码，待 `buildAndBroadcast` 具体实现时补齐，实现前 `market_genesis` 广播如果 relay 手头只有大额 UTXO 会直接被 ceiling 拒绝，属预期行为不是 bug）。
