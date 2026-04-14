import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KASIA_PATH = `${process.env.KANET_ROOT || 'D:/Anthropic'}/kasia-mcp/dist/index.js`;
const MNEMONIC_C = process.env.KASPA_MNEMONIC_C || process.env.KASPA_MNEMONIC;
if (!MNEMONIC_C) throw new Error("KASPA_MNEMONIC_C (or KASPA_MNEMONIC) env var required");

function extractJson(res) {
  const text = res?.content?.find?.(c => c?.type === "text")?.text ?? null;
  if (!text) return res;
  try { return JSON.parse(text); } catch { return { rawText: text }; }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [KASIA_PATH],
  env: { ...process.env, KASPA_NETWORK: "mainnet", KASIA_NETWORK: "mainnet", KASPA_MNEMONIC: MNEMONIC_C },
});
const client = new Client({ name: "relay-check", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);
console.log("✅ relay (Account C) connected");

const convs = extractJson(await client.callTool({ name: "kasia_get_conversations", arguments: {} }));
console.log("CONVERSATIONS:", JSON.stringify(convs, null, 2));

const reqs = extractJson(await client.callTool({ name: "kasia_get_requests", arguments: {} }));
console.log("PENDING REQUESTS:", JSON.stringify(reqs, null, 2));

await client.close();
process.exit(0);
