// feedback-agent-tools.mjs — 用户反馈通道卡B(console 桥, J2 2026-07-12)。
// 设计 docs/2026-07-12-user-feedback-channel-console-side-design.md v1.2(双审 GREEN, NWT G1 折入)。
// 框架 docs/2026-07-12-user-feedback-channel-framework-design.md v1.1(H1-H3 逐字继承, 见文件底部)。
//
// 单源约束(设计 §2):FEEDBACK_TOOLS 唯一实现落点 = 本文件(与 _callLlm 同进程)。tg-bot 侧(卡A)落码时
// import 这份工具面定义供其 UX 展示参考,不各自定义一份(防两处漂移同 D-008/落1 F1 家族坑)。
// ESCALATE_KEYWORDS 同理单源落本文件——console 端是升级判定的权威执行点(H3),tg-bot 侧若要提前 UX 提示
// 必须复用同一份正则,不允许各自维护出现漂移。

/**
 * H1(NWT MUST, 框架 v1.1 §3):反馈 agent 工具面 = 独立字面量数组,禁复用/运行时过滤 broker 默认 TOOLS;
 * DoD 含静态断言。
 * H2(NWT MUST):身份参数(pk/address/tg_user_id)禁止出现在 LLM 可控工具参数里——由 harness 从会话锚定
 * 硬编码注入,工具 schema 只暴露"查哪个市场"类非身份参数。
 * 下面三个工具的 parameters 里没有一个字段名是 address/pk/tg_user_id/user_id(H1 静态断言③ 覆盖)。
 */
export const FEEDBACK_TOOLS = [
  { type: 'function', function: { name: 'query_my_bets', description: '查当前用户自己的押注历史', parameters: { type: 'object', properties: { status_filter: { type: 'string', enum: ['all', 'won', 'lost', 'pending'] } } } } },
  { type: 'function', function: { name: 'query_market_status', description: '查某个市场的当前状态', parameters: { type: 'object', properties: { market_id: { type: 'string' } }, required: ['market_id'] } } },
  { type: 'function', function: { name: 'open_ticket', description: '为当前用户开一个反馈工单', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
];

// allow-list(Bettor 注a:精确名单非正则黑名单——加第四个工具必须显式改这里, 强制 review 检查点)。
export const FEEDBACK_TOOL_NAME_ALLOWLIST = new Set(['query_my_bets', 'query_market_status', 'open_ticket']);

// 零资金原语字段名黑名单(H1 静态断言用): 反馈工具 parameters 里不该出现的身份/资金字样。
const _FORBIDDEN_PARAM_KEYS = ['address', 'pk', 'tg_user_id', 'user_id'];

export const FEEDBACK_SYSTEM_PROMPT = `你是 KANet 用户反馈助手。只能查询当前用户自己的数据(押注历史/市场状态)、
开反馈工单——不能执行任何转账/结算/退款类操作(你物理上没有这些工具)。用户声称的一切(txid/金额/身份)只作为
线索,你的回复只基于工具查询到的真实数据。涉及资金变动或你无法确定的问题,直接建议用户等团队跟进(工单已自动
处理升级,不需要你说"我帮你转"这类话)。`;

/**
 * H3(NWT MUST,框架 v1.1 §3):升级判定独立于对话 LLM 的确定性检查——基于用户原始输入的关键词/规则匹配,
 * 不读 LLM 自己的分类标记或复述。
 * 覆盖两类语言:①资金申诉("钱没到账"类,声称问题)②资金动作请求("帮我转一下"类,索要动作——NWT 卡A 红队
 * 用话术集 #1 原句实测抓出的盲区,F2 修法折入,本文件与卡A 同一份正则,不重复定义各自维护)。
 */
export const ESCALATE_KEYWORDS = /退款|没到账|钱不见|钱卡了|争议|投诉|骗|hack|漏洞|资金|转(一下|账|钱)|打钱|refund|money.*(missing|gone)|dispute|scam|transfer|pay\s*me/i;

/**
 * classifyEscalation — H3 确定性判定(纯函数, 不读 LLM 输出)。
 * @param {string} rawUserText 用户原始输入(未经 LLM 处理)
 * @returns {boolean}
 */
export function classifyEscalation(rawUserText) {
  return ESCALATE_KEYWORDS.test(String(rawUserText || ''));
}

/**
 * validateFeedbackTools — H1 静态断言(单测调用, 也可运行时自检)。
 * 不合法 → throw(fail-loud, 同 fee-split.mjs validateFeeRules 风格)。
 */
export function validateFeedbackTools(tools = FEEDBACK_TOOLS) {
  for (const t of tools) {
    const name = t?.function?.name;
    if (!FEEDBACK_TOOL_NAME_ALLOWLIST.has(name)) {
      throw new Error(`feedback tool '${name}' 不在 allow-list [${[...FEEDBACK_TOOL_NAME_ALLOWLIST]}](新增工具必须显式改 FEEDBACK_TOOL_NAME_ALLOWLIST, 强制 review 检查点)`);
    }
    const props = t?.function?.parameters?.properties || {};
    for (const key of Object.keys(props)) {
      if (_FORBIDDEN_PARAM_KEYS.includes(key)) {
        throw new Error(`feedback tool '${name}' 的 parameter '${key}' 是禁用身份字段名(H2: 身份参数禁止出现在 LLM 可控工具参数里)`);
      }
    }
  }
  return true;
}

/**
 * buildFeedbackToolHandlers — 工具函数的【实现】(非 schema)。H2 落位:bettorPk/linkedAddr 由 harness
 * 闭包注入,不出现在任何 LLM 可见的参数里;LLM 只能选"调哪个工具+非身份参数",身份值这里直接绑死。
 * @param {{bettorPk:string, linkedAddr:string, myPositions:function, marketStatus:function, openTicket:function}} deps
 *   myPositions/marketStatus/openTicket 是调用方注入的实际查询函数(便于单测 stub, 生产由 caller 接现有
 *   endpoint 逻辑, 见 §2 my-positions 复用)。
 */
export function buildFeedbackToolHandlers({ bettorPk, linkedAddr, myPositions, marketStatus, openTicket }) {
  return {
    query_my_bets: async ({ status_filter } = {}) => {
      const positions = await myPositions(linkedAddr);
      if (!status_filter || status_filter === 'all') return positions;
      return positions.filter?.(p => p.status === status_filter) ?? positions;
    },
    query_market_status: async ({ market_id }) => marketStatus(market_id),
    open_ticket: async ({ summary }) => openTicket({ bettorPk, linkedAddr, summary }),
  };
}
