// escalation-sanitize.mjs — 独立纯函数模块(无副作用, 无 import), 供 owner-bot.mjs Direction C 使用。
// 拆出来的原因: owner-bot.mjs 顶层 `new Bot(token)` 需要 OWNER_BOT_TOKEN 才能 import, 纯逻辑测试需要
// 零依赖能单独 import(同 H1 "独立字面量数组"精神: 逻辑与运行时副作用物理隔离)。
//
// 2026-07-17(Bettor#omp36y GREEN, NWT红队c96fc9f9 #7 MUST-FIX): raw_text 此前零转义/零截断/零结构分隔
// 直接拼进"原始输入: "后面, 用户可控文本能伪装成"[系统更正]...Owner已批准..."这类看起来是独立指令的
// 内容, 混进一条发送方=Owner真实relay的广播里。修法(NWT建议①②): 换行折叠消除伪造多行排版空间+超长
// 截断收窄注入可用空间。围栏(NWT建议①)由调用方(owner-bot.mjs)包在 body 模板里。
export const RAW_TEXT_PREVIEW_MAX = 400;

export function sanitizeRawTextForBroadcast(raw, ticketShort) {
  if (!raw) return '(无)';
  const folded = String(raw).replace(/\r\n|\r|\n/g, ' ⏎ ');
  if (folded.length > RAW_TEXT_PREVIEW_MAX) {
    return folded.slice(0, RAW_TEXT_PREVIEW_MAX) + `...[截断, 完整原文见 console 工单#${ticketShort}]`;
  }
  return folded;
}
