# NWT diff verdict — jepu1 终诊根因修复(提交侧 safe_json 补修)(2026-07-18)

> **Status**: CURRENT
> **对象**: `0c07ff73`(pool-market-settler.js / p2sh.mjs / relay.mjs)
> **verdict**: **🟢 GREEN — 独立复现核心机制+跑测全过, 这是整晚"静态全 PASS 但节点仍拒"悖论的真正解释**

## 根因诊断复核(读代码坐实, 不是照抄 commit message)

整夜排除法(①③④⑤⑥⑦⑨全静态 PASS)+四方独立 sighash 验证(schnorr-verify 全绿)之所以跟节点结果矛盾, 是因为**所有验证都发生在同一个"tx_obj 自洽世界"里**——committee 签的是`meta.phase2_tx_obj`经`toSettleSafeJsonTxHex`正确序列化后的 sighash, 但 relay `unlockPoolSpineP2SH`(p2sh.mjs:991)组装**实际提交上链的 wire tx** 时走的是另一条独立的`new Transaction(JSON.parse(JSON.stringify(txObjPreimage)))`构造路径——这条路径只补水了 BigInt(lockTime/gas/input.sequence/utxo.amount/utxo.blockDaaScore), **没有对`scriptPublicKey`做 c8188d98 那套 flat-hex 保全处理**, 跟 c8188d98 最初描述的根因(新 kaspa-wasm 下 plain-object spk 不被正确注入)是**同一个坑, 换了个函数**。这解释了全部观察: 签名对我们的 sighash 有效(离线验证用的是 tx_obj 直接派生, 从没走过这条坏构造路径)、但节点拒(节点验证的是**这条坏路径产出的 wire tx** 的真实 outputs_hash, 跟签名时的不一致)、重签无效/413 次同错(签名本身从未错过, 错的是提交侧的另一次独立构造)、jepu1 特有(bshard 盘走`bshard-close-voter.js`, 完全不经过`unlockPoolSpineP2SH`——这条我 grep 全仓确认, 只有`pool-market-settler.js`调这个函数)。

## 独立复现核心机制(不信"本机验证三项过"自我陈述, 自己单独跑一遍等价场景)

用真实`toSettleSafeJsonTxHex`产出的 safe_json 字符串, 模拟 p2sh.mjs 新分支的确切操作序列(parse → 取 `safeObj.transaction||safeObj` → 逐 input 注入 signatureScript → `JSON.stringify` 重序列化 → `Transaction.deserializeFromSafeJSON`重构), 用 2-input/1-output 合成 fixture 独立验证:

```
safe_json 顶层字段确认(实测, 非猜测): ['id','version','inputs','outputs','subnetworkId','lockTime','gas','storageMass','payload']
→ 没有 .transaction 包裹层, safeObj.transaction||safeObj 的 fallback 逻辑对实际形态正确解析为 safeObj 本身
inputs.length 与 scriptSigs 数量匹配检查: 2 == 2 ✓
注入后 round-trip: input0/input1 signatureScript 精确保留(aabbcc/ddeeff, 没被吞/改)
output0.value 精确保留(7990000000, 未变)
output0.scriptPublicKey 精确保留(完整 flat-hex, 没有被 plain-object 路径那种碾坏现象)
```

这就是修法的核心承诺(safe-json 平铺结构里纯 JSON 编辑注入 scriptSig, 不经过会碾坏 spk 的 plain 路径)在真实数据下的独立复现, 不是照抄 J1 commit message 的"三项验证过"。

## 独立跑测(自己重跑, 不信自述)

```
node --check ×3(pool-market-settler.js/p2sh.mjs/relay.mjs) → 语法全过
node scripts/lint-kanet.mjs(三文件) → 0 errors
node kasia-console/scripts/test.mjs --domain=predictions → ALL PASS(0 failures)
```

## 影响面核实(WC 盘零风险, 结构性非概率性)

`grep -rln "unlockPoolSpineP2SH"`全仓确认唯一调用方是`pool-market-settler.js`(legacy v0.6/v0.7 委员签管线), `bshard-settle-daemon.mjs`/`bshard-auto-settler.mjs`/`bshard-close-voter.js`均不涉及这个函数——跟我今晚设计审阶段坐实过的 bshard/legacy 结构隔离(消息 type 分发键+isBshard 早退 line 389)是同一条隔离带, 这次改动没有跨过它。新分支还有 flag 门(`args.txObjPreimageSafeJson === true`才走新路), 未设 flag 的既有调用点(commit message 提到的 unlockP2SHMultiSig/unlockP2SHConsensual/refund-disagreement 站点)原样落回旧 plain 分支, 行为零改变, 不是无差别替换。

## 诚实边界(commit message 自己也承认, 不是我发现的新问题)

同族 twin-construction 问题(new Transaction(plain)家族, 规则64语境下比 sign_input_for_settle 家族更大)在`unlockP2SHMultiSig:473`/`unlockP2SHConsensual:597`/refund-disagreement 路径**依然未修**, commit message 已诚实立卡, 不是本次 scope, 不构成本次 verdict 的阻塞项——本次只精确修 jepu1 这条关键路径(唯一撞上这个坑的活盘), 符合今晚一贯的"不在压力下扩大改动面"纪律。

## Verdict

**GREEN。** 这是我整晚追这条线索(逻辑收窄→UTXO 数据→require 逐条排除→今天早上 J1 提出的"tx_obj 世界外面"resume 起点)最终收口到的真根因, 机制独立复现验证成立, 影响面对今晚 WC 盘结构性零风险, 同族未修站点已诚实立卡不隐藏。可以推进到实战验证(对 jepu1 走一次真实 unfreeze+submit, 这次应该真的能落链)。

— NWT 2026-07-18
