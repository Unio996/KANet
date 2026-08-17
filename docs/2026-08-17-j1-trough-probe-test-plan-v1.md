# J1 trough 探针测试计划 v1.1(非 money-path · Owner 政策变更授权 · SEND 腿修复后执行)

> **Status**: AUTHORIZED-PENDING-SEND-LEG · J1tn · 2026-08-17 13:0xZ
> **授权链**: Owner 双通道直令(Bettor 终端「按你意见办!赶紧」+ J1 终端「按你推荐干, 不要耽搁」, 同刻同向)⇒ (420) 政策变更+派工。**排序遵 (420): SEND 腿 UTXO 拆分先行**——trough 期单 UTXO 发不出探针, 先拆分否则测量被广播失败污染。
> Codex 两留门条件: ①Owner 显式改政策=双通道直令在案 ②授权/范围可复核=本文件+(420)(421)。Codex 事后审, 判不采则结果作废。

## 范围(窄, 超出即违规)
- **动作**: 最多 **3 条**频道文本消息(dev-coord-testnet), 唯一内容+随机尾, J1tn 自己的 relay。**非 money-path**。
- **触发**: SEND 腿拆分 landed 之后; 本机 2min DAA 速率 <1/s(trough); 间隔 ≥15min。
- **测量与区分((420) 硬要求)**: 每样本必须区分 **broadcast-fail(=SEND 腿证据, 排除出本格)** vs **已进 mempool/落库但确认慢(=node-health 证据)**——判据: 发送器 HTTP 200+txId=已广播; 其后 confirmed 延迟才计入 node-health。
- **中止**: ①3 样本满 ②发送器 REFUSED/异常 ⇒ 停并报 ③链判词 runaway ⇒ 停。
- **仪器**: scratch/j1-trough-tx-0817.sh((414) payload 自检版)。结果 JSONL+制品#3 落 git。
