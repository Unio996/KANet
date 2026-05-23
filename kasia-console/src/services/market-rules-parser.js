import { sqlite } from '../db/client.js';
import crypto from 'node:crypto';
import { callLlm, extractJson } from './llm-dispatcher.js';

const RULES_TTL_DAYS = 7;
const GAMMA_URL = 'https://gamma-api.polymarket.com/markets';

async function fetchMarketDescription(conditionId) {
  const r = await fetch(`${GAMMA_URL}?condition_ids=${conditionId}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`gamma HTTP ${r.status}`);
  const arr = await r.json();
  const m = Array.isArray(arr) ? arr[0] : arr;
  if (!m) throw new Error('market not found');
  return { question: m.question, description: m.description || '', endDate: m.endDate };
}

export function getCached(conditionId) {
  const row = sqlite.prepare(
    "SELECT * FROM polymarket_rules WHERE condition_id = ? AND expires_at > datetime('now')"
  ).get(conditionId);
  if (!row) return null;
  return {
    ...row,
    rules_digest: safeParse(row.rules_digest),
    risks: safeParse(row.risks),
    decision_inputs: safeParse(row.decision_inputs),
  };
}

export async function parseRules(conditionId, { backend = 'qwen', force = false } = {}) {
  let source;
  try { source = await fetchMarketDescription(conditionId); }
  catch (e) { return { ok: false, error: `gamma fetch failed: ${e.message}` }; }

  const hash = crypto.createHash('md5').update(source.description || '').digest('hex');

  if (!force) {
    const cached = getCached(conditionId);
    if (cached && cached.source_hash === hash) {
      return { ok: true, cached: true, ...cached };
    }
  }

  // QWEN-RULES.md Rule 11 (2026-04-23): /no_think 前缀实测无效, 真 kill switch 是
  // body.chat_template_kwargs:{enable_thinking:false}. 本 caller 走 llm-dispatcher.callLlm()
  // qwen backend 已自动加 kill switch, 以下 prompt 里的 /no_think 是兼容保留 (Qwen3.6 版本下
  // 不报错但不生效). 留着不清理, 以防某些 llama-server 配置下 /no_think 作为软提示有益.
  const system = `/no_think
You are a Polymarket rules analyst. Output ONLY valid JSON (no thinking, no prose, no markdown code fence). Your response MUST start with { and end with }. Schema:
{
  "rules_digest": {"data_source": "where resolver will look", "timezone": "UTC or ET or other", "inclusion": ["what counts"], "exclusion": ["what doesn't count"]},
  "risks": ["ambiguous wording here", "subjective criterion there"],
  "decision_inputs": {"yes_conditions": "exact conditions for Yes to win", "no_conditions": "exact conditions for No to win"}
}`;
  const user = `/no_think\nQuestion: ${source.question}\n\nDescription:\n${source.description || '(empty)'}`;

  const r = await callLlm({ backend, system, user, maxTokens: 4000 });
  if (!r.ok) return { ok: false, error: `LLM call failed: ${r.error}` };

  const parsed = extractJson(r.text);
  if (!parsed) return { ok: false, error: 'LLM did not return valid JSON', raw: r.text?.slice(0, 500) };

  const now = new Date().toISOString();
  const expires = new Date(Date.now() + RULES_TTL_DAYS * 86400000).toISOString();

  sqlite.prepare(`
    INSERT INTO polymarket_rules (condition_id, question, rules_digest, risks, decision_inputs, source_hash, parsed_by, parsed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(condition_id) DO UPDATE SET
      question = excluded.question,
      rules_digest = excluded.rules_digest,
      risks = excluded.risks,
      decision_inputs = excluded.decision_inputs,
      source_hash = excluded.source_hash,
      parsed_by = excluded.parsed_by,
      parsed_at = excluded.parsed_at,
      expires_at = excluded.expires_at
  `).run(
    conditionId, source.question,
    JSON.stringify(parsed.rules_digest || {}),
    JSON.stringify(parsed.risks || []),
    JSON.stringify(parsed.decision_inputs || {}),
    hash, r.backend, now, expires
  );

  return { ok: true, cached: false, backend: r.backend, ...parsed };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
