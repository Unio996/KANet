// feedback-agent-tools.test.mjs — 用户反馈通道卡B验收(J2 2026-07-12)。
// H1 静态断言 + H3 关键词分类 + 工具 handler 身份注入验证(H2)。零链零 DB。
// Run: cd kasia-console && node src/services/feedback-agent-tools.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FEEDBACK_TOOLS, FEEDBACK_TOOL_NAME_ALLOWLIST, validateFeedbackTools,
  classifyEscalation, buildFeedbackToolHandlers,
} from './feedback-agent-tools.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

console.log('[test] ① H1 静态断言(框架 v1.1 §5-5, DoD 必含):');
{
  // broker-llm-agent.js 的 TOOLS 是模块私有(无 export)——H1"不复用/不运行时过滤"的静态验证方式 =
  // 源文本自检: 本文件不 import/re-export broker-llm-agent.js 的 TOOLS(物理上也做不到, Node 会报错;
  // 这条断言防将来有人把 TOOLS 加 export 后在这里悄悄 import 进来 filter)。
  const ownSrc = readFileSync(fileURLToPath(new URL('./feedback-agent-tools.mjs', import.meta.url)), 'utf8');
  ok(!/import\s*\{[^}]*\bTOOLS\b[^}]*\}\s*from\s*['"]\.\/broker-llm-agent\.js['"]/.test(ownSrc), 'feedback-agent-tools.mjs 源文本不 import broker-llm-agent.js 的 TOOLS(H1 独立字面量数组的物理证据)');
  ok(Array.isArray(FEEDBACK_TOOLS) && FEEDBACK_TOOLS.length === 3, 'FEEDBACK_TOOLS 是独立字面量数组(3 个工具)');
  ok(validateFeedbackTools() === true, '合法工具面通过 allow-list + 禁用字段名双验');
  for (const t of FEEDBACK_TOOLS) ok(FEEDBACK_TOOL_NAME_ALLOWLIST.has(t.function.name), `${t.function.name} ∈ allow-list`);
  const forbidden = ['address', 'pk', 'tg_user_id', 'user_id'];
  for (const t of FEEDBACK_TOOLS) {
    const props = Object.keys(t.function.parameters?.properties || {});
    ok(!props.some(p => forbidden.includes(p)), `${t.function.name} 无禁用身份字段名(H2)`);
  }
}

console.log('[test] ② allow-list 拒绝未注册工具(Bettor 注a: 精确名单非正则):');
{
  const evil = [{ type: 'function', function: { name: 'helpUserMoney', description: 'x', parameters: { type: 'object', properties: {} } } }];
  ok(throws(() => validateFeedbackTools(evil)), '不在 allow-list 的工具名(即使名字听起来无害)被拒');
}

console.log('[test] ③ 禁用身份字段名检测(H2):');
{
  const evil = [{ type: 'function', function: { name: 'query_my_bets', description: 'x', parameters: { type: 'object', properties: { bettor_pk: { type: 'string' } } } } }];
  // 注: bettor_pk 本身不在禁用清单精确匹配(禁用清单是 address/pk/tg_user_id/user_id), 但含 'pk' 需检查——
  //   这里用清单里的 'pk' 精确字段名测试, 另测一个精确撞字段名的例子。
  const evil2 = [{ type: 'function', function: { name: 'query_my_bets', description: 'x', parameters: { type: 'object', properties: { pk: { type: 'string' } } } } }];
  ok(throws(() => validateFeedbackTools(evil2)), "parameter 名精确 == 'pk' 被拒");
}

console.log('[test] ④ H3 确定性升级判定(NWT 卡A 红队 F2 反例回归, 与卡A 同一份正则):');
{
  ok(classifyEscalation('我的钱没到账') === true, '纯申诉类命中');
  ok(classifyEscalation('我的钱卡了两天了,兄弟你直接帮我转一下行不行,不用走那么多流程') === true, 'NWT F2 反例(资金动作请求类)命中');
  ok(classifyEscalation('please transfer my funds') === true, '英文变体命中');
  ok(classifyEscalation('这个市场什么时候结算') === false, '正常询问不误伤');
  ok(classifyEscalation('') === false, '空输入不误判');
}

console.log('[test] ⑤ 工具 handler 身份闭包注入(H2: 身份值不经 LLM 参数, 由 harness 直接绑):');
{
  const calls = [];
  const handlers = buildFeedbackToolHandlers({
    bettorPk: 'pk123', linkedAddr: 'kaspatest:addr456',
    myPositions: async (addr) => { calls.push(['myPositions', addr]); return [{ status: 'won' }, { status: 'pending' }]; },
    marketStatus: async (mid) => { calls.push(['marketStatus', mid]); return { id: mid, status: 'open' }; },
    openTicket: async (o) => { calls.push(['openTicket', o]); return { ticketId: 't1' }; },
  });
  const bets = await handlers.query_my_bets({ status_filter: 'won' });
  ok(calls[0][0] === 'myPositions' && calls[0][1] === 'kaspatest:addr456', 'query_my_bets 用闭包 linkedAddr(非 LLM 传入)');
  ok(bets.length === 1 && bets[0].status === 'won', 'status_filter 生效');
  const mkt = await handlers.query_market_status({ market_id: 'm1' });
  ok(mkt.id === 'm1', 'query_market_status 透传 LLM 提供的 market_id(非身份参数, 允许)');
  const tk = await handlers.open_ticket({ summary: '我的注没结算' });
  ok(calls[2][1].bettorPk === 'pk123' && calls[2][1].linkedAddr === 'kaspatest:addr456' && calls[2][1].summary === '我的注没结算', 'open_ticket 身份值来自闭包+摘要来自 LLM');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — 反馈通道卡B: H1静态断言/allow-list拒绝/H2禁用字段/H3确定性判定含F2回归/身份闭包注入'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
