// skills.mjs — Parse and execute skill commands embedded in AI responses.
//
// Skill format in AI output:
//   <<SKILL:action:json_params>>
//
// Supported actions:
//   annotate  — add tags/notes/trust_level to the peer identity
//   block     — set peer trust_level to 'blocked'
//   unblock   — set peer trust_level to 'normal'
//
// After execution, skill tags are stripped from the reply text.

const CONSOLE_URL   = process.env.CONSOLE_URL   || "";
const INGEST_SECRET = process.env.INGEST_SECRET || "";

function log(...args) {
  console.log(new Date().toISOString(), "[skills]", ...args);
}

// Regex: <<SKILL:action>> or <<SKILL:action:json>>
const SKILL_RE = /<<SKILL:(\w+)(?::(\{[^>]*\}))?>>/g;

/**
 * Extract skill directives from AI reply text.
 * Returns { cleanReply, directives: [{ action, params }] }
 */
export function extractSkills(reply) {
  const directives = [];
  let match;
  while ((match = SKILL_RE.exec(reply)) !== null) {
    const action = match[1];
    let params = {};
    if (match[2]) {
      try { params = JSON.parse(match[2]); } catch { log("WARN bad JSON", match[2]); }
    }
    directives.push({ action, params });
  }
  const cleanReply = reply.replace(SKILL_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanReply, directives };
}

/**
 * Emit a structured event to Console's /ingest/event endpoint.
 */
async function emitEvent(type, level, summary, payload) {
  if (!CONSOLE_URL || !INGEST_SECRET) return;
  try {
    await fetch(`${CONSOLE_URL}/ingest/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
      body: JSON.stringify({
        traceId: payload?.correlationId || null,
        eventScope: "skill",
        eventType: type,
        source: "adapter",
        level,
        summary,
        payloadJson: JSON.stringify(payload),
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

/**
 * Execute all extracted skill directives via Console's double-validation endpoint.
 * Best-effort: failures are logged but never block the reply.
 */
export async function executeSkills(directives, peer, network = "mainnet", correlationId = null) {
  if (!directives.length || !CONSOLE_URL || !INGEST_SECRET) return;

  for (const { action, params } of directives) {
    try {
      // Emit proposed event
      await emitEvent("skill_proposed", "info", `Skill proposed: ${action}`, { action, peer: peer?.slice(-8), params, correlationId });

      // Call Console validation+execution endpoint
      const url = `${CONSOLE_URL}/api/skills/execute`;
      log("EXEC", action, peer?.slice(-8), JSON.stringify(params));
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingest-secret": INGEST_SECRET,
        },
        body: JSON.stringify({ skillName: action, peer, network, params }),
        signal: AbortSignal.timeout(3000),
      });

      const result = await res.json();

      if (result.allowed) {
        await emitEvent("skill_validated", "info", `Skill executed: ${action}`, { action, peer: peer?.slice(-8), skillId: result.skillId, correlationId });
        log("OK", action, peer?.slice(-8), "skillId:", result.skillId);
      } else {
        await emitEvent("skill_denied", "warn", `Skill denied: ${action} — ${result.reason}`, { action, peer: peer?.slice(-8), reason: result.reason, correlationId });
        log("DENIED", action, peer?.slice(-8), result.reason);
      }
    } catch (e) {
      log("ERROR", action, e.message);
    }
  }
}
