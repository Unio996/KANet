# J2 → Bettor · DONE(核心)+ 一个阻塞点：D-035 KTT v2 实现

**分支**: `coord/j2-ktt-wallet-panel-20260927`，commit `20066ed5`，已推 origin。
**证据**: `docs/provenance/2026-09-27-j2-ktt-v2-simnet/README.md`——**12 笔真实 simnet 广播 txid +
3 条对抗拒绝原文**，全部真实节点(`--simnet --utxoindex`)真实广播，不是 cli-debugger 模拟。

## 六项逐条

**①KanetTestTokenV2.sil**：新文件，`KanetTestToken.sil` 老合约一个字节没动。`owner_scheme` 新增
`0x00`(pubkey, `checkSig`)与既有 `0x04`(covenant-id)并存；同笔 tx 混用两种 scheme——真实广播验证过
(第 8 笔 txid `611f857c...`：KTT-D(covenant-owned)+ Carol 的 KTT(pubkey-owned)各自独立续约成功)。

**②铸币**：`pool-bshard-artifacts.mjs` 新增 `computeKttV2TokenArtifact`(纯追加函数，**没有改动**既有
`computeKttTokenArtifact` 一行代码，已验证两者 template_hash 逐字节不变、v1 既有测试
`ktt-transfer-witness.test.mjs` 6/6 仍全绿——零回归)；relay 侧 `unlockKttV2Mint` 照抄
`unlockBshardGenesisMintStakeChip` 骨架。任何人可铸任意数量到任意地址(第 1/1b/9/11 笔 txid)。

**③转账**：`kcc20-token/ktt-v2-transfer-witness.mjs`(真实实现了 State[] 的 SoA 转置编码，不是简化
版)+ `ktt-v2-sdk.mjs`(console 侧高层封装)+ relay 侧 `unlockKttV2Transfer`(照抄式编码器，遵守
kasia-relay 既有的"不跨包 import kasia-console"纪律，`p2sh.mjs:2882` 头注原话)。**真实转账 + 找零
+ 真实回收(round-trip re-spend)验证过**：Alice→Bob(第 2-fixed 笔)→Bob→Carol(第 3 笔，证明②不是
"看起来能花"而是真的能再花一次)。

**④relay 三层注册**：`commands.mjs`(COMMAND_TYPES + PAYLOAD_SCHEMA + FIELD_TYPES 三处都补了)+
`relay.mjs`(两个 case)+ `p2sh.mjs`(两个 handler 函数)。`lint-kanet.mjs` 的
`R-COMMAND-REGISTRATION` 没有对我新增的 `KTT_V2_MINT`/`KTT_V2_TRANSFER` 报警(说明三层没漏)。

**⑤DB**：`migrate.js` v218，`ktt_holdings_ledger` 表(设计稿④本地记录表)，纯新增，跑过完整
v196→v218 全链迁移测试(对着一个全新临时库跑通，证明我这一版没打断任何前序迁移)。

**⑥对抗清单**(全部真实广播，不是纸面推理)：
- owner=0(`next_states[0].owner=ZERO32`)→ 真实拒绝：`script ran, but verification failed`
- 错误签名者(用 Bob 的私钥签 Carol 的 KTT)→ 真实拒绝：同上错误
- **NWT 补的 SHOULD 项**(`sigs.length != owner_input_idx.length`，手工构造 0 个签名喂 1 个下标)→
  真实拒绝，且是一个**不同类**的错误：`substring [0:65] is out of bounds for string of length 0`——
  证实 NWT 自己的判断("越界读取更可能导致验证失败，不是拒绝被绕过")是对的，不是靠猜。

## 实现过程中真实撞出、修的 7 个 bug(不是设计阶段就想到的)

最重的一个：**continuation 输出漏 `CovenantBinding` = 铸出的代币永久不可再花**。第一次转账
"成功"落链(第 2 笔 txid)，但事后一查 `covenantId` 是 `undefined`；再花它就撞
`covenant id 0000...0000 input 0 is out of bounds`(跟 `p2sh.mjs` 里既有 `unlockBshardGenesisMintStakeChip`
头注记录的坑同一段文字)。修法：continuation 输出要显式 `new CovenantBinding(authInputIdx, new
Hash(继承的 covenant_id))`，照抄本仓 PayoutShard/ShardLeaf 的既有先例——不是 genesis 那套
(`populateGenesisCovenants`)。**修复后没有只信"落链了"就算数，专门做了一次 round-trip re-spend
(第 3 笔)真的把它再花了一次去验证。** 其余 6 个(KIP-9 storage mass / coinbase 成熟期 / 签名
push-opcode 前缀 / relay 侧字段名不对齐 / 费用常量不够 / next_states 基数不匹配)见 provenance
README，逐条写了真实报错原文与修法。

## 一个阻塞点：tokens.js 撞 M0a 门，未随本次提交

`kasia-console/src/api/tokens.js`(铸币/转账/查阅三条 API)与 `kasia-console/src/ui/tokens-list.eta`
(`/tokens` 页面新增 KTT v2 区块)**代码已经写完**，逻辑跟已经真实验证过的 SDK/relay handler 调用
形状一致——但 `tokens.js` 新增 `import { sendCommandAsync } from '../services/relay-manager.js'`
撞了 `R-SENDCMD-ORIGIN-REQUIRED`(已修，补了 origin='app')之后又撞了
`R-M0A-BARE-IMPORT-DIFF`(件④ money-path manifest 门禁)——`tokens.js` 之前不在 baseline 里，新增
一个裸 relay-manager import 需要经 NWT 审的 manifest 条目才能过 pre-commit 闸。`pool.js` 已经有一条
一模一样的 baseline 条目(`import { sendCommandAsync, transferAndConfirm, isRelayAlive } from
relay-manager.js`)，理论上可以走"改从 pool.js 转一手"绕开检测，但那是在钻这个闸的空子而不是走它
本来设计的审核通道——这是钱路控制点，我不该自己拍板绕过。

两份文件原样留在我自己的隔离 worktree 里(`scratch/_j2_wt_ktt_panel`，未 staged，不会丢)，等你/NWT
裁定：① 给 tokens.js 加一条 manifest 条目审过，还是 ② 改走别的注入方式(比如从 pool.js 里已批的
`registerPoolRoutes` 传一个 `sendCommand` 函数进来)。核心钱路(合约/编码/relay 广播)已经全部真实
验证完毕，不受这个阻塞点影响。

停在这里等裁定。
