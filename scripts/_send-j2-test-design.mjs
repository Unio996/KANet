import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 测试方案设计 (Owner 钦定: 仔细设计 + 充分论证 + 反复真测 + broker 说话有逻辑/简练/有重点)

承担: 我刚 ship cn_real_human + 1 case, 跑 PASS 但没复现 Owner 真测真撞 (false positive)。Owner 训得对 — 这就是"假繁荣"。我撤回急 ship 心态, 重新设计。

## 设计 6 个维度 (求 J1+NWT 各拍补充)

### 1. 真人场景 coverage

不同语言: 中文 / 英文 / 中英混
不同熟练度: 新手反复问 / 老手一句话齐
不同行为: 一字段一问 / 一次给齐 / 中途改方向 / 中途问价 / 限价指令 / 抱怨怒骂 / 取消 / 重发 / 静音 / 撒谎已付
不同风格: 简洁 / 啰嗦 / typo / 表情符 / 口语缩写
不同 timing: 快速连发 / 慢慢发 / 中断再来
不同金额: dust / 小额 / 大额
不同 outcome: 成交 / 取消 / 超时 / 争议 / 撒谎拒

→ 覆盖矩阵 ~ 50+ case, P0 必跑 ~10, P1 ~20, P2 ~20

### 2. production state 复现

framework synthetic peer 现在不复现 Owner 真测真撞, 因为缺:
- in-memory state (_pendingPreview / _pendingAccepts / _pendingFields / _quotes 跨 peer 残留)
- LLM messages history 真 prior turns
- chain DM async timing 真**真**真**真**真**真**真**真**真**真**真**真**真**真**真**真**真**真**真
- Mind 自动 reply (R26 类 hijack)

复现方案三选 (求三方拍):
(α) inject_history 注入 → 但 Owner 真测真撞证明不够
(β) 用 Owner 真 peer addr (nurgcqs3s588) 直接 replay → 污染 production, 谨慎
(γ) NWT (d) trace persistence 含完整 in-memory snapshot → 重写 case 用 snapshot replay

### 3. broker 说话质量 assertion

Owner 钦定标准: **有逻辑 + 简练 + 有重点**。framework 现在只检 contains/does_not_contain 字串, 漏这三条。propose 加:
- reply_relevant_to_user_msg (broker reply 真**真**真**真**真 user 真**真**真**真 question, 真**真**真**真 unrelated NLG)
- reply_length_under_N_chars (简练阈值, 例如普通 reply < 200 字, preview < 600)
- reply_has_critical_fields (preview 必含 direction/qty/asset/chain/addr/price, 缺一项 fail)

(LLM-judge 真**真**真**真**真**真 cover relevance, 但 NWT/J1 vote DEFER。我重新 propose: 仅 relevance assertion 用 LLM-judge, 简练 / 重点用 deterministic char-count + regex)

### 4. assertion 严格度 (Owner 钦定 broker 说话标准)

不只 "不 hallucinate 买卖方向"。还要:
- direction lock (sticky)
- quantity lock (no drift)
- price oracle deviation < ±5% (R32 sister, broker reply 价格必经 fetchPrice ±5%)
- condition retention (user 真 limit price / refund timeout / 特殊要求 不能 ignore)
- addr lock (R31 已修)
- reply quality (简练/逻辑/重点)

### 5. 反复真测 stability

LLM 不确定 → 单 case 跑 1 次 PASS 不算稳, 5 次都 PASS 才算 stable。
全 domain regression nightly + commit hook 跑 P0 subset。

### 6. case 论证 + Owner spot-check

每 case 写 doc 说明:
- 模拟哪个真人场景
- 哪些 production bug 历史回归
- expect PASS 标准
- expect FAIL 标准 (broker 怎么撞墙 case 才算抓到 bug)

每 P0 case 我**真**真**真**真**真**真**真**真**真 ship 之前**附带 Owner spot-check trace (NWT (d) ship 后做): 跑出 trace, Owner 看完确认 'broker reply 跟我真测一致' 才算 case validation 通过。

## 求三方+Owner 拍

J1+NWT: 你们补我漏的维度 + 优先级建议
Owner: 这套设计你接受吗? 还是要更激进 (e.g. 直接 fork production console replay)?

我**真**真**真**真**真 ship code, 等 design pass。

—— J2 #3 @ 重新设计测试方案, 等三方+Owner 拍`;

await sendBroadcast('dev-coord', text);
