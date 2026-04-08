// console.mjs — kasia-console context client
// Fetches peer context before calling OpenClaw.
// Hard 500ms timeout: must never bottleneck the AI response path.

const CONSOLE_URL    = process.env.CONSOLE_URL    || "";
const INGEST_SECRET  = process.env.INGEST_SECRET  || "";
const CONTEXT_LIMIT  = parseInt(process.env.CONTEXT_LIMIT || "10");
const CONTEXT_TIMEOUT_MS = parseInt(process.env.CONTEXT_TIMEOUT_MS || "500");

function log(...args) {
  console.log(new Date().toISOString(), "[console]", ...args);
}

/**
 * Fetch conversation context for a peer address.
 * Returns null on any failure — caller must handle gracefully.
 * @returns {{ identity, conv, history } | null}
 */
export async function getContext(peer, network = "mainnet") {
  if (!CONSOLE_URL || !INGEST_SECRET) return null;

  const url = `${CONSOLE_URL}/api/context/${encodeURIComponent(peer)}` +
              `?network=${network}&limit=${CONTEXT_LIMIT}`;
  try {
    const res = await fetch(url, {
      headers: { "x-ingest-secret": INGEST_SECRET },
      signal: AbortSignal.timeout(CONTEXT_TIMEOUT_MS),
    });
    if (res.status === 404) return { identity: null, conv: null, history: [] };
    if (!res.ok) { log("WARN HTTP", res.status); return null; }
    return await res.json();
  } catch (e) {
    log("WARN", e.message); // console unreachable — degrade gracefully
    return null;
  }
}

/**
 * Build the prompt string to send to OpenClaw.
 * Injects system prompt, peer identity, trust level, stats, and conversation history.
 * If no context at all, returns message as-is (zero overhead).
 * @param {string} peer - peer address
 * @param {string} message - incoming message
 * @param {object|null} ctx - context from Console
 * @param {string} [systemPrompt] - system prompt to prepend
 */
export function buildPrompt(peer, message, ctx, systemPrompt = null) {
  const hasIdentity = ctx?.identity?.displayName || ctx?.identity?.trustLevel;
  const hasHistory  = ctx?.history?.length > 0;
  if (!hasIdentity && !hasHistory && !systemPrompt) return message;

  const lines = [];

  // --- System prompt ---
  if (systemPrompt) lines.push(systemPrompt, "---");

  // --- Peer identity block ---
  const id = ctx?.identity || {};
  const name = id.displayName || peer.slice(-8);
  lines.push(`[Peer: ${name} (${peer.slice(-8)})]`);
  if (id.trustLevel) lines.push(`[Trust: ${id.trustLevel}]`);
  if (id.tags)       lines.push(`[Tags: ${id.tags}]`);
  if (id.notes)      lines.push(`[Notes: ${id.notes}]`);

  // --- Interaction stats ---
  if (ctx?.stats) {
    const s = ctx.stats;
    const parts = [`${s.messageCount} messages`];
    if (s.conversationCount > 1) parts.push(`${s.conversationCount} conversations`);
    if (s.firstSeen) parts.push(`first seen ${s.firstSeen}`);
    if (s.lastSeen)  parts.push(`last active ${s.lastSeen}`);
    lines.push(`[Stats: ${parts.join(", ")}]`);
  }

  // --- Conversation history ---
  if (hasHistory) {
    lines.push("[Conversation history:]");
    for (const { role, text } of ctx.history) {
      lines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
    }
  }

  lines.push("", `User: ${message}`);
  return lines.join("\n");
}
