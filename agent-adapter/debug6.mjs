// 用 agent:main:main（WebUI 同一 session）
const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

const ws = new WebSocket(GATEWAY_URL);
const connectId  = crypto.randomUUID();
const agentReqId = crypto.randomUUID();
let runId = null;

ws.addEventListener("message", ({ data }) => {
  const frame = JSON.parse(data);

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
  }

  if (frame.type === "res" && frame.id === connectId && frame.payload?.type === "hello-ok") {
    console.log("[connected] →agent (session: agent:main:main)");
    ws.send(JSON.stringify({
      type: "req", id: agentReqId, method: "agent",
      params: {
        message: "hi",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "d6-" + Date.now(),
      },
    }));
  }

  if (frame.type === "res" && frame.id === agentReqId) {
    runId = frame.payload?.runId;
    console.log("[agent res]", JSON.stringify(frame.payload));
  }

  if (frame.type === "event" && frame.event === "agent" && frame.payload?.runId === runId) {
    const { stream, data, seq } = frame.payload;
    console.log(`[${seq}] stream=${stream} data=${JSON.stringify(data).slice(0, 300)}`);
  }
});

ws.addEventListener("error", (e) => console.log("[error]", e.message));
ws.addEventListener("close", (e) => { console.log("[close]", e.code, e.reason); process.exit(0); });
setTimeout(() => { console.log("[90s timeout]"); ws.close(); }, 90000);
