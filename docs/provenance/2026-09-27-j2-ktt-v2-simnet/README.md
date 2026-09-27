# D-035 KTT v2 实现 — simnet 真共识证据(全部真实广播, 非 cli-debugger 模拟)

节点: `--simnet --utxoindex`(`D:/kanet-tn12/scratch/_j2_instant_split_freshnet/node-data`,
borsh RPC `ws://127.0.0.1:29817`)。编译器: D-019 pin `silverc-v100-3ed9733.exe`(通过
`compileSilV100`/`computeKttV2TokenArtifact` 调用, 与生产同一份二进制, 未改动)。

## 真实 txid 清单(先后顺序)

| # | 场景 | txid | 结果 |
|---|---|---|---|
| 1 | genesis mint, owner_scheme=0x00(pubkey, Alice) | `a06ddf3e5615a8824b1ec16faee5fcdbcce033e6dafb0ae827f898e8b9392ff5` | 落链, 但**发现真 bug**(见下) |
| 1b | genesis mint, owner_scheme=0x00(pubkey, Alice, 重铸) | `e4ff55c0512511a0b379ff5a422831f72dc89e30f6c560d6011827dee031df1e` | 落链(供 #2 修复重试用) |
| 2 | transfer A→B(checkSig, next_states=[]) | `1b2a530619c1b98653c148c738dfb7af9246d318cfe4cb7f70b34164882595a1` | 落链, **但 covenant_id=undefined(永久不可花, 真 bug)** |
| 2-fixed | transfer A→B(checkSig, 修复后: CovenantBinding + next_states=[1元素]) | `9d43d9c7e0cde5993d81232357b66cba779a829d08a12ab9ba5a63d151769416` | 落链, covenant_id 正确延续 |
| 3 | transfer B→C(round-trip re-spend, 证明②真的可再花) | `040a7c0a2db07c38839ff1470bf793c2ca65a56e12000aa33477fb196e9f0c9f` | 落链, Bob 的正确绑定 UTXO 被消费, Carol 收到正确延续的 covenant_id |
| 4 | genesis mint, owner_scheme=0x04(covenant, KTT-D, owner=Carol 的 covenant_id) | `f4307c023dd83b036a7524eff5ebf8068ea2769dcec435481d922a67d3bdc1c9` | 落链 |
| 5 | **对抗①** owner=0(next_states[0].owner=ZERO32) | 尝试(未落链, 见下) | `Rejected transaction 63401d88...: script ran, but verification failed` |
| 6 | **对抗②** 错误签名者(Bob 签 Carol 的 KTT) | 尝试(未落链) | `Rejected transaction 74c83e0d...: script ran, but verification failed` |
| 7 | **对抗③**(NWT SHOULD) sigs.length≠owner_input_idx.length(0 vs 1) | 尝试(未落链) | `Rejected transaction 8494a05d...: script ran, but verification failed: substring [0:65] is out of bounds for string of length 0` |
| 8 | **混用同笔 tx**: KTT-D(covenant-owned)+Carol 的 KTT(pubkey-owned)独立续约 | `611f857c2a561aa906e56a3455f1e41352656283299782a363b51e21a6ab2cbd` | 落链, 两个独立实例各自续约成功 |
| 9 | SDK 模块(`ktt-v2-sdk.mjs`, 非 scratch 脚本)mint | `e7b772ac08a80d35111c13b5e134429aa95647fcc95f1699974e86132528c3d6` | 落链 |
| 10 | SDK 模块 transfer | `3acd7ee729bff611213f8f985adaf9020141fb3a2d49df994f166895b4885c5f` | 落链 |
| 11 | **relay 生产 handler**(`kasia-relay/src/lib/p2sh.mjs` unlockKttV2Mint) | `469581a4a598bd5584de598830ba0cf43a03a805fd3fd8dac2e89a61fd2450c6` | 落链 |
| 12 | **relay 生产 handler**(unlockKttV2Transfer) | `0338612158905431a1ce4354bad0b741b443debaed1844042e0679d64bbf2ca3` | 落链 |

## 实现过程中发现并修复的真 bug(不是设计阶段就想到的, 全部真实广播撞出来)

1. **continuation 输出漏 `CovenantBinding` = 永久不可再花**。第一次 A→B 转账(#2)在没有显式绑定
   `CovenantBinding` 的情况下"成功"落链, 但落链后查询 `entry.covenantId` 为 `undefined`——再次尝试
   花费它(供对抗测试用)时 kaspad 报 `covenant id 0000...0000 input 0 is out of bounds`(与
   `p2sh.mjs` 里 `unlockBshardGenesisMintStakeChip` 头注记录的已知坑同一段文字)。修法: continuation
   输出必须 `new CovenantBinding(authInputIdx, new Hash(继承的 covenant_id))`, 同本仓既有
   PayoutShard/ShardLeaf continuation 先例(`new CovenantBinding(0, new Hash(psCovId))`)——不是
   genesis(`populateGenesisCovenants`), 两者是不同机制, 不能混用。修复后(#2-fixed)重新验证, 且用
   #3(round-trip re-spend)**真实再花了一次**, 不是只看落链就信。
2. **`next_states=[]`(清空)与"有一个续约输出"是矛盾状态**——`transferPolicy` 的 wrapper 做
   cardinality 检查(声明的 `next_states.length` 要与本 covenant 组自己的续约输出数一致), 加了
   `CovenantBinding` 后本组有 1 个续约输出, 若还用"清空"编码器会撞 `script ran, but verification
   failed`。修法: 用 1 元素的 `next_states`, 真实实现了 State 数组的 SoA(struct-of-arrays)转置编码
   (`encodeKttV2TransferAction`), 不是简单改一个数字。
3. **KIP-9 storage mass**: funding UTXO(~39-50 KAS)与 KTT 面值悬殊(最初试 5,000,000 sompi)被拒
   `storage mass of 800000 > max 500000`——大额输入拆成小额 covenant 输出+大额找零的形状触发更高
   倍率计算(covenant 输出 plurality 更高)。修法: 铸币面值定得接近 funding 全额, 不留大额找零。
4. **coinbase 成熟期**: 手续费 UTXO 选到刚挖出的(daa 差 117<1000)被拒 "hasn't passed yet"。修法:
   显式挑 `blockDaaScore < virtualDaaScore - 1000`的。
5. **`createInputSignature` 输出 66 字节**(push-opcode 0x41 + 64B 签名 + 1B sighash 类型), ABI 的
   `sig` 类型只要后 65 字节——同 `proto-tx-assembly-settlement.mjs:463-470` 已记录的既有惯例, 本轮
   独立撞到、独立确认。
6. **relay 侧手写编码器的字段名 bug**: `unlockKttV2Transfer` 第一次把 `nextStates` 对象的键写成驼峰
   (`ownerHex`/`ownerScheme`)但 `_encodeKttV2TransferAction` 内部按 State 字段原名(`owner`/
   `owner_scheme`)读——真实调用当场报 "owner must be 32 bytes, got 0"(不是猜出来的, `_toAbiSig65`/
   `_encodeKttV2TransferAction` 两处独立命名约定没对齐)。修复后 relay 生产 handler 的 mint+transfer
   两条真实广播全绿(#11 #12)。
7. **`_bshardFeeV1(2)`(2,000,000)不够 KTT transfer 的真实 compute mass**(实测 51,776, 需要
   5,177,600+)——checkSig 校验比裸 genesis/轻量 2 输入操作贵得多, 不能沿用给别的操作校准的常量,
   relay handler 里单独定了一个够用的费用常量(6,500,000)。

## 目录内容

- `01`-`09`: 按时间顺序的真实 simnet 测试脚本(含上面表格每一行的构造过程)。
- `common.mjs`: 共享 RPC/密钥辅助函数。
- `mine.mjs`: simnet 出块脚本(`getBlockTemplate`+`submitBlock`, 无需真实 PoW)。
- `*_output.log` / `*.json`: 真实运行留痕(txid、covenant_id、rejection 原文全部来自这些文件, 上表
  逐条可反查)。

## 对应生产代码(已合入本分支, 非 scratch)

- `kasia-console/src/lib/sil-v1/KanetTestTokenV2.sil` — 新合约(D-035 §②)。
- `kasia-console/src/lib/pool-bshard-artifacts.mjs` — 新增 `computeKttV2TokenArtifact`(纯追加, 未改
  既有 `computeKttTokenArtifact`, 已验证 byte-identical)。
- `kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs` / `ktt-v2-sdk.mjs` — console 侧
  编码器 + 高层构造函数(#9 #10 真实验证过)。
- `kasia-relay/src/lib/commands.mjs` / `relay.mjs` / `p2sh.mjs` — relay 侧三层命令注册 +
  `unlockKttV2Mint`/`unlockKttV2Transfer`(#11 #12 真实验证过, 含上面 bug #6 #7 的修复)。
- `kasia-console/src/db/migrate.js` v218 — `ktt_holdings_ledger` 表(设计稿④本地记录表)。
- 🔴 **`kasia-console/src/api/tokens.js`(铸币/转账/查阅三条 API)与 `kasia-console/src/ui/tokens-list.eta`
  (`/tokens` 页面 KTT v2 区块)代码已写完、逻辑与本目录已验证的调用形状一致, 但**本轮未随本 commit
  一起提交**——`tokens.js` 里 `import { sendCommandAsync } from '../services/relay-manager.js'` 撞
  `R-M0A-BARE-IMPORT-DIFF`(件④ money-path manifest 门禁): tokens.js 之前不在 baseline 里, 新增这个
  bare import 需要经 NWT 审的 manifest 条目(或改走 baseline 已批的入口, 如 `pool.js` 已有的同款
  import)才能过 pre-commit 闸——这是钱路控制点, 不该自己绕过。两份文件原样留在 worktree 里
  (`git status` 可见, 未 staged), 已在交件里向 Bettor/NWT 报这个阻塞点, 等裁定要不要走 manifest 审。

## 诚实边界(未做到的, 如实标注)

- console API(`api/tokens.js` 三条路由)与 UI(`tokens-list.eta` 新区块)**代码完整、逻辑上对齐已
  验证过的 SDK/relay handler 调用形状**, 但① 未随本轮 commit 提交(见上方 M0a 阻塞说明)② 就算过了
  M0a 闸, 本轮也**没有**独立起一套 console+relay+浏览器全链路去实际点按钮验证——这一层是"照着已
  验证的调用形状写、lint 过、未独立冒烟"的状态, 不是"真实点过"。核心钱路逻辑(合约/编码/relay
  广播, 12 笔真实 txid)全部真实验证, HTTP/UI 胶水层留给 NWT diff 审或后续冒烟。
