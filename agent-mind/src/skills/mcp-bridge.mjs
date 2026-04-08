/**
 * Skill: MCP Bridge — Universal socket for any MCP Server
 *
 * KANet's "万能插座". Instead of building custom skills for every external tool,
 * this skill connects to any MCP Server and exposes its tools to the Brain.
 *
 * Usage:
 *   1. Configure MCP servers in agent's mmConfig.mcpServers:
 *      { "coingecko": { "command": "npx", "args": ["-y", "@anthropic-ai/coingecko-mcp"] } }
 *   2. mcp_bridge gathers available tools from all configured servers
 *   3. Brain sees the tool list and can invoke them via [ACTION:MCP_CALL]
 *
 * Pre-configured MCP servers (npm install + configure):
 *   - CoinGecko: crypto prices, market data, trending coins (official Anthropic MCP)
 *   - whale-tracker-mcp: large transaction monitoring
 *   - solscan-mcp: Solana chain data
 *   - tron_mcp_server: TRON chain data
 *
 * This is NOT a wrapper per MCP server. It's ONE skill that connects to ALL configured servers.
 * Add a new MCP server = add one line to config. No code changes.
 */

import { Skill } from './base.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── MCP Client Pool ─────────────────────────────────────────────────────────

const _clients = new Map(); // serverName → { client, tools, connected }

async function getOrConnectMcp(serverName, serverConfig) {
  const existing = _clients.get(serverName);
  if (existing?.connected) return existing;

  try {
    const transport = new StdioClientTransport({
      command: serverConfig.command || 'npx',
      args: serverConfig.args || [],
      env: { ...process.env, ...(serverConfig.env || {}) },
    });

    const client = new Client({ name: `kanet-${serverName}`, version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();

    const entry = { client, tools, connected: true, name: serverName };
    _clients.set(serverName, entry);
    console.log(`[mcp-bridge] connected to ${serverName}: ${tools.length} tools available`);
    return entry;
  } catch (err) {
    console.log(`[mcp-bridge] failed to connect ${serverName}: ${err?.message || err}`);
    return null;
  }
}

/**
 * Call a tool on a connected MCP server.
 * Used by ACTION handler in mind.mjs: [ACTION:MCP_CALL server=coingecko tool=get_price args={"id":"kaspa"}]
 */
export async function mcpCall(serverName, toolName, args) {
  const entry = _clients.get(serverName);
  if (!entry?.connected) return { error: `MCP server "${serverName}" not connected` };

  try {
    const result = await entry.client.callTool({ name: toolName, arguments: args || {} });
    return { ok: true, content: result.content };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

// ── Skill Class ─────────────────────────────────────────────────────────────

export class McpBridgeSkill extends Skill {
  constructor() {
    super('mcp_bridge', 'Universal MCP bridge — connects to any MCP Server and exposes tools to Brain');
  }

  canActivate(taskType, context) {
    // Only activate if agent has MCP servers configured
    const mcpServers = context?.config?.mmConfig?.mcpServers
                    || context?.config?.mcpServers;
    return !!(mcpServers && Object.keys(mcpServers).length > 0);
  }

  async gatherContext(kernels, config) {
    const mcpServers = config.mmConfig?.mcpServers || config.mcpServers || {};
    const serverNames = Object.keys(mcpServers);

    if (serverNames.length === 0) {
      return { servers: [], totalTools: 0 };
    }

    // Connect to all configured servers in parallel
    const connections = await Promise.all(
      serverNames.map(name => getOrConnectMcp(name, mcpServers[name]))
    );

    const servers = [];
    for (const conn of connections) {
      if (!conn) continue;
      servers.push({
        name: conn.name,
        tools: conn.tools.map(t => ({
          name: t.name,
          description: t.description || '',
        })),
      });
    }

    return {
      servers,
      totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0),
    };
  }

  formatForBrain(gathered) {
    if (gathered.totalTools === 0) {
      return {
        name: this.name,
        description: 'No MCP servers connected',
        data: gathered,
        instructions: '== MCP BRIDGE == No servers configured or all failed to connect.',
      };
    }

    const sections = [
      '== MCP BRIDGE ==',
      `Connected servers: ${gathered.servers.length} | Total tools: ${gathered.totalTools}`,
      '',
      'To call a tool: [ACTION:MCP_CALL server=SERVER_NAME tool=TOOL_NAME args={"key":"value"}]',
      '',
    ];

    for (const server of gathered.servers) {
      sections.push(`--- ${server.name} (${server.tools.length} tools) ---`);
      for (const tool of server.tools) {
        sections.push(`  ${tool.name}: ${tool.description}`);
      }
      sections.push('');
    }

    return {
      name: this.name,
      description: `MCP bridge: ${gathered.totalTools} tools from ${gathered.servers.length} servers`,
      data: gathered,
      instructions: sections.join('\n'),
    };
  }
}
