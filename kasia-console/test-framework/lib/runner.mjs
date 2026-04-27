// test-framework/lib/runner.mjs — generic test runner (Owner 14:00+ 钦定可复用体系)
//
// 跑任意领域 case (broker / seeker / exchange / 任何 agent), 不写死 broker 业务逻辑.
// case 是 .test.mjs 模块, export default { id, steps[], expect }.
// runner 负责: 读 case → 执行 setup → 顺序跑 steps → 校验 expect → PASS/FAIL + trace.
//
// 复用范围:
// - actions: send_message / inject_history / wait_for_event / query_db / sleep
// - assertions: contains / does_not_contain / one_of / count / response_time
// - 加新 action / assertion 在此文件加, 全领域立刻能用.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3100';
const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/console.db');
// Owner 钦定 (2026-04-27 13:43): 'no log no pass' — 每个 case 跑测必须留完整 trace,
// 没生成 trace 文件 → 自动 FAIL, 即使所有 assertion 都过. 保证审计可信.
const TRACE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../logs/test-runs');

// ── action handlers (generic, 领域无关) ──────────────────────────

const actions = {
  /**
   * Send DM to broker via /api/agent/reply (synchronous reply path).
   * step: { action: 'send_message', from_peer, to_relay_id, message }
   * → returns { reply, latency_ms, raw }
   */
  async send_message(step, ctx) {
    const t0 = Date.now();
    const res = await fetch(`${CONSOLE_URL}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayNodeId: step.to_relay_id,
        peer: step.from_peer,
        message: step.message,
      }),
    });
    const data = await res.json();
    return {
      reply: data.reply || '',
      skip_reason: data.skip_reason || null,
      latency_ms: Date.now() - t0,
      raw: data,
    };
  },

  /**
   * Inject simulated history into messages table (peer ↔ relay).
   * Useful for testing scenarios that require pre-existing context.
   * step: { action: 'inject_history', peer_addr, relay_addr, messages: [{ direction, text }] }
   */
  async inject_history(step, ctx) {
    const db = new Database(DB_PATH);
    const ensureIdent = (addr) => {
      const row = db.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
      if (row) return row.id;
      const id = randomUUID();
      db.prepare("INSERT INTO identities (id, address, network, created_at, updated_at) VALUES (?, ?, 'mainnet', datetime('now'), datetime('now'))").run(id, addr);
      return id;
    };
    const peerId = ensureIdent(step.peer_addr);
    const relayId = ensureIdent(step.relay_addr);
    const insert = db.prepare(`
      INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?)
    `);
    let baseTs = Date.now() - 60_000;
    for (const m of step.messages) {
      const ts = new Date(baseTs).toISOString();
      const sender = m.direction === 'inbound' ? peerId : relayId;
      const receiver = m.direction === 'inbound' ? relayId : peerId;
      insert.run(randomUUID(), randomUUID(), m.direction, sender, receiver, m.text, ts, ts);
      baseTs += 5_000;
    }
    db.close();
    return { injected: step.messages.length };
  },

  /**
   * Sleep N ms (for letting backend process).
   */
  async sleep(step, ctx) {
    await new Promise(r => setTimeout(r, step.ms));
    return { slept_ms: step.ms };
  },

  /**
   * Run arbitrary SQL query (read-only) and return rows.
   * step: { action: 'query_db', sql, params: [] }
   */
  async query_db(step, ctx) {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(step.sql).all(...(step.params || []));
    db.close();
    return { rows, count: rows.length };
  },

  /**
   * Poll DB until row matches predicate (or timeout). Useful for "wait for chain TX".
   * step: { action: 'wait_for_db_row', sql, params, timeout_ms, poll_ms }
   * → returns { rows, found, polled_for_ms }
   */
  async wait_for_db_row(step, ctx) {
    const timeout = step.timeout_ms || 60_000;
    const poll = step.poll_ms || 2_000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const db = new Database(DB_PATH, { readonly: true });
      const rows = db.prepare(step.sql).all(...(step.params || []));
      db.close();
      if (rows.length > 0) return { rows, found: true, polled_for_ms: Date.now() - t0 };
      await new Promise(r => setTimeout(r, poll));
    }
    return { rows: [], found: false, polled_for_ms: Date.now() - t0 };
  },

  /**
   * Wait for an exchange_offer matching predicate to reach a target protocol_status.
   * step: { action: 'wait_for_offer_status', maker, status, timeout_ms }
   */
  async wait_for_offer_status(step, ctx) {
    const timeout = step.timeout_ms || 180_000;
    const poll = step.poll_ms || 3_000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const db = new Database(DB_PATH, { readonly: true });
      const row = db.prepare(`
        SELECT id, protocol_status, give_asset, give_amount, want_asset, taker, completed_at
        FROM exchange_offers
        WHERE maker = ? AND protocol_status = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(step.maker, step.status);
      db.close();
      if (row) return { row, found: true, polled_for_ms: Date.now() - t0 };
      await new Promise(r => setTimeout(r, poll));
    }
    return { row: null, found: false, polled_for_ms: Date.now() - t0 };
  },

  /**
   * Drive a persona one turn — generates user message via persona.step(state, prevReply),
   * sends to broker, captures reply for next turn. Persona state persists in ctx.vars[state_key].
   * step: { action: 'persona_turn', persona, from_peer, to_relay_id, state_key? }
   *   persona: imported persona module (default export)
   *   state_key: ctx.vars key for persisting persona state (default 'persona_state')
   * → returns { reply, latency_ms, message, persona_state, persona_done }
   * Assertions like reply_contains, reply_does_not_contain work as usual on this step result.
   * Cases that want multi-turn just repeat persona_turn until persona_done becomes true.
   * (T-J2-2026-04-27 personas v1, NWT runner integration via new action — non-breaking add)
   */
  async persona_turn(step, ctx) {
    const persona = step.persona;
    if (!persona || typeof persona.step !== 'function') {
      throw new Error('persona_turn requires step.persona module with .step(state, reply) method');
    }
    const stateKey = step.state_key || 'persona_state';
    if (!ctx.vars[stateKey]) {
      ctx.vars[stateKey] = persona.initialState ? persona.initialState() : {};
    }
    const prevReply = ctx.lastReply || null;
    const turn = persona.step(ctx.vars[stateKey], prevReply);
    ctx.vars[stateKey] = turn.nextState || ctx.vars[stateKey];
    if (turn.done || !turn.message) {
      return { message: null, reply: '', latency_ms: 0, persona_state: ctx.vars[stateKey], persona_done: true };
    }
    const t0 = Date.now();
    const res = await fetch(`${CONSOLE_URL}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayNodeId: step.to_relay_id,
        peer: step.from_peer,
        message: turn.message,
      }),
    });
    const data = await res.json();
    ctx.lastReply = data.reply || '';
    return {
      message: turn.message,
      reply: ctx.lastReply,
      skip_reason: data.skip_reason || null,
      latency_ms: Date.now() - t0,
      persona_state: ctx.vars[stateKey],
      persona_done: false,
    };
  },

  /**
   * Cleanup injected test peer history (best-effort, by trace_id pattern).
   * step: { action: 'cleanup_peer', peer_addr }
   */
  async cleanup_peer(step, ctx) {
    const db = new Database(DB_PATH);
    const ident = db.prepare('SELECT id FROM identities WHERE address = ?').get(step.peer_addr);
    if (!ident) { db.close(); return { cleaned: 0 }; }
    const r = db.prepare('DELETE FROM messages WHERE sender_identity_id = ? OR receiver_identity_id = ?').run(ident.id, ident.id);
    db.close();
    return { cleaned: r.changes };
  },

  /**
   * Wait for broker to have sent an outbound message to peer (via chain DM).
   * Polls messages table for outbound row from broker → peer with optional content match.
   * Use realLocalPeer() (not freshTestPeer) for the peer arg, otherwise broker chain DM
   * silently fails and this assertion will always timeout (Bug-Z10 dig).
   *
   * step: { action: 'wait_for_broker_outbound_msg', broker_addr, peer_addr, content_contains?, since_iso?, timeout_ms?, poll_ms? }
   * → returns { row, found, polled_for_ms }
   */
  async wait_for_broker_outbound_msg(step, ctx) {
    const timeout = step.timeout_ms || 60_000;
    const poll = step.poll_ms || 2_000;
    const since = step.since_iso || new Date(Date.now() - 5 * 60_000).toISOString();
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const db = new Database(DB_PATH, { readonly: true });
      const row = db.prepare(`
        SELECT m.id, m.created_at, m.content_text
        FROM messages m
        LEFT JOIN identities si ON si.id = m.sender_identity_id
        LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
        WHERE si.address = ? AND ri.address = ?
          AND m.message_type = 'text'
          AND m.created_at >= ?
        ORDER BY m.created_at DESC LIMIT 1
      `).get(step.broker_addr, step.peer_addr, since);
      db.close();
      if (row) {
        if (!step.content_contains || (row.content_text || '').includes(step.content_contains)) {
          return { row, found: true, polled_for_ms: Date.now() - t0 };
        }
      }
      await new Promise(r => setTimeout(r, poll));
    }
    return { row: null, found: false, polled_for_ms: Date.now() - t0 };
  },
};

// ── assertion functions (generic) ────────────────────────────────

const assertions = {
  reply_contains(step_result, expected, ctx) {
    const reply = String(step_result.reply || '');
    const list = Array.isArray(expected) ? expected : [expected];
    const missing = list.filter(s => !reply.includes(s));
    return missing.length === 0
      ? { pass: true }
      : { pass: false, msg: `reply missing: ${missing.join(', ')}\n  reply: ${reply.slice(0, 200)}` };
  },

  reply_does_not_contain(step_result, forbidden, ctx) {
    const reply = String(step_result.reply || '');
    const list = Array.isArray(forbidden) ? forbidden : [forbidden];
    const found = list.filter(s => reply.includes(s));
    return found.length === 0
      ? { pass: true }
      : { pass: false, msg: `reply must NOT contain: ${found.join(', ')}\n  reply: ${reply.slice(0, 200)}` };
  },

  reply_contains_one_of(step_result, list, ctx) {
    const reply = String(step_result.reply || '');
    const hit = list.find(s => reply.includes(s));
    return hit
      ? { pass: true }
      : { pass: false, msg: `reply must contain one of [${list.join(', ')}]\n  reply: ${reply.slice(0, 200)}` };
  },

  reply_response_time_ms_max(step_result, max_ms, ctx) {
    return step_result.latency_ms <= max_ms
      ? { pass: true }
      : { pass: false, msg: `latency ${step_result.latency_ms}ms > ${max_ms}ms max` };
  },

  reply_response_time_ms_min(step_result, min_ms, ctx) {
    return step_result.latency_ms >= min_ms
      ? { pass: true }
      : { pass: false, msg: `latency ${step_result.latency_ms}ms < ${min_ms}ms min (too fast — possibly hit deterministic path when LLM expected)` };
  },

  reply_skip_reason_equals(step_result, expected, ctx) {
    return step_result.skip_reason === expected
      ? { pass: true }
      : { pass: false, msg: `skip_reason='${step_result.skip_reason}' (want '${expected}')` };
  },

  db_row_count(step_result, expected, ctx) {
    return step_result.count === expected
      ? { pass: true }
      : { pass: false, msg: `db query returned ${step_result.count} rows (want ${expected})` };
  },

  found(step_result, expected, ctx) {
    return step_result.found === expected
      ? { pass: true }
      : { pass: false, msg: `found=${step_result.found} (want ${expected}), polled ${step_result.polled_for_ms}ms` };
  },

  row_field_equals(step_result, spec, ctx) {
    const row = step_result.row || step_result.rows?.[0];
    if (!row) return { pass: false, msg: 'no row to check' };
    for (const [k, expected] of Object.entries(spec || {})) {
      if (row[k] !== expected) return { pass: false, msg: `row.${k}='${row[k]}' (want '${expected}')` };
    }
    return { pass: true };
  },
};

// ── trace persistence (Owner 13:43 钦定 'no log no pass') ───────────

function _writeTraceFile(result) {
  // 写完整 trace 到 logs/test-runs/<ts>_<case_id>.log
  // 含: 元数据 + 每步 user msg / 完整 broker reply (no truncate) / 每条 assertion 判据
  // 失败容忍: 写失败 throw, 由 runCase 捕到标 trace_write_failed
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  const ts = result.started_at.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${ts}_${result.id}.log`;
  const filepath = path.join(TRACE_DIR, filename);

  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`Test Case: ${result.id}`);
  lines.push(`Domain:    ${result.domain || '?'}`);
  lines.push(`Started:   ${result.started_at}`);
  lines.push(`Ended:     ${result.ended_at || '?'}`);
  lines.push(`Verdict:   ${result.pass ? 'PASS' : 'FAIL'}` +
             (result.warnings?.length ? ` (${result.warnings.length} warning)` : ''));
  if (result.description) lines.push(`Description: ${result.description}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  for (const [i, s] of result.steps.entries()) {
    lines.push(`──── Step ${i + 1}: ${s.action} (${s.duration_ms || 0}ms) ────`);

    // user/broker message capture (full, no truncation)
    if (s.result) {
      // send_message / persona_turn 类有 message + reply
      if (s.result.message !== undefined) {
        lines.push(`USER MSG (verbatim):`);
        lines.push(`> ${String(s.result.message || '').split('\n').join('\n> ')}`);
        lines.push('');
      } else if (s.action === 'send_message') {
        // step input message (来自 step config, 不在 result 里)
        // → step config 在 testCase.steps[i] 里能拿到 message
        // 但我们在 result 里没存 step input, 这里 trace 时如果没存 input 就只输 reply
      }
      if (s.result.reply !== undefined) {
        lines.push(`BROKER REPLY (verbatim, full):`);
        lines.push(`> ${String(s.result.reply || '<empty>').split('\n').join('\n> ')}`);
        lines.push('');
        if (s.result.latency_ms !== undefined) {
          lines.push(`Latency: ${s.result.latency_ms}ms`);
        }
        if (s.result.skip_reason) {
          lines.push(`Skip reason: ${s.result.skip_reason}`);
        }
      }
      // 其他 action 类 (query_db / wait_for_*): dump result fields
      if (!s.result.reply && !s.result.message) {
        const dumpable = { ...s.result };
        delete dumpable.raw;  // raw 通常重复 reply
        lines.push(`Action result: ${JSON.stringify(dumpable, null, 2)}`);
        lines.push('');
      }
    }

    if (s.error) {
      lines.push(`ERROR: ${s.error}`);
      lines.push('');
    }

    // assertions (每条判据 pass/fail + 失败原因)
    if (s.assertions?.length) {
      lines.push(`Assertions:`);
      for (const a of s.assertions) {
        const sym = a.pass ? '✓' : (a.severity === 'should' ? '⚠' : '✗');
        const sev = a.severity === 'should' ? ' (warn)' : '';
        if (a.pass) lines.push(`  ${sym} ${a.key}${sev}`);
        else lines.push(`  ${sym} ${a.key}${sev}: ${a.msg}`);
      }
      lines.push('');
    }
    lines.push('');
  }

  // failed assertions summary
  if (result.failed_assertions?.length) {
    lines.push('═══ Failed assertions ═══');
    for (const f of result.failed_assertions) {
      lines.push(`  ${f.step} :: ${f.key}: ${f.msg}`);
    }
    lines.push('');
  }
  if (result.warnings?.length) {
    lines.push('═══ Warnings (should-level, not blocking PASS) ═══');
    for (const w of result.warnings) {
      lines.push(`  ${w.step} :: ${w.key}: ${w.msg}`);
    }
    lines.push('');
  }

  fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
  return filepath;
}

// ── runner main ──────────────────────────────────────────────────

export async function runCase(testCase) {
  const result = {
    id: testCase.id,
    description: testCase.description,
    domain: testCase.domain,
    started_at: new Date().toISOString(),
    steps: [],
    pass: true,
    failed_assertions: [],
  };
  const ctx = { vars: {}, log: (m) => console.log(`  [ctx] ${m}`) };

  // optional setup
  if (testCase.setup) {
    for (const s of (testCase.setup.actions || [])) {
      const handler = actions[s.action];
      if (!handler) throw new Error(`unknown setup action: ${s.action}`);
      await handler(s, ctx);
    }
  }

  // steps
  for (const step of (testCase.steps || [])) {
    const stepLog = { action: step.action, started_at: Date.now() };
    const handler = actions[step.action];
    if (!handler) {
      stepLog.error = `unknown action: ${step.action}`;
      result.steps.push(stepLog);
      result.pass = false;
      break;
    }
    try {
      const stepResult = await handler(step, ctx);
      stepLog.result = stepResult;
      stepLog.duration_ms = Date.now() - stepLog.started_at;

      // run assertions — split must (hard fail) vs should (warning only)
      // expect: { must: { ...hard checks }, should: { ...warnings } }
      // backward compat: bare keys at expect.* are treated as must
      const assertResults = [];
      const evalGroup = (group, severity) => {
        for (const [k, v] of Object.entries(group || {})) {
          const assertFn = assertions[k];
          if (!assertFn) {
            assertResults.push({ key: k, severity, pass: false, msg: `unknown assertion: ${k}` });
            if (severity === 'must') {
              result.pass = false;
              result.failed_assertions.push({ step: step.action, key: k, msg: `unknown: ${k}` });
            }
            continue;
          }
          const ar = assertFn(stepResult, v, ctx);
          assertResults.push({ key: k, severity, ...ar });
          if (!ar.pass && severity === 'must') {
            result.pass = false;
            result.failed_assertions.push({ step: step.action, key: k, msg: ar.msg });
          }
          if (!ar.pass && severity === 'should') {
            result.warnings = result.warnings || [];
            result.warnings.push({ step: step.action, key: k, msg: ar.msg });
          }
        }
      };
      const exp = step.expect || {};
      // explicit must/should groups
      evalGroup(exp.must, 'must');
      evalGroup(exp.should, 'should');
      // bare keys (backward compat) treated as must
      const bare = Object.fromEntries(
        Object.entries(exp).filter(([k]) => k !== 'must' && k !== 'should')
      );
      evalGroup(bare, 'must');
      stepLog.assertions = assertResults;
    } catch (err) {
      stepLog.error = err.message;
      stepLog.duration_ms = Date.now() - stepLog.started_at;
      result.pass = false;
      result.failed_assertions.push({ step: step.action, key: '<exception>', msg: err.message });
    }
    result.steps.push(stepLog);
    if (step.stop_on_fail && !result.pass) break;
  }

  result.ended_at = new Date().toISOString();

  // Capture step input (user message) for trace — pull from testCase.steps[i].message
  // (step input not in stepLog.result, so backfill here for trace审计 completeness)
  for (const [i, stepLog] of result.steps.entries()) {
    const cfg = testCase.steps?.[i] || {};
    if (cfg.message && stepLog.result && stepLog.result.message === undefined) {
      stepLog.result.message = cfg.message;
    }
  }

  // 'no log no pass' (Owner 13:43 钦定): 写 trace 文件失败 → 强制 FAIL
  try {
    result.trace_file = _writeTraceFile(result);
  } catch (err) {
    result.pass = false;
    result.failed_assertions.push({
      step: '<trace>',
      key: 'no_log_no_pass',
      msg: `trace file 写失败 (${err.message}) — case 强制 FAIL 即使 assertion 都过 (Owner '别骗我' 钦定)`,
    });
    result.trace_file = null;
  }

  return result;
}

export function formatResult(result) {
  const warningCount = result.warnings?.length || 0;
  const verdict = result.pass
    ? (warningCount > 0 ? `✓ PASS (${warningCount} warning)` : '✓ PASS')
    : '✗ FAIL';
  const lines = [`${verdict} | ${result.id} (${result.domain || 'unknown'})`];
  if (result.description) lines.push(`  ${result.description}`);
  for (const s of result.steps) {
    const tag = s.error
      ? '✗'
      : (s.assertions?.every(a => a.pass || a.severity === 'should') ? '✓' : '✗');
    lines.push(`  ${tag} step "${s.action}" (${s.duration_ms || 0}ms)`);
    if (s.error) lines.push(`     ERROR: ${s.error}`);
    if (s.result?.reply) lines.push(`     reply: ${String(s.result.reply).slice(0, 160).replace(/\n/g, ' ')}`);
    for (const a of (s.assertions || [])) {
      const symbol = a.pass ? '✓' : (a.severity === 'should' ? '⚠' : '✗');
      const tag2 = a.severity === 'should' ? ' (warn)' : '';
      if (a.pass) lines.push(`     ${symbol} ${a.key}${tag2}`);
      else lines.push(`     ${symbol} ${a.key}${tag2}: ${a.msg}`);
    }
  }
  if (!result.pass) {
    lines.push('');
    lines.push(`  Failed assertions: ${result.failed_assertions.length}`);
  }
  // 'no log no pass' (Owner 钦定): trace 文件路径打印, 任何人 cat 即可审计
  if (result.trace_file) {
    lines.push(`  📁 trace: ${result.trace_file}`);
  } else {
    lines.push(`  📁 trace: <missing — no log no pass triggered>`);
  }
  return lines.join('\n');
}
