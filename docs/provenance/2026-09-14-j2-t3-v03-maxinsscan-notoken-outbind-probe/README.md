# T3 v0.3 探针 — max_ins_scan 边界纪律 + noTokenInput B 类负向量 + 输出侧去向绑定

对应三条独立指令的实证要求（均"不许纸上假定"，同一工具链层，手法同 T1 v0.2 `MarketScanProbe.sil`）：
- Bettor ledger 1122：`max_ins_scan` 须 ≥ 协议实际单笔最大输入数(1000)，或等价安全替代
  `require(tx.inputs.length <= max_ins_scan)` 先拒超界再遍历。
- Bettor ledger 1122-补(NWT 边界戳点)：① require 挡的必须是整笔交易真实 `tx.inputs.length`；② require 的界与
  循环体实际可达深度必须是同一个常量。要求三向量：界处、界+1 处、victim 在末位。
- Bettor ledger 1123(转 Codex 复核)：B 类 `noTokenInput` 也要同一 1122 纪律；补两条负向量：B 类入口 + 归己代币
  输入 + 无续约 ⇒ 必败；B 类入口有真实状态变化(非 no-op)时同样必败。
- Bettor ledger 1127①(Owner 终端)：对账必须双边——scanOwnedTokenInputs 只保证输入侧没漏；输出侧续约去向必须
  绑派生表达式，不能是裸 witness，否则"输入对上、输出转去陌生地址"这条路没堵。

`MarketScanProbe3.sil`：`token_prefix/token_prefix_len/token_suffix/token_suffix_len/token_tmpl_hash` ctor 参数
延续 T1 v0.2 探针的 TokenStub 派生产物(`docs/provenance/2026-09-13-j2-t1-v0.2-market-scan-probe/`)，本次未重新派生，
直接复用其 `TokenStub_A/B.compiled.json` + `token_stub.derived.json`(TokenStub A/B 均 owner=`0x11*32`)。
`MAX_INS_SCAN` 定死为编译期常量 8（小值只为可测试的展开成本；生产值由部署配置按市场实际最大输入数选，机制本身
与具体取值无关——因为 `require(tx.inputs.length <= MAX_INS_SCAN)` 已经把超界交易挡在遍历之前, victim 不可能
"藏在遍历不到的下标之后"）。三个 entry：

- `scan_absorb(declared_total)`：A 类扫描形(同 T1 v0.2 `MarketScanProbe.sil`)，加 1122 边界纪律。
- `no_token_entry(dummy_state_change)`：B 类不在场证明形，同样加 1122 边界纪律；`dummy_state_change` 参数模拟
  "入口本身有真实状态变化"(1123-b3 第二条负向量要求)。
- `scan_and_bind_output(declared_total, selfOutIdx)`：1127① 新增，输入侧扫描 + 输出侧
  `require(OpOutputCovenantId(selfOutIdx) == OpInputCovenantId(this.activeInputIndex))` 派生表达式绑定。

## 向量结果：`run.log` — **9/9 PASS**

| 向量 | 验证点 |
|---|---|
| V-bound-1（8 输入,恰好=界） | 界处：3 笔归己代币(共 300)在 8 输入内被正确累加 |
| V-bound-2（9 输入,界+1） | 界+1：`require(len<=8)` 单独挡下(内容本身若无此挡也会通过, 隔离出纯粹是长度闸拦的) |
| V-bound-3（victim 在下标 7,末位可达） | 循环真实展开到下标 7, 不是提前截断 |
| V-bound-4（同上, 但 declared_total 不算 index7 那笔） | 证明扫描确实读到了下标 7 的值(非"require 空转过") |
| V-notoken-1（无代币输入） | B 类合法通过 |
| V-notoken-2（夹带归己代币,入口本身 no-op） | `require(!found)` 挡下 |
| V-notoken-3（同上,入口有真实状态变化 witness=42） | 挡下不因"入口做了真事"而失效(1123-b3 第二条) |
| V-outbind-1（输入对上,输出续约到自身派生 covenant） | 通过 |
| V-outbind-2（输入对上,输出续约到陌生 covenant,经"continuation 案例"绕开创世预检以隔离出真正被挡的是哪一条 require） | `require(OpOutputCovenantId==OpInputCovenantId(self))` 挡下 |

## 踩坑记录

- `WrongGenesisCovenantId` 陷阱(同 T1 v0.6 `V-T-6b` 已踩过的坑, 这次是第二次撞上, 记一遍供以后不用再猜)：
  一个输出声明的 `covenant_id` 若既不匹配任何输入的 `covenant_id`(continuation 案例, 字符串相等)、也没有走
  真正的 genesis 构造流程, 就会在脚本执行前被 `CovenantsContext::from_tx` 的创世预检直接拒——错误信息看起来像
  "验证失败", 但其实是消费方/测试构造没搭对, 不是我要测的那条 `require`。构造"陌生 owner"负向量时必须让陌生
  covenant_id **也**作为某个输入出现在同一笔交易里(配 `authorizing_input` 指到那个输入的下标), 才能真正把
  "continuation 案例"这条路走通, 从而把失败原因**隔离**到我自己加的那条派生表达式检查上, 而不是创世预检。
