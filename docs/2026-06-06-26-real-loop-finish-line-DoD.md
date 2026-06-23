# #26 项目终点线 — 真闭环 DoD + 分工 + 守关

> **目标(Owner 钦定)**: 一条**判得出、结得了、交付得到、能反复演示**的真闭环。这是项目终点线。
> **性质**: 收敛(让现有 create→bet→judge→settle→deliver 机制真正稳定工作),非扩张。
> **标尺**: 系统工作得好不好,不是钱(测试币零价值,守 G5)。
> **协调人**: Bettor — 设目标 / 分工 / 关1 事前审 / 关2 链上验 / 关3 测试 / 监督协调沟通。

---

## 一、DoD — "完美工作"的可验收定义(逐条链上证才算)

一个市场必须无人干预走完,且**可重复**:

| # | 关卡 | 验收(看链不看码) |
|---|------|------------------|
| D1 | 建市质量 | 市场有内容+规则(非只标题/来源),bot 渲染规则清晰 |
| D2 | 下注 | 用户/agent 下注,stake 真锁链上(side_lock_tx is_accepted) |
| D3 | 委员裁决 | deadline 过→抽样→投票→共识,vrf 证据齐 |
| D4 | **签名交付** | 委员签名收齐→组装→settle TX **广播上链 is_accepted=true** |
| D5 | **赢家到账** | winner 收到 payout 到绑定地址,explorer 可验;输家份额正确再分 |
| D6 | 终态 | protocol_status=completed,无残留卡态 |
| D7 | **两条路都通** | unanimous(5/5) **AND** threshold(4-of-5 一委员静默)都链上证 |
| D8 | **可重复** | 连续 N 次(≥3)干净跑通,same-node **AND** cross-node(J1 :3300 当真实参与方) |
| D9 | 无死胡同 | 任何进入的市场必达正确终态(completed/refunded),零永久冻结 |

**当前差距(实测)**: D4 断(45c6i 5/5 全签卡 collecting_sigs 14h,签名收不齐)→ D5/D6 全部到不了。D7 的 4-of-5 路另卡 SS verify(#25)。D8/D9 未达。

---

## 二、分工(按域 owner,不越界)

| Agent | 域 | #26 职责 |
|-------|----|---------|
| **J2-tn** | settler/交付管线 | **当前命门 D4**: collecting_sigs→assemble→broadcast 为何永不完成(sig 收集/持久化/跨节点回传) |
| **J1-tn** | SS/链上/relay 签名 | D7 的 #25 4-of-5 SS verify 未知 require;sig 语义 + 跨节点签名回传 relay 侧 |
| **NWT-tn** | 测试/lint | D8 可重复 e2e 回归 harness + D9 "必达终态"不变量 + 通信规范 lint |
| **KANet-UI** | bot/UI | D1 建市质量 + 可演示性(用户视角看到的就是工作的系统) |
| **Bettor** | 协调/审 | 设目标 + 分工 + 关1 审方案 + 关2 链上验 + 关3 督测 + 监督协调沟通 |

---

## 三、关键路径(顺序,不并行乱铺)

1. **D4 交付断**(J2,进行中)— 不通则一切到不了终态,**最高优先**
2. **D7 4-of-5 SS**(J1,#25)— 容错路,去中心化核心卖点
3. **D8 可重复 e2e harness**(NWT)— 把 D1-D7 串成一键回归,守不退化
4. **D8 cross-node 干净跑**(全队)— J1 :3300 当真实参与方,终点线演示

并行项: D1 建市质量(UI) + legacy/孤立单清死胡同(D9,J2 已 ship trial,守关2)可与主线并行,但不抢主线资源。

---

## 四、守关纪律(每个 agent 改码必走)

- **关1 事前审**: 任何 agent 动 settler/SS/链上码前,方案先回 Bettor 审(防半迁移坑,如 #28 selector OP_2/OP_3 错位被关1 拦下)
- **关2 事后链上验**: 改完必拿 TX 落链 is_accepted 实证,看链不看码不信 claim
- **关3 测试守住**: 修 bug 必加 regression case 进 framework,永不退化
- **NO TX NO STATE CHANGE**: 状态只在广播确认上链后推进
- **通信规范**: 报必带证据(file:line/txid/DB查)+结论+下一步
