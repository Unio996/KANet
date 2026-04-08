// 调试 agent 请求后的所有帧
const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

const ws = new WebSocket(GATEWAY_URL);
const connectId = crypto.randomUUID();
const agentId   = crypto.randomUUID();

ws.addEventListener("error", (e) => console.log("[error]", e.message));
ws.addEventListener("close", (e) => console.log("[close]", e.code, e.reason));

ws.addEventListener("message", ({ data }) => {
  const frame = JSON.parse(data);
  const summary = { type: frame.type, event: frame.event, id: frame.id,
    ok: frame.ok, status: frame.payload?.status, ptype: frame.payload?.type,
    error: frame.error || frame.payload?.error };
  console.log("[frame]", JSON.stringify(summary));

  if (frame.type === "event" && frame.event === "connect.challenge") {
    ws.send(JSON.stringify({
      type: "req", id: connectId, method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "cli", version: "1.0.0", platform: "win32", mode: "cli" },
        auth: { token: GATEWAY_TOKEN },
        scopes: ["operator.admin"],
      },
    }));
    console.log("[→ connect]");
  }

  if (frame.type === "res" && frame.id === connectId && frame.payload?.type === "hello-ok") {
    console.log("[→ agent request]");
    ws.send(JSON.stringify({
      type: "req", id: agentId, method: "agent",
      params: {
        message: "ping",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "debug2-" + Date.now(),
      },
    }));
  }
});

setTimeout(() => { console.log("[timeout]"); ws.close(); process.exit(0); }, 30000);
