// gateway.mjs — Gateway Adapter（AI 决策引擎桥接层）
// 职责：接收 relay 消息 → 调用 AI → 返回回复
// 现在：stub 回复（验证通路）
// 以后：替换 handleMessage 内部即可接入任何 AI

import { createServer } from "node:http";

const PORT = process.env.GATEWAY_PORT || 3000;

// ─────────────────────────────────────────
// 🔌 AI 引擎接口（只需改这一个函数）
// ─────────────────────────────────────────
async function handleMessage(peer, message) {
  // TODO: 替换为真实 AI 调用（OpenClaw / Anthropic / 本地模型）
  // 示例：
  // const res = await fetch("http://openclaw.local/api/chat", {
  //   method: "POST",
  //   headers: { "Authorization": `Bearer ${process.env.OPENCLAW_TOKEN}` },
  //   body: JSON.stringify({ message, peer })
  // });
  // return (await res.json()).reply;

  return `[Gateway stub] 收到你的消息："${message}"`;
}
// ─────────────────────────────────────────

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/reply") {
    res.writeHead(404).end("Not found");
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let peer, message;
  try {
    ({ peer, message } = JSON.parse(body));
  } catch {
    res.writeHead(400).end("Bad JSON");
    return;
  }

  console.log(`[${new Date().toISOString()}] ← ${peer.slice(-8)} | ${message}`);

  try {
    const reply = await handleMessage(peer, message);
    console.log(`[${new Date().toISOString()}] → ${reply.slice(0, 80)}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reply }));
  } catch (e) {
    console.error("Gateway error:", e.message);
    res.writeHead(500).end(JSON.stringify({ reply: "（Gateway 暂时不可用）" }));
  }
});

server.listen(PORT, () => {
  console.log(`🌉 Gateway Adapter running on http://localhost:${PORT}`);
  console.log(`   POST /reply  { peer, message } → { reply }`);
});
