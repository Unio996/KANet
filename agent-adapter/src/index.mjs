// agent-adapter/src/index.mjs
// HTTP server — relay 接口
//
// Contract:
//   POST /reply
//   Body:     { peer: string, message: string, txId?: string, network?: string }
//   Response: { reply: string }

import http from "node:http";
import { randomUUID } from "node:crypto";
import { ask, loadProvider, getProviderName } from "./providers/index.mjs";
import { getContext, buildPrompt } from "./console.mjs";
import { extractSkills, executeSkills } from "./skills.mjs";
import { SYSTEM_PROMPT } from "./system-prompt.mjs";

const PORT = process.env.ADAPTER_PORT || 3000;
const MAX_BODY_BYTES = 524288; // 512KB — Mind tasks with skills can be large

function log(...args) {
  console.log(new Date().toISOString(), "[adapter]", ...args);
}

async function handleReply(req, res) {
  let body = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      res.writeHead(413);
      res.end(JSON.stringify({ error: "payload too large" }));
      return;
    }
    body += chunk;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }

  // T-NWT-2026-04-30 RFC 阶段 2 (D3 + D7): /reply optional tools + trace_id propagation.
  // body 加: tools? / tool_choice? / trace_id?
  // returns: { reply: string } 不变 (mind brain backward-compat) OR { reply, tool_calls? } 当 tools 传时.
  const { peer, message, txId, network = "mainnet", mindTask, mindSystem, mindUser, tools, tool_choice, trace_id } = parsed;

  if (!peer || (!message && !mindUser)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "peer and message (or mindUser) are required" }));
    return;
  }
  const correlationId = randomUUID();
  const idempotencyKey = txId || correlationId;
  const hasTools = Array.isArray(tools) && tools.length > 0;

  let rawReply;
  let ctx = null;

  if (mindSystem && mindUser) {
    // Layered Mind task — system + user as separate roles for provider caching
    log("IN", peer?.slice(-8), `[MIND:layered] sys=${mindSystem.length}c usr=${mindUser.length}c`);
    rawReply = await ask(mindUser, idempotencyKey, { system: mindSystem, ...(hasTools ? { tools, tool_choice } : {}), ...(trace_id ? { trace_id } : {}) });
  } else if (mindTask) {
    // Legacy Mind task — single prompt string (backward compat)
    const prompt = typeof message === 'string' ? message : JSON.stringify(message);
    log("IN", peer?.slice(-8), "[MIND]", JSON.stringify(message).slice(0, 60));
    rawReply = await ask(prompt, idempotencyKey, { ...(hasTools ? { tools, tool_choice } : {}), ...(trace_id ? { trace_id } : {}) });
  } else {
    // Regular message — build prompt with adapter's own context
    log("IN", peer?.slice(-8), JSON.stringify(message).slice(0, 60));
    ctx = await getContext(peer, network);
    if (ctx?.history?.length) {
      log("CTX", peer.slice(-8), `${ctx.history.length} turns`);
    }
    const prompt = buildPrompt(peer, message, ctx, SYSTEM_PROMPT);
    rawReply = await ask(prompt, idempotencyKey, { ...(hasTools ? { tools, tool_choice } : {}), ...(trace_id ? { trace_id } : {}) });
  }

  // D1 polymorphic: rawReply 是 string (无 tools) OR {content, tool_calls?} (有 tools)
  const isObject = typeof rawReply === 'object' && rawReply !== null;
  const replyText = isObject ? (rawReply.content || '') : rawReply;
  const replyToolCalls = isObject ? rawReply.tool_calls : null;

  // Extract and execute skill directives (best-effort, never blocks reply)
  // skills 仅 apply 给 text reply path (mind brain), tool_calls 路径 broker 业务自处理.
  const { cleanReply, directives } = extractSkills(replyText);
  if (directives.length) {
    log("SKILLS", peer.slice(-8), directives.map(d => d.action).join(","));
    // Fire-and-forget: skill execution must not delay the reply
    executeSkills(directives, peer, network, correlationId).catch(e =>
      log("SKILL_ERROR", e.message)
    );
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  // D1 response shape: tools 传时返 {reply, tool_calls?}, 不传时返 {reply} (brain backward-compat).
  const responseBody = replyToolCalls
    ? { reply: cleanReply, tool_calls: replyToolCalls }
    : { reply: cleanReply };
  res.end(JSON.stringify(responseBody));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/reply") {
    try {
      await handleReply(req, res);
    } catch (e) {
      log("ERROR", e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, provider: getProviderName() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Load provider before accepting requests
loadProvider().then(() => {
  server.listen(PORT, () => {
    log(`listening on port ${PORT}`);
    log(`AI provider     → ${getProviderName()}`);
    log(`Console context → ${process.env.CONSOLE_URL || "(disabled — set CONSOLE_URL)"}`);
  });
}).catch(err => {
  console.error("FATAL: failed to load AI provider:", err.message);
  process.exit(1);
});
