// 调试：打印所有收到的 WebSocket 帧
const GATEWAY_URL   = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "88d16c353db3406b89a9dd89818a361b";

console.log("连接", GATEWAY_URL);
const ws = new WebSocket(GATEWAY_URL);

ws.addEventListener("open", () => console.log("[open]"));
ws.addEventListener("error", (e) => console.log("[error]", e.message));
ws.addEventListener("close", (e) => console.log("[close]", e.code, e.reason));

ws.addEventListener("message", ({ data }) => {
  console.log("[frame]", data);

  let frame;
  try { frame = JSON.parse(data); } catch { return; }

  // 收到任何 event 就回 connect
  if (frame.type === "event" && frame.event === "connect.challenge") {
    console.log("[→ connect with token]");
    ws.send(JSON.stringify({
      type: "req",
      id: crypto.randomUUID(),
      method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "cli", version: "1.0.0", platform: "win32", mode: "cli" },
        auth: { token: GATEWAY_TOKEN },
      },
    }));
  }

  if (frame.type === "event" && frame.event === "connect.ok") {
    console.log("[→ send agent request]");
    ws.send(JSON.stringify({
      type: "req",
      id: "test-001",
      method: "agent",
      params: {
        message: "ping",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "debug-" + Date.now(),
      },
    }));
  }
});

// 15秒后关闭
setTimeout(() => { console.log("[timeout, closing]"); ws.close(); process.exit(0); }, 15000);
