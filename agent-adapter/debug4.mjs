// 打印前5个 agent event 的完整 payload
const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

const ws = new WebSocket(GATEWAY_URL);
const connectId = crypto.randomUUID();
const agentReqId = crypto.randomUUID();
let runId = null;
let count = 0;

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
    console.log("[connected]");
    ws.send(JSON.stringify({
      type: "req", id: agentReqId, method: "agent",
      params: {
        message: "用一句话介绍你自己",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "debug4-" + Date.now(),
      },
    }));
  }

  if (frame.type === "res" && frame.id === agentReqId) {
    runId = frame.payload?.runId;
    console.log("[agent res]", JSON.stringify(frame.payload));
  }

  if (frame.type === "event" && frame.event === "agent" && count < 5) {
    count++;
    console.log(`[agent event #${count}]`, JSON.stringify(frame.payload).slice(0, 300));
    if (count === 5) {
      console.log("... (stopping after 5 events, watching for final)");
    }
  }

  // also watch for later events with status
  if (frame.type === "event" && frame.event === "agent" && count >= 5) {
    const p = frame.payload;
    if (p?.status || p?.done || p?.final || p?.result) {
      console.log("[agent final?]", JSON.stringify(p).slice(0, 500));
    }
  }
});

ws.addEventListener("error", (e) => console.log("[error]", e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 90000);
