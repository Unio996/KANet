/**
 * kasia-relay — MCP 连接验证脚本
 * 目标：验证 kaspa-mcp 和 kasia-mcp 两个 MCP server 能正常连接并调用工具
 *
 * 用法：
 *   node verify-mcp.mjs
 *
 * 依赖（在本脚本目录执行一次）：
 *   npm install @modelcontextprotocol/sdk
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ─── 配置区（Claude Code 填入真实值）───────────────────────────────────────
const _root = process.env.KANET_ROOT || 'D:/Anthropic';
const KASPA_MCP_PATH = `${_root}/kaspa-mcp/dist/index.js`;
const KASIA_MCP_PATH = `${_root}/kasia-mcp/dist/index.js`;
const KASPA_MNEMONIC = "reject bulk rapid citizen myself health rally expand solution tide person cargo"; // ← 钱包1
const KASPA_NETWORK  = "mainnet";
// ──────────────────────────────────────────────────────────────────────────────

const ENV = {
  ...process.env,
  KASPA_NETWORK,
  KASPA_MNEMONIC,
};

/**
 * 创建并连接一个 MCP stdio 客户端
 */
async function connectMCP(name, scriptPath) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [scriptPath],
    env: ENV,
  });
  const client = new Client({ name, version: "1.0.0" }, {});
  await client.connect(transport);
  console.log(`✅ [${name}] 连接成功`);
  return client;
}

/**
 * 列出 MCP server 暴露的所有 tools（用于调试确认）
 */
async function listTools(client, name) {
  const { tools } = await client.listTools();
  console.log(`\n📋 [${name}] 可用 tools (${tools.length} 个):`);
  for (const t of tools) {
    console.log(`   - ${t.name}`);
  }
}

/**
 * 调用单个 tool，打印结果
 */
async function callTool(client, toolName, args = {}) {
  console.log(`\n🔧 调用 ${toolName}`, Object.keys(args).length ? args : "");
  const result = await client.callTool({ name: toolName, arguments: args });

  // MCP tool 返回 content 数组，取第一个 text 块
  const text = result.content?.find(c => c.type === "text")?.text ?? JSON.stringify(result);
  console.log(`   结果:`, text);
  return text;
}

// ─── 主验证流程 ───────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  kasia-relay MCP 连接验证");
  console.log("═══════════════════════════════════════\n");

  let kaspaClient, kasiaClient;

  // ── 1. kaspa-mcp ────────────────────────────────────────────────────────────
  console.log("── kaspa-mcp ──────────────────────────");
  try {
    kaspaClient = await connectMCP("kaspa-mcp", KASPA_MCP_PATH);
    await listTools(kaspaClient, "kaspa-mcp");
    await callTool(kaspaClient, "get_my_address");
    await callTool(kaspaClient, "get_balance");
    console.log("\n✅ kaspa-mcp 验证通过");
  } catch (err) {
    console.error("\n❌ kaspa-mcp 失败:", err.message);
  }

  // ── 2. kasia-mcp ────────────────────────────────────────────────────────────
  console.log("\n── kasia-mcp ──────────────────────────");
  try {
    kasiaClient = await connectMCP("kasia-mcp", KASIA_MCP_PATH);
    await listTools(kasiaClient, "kasia-mcp");
    await callTool(kasiaClient, "kasia_get_conversations");
    await callTool(kasiaClient, "kasia_get_requests");
    console.log("\n✅ kasia-mcp 验证通过");
  } catch (err) {
    console.error("\n❌ kasia-mcp 失败:", err.message);
  }

  // ── 3. 清理 ─────────────────────────────────────────────────────────────────
  console.log("\n── 清理连接 ───────────────────────────");
  try { await kaspaClient?.close(); } catch (_) {}
  try { await kasiaClient?.close(); } catch (_) {}
  console.log("完成。\n");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
