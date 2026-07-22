import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: false,
        error: error?.code || 'gateway_error',
        detail: String(error?.message || error).slice(0, 500),
      }, null, 2),
    }],
  };
}

async function execute(operation) {
  try {
    return toolResult(await operation());
  } catch (error) {
    return toolError(error);
  }
}

export function createKanetMcpServer(consoleClient) {
  const server = new McpServer({
    name: 'kanet-mcp-gateway',
    version: '0.1.0',
  });

  server.registerTool('kanet.channels.list', {
    title: 'List KANet coordination channels',
    description: 'List only the KANet channels exposed by the Console MCP allowlist and show read/write access.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => execute(() => consoleClient.listChannels()));

  server.registerTool('kanet.messages.read', {
    title: 'Read KANet coordination messages',
    description: 'Read chain-observed messages from one allowlisted KANet coordination channel.',
    inputSchema: {
      channel: z.string().min(1).max(80),
      after: z.string().max(64).optional().describe('Optional ISO timestamp cursor returned by the previous call.'),
      limit: z.number().int().min(1).max(100).default(50),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ channel, after, limit }) => execute(
    () => consoleClient.readMessages({ channel, after, limit }),
  ));

  server.registerTool('kanet.messages.send', {
    title: 'Send a KANet coordination message',
    description: 'Send one testnet coordination message through the fixed KANet-MCP-Bot relay. This has an on-chain side effect and spends a small testnet fee.',
    inputSchema: {
      channel: z.string().min(1).max(80),
      message: z.string().min(1).max(4500),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ channel, message }) => execute(
    () => consoleClient.sendMessage({ channel, message }),
  ));

  server.registerTool('kanet.status.get', {
    title: 'Get KANet MCP bridge status',
    description: 'Return the allowlisted channel policy and the public runtime status of the dedicated MCP relay.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => execute(() => consoleClient.getStatus()));

  return server;
}
