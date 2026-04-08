const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

const ws = new WebSocket(GATEWAY_URL);
const connectId = crypto.randomUUID(), agentReqId = crypto.randomUUID();
let myRunId = null, buf = "";

ws.addEventListener("message", ({ data }) => {
  const frame = JSON.parse(data);

  if (frame.type === "event" && frame.event === "connect.challenge")
    ws.send(JSON.stringify({ type:"req", id:connectId, method:"connect",
      params:{ minProtocol:3, maxProtocol:3,
        client:{id:"cli",version:"1.0.0",platform:"win32",mode:"cli"},
        auth:{token:GATEWAY_TOKEN}, scopes:["operator.admin"] } }));

  if (frame.type === "res" && frame.id === connectId && frame.payload?.type === "hello-ok")
    ws.send(JSON.stringify({ type:"req", id:agentReqId, method:"agent",
      params:{ message:"用一句话介绍你自己", agentId:"main",
        sessionKey:"agent:main:main", idempotencyKey:"d8-"+Date.now() } }));

  if (frame.type === "res" && frame.id === agentReqId)
    myRunId = frame.payload?.runId;

  if (frame.type === "event" && frame.event === "agent" && frame.payload?.runId === myRunId) {
    const { stream, data } = frame.payload;

    if (stream === "assistant")
      console.log("[assistant data]", JSON.stringify(data).slice(0, 200));

    if (stream === "lifecycle" && data?.phase === "end") {
      console.log("\n✅ 完整回复:\n" + buf);
      ws.close(); process.exit(0);
    }
  }
});

ws.addEventListener("error", (e) => { console.log("[error]", e.message); process.exit(1); });
setTimeout(() => { ws.close(); process.exit(0); }, 60000);
