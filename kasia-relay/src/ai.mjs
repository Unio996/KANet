// src/ai.mjs — relay 侧 AI 客户端
// All replies go through Console Mind. No adapter fallback.
// Console Mind has identity, skills, Gate 0 (stop detection), Gate 1 (blocked/rate limit).

const CONSOLE_URL = process.env.CONSOLE_URL || "";
const RELAY_NODE_ID = process.env.RELAY_NODE_ID || "";

export async function getAIReply(peer, message, txId) {
  if (!CONSOLE_URL) {
    console.log('[ai] No CONSOLE_URL — cannot reply');
    return null;
  }
  try {
    const res = await fetch(`${CONSOLE_URL}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: RELAY_NODE_ID, peer, message, txId }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.log(`[ai] Console returned ${res.status}`);
      return null;
    }
    const { reply } = await res.json();
    return reply?.trim() || null;
  } catch (err) {
    console.log(`[ai] Console unreachable: ${err.message}`);
    return null;
  }
}
