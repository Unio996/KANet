// agent-adapter/src/openclaw.mjs
// OpenClaw Gateway WebSocket client
// Protocol from openclaw source: dist/client-eOXd-Nak.js

const GATEWAY_URL         = process.env.OPENCLAW_GATEWAY_URL  || "ws://127.0.0.1:18789";
const GATEWAY_TOKEN       = process.env.OPENCLAW_TOKEN        || "";
const AGENT_ID            = process.env.OPENCLAW_AGENT_ID     || "main";
const DEFAULT_SESSION_KEY = process.env.OPENCLAW_SESSION_KEY  || "agent:main:main";
const TIMEOUT_MS          = parseInt(process.env.OPENCLAW_TIMEOUT_MS || "120000");

function log(...args) {
  console.log(new Date().toISOString(), "[openclaw]", ...args);
}

/**
 * Send one message to OpenClaw agent, return reply text.
 * @param {string} message        - plaintext message to send
 * @param {string} idempotencyKey - unique key per message (use txId)
 * @param {string} [sessionKey]   - per-peer session key (defaults to DEFAULT_SESSION_KEY)
 * @returns {Promise<string>}     - agent reply text
 */
export async function askAgent(message, idempotencyKey, sessionKey = DEFAULT_SESSION_KEY) {
  return new Promise((resolve, reject) => {
    const ws       = new WebSocket(GATEWAY_URL);
    const connectId = crypto.randomUUID();
    const agentId   = crypto.randomUUID();
    let runId       = null;
    let textBuffer  = "";
    let settled     = false;
    let timer;

    function done(err, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      err ? reject(err) : resolve(val);
    }

    timer = setTimeout(() => done(new Error("OpenClaw timeout")), TIMEOUT_MS);
    ws.addEventListener("error", (e) => done(new Error(e.message || "WebSocket error")));

    ws.addEventListener("message", ({ data }) => {
      let frame;
      try { frame = JSON.parse(data); } catch { return; }

      // 1. Server challenge → send connect req
      if (frame.type === "event" && frame.event === "connect.challenge") {
        ws.send(JSON.stringify({
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "cli", version: "1.0.0", platform: "win32", mode: "cli" },
            auth: { token: GATEWAY_TOKEN },
            scopes: ["operator.admin"],
          },
        }));
        return;
      }

      // 2. Connect confirmed → send agent request
      if (frame.type === "res" && frame.id === connectId && frame.payload?.type === "hello-ok") {
        ws.send(JSON.stringify({
          type: "req",
          id: agentId,
          method: "agent",
          params: {
            message,
            agentId: AGENT_ID,
            sessionKey,
            idempotencyKey,
          },
        }));
        log("→", idempotencyKey.slice(0, 16), JSON.stringify(message).slice(0, 50));
        return;
      }

      // 3. Agent accepted → grab runId
      if (frame.type === "res" && frame.id === agentId && frame.payload?.status === "accepted") {
        runId = frame.payload.runId;
        return;
      }

      // 4. Streaming agent events
      if (frame.type === "event" && frame.event === "agent" && frame.payload?.runId === runId) {
        const { stream, data } = frame.payload;

        // Assistant stream: data.text is cumulative, data.delta is the new token
        if (stream === "assistant" && data?.text) {
          textBuffer = data.text; // keep latest cumulative text
          return;
        }

        // Lifecycle end → done
        if (stream === "lifecycle" && data?.phase === "end") {
          if (data?.isError) {
            done(new Error(data.error || "Agent error"));
          } else {
            log("←", textBuffer.slice(0, 80));
            done(null, textBuffer || "（无回复内容）");
          }
        }
      }
    });
  });
}
