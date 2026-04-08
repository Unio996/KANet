// 只打印 agent event 的关键字段，找最终完成帧
const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

const ws = new WebSocket(GATEWAY_URL);
const connectId = crypto.randomUUID();
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
    console.log("[connected] sending agent request...");
    ws.send(JSON.stringify({
      type: "req", id: agentReqId, method: "agent",
      params: {
        message: "用一句话介绍你自己",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "debug3-" + Date.now(),
      },
    }));
  }

  // accepted → grab runId
  if (frame.type === "res" && frame.id === agentReqId && frame.payload?.status === "accepted") {
    runId = frame.payload.runId;
    console.log("[accepted] runId:", runId);
  }

  // agent events — print payload summary
  if (frame.type === "event" && frame.event === "agent") {
    const p = frame.payload;
    if (p?.runId !== runId) return; // ignore other sessions' events
    const summary = { runId: p?.runId, status: p?.status, type: p?.type,
      text: p?.text?.slice?.(0,80), payloads: p?.result?.payloads?.length };
    console.log("[agent event]", JSON.stringify(summary));
  }
});

ws.addEventListener("error", (e) => console.log("[error]", e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 90000);
