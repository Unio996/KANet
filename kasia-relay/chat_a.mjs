// chat_a.mjs — 账户 A 与账户 B 对话客户端
// 用法：
//   KASPA_MNEMONIC_A="canyon negative..." node chat_a.mjs handshake
//   KASPA_MNEMONIC_A="canyon negative..." node chat_a.mjs send "你好！"
//   KASPA_MNEMONIC_A="canyon negative..." node chat_a.mjs poll

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const _root = process.env.KANET_ROOT || 'D:/Anthropic';
const KASPA_PATH = `${_root}/kaspa-mcp/dist/index.js`;
const KASIA_PATH = `${_root}/kasia-mcp/dist/index.js`;

const PEER_B = process.env.PEER || "kaspa:qqscw77lnjdjuafrjh8nz5hxlat83cehv0waauh40cmu09xhtnurgcqs3s588";

const MNEMONIC_A = process.env.KASPA_MNEMONIC_A;
if (!MNEMONIC_A) throw new Error("Missing KASPA_MNEMONIC_A");

const BASE_ENV = {
  KASPA_NETWORK: "mainnet",
  KASIA_NETWORK: "mainnet",
  KASPA_MNEMONIC: MNEMONIC_A,
};

function extractJson(res) {
  const text = res?.content?.find?.(c => c?.type === "text")?.text ?? null;
  if (!text) return res;
  try { return JSON.parse(text); } catch { return { rawText: text }; }
}

async function makeClient(path, name) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [path],
    env: { ...process.env, ...BASE_ENV },
  });
  const client = new Client({ name, version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log(`✅ ${name} connected`);
  return client;
}

async function call(client, tool, args = {}) {
  const res = await client.callTool({ name: tool, arguments: args });
  return extractJson(res);
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ——— MAIN ———

const cmd = process.argv[2] || "status";
const msgArg = process.argv[3];

const kaspaClient = await makeClient(KASPA_PATH, "kaspa-a");
const kasiaClient = await makeClient(KASIA_PATH, "kasia-a");

async function sendKaspa(draft) {
  const sent = await call(kaspaClient, "send_kaspa", {
    to: draft.to,
    amount: draft.amount,
    payload: draft.payload,
  });
  return sent;
}

if (cmd === "status") {
  const convs = await call(kasiaClient, "kasia_get_conversations", {});
  log("Conversations:", JSON.stringify(convs, null, 2));

  const reqs = await call(kasiaClient, "kasia_get_requests", {});
  log("Pending requests:", JSON.stringify(reqs, null, 2));

} else if (cmd === "handshake") {
  // 先检查是否已有会话
  const convs = await call(kasiaClient, "kasia_get_conversations", {});
  const existing = Array.isArray(convs) && convs.find(c => c.contactAddress === PEER_B);
  if (existing) {
    log("Already have conversation with B:", existing.status);
  } else {
    // 检查是否有来自 B 的待接受请求
    const reqs = await call(kasiaClient, "kasia_get_requests", {});
    const inbound = Array.isArray(reqs) && reqs.find(r => r.address === PEER_B);
    if (inbound) {
      log("Found inbound handshake from B, accepting...");
      const draft = await call(kasiaClient, "kasia_accept_handshake", { address: PEER_B });
      log("Accept draft:", draft);
      const sent = await sendKaspa(draft);
      log("Accepted handshake TX:", sent?.txId || sent);
    } else {
      log("Sending handshake to B...");
      const draft = await call(kasiaClient, "kasia_send_handshake", { address: PEER_B });
      log("Handshake draft:", draft);
      const sent = await sendKaspa(draft);
      log("Handshake TX sent:", sent?.txId || sent);
      log("等待对方（B）接受握手后，再运行 send 或 poll。");
    }
  }

} else if (cmd === "send") {
  if (!msgArg) { console.error("Usage: node chat_a.mjs send \"消息内容\""); process.exit(1); }
  const draft = await call(kasiaClient, "kasia_send_message", { address: PEER_B, message: msgArg });
  if (!draft?.payload) { log("Send message failed:", draft); process.exit(1); }
  const sent = await sendKaspa(draft);
  log("Message TX:", sent?.txId || sent);
  log(`已发送: "${msgArg}"`);

} else if (cmd === "poll") {
  const seenTxs = new Set();
  log(`开始轮询来自 B 的消息，Ctrl+C 退出...`);
  const interval = setInterval(async () => {
    try {
      const msgs = await call(kasiaClient, "kasia_get_messages", { address: PEER_B });
      if (!Array.isArray(msgs)) return;
      for (const m of msgs) {
        if (!m.txId || seenTxs.has(m.txId)) continue;
        seenTxs.add(m.txId);
        log(`[B → A] ${m.message}`);
      }
    } catch (e) {
      log("Poll error:", e.message);
    }
  }, 3000);

  process.on("SIGINT", () => { clearInterval(interval); process.exit(0); });
  // keep alive
  await new Promise(() => {});

} else {
  console.error("Unknown command:", cmd);
  console.error("Commands: status | handshake | send \"msg\" | poll");
}

await kaspaClient.close();
await kasiaClient.close();
process.exit(0);
