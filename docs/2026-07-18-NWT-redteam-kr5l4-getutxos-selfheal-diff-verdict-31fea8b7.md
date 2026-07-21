# NWT diff verdict — kr5l4 consolidate DB-lag 自愈补齐(2026-07-18)

> **Status**: CURRENT
> **对象**: `31fea8b7`(bshard-close-transport.mjs / commands.mjs / p2sh.mjs / relay.mjs)
> **verdict**: **🟢 GREEN, 可装载+dry-run — 布线正确, 复用已证机制, 影响面精确隔离**

## 根因诊断复核(读代码坐实)

`autoDetectConsolidateResume`(pool-shard-settle.mjs:330-372)不是这次新写的逻辑, 是**2026-07-06 lv3rz/dyljb 公测首两场实战暴露后已收编、已证过的机制**——从 DB 记录的 genesis payout_redeem_hex 出发, 按 shard_index 升序逐片 splice 出新的 consolidated_pool 值算出对应 P2SH 地址, 查真实链上 UTXO, 第一个"有 UTXO"的地址即当前真实 tip; 探不到任何进度则 fail-closed 返回 null(不编造假 resume 点, 让调用方照常走原逻辑报错)。经典路径`consolidateAndBuildPsState`(bshard-settle-daemon.mjs:172)早已接好这条自愈, ZK 路径`buildProposeCloseRequestV2`(bshard-close-transport.mjs:276)确实没传`getUtxos`——`consolidateAllShards`函数签名里`getUtxos = null`(pool-shard-settle.mjs:381), 内部`if (!resume && getUtxos)`门控(384行)——**这条自愈对 ZK 调用方结构性从未触发过**, 是真实的规则64漂移母题实例, 不是过度诠释。

## 影响面核实(向后兼容性, 不只信 commit message)

`getUtxos`参数默认`null`, 只在真值时才触发自愈探测——这意味着**除本次 ZK 调用点外, 其余任何未传该参数的既有调用方行为零改变**(我读了函数签名和门控条件独立确认, 不是照抄 commit message 的"backward-compat"断言)。新增的三个文件改动(relay 命令注册/p2sh 只读 RPC helper/relay case handler)全部是纯新增, 没有修改任何既有函数的签名或既有分支的行为。

## 独立跑测(自己重跑)

```
node --check ×4(bshard-close-transport.mjs/commands.mjs/p2sh.mjs/relay.mjs) → 语法全过
node scripts/lint-kanet.mjs(四文件) → 0 errors
node kasia-console/scripts/test.mjs --domain=predictions → ALL PASS(0 failures)
grep -c "GET_ADDRESS_UTXOS" commands.mjs → 3(三处注册齐全, 未撞本 session 开头就在 lint 里见过的
  "半登记新命令"那类坑——本次是完整三处: COMMAND_TYPES/COMMAND_PAYLOAD_SCHEMA/COMMAND_FIELD_TYPES)
```

## 只读性核实(钱路边界)

`getAddressUtxos`(p2sh.mjs)是纯`rpc.getUtxosByAddresses()`包装, 不签名不构造交易不广播; `relay.mjs`的`get_address_utxos` case 同样纯只读转发。RPC 连接用`finally`块确保`disconnect()`执行(不留连接泄漏, 呼应今晚早些时候 memory 里记过的 relay ws 连接泄漏风暴教训)。这条 fix 本身不移动任何一分钱, 只是给自愈探测提供它需要的链上真实数据源。

## 诚实边界(commit message 自己已承认, 非隐瞒)

"端到端(kr5l4真自愈探测)待装载后dry-run+cross-node核d6fb5b9f真实地址"——这条**真正证明"这个修复确实能让 kr5l4 走出正确的 resume 点"的验证还没做**, 需要部署后针对 kr5l4 实盘跑一次 dry-run 才能坐实。我这次审的是**代码机制正确性+影响面隔离**, 不是"kr5l4 已经修好"。

## Verdict

**GREEN。** 布线精确(只加一个可选参数的传递, 不改任何既有行为)、复用的自愈机制本身是已证过的成熟代码(非新写风险逻辑)、只读 RPC 边界清晰(不碰钱)、三处命令注册完整、独立跑测全过。可以装载, 下一步是 dry-run 验证 kr5l4 实际能不能探测到正确的 resume 点(这步待 canonical 侧 d6fb5b9f 真实地址核对)。

— NWT 2026-07-18
