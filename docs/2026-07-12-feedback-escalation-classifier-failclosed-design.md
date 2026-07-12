> **Status**: CURRENT

# 反馈通道升级判定 — 模式级 MUST-FIX(fail-closed 反转)

**作者**: KANet-UI(2026-07-12,Bettor 派工 #i5cl3g.1,Owner 直令重开班段件①)

**背景**: 当前 `classifyEscalation`(`kasia-console/src/services/feedback-agent-tools.mjs`)用一份复合短语正则
`ESCALATE_KEYWORDS`(如`退款|转(一下|账|钱)|pay\s*me`)匹配用户原始输入。今晚三次独立测试各漏判一句新表述
(NWT F2 场景"钱卡了...直接帮我转一下" — 已在 v1.1 折入；今晚 live 测试再漏"请把我押注的钱退给我"[含"退"但非
"退款"复合词]、"there is a bug I found, can I get paid for it"["pay me"词序限定漏"get paid for"])。**同一族问题
第三撞**：枚举"该触发升级的具体短语"天生不完备，新表述会持续漏判——不是补第 N 个关键词能封死的（同
ANTI-PATTERNS 规则 58 黑名单不完备族，但方向相反：这里是"该拦的没拦住"非"不该拦的被拦住"）。

## 修法：fail-closed 反转（Bettor 裁定方向）

把"精确短语匹配才升级"反转成"含钱类字眼默认升级，只有明确匹配安全查询模式才放行"——枚举范围从"该升级的
所有说法"（无穷、持续漏）缩小到"安全查询的固定形状"（`/support` 场景下用户只有查押注/查市场/开工单三种
读操作，形状远比"表达资金不满的所有说法"少且稳定）。

```js
// 宽网: 钱类词根(非复合短语), 覆盖比旧正则更广的表述面
const MONEY_SIGNAL = /钱|退|赔|付|资金|骗|投诉|争议|hack|漏洞|refund|pay|paid|fund|transfer|money|scam|dispute/i;

// 窄口: 已知安全查询形状(查押注/查市场/查状态), 无资金动作动词
const SAFE_QUERY_PATTERNS = [
  /^(查一?下?|看一?下?|check|show|list)\s*(我的)?\s*(押注|positions?|bets?|market|市场|状态|status|历史|record)/i,
  /^(how\s+(many|much)|what('s|\s+is))\b.{0,30}\b(bets?|positions?|market|status)/i,
  /^(just\s+checking|我?看看|我?查查)\b/i,
];

export function classifyEscalation(rawUserText) {
  const text = String(rawUserText || '');
  if (!MONEY_SIGNAL.test(text)) return false;               // 无钱类信号 = 安全, 不升级
  if (SAFE_QUERY_PATTERNS.some((p) => p.test(text))) return false;  // 匹配已知安全查询形状 = 放行
  return true;                                               // 有钱类信号且非安全查询形状 = fail-closed 升级
}
```

**旧 `ESCALATE_KEYWORDS` 保留但降级为"快速路径"注释/文档参考**（Bettor 原文"精确关键词表只做快速路径"）——
不再是判定的唯一依据，`MONEY_SIGNAL` 取代它成为主判据；旧正则的复合短语大部分是 `MONEY_SIGNAL` 词根的严格
子集（如"退款"⊂"退"），不会漏判旧正则已覆盖的场景。

## DoD（Bettor 硬门）

1. **不猜代码，查了再改**：只改 `classifyEscalation`/`ESCALATE_KEYWORDS` 所在文件
   `kasia-console/src/services/feedback-agent-tools.mjs`，不碰其余反馈通道逻辑。
2. **NWT 小审通过**（本设计半页方案，落码前过一遍——重点核 `SAFE_QUERY_PATTERNS` 是否会把带资金动作动词的
   查询误判成安全["查一下能不能退款"这类混合句该不该过安全网, 需要 NWT 拿真实边界案例测]）。
3. **扩展话术集 live 回归全绿**：七条社工话术集（`1a3fd5ac`，主要验证判定环节对社工话术免疫，非直接测
   classifier）+ NWT 今晚 live 测试的完整语料集（8 句 + 2 句缺口）+ 本设计自带的安全查询反例集，逐句跑
   `classifyEscalation`（离线单测，非过 LLM）核对预期 true/false，必须 100% 符合预期。
4. **不改变 H1-H3 既有约束**：判定仍在 LLM 调用前对原始文本跑（H3）、仍是纯函数不读 LLM 输出、
   `FEEDBACK_TOOLS`/`FEEDBACK_TOOL_NAME_ALLOWLIST` 不动。

## 明确不做什么

- 不引入 LLM 做升级判定（H3 铁律：判定必须独立于对话 LLM，正则/规则匹配路线不变，只改判据本身）。
- 不改 `execution_states`/`events` 写入逻辑、不改 tg-bot 侧任何代码（这条 MUST-FIX 是纯分类器改动，卡A/卡B
  其余部分已 shipped 不动）。
- `SAFE_QUERY_PATTERNS` 有意窄（宁可漏判安全查询导致误升级，不可漏判危险信号导致零升级——NWT 已指出这个
  方向的失败模式风险远小于反向黑名单）。
