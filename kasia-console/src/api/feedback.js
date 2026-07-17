// feedback.js — 用户反馈通道卡B: console 桥 API 端点(J2 2026-07-12)。
// 设计 docs/2026-07-12-user-feedback-channel-console-side-design.md v1.2(双审 GREEN, NWT G1 折入落码)。
// 框架 docs/2026-07-12-user-feedback-channel-framework-design.md v1.1(H1-H3)。
//
// POST /api/feedback/reply — tg-bot(卡A)调用入口。H2:重新校验 tg-bot 声称的 linked_addr/bettor_pk
// 一致性(不信任跨进程传来的未经验证值,verify-value-source 精神延伸到跨进程边界)。H3:确定性升级判定
// 在 LLM 调用之前对原始文本跑(feedback-agent-tools.mjs 单源正则)。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { FEEDBACK_TOOLS, FEEDBACK_SYSTEM_PROMPT, classifyEscalation, buildFeedbackToolHandlers, validateFeedbackTools } from '../services/feedback-agent-tools.mjs';
import { checkTestHarnessToken } from '../lib/sim-traffic-marker.mjs';

validateFeedbackTools();   // 启动即自检(H1), 工具面若被意外改坏(如误加身份字段)直接 fail-loud 阻止服务起来。

async function deriveXOnlyPubkey(address) {
  const kaspa = await import('kaspa-wasm');
  return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
}

async function myPositions(linkedAddr) {
  const port = process.env.PORT || 3200;
  const r = await fetch(`http://localhost:${port}/api/pool/my-positions?linked_addr=${encodeURIComponent(linkedAddr)}`);
  const j = await r.json();
  return j.positions || j.data || [];
}
async function marketStatus(marketId) {
  const port = process.env.PORT || 3200;
  const r = await fetch(`http://localhost:${port}/api/pool/market/${encodeURIComponent(marketId)}`);
  return r.json();
}

/**
 * openTicket — execution_states 行(type='user_feedback', NWT G1: 不复用 approveExecution/startExecution
 * 那套 money-flow 状态机——反馈工单没有 approved/executing 这两态, 直接最小 INSERT)。
 */
function openTicket({ bettorPk, linkedAddr, summary, rawText, escalated, isSimulated }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO execution_states
      (id, type, source, agent_address, permission_level, status, action_details, created_at, updated_at)
    VALUES (?, 'user_feedback', 'user_feedback_agent', ?, 'feedback', 'pending', ?, ?, ?)
  `).run(id, bettorPk || null, JSON.stringify({ linkedAddr, summary, rawText, escalated: !!escalated, is_simulated: !!isSimulated }), now, now);
  return { ticketId: id };
}

/**
 * escalateTicket — 升级投递(Bettor §4 裁定方案B): 只写 events 行, 不直接广播。owner-bot 既有 poller
 * 加一条并行只读轮询源拾取这条 events 代发(硬条件①②见设计 §4, 本卡不实现 owner-bot 侧, 那是独立续卡)。
 * 去重(Bettor 注b): 每工单一次——同一 ticketId 已 escalated 的行不重复写 events。
 *
 * S1(2026-07-17): payload_json 镜像 is_simulated, 让 owner-bot pollFeedbackEscalations 直接从
 * events 行读到, 不用回查 execution_states join(零额外查询开销)。
 */
function escalateTicket(ticketId, { rawText, isSimulated }) {
  const row = sqlite.prepare(`SELECT action_details FROM execution_states WHERE id = ?`).get(ticketId);
  let details = {}; try { details = JSON.parse(row?.action_details || '{}'); } catch {}
  if (details.escalated_at) return { alreadyEscalated: true };   // 幂等: 每工单一次
  details.escalated_at = new Date().toISOString();
  sqlite.prepare(`UPDATE execution_states SET action_details = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(details), details.escalated_at, ticketId);
  const eventId = randomUUID();
  sqlite.prepare(`
    INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
    VALUES (?, 'system', 'feedback_escalated', 'feedback-agent', 'warn', ?, ?, datetime('now'))
  `).run(eventId, `用户反馈工单 ${ticketId.slice(0, 8)} 升级——涉资金或需人工判断`, JSON.stringify({
    ticket_id: ticketId, raw_text: rawText, is_simulated: !!isSimulated,   // N1: raw fact, 非 LLM 摘要(NWT 卡B 红队要求)
  }));
  return { alreadyEscalated: false, eventId };
}

export async function registerFeedbackRoutes(fastify) {
  // GET /api/feedback/escalated-since/:ts — owner-bot 独立轮询源用(设计 §4 硬条件②: 纯只读 events 查询)。
  // 光标语义同 devCoordMessagesSince: ts 是 ISO 时间戳, 返回严格晚于它的行, ASC 序(旧→新)供调用方顺序推送。
  // 只读 events 表(非 chain_events), 不需要 address(feedback_escalated 是系统事件非地址维度)。
  fastify.get('/api/feedback/escalated-since/:ts', async (request, reply) => {
    const { ts } = request.params;
    const limit = Math.min(parseInt(request.query?.limit, 10) || 50, 200);
    // events.created_at 写入用 SQLite datetime('now') = 空格分隔无 T/Z 形式("YYYY-MM-DD HH:MM:SS");
    // 调用方(owner-bot)cursor 用 JS new Date().toISOString() = 'T'/'Z' 形式——两种格式字符串直接
    // > 比较是字典序非时间序('T'>' ' ascii, 同日任意时刻都会误判为"更早"), SQLite 无原生 datetime
    // 类型全走 TEXT 比较, 必须用 datetime() 显式归一化两侧再比较 (同 memory
    // reference-sqlite-iso-timestamp-string-compare-trap 教训, 这里是新代码首次撞同一个坑).
    const rows = sqlite.prepare(`
      SELECT id, summary, payload_json, created_at FROM events
      WHERE event_type = 'feedback_escalated' AND datetime(created_at) > datetime(?)
      ORDER BY created_at ASC LIMIT ?
    `).all(ts || '1970-01-01', limit);
    const events = rows.map((r) => {
      let payload = {};
      try { payload = JSON.parse(r.payload_json || '{}'); } catch {}
      return { id: r.id, summary: r.summary, created_at: r.created_at, ticket_id: payload.ticket_id || null, raw_text: payload.raw_text || null, is_simulated: !!payload.is_simulated };
    });
    return reply.send({ ok: true, events });
  });

  fastify.post('/api/feedback/reply', async (request, reply) => {
    const { tg_user_id, linked_addr, bettor_pk, raw_text } = request.body || {};
    if (!raw_text?.trim()) return reply.code(400).send({ ok: false, error: 'raw_text required' });

    // S1(2026-07-17, KANet-UI, 设计 docs/2026-07-17-s1-support-cases-simulated-traffic-isolation-design.md
    // NWT GREEN 6ba63748): 模拟流量标记, 与身份/升级判定路径零交叉——只影响 is_simulated 落库,
    // 不做任何其他事(不绕 H2 重校验/classifyEscalation/anchored 判定, 顺序不变仍在下面照跑)。
    const harnessCheck = checkTestHarnessToken(request);
    if (harnessCheck.ok === false) return reply.code(harnessCheck.code).send({ ok: false, error: harnessCheck.error });
    const isSimulated = harnessCheck.isSimulated === true;

    // H2 跨进程再校验: 不信任 tg-bot 声称的 bettor_pk, 从 linked_addr 独立重导出比对(mismatch = fail-closed
    // 只给通用帮助, 同 verify-value-source 精神——上游可能被绕过/传错, console 是最后一道闸)。
    let verifiedBettorPk = null;
    if (linked_addr) {
      try {
        const derived = await deriveXOnlyPubkey(linked_addr);
        if (bettor_pk && String(bettor_pk).toLowerCase() !== derived.toLowerCase()) {
          return reply.code(200).send({ ok: true, anchored: false, reply: '暂时无法验证你的身份,请重新 /link 后再试。', reason: 'pk_mismatch' });
        }
        verifiedBettorPk = derived;
      } catch (e) {
        return reply.code(200).send({ ok: true, anchored: false, reply: '暂时无法验证你的身份,请重新 /link 后再试。', reason: `derive_fail: ${e.message}` });
      }
    }
    const anchored = !!verifiedBettorPk;

    // H3: 确定性判定在 LLM 调用之前, 对原始文本(未经处理)跑
    const escalated = classifyEscalation(raw_text);

    const { ticketId } = openTicket({ bettorPk: verifiedBettorPk, linkedAddr: linked_addr, summary: raw_text.slice(0, 200), rawText: raw_text, escalated, isSimulated });
    if (escalated) escalateTicket(ticketId, { rawText: raw_text, isSimulated });

    if (!anchored) {
      return reply.send({ ok: true, anchored: false, ticketId, escalated, reply: '未锚定用户只提供通用帮助——先 /link 你的地址才能查押注记录。' });
    }

    const handlers = buildFeedbackToolHandlers({
      bettorPk: verifiedBettorPk, linkedAddr: linked_addr,
      myPositions, marketStatus, openTicket: ({ summary }) => openTicket({ bettorPk: verifiedBettorPk, linkedAddr: linked_addr, summary, rawText: raw_text, escalated, isSimulated }),
    });

    try {
      const llmReply = await _runFeedbackDialog(raw_text, handlers);
      return reply.send({ ok: true, anchored: true, ticketId, escalated, reply: llmReply });
    } catch (e) {
      // LLM 侧失败不影响工单已开(fail-loud 记账, 用户仍有工单号可追)
      console.error(`[feedback] LLM dialog fail (ticket ${ticketId.slice(0, 8)}): ${e.message}`);
      return reply.send({ ok: true, anchored: true, ticketId, escalated, reply: `已收到你的反馈(工单 #${ticketId.slice(0, 8)}),团队会跟进。`, llmError: e.message });
    }
  });
}

// 🔴 复用范围钉死(不猜代码, 查了再写): handleLlmDialog(broker-llm-agent.js:925)是【整个 broker 买卖会话
// 状态机】(cancel/refund检测/pending fields merge/R31防重放...), 不是通用"call LLM with tools"工具函数
// ——反馈通道不该拖入这些无关逻辑。真正可复用的原语是 _callLlm(messages,ctx,opts) 本身(Rule 11
// 合规+retry+留痕已在其内部封装, ctx.peer 只影响 trace_id 关联, LLM 走 BROKER_RELAY_ID 绑定的同一个
// adapter——复用既有 LLM 基础设施, 非另起一套)。本函数是反馈通道自己的最小 tool-dispatch 循环(OpenAI
// 风格: 有 tool_calls 就执行+回填, 无 tool_calls 就是最终回复), 上限 3 轮防止 LLM 死循环调工具。
async function _runFeedbackDialog(rawText, handlers) {
  const { _callLlm } = await import('../services/broker-llm-agent.js');
  const messages = [{ role: 'user', content: rawText }];
  const MAX_TURNS = 3;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await _callLlm(messages, { peer: 'feedback-agent-internal', turn }, { tools: FEEDBACK_TOOLS, systemPrompt: FEEDBACK_SYSTEM_PROMPT });
    if (!res) throw new Error('_callLlm returned null(adapter 未配置或失败)');
    const toolCalls = res.tool_calls || [];
    if (toolCalls.length === 0) return res.content || '';
    messages.push({ role: 'assistant', content: res.content || null, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const handler = handlers[name];
      let result;
      if (!handler) {
        result = { error: `unknown tool ${name}` };   // H1 allow-list 已在启动自检卡过, 这里是纵深防线
      } else {
        let args = {}; try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        try { result = await handler(args); } catch (e) { result = { error: e.message }; }
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return '抱歉, 这个问题有点复杂, 已经帮你开了工单, 团队会跟进。';   // MAX_TURNS 耗尽兜底(非空回复)
}
