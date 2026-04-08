// 打印所有 agent 事件（不过滤 runId）看实际来了什么
const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

const ws = new WebSocket(GATEWAY_URL);
const connectId  = crypto.randomUUID();
const agentReqId = crypto.randomUUID();
let myRunId = null;
let total = 0;

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
        message: "hi",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "d7-" + Date.now(),
      },
    }));
  }

  if (frame.type === "res" && frame.id === agentReqId) {
    myRunId = frame.payload?.runId;
    console.log("[accepted] myRunId:", myRunId);
  }

  // 打印所有 agent 事件，不管 runId
  if (frame.type === "event" && frame.event === "agent") {
    total++;
    const p = frame.payload;
    const mine = p?.runId === myRunId ? "★" : " ";
    console.log(`${mine}[${total}] runId=${p?.runId?.slice(0,12)} stream=${p?.stream} phase=${p?.data?.phase} seq=${p?.seq}`);
    if (p?.data?.phase === "end") {
      console.log("  → end data:", JSON.stringify(p.data).slice(0, 300));
    }
    if (p?.stream === "text") {
      console.log("  → text:", JSON.stringify(p.data?.text).slice(0, 100));
    }
  }
});

ws.addEventListener("error", (e) => console.log("[error]", e.message));
ws.addEventListener("close", (e) => { console.log("[close]", e.code); process.exit(0); });
setTimeout(() => { console.log("[30s timeout, total events:", total, "]"); ws.close(); }, 30000);
