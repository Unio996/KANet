# NWT diff verdict — jepu1 母题枚举测试落地 + 第五裸JSON站点补修(2026-07-18)

> **Status**: CURRENT
> **对象**: `b862c6e0`(settle-safe-json.test.mjs 新建 / bettor-prediction-voter.js 第五站点)
> **verdict**: **🟢 GREEN — 独立验证含对抗性自测(测试本身有没有牙齿), 全过**

## 独立跑测(不信"17项全绿"自我陈述)

```
node kasia-console/src/lib/settle-safe-json.test.mjs           → 实测17项(枚举12+行为5)全部 ✅
node kasia-console/scripts/test.mjs --domain=predictions       → ALL PASS(0 failures)
node scripts/lint-kanet.mjs (两文件)                             → 0 errors
```

## 对抗性验证: 枚举测试本身有没有牙齿(不只信"绿了")

绿测试不等于测试真的会抓坏东西(本 session 反复踩过"重跑一致只证确定性不证正确性"这条)。单独摘出裸 JSON 检测的核心正则逻辑, 喂一段人工构造的"坏"片段(`tx_hex: JSON.stringify(...)`裸写, 没有 safe_json), 独立跑确认检测器**真的会 FAIL**(不是永远绿的摆设)。这条测试机制经过了"故意让它抓坏"验证, 不只是"故意让它过"验证。

## 第五站点修复正确性核实

`bettor-prediction-voter.js:696`(`processPoolRefundDisagreementTxSign`函数内)——`tx_hex: JSON.stringify(meta.refund_disagreement_tx_obj)`改为`toSettleSafeJsonTxHex(meta.refund_disagreement_tx_obj)` + `safe_json:true`, 复用文件顶部已有的单源 import(d060e872 已引入), 没有重新声明/重新实现, 跟前四个站点同一套模式。commit message 描述这是"同族活 bug"(refund-disagreement 结算会撞同款 verify-failed)——这个定性核实成立: 该函数走的正是同一条`sign_input_for_settle`IPC 命令 + 同一个坏 sighash 根因链, 不是过度诠释。

## "已经安全"两处新登记的核实(非只信 allowlist 注释)

`lib/pool-shard-settle.mjs:320`与`bshard-auto-settler.mjs:365`/`749`——直接读代码确认三处都是`tx_hex: txSafeJson`/`tx_hex: unSafeJson`(变量名即表明预处理过) **紧邻同一对象字面量内的`safe_json: true`**, 不是松散窗口检测碰巧命中的假阳性。其中`bshard-auto-settler.mjs`正是今晚 ajnid/85fit 结算管线的一部分——这次核实**再次印证**(第三次独立坐实, 前两次是设计审④+diff审①)bshard 侧从一开始就在 safe_json proven 路上, 本次改动对它零触碰、零新增风险, 只是把"确认过安全"这件事从人工记忆升级成机器测试固化。

## Verdict

**GREEN。** 母题枚举测试(Codex MSG-008条件2的落地形态)设计合理且经过对抗性自验证(不是纸老虎), 首跑立刻兑现了它存在的价值(抓出人工枚举漏掉的第五个真实活 bug), 第五站点修复跟前四个同构、复用同一单源、无重复实现。对今晚 WC 盘再次确认零影响(且这次是机器测试固化的确认, 不再是人工推理)。可以继续推进§4-0 locality SQL。

— NWT 2026-07-18
