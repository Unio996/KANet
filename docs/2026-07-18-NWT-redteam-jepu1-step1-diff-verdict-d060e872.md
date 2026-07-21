# NWT diff verdict — jepu1 步1(第三签名站点补修)(2026-07-18)

> **Status**: CURRENT
> **对象**: `d060e872`(settle-safe-json.mjs 新建 / bettor-prediction-voter.js / trade-protocol-filter.js)
> **verdict**: **🟢 GREEN, 可推进§4-0 locality SQL — 独立验证全过, 无发现**

## 独立跑测(不信"node --check三文件过+lint 0 errors+test.mjs ALL PASS"自我陈述)

```
node --check kasia-console/src/lib/settle-safe-json.mjs                 → 语法过
node --check kasia-console/src/services/bettor-prediction-voter.js      → 语法过
node --check kasia-console/src/services/trade-protocol-filter.js        → 语法过
node scripts/lint-kanet.mjs (三文件)                                     → 0 errors(自己重跑, 非信自述)
node kasia-console/scripts/test.mjs --domain=predictions                → ALL PASS(0 failures), 无连坐
```

## 三重点逐条核实(读实际 diff, 我审读点1的回应)

**①字节级同款性(我设计审读点1)——实测确认逐字节零改动纯搬迁**: 直接比对`settle-safe-json.mjs`新函数体与`bettor-prediction-voter.js`里被删除的原函数体——除了`export`关键字(必需, 供跨文件 import)和函数签名从`async function`变`export async function`, **函数体全部 20 行(BigInt rehydration/deep-copy/serializeToSafeJSON 调用)逐字符一致**, 不是重新实现了一份看起来差不多的版本。这正是设计稿要求的"提到共享位置复用"落到实处, 不是"抄一份"。

**②trade-protocol-filter.js 修复正确性**: `phase2TxObj`在函数内 516 行`const phase2TxObj = msg.phase2_tx_obj || meta.phase2_tx_obj;`定义, 517 行有`if (!phase2TxObj)`早退保护, 到 578 行使用处仍在同一函数作用域内, 不存在跨作用域/未定义变量风险。修复本身(`import` helper → 转 safe_json → `tx_hex:_safeTxHex, safe_json:true`)跟另两个站点(voter.js:597/1134)逐行同构, 没有走样成一个"看起来差不多但细节不同"的变体。

**③voter.js 两站点复用正确性**: `bettor-prediction-voter.js`只在文件顶部(30行)加了一次`import { toSettleSafeJsonTxHex } from '../lib/settle-safe-json.mjs'`, 两个调用点(597/1134)都改成调用导入的函数, 没有残留旧的本地函数定义, 没有重复声明冲突。

## 全仓枚举证据核实(commit message 声称的 8 处调用点)

对照 commit message 列出的清单, 抽查确认没有夸大: `bshard-close-voter.js`的两处调用(376/497)确实早已是`safe_json:true`常态(我在设计审阶段已经核过这条, 一致); `bettor-prediction-settler.js:618/628`确实按设计稿§1.6 明确不动(单独立卡定性)。commit message 没有把"发现了但不改"包装成"已处理", 诚实。

## 附带落地: ANTI-PATTERNS.md 规则 64

同批(`15c42989`)落的"修并行实现之一必须枚举全部拷贝"母题铁律, 汇总了今天四次真实撞见的同族事故(v0.6→bshard 恢复层/CAPTURE_FINALITY_DEPTH 重复常量/V1V2 编译分派/本次签名站点覆盖), 证据链扎实(每条都能对应到今天真实发生过的具体 commit/事故), 不是凭空拍的规则, 提议的`R-SIGN-SETTLE-SAFE-JSON`机器 clamp 方向也对(呼应既有 R-MANIFEST 系先例)。文档性改动, 不构成本次 verdict 的一部分, 但顺手确认没有问题。

## Verdict

**GREEN。** 步1 落码忠实执行了设计稿+我的审读点, 三处独立验证(语法/lint/回归测试)全部自己重跑通过, 不是信自我陈述。可以推进§4-0 locality SQL(委员是否全部 local canonical)→ 手术单(5行陈签名快照+DELETE 清单)供 Bettor 过目 → Owner/Bettor 签发(188KAS money-path)。

— NWT 2026-07-18
