// retail-dex-memory.js — 对话记忆蒸馏层
//
// ⚠ SUPERSEDED BY docs/spec/2026-04-24-dex-broker-v2-glue-layer.md
// ⚠ DO NOT EXTEND — see docs/ANTI-PATTERNS.md (v1 retail-dex case study)
//
// 本文件 232 行 100% 重复 Mind memory kernel, 具体:
//   · distillIfNeeded (~60 LOC)            → 重复 agent-mind/src/kernels/memory.mjs (203 LOC) 已有 notes + relationship 蒸馏
//   · _callQwen (~50 LOC)                  → 重复 llm-dispatcher.callLlm (与 dialog.js 同一重复路径)
//   · user_memory 表 (v73)                 → 重复 agent-mind relationships{address: {notes[]}}
//   · applyMemoryToPrompt                  → 重复 context-builder.buildMemoryContext 注入
//
// v2 删此文件, memory 走 Mind kernel 唯一真相源.
//
// 职责: 周期性把用户-Broker 原始 DM 蒸馏成结构化画像字段
//
// 导出:
//   distillIfNeeded(userAddr, brokerAddr)  — 检查是否需要蒸馏, 需要则调 LLM
//   getMemory(userAddr)                    — 读 retail_dex_user_memory, 返画像对象

import { sqlite } from '../db/client.js';
import { extractJson } from './retail-dex-dialog.js';

const QWEN_URL    = process.env.QWEN_URL   || 'http://127.0.0.1:8000';
const QWEN_MODEL  = process.env.QWEN_MODEL || 'Qwen3.6-35B-A3B-Q4_K_M.gguf';
const QWEN_TIMEOUT_MS = 30_000;
const DISTILL_THRESHOLD = 10; // 消息数差 >= 10 触发蒸馏

// ── 辅助: 地址 → identity ID ──────────────────────────────────────────────

async function _addressToIdentityId(address) {
  if (!address) return null;
  const row = sqlite.prepare('SELECT id FROM identities WHERE address = ?').get(address);
  return row?.id || null;
}

// ── 拉取用户-Broker 双向 DM (最近 N 条, type=text) ──────────────────────

async function _fetchDmMessages(userAddr, brokerAddr, limit = 50) {
  const userId = await _addressToIdentityId(userAddr);
  const brokerId = await _addressToIdentityId(brokerAddr);
  if (!userId || !brokerId) return { messages: [], total: 0 };

  const messages = sqlite.prepare(`
    SELECT m.content_text, m.direction, m.created_at
    FROM messages m
    WHERE m.message_type = 'text'
      AND m.conversation_id IN (
        SELECT id FROM conversations
        WHERE ((local_identity_id = ? AND remote_identity_id = ?)
           OR (local_identity_id = ? AND remote_identity_id = ?))
        AND channel_type = 'dm'
      )
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(userId, brokerId, brokerId, userId, limit);

  const total = sqlite.prepare(`
    SELECT COUNT(*) as c FROM messages m
    WHERE m.message_type = 'text'
      AND m.conversation_id IN (
        SELECT id FROM conversations
        WHERE ((local_identity_id = ? AND remote_identity_id = ?)
           OR (local_identity_id = ? AND remote_identity_id = ?))
        AND channel_type = 'dm'
      )
  `).get(userId, brokerId, brokerId, userId)?.c || 0;

  return { messages: messages.reverse(), total }; // 按时间正序返回
}

// ── LLM 蒸馏 ──────────────────────────────────────────────────────────────

async function _callQwen(messages) {
  // kill switch: Qwen3.6 /no_think 前缀无效, 必须 API body chat_template_kwargs 关 reasoning
  const body = JSON.stringify({
    model: QWEN_MODEL,
    messages,
    max_tokens: 1000,
    temperature: 0.3,
    chat_template_kwargs: { enable_thinking: false },
  });
  const t0 = Date.now();
  const res = await fetch(`${QWEN_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(QWEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Qwen ${res.status}: ${t.slice(0, 100)}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  if (!content && data.choices?.[0]?.message?.reasoning_content) {
    content = data.choices[0].message.reasoning_content;
  }
  content = content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
  console.log(`[retail-dex-memory] Qwen distill ${content.length}c in ${Date.now() - t0}ms`);
  return content;
}

const DISTILL_SYSTEM = `你是摘要助手. 下面是某个用户在 KANet DEX Broker 处的聊天对话记录.
请从中蒸馏出用户的交易偏好, 写入以下 JSON 字段:
- distilled_summary: 3-5 句话摘要用户背景和意图
- preferred_chain: 最常用付款链 (BSC/ETH/TRON/SOL/Polygon 任一), 无偏好写 null
- preferred_pay_address: 常用付款地址 (0x 开头), 无偏好写 null
- tone_preference: 对话风格 (简短/详细/技术派), 无偏好写 null
- notable_preferences: 其他偏好字符串

只返回纯 JSON, 不要 markdown. 无可提炼信息的字段填 null.`;

// LLM 可能返 "BSC"/"Ethereum"/"TRX" 各种写法, 统一归一
function _normalizeChainStr(c) {
  if (!c) return null;
  const u = String(c).toUpperCase().trim();
  if (u === 'BSC' || u === 'BNB' || u === 'BEP20' || u === 'BINANCE') return 'bnb';
  if (u === 'ETH' || u === 'ETHEREUM' || u === 'MAINNET') return 'eth';
  if (u === 'TRON' || u === 'TRX') return 'tron';
  if (u === 'SOL' || u === 'SOLANA') return 'sol';
  if (u === 'POLYGON' || u === 'MATIC') return 'polygon';
  return null;
}

function _parseDistillResult(raw) {
  const obj = extractJson(raw);
  if (!obj) return null;
  return {
    distilled_summary: typeof obj.distilled_summary === 'string' ? obj.distilled_summary : null,
    preferred_chain: _normalizeChainStr(obj.preferred_chain),
    preferred_pay_address: typeof obj.preferred_pay_address === 'string'
      ? obj.preferred_pay_address : null,
    tone_preference: typeof obj.tone_preference === 'string' ? obj.tone_preference : null,
    notable_preferences: typeof obj.notable_preferences === 'string'
      ? obj.notable_preferences
      : (typeof obj.notable_preferences === 'object' && obj.notable_preferences !== null
        ? JSON.stringify(obj.notable_preferences) : null),
  };
}

// ── 写入 retail_dex_user_memory ──────────────────────────────────────────

function _upsertMemory(addr, distilled, msgCount, now) {
  sqlite.prepare(`
    INSERT INTO retail_dex_user_memory (
      user_kasia_address, distilled_summary, preferred_chain,
      preferred_pay_address, tone_preference, notable_preferences,
      last_distilled_at, message_count_at_distill, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_kasia_address) DO UPDATE SET
      distilled_summary = excluded.distilled_summary,
      preferred_chain = excluded.preferred_chain,
      preferred_pay_address = excluded.preferred_pay_address,
      tone_preference = excluded.tone_preference,
      notable_preferences = excluded.notable_preferences,
      last_distilled_at = excluded.last_distilled_at,
      message_count_at_distill = excluded.message_count_at_distill,
      updated_at = excluded.updated_at
  `).run(
    addr,
    distilled.distilled_summary,
    distilled.preferred_chain,
    distilled.preferred_pay_address,
    distilled.tone_preference,
    distilled.notable_preferences,
    now,              // last_distilled_at
    msgCount,         // message_count_at_distill (INTEGER, 不是时间戳!)
    now,              // created_at
    now,              // updated_at
  );
}

// ── 公开导出 ──────────────────────────────────────────────────────────────

/**
 * 判断是否需要蒸馏, 需要则执行 LLM 蒸馏并写入 DB.
 * 触发条件: retail_dex_user_memory.message_count_at_distill 落后当前 DM 消息数 >= DISTILL_THRESHOLD.
 */
export async function distillIfNeeded(userAddr, brokerAddr) {
  if (!userAddr) return { triggered: false, reason: 'no_user_addr' };

  const { messages, total } = await _fetchDmMessages(userAddr, brokerAddr);
  if (messages.length === 0) return { triggered: false, reason: 'no_messages' };

  const existing = sqlite.prepare(
    'SELECT message_count_at_distill FROM retail_dex_user_memory WHERE user_kasia_address = ?'
  ).get(userAddr);

  const lastCount = existing?.message_count_at_distill || 0;
  const diff = total - lastCount;
  if (diff < DISTILL_THRESHOLD) {
    return { triggered: false, reason: `diff=${diff} < threshold=${DISTILL_THRESHOLD}`, total };
  }

  try {
    const msgsForPrompt = messages.slice(0, 30).map((m, i) =>
      `${m.direction === 'inbound' ? '用户' : 'Broker'}: ${m.content_text}`
    );
    const prompt = `以下是用户与 Broker 的对话 (${msgsForPrompt.length} 条, 按时间正序):\n\n`
      + msgsForPrompt.join('\n')
      + '\n\n请蒸馏出用户偏好, 返回 JSON.';

    const raw = await _callQwen([
      { role: 'system', content: DISTILL_SYSTEM },
      { role: 'user', content: prompt },
    ]);

    const distilled = _parseDistillResult(raw);
    if (!distilled || !distilled.distilled_summary) {
      console.warn('[retail-dex-memory] distill returned empty summary, skipping');
      return { triggered: false, reason: 'empty_distill_result' };
    }

    const now = new Date().toISOString();
    _upsertMemory(userAddr, distilled, total, now);
    console.log(`[retail-dex-memory] distilled user=${userAddr.slice(0, 10)}... total=${total}`);
    return { triggered: true, distilled, total };
  } catch (err) {
    console.error('[retail-dex-memory] distill error:', err.message);
    return { triggered: false, reason: `error: ${err.message}` };
  }
}

/**
 * 读取用户的蒸馏记忆.
 * @returns {Promise<object|null>} null 如果无记录
 */
export async function getMemory(userAddr) {
  if (!userAddr) return null;
  const row = sqlite.prepare(
    'SELECT * FROM retail_dex_user_memory WHERE user_kasia_address = ?'
  ).get(userAddr);
  if (!row) return null;

  // 解析 notable_preferences JSON
  try {
    row.notable_preferences = row.notable_preferences ? JSON.parse(row.notable_preferences) : null;
  } catch {
    // 保持原始字符串
  }

  return row;
}
