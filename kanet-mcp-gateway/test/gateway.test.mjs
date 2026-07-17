import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGatewayApp } from '../src/app.mjs';
import { KanetConsoleClient } from '../src/console-client.mjs';
import { hasValidBearer } from '../src/security.mjs';

const TOKEN = 'e'.repeat(32);

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', error => {
      if (error) reject(error);
      else resolve(server);
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test('bearer authorization is exact and fail-closed', () => {
  assert.equal(hasValidBearer(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(hasValidBearer(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(hasValidBearer(TOKEN, TOKEN), false);
  assert.equal(hasValidBearer(undefined, TOKEN), false);
});

test('Console client always sends the internal token and request id', async () => {
  const calls = [];
  const client = new KanetConsoleClient({
    baseUrl: 'http://console.invalid',
    internalToken: 'i'.repeat(32),
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.sendMessage({ channel: 'codex-coord-testnet', message: 'hello' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['x-kanet-mcp-internal-token'], 'i'.repeat(32));
  assert.match(calls[0].init.headers['x-kanet-mcp-request-id'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    channel: 'codex-coord-testnet',
    message: 'hello',
  });
});

test('MCP endpoint exposes four tools and routes calls through the Console client', async () => {
  const calls = [];
  const consoleClient = {
    async listChannels() {
      calls.push(['list']);
      return { channels: [{ name: 'dev-coord-testnet', access: 'read' }] };
    },
    async readMessages(args) {
      calls.push(['read', args]);
      return { channel: args.channel, messages: [] };
    },
    async sendMessage(args) {
      calls.push(['send', args]);
      return { ok: true, txid: 'a'.repeat(64) };
    },
    async getStatus() {
      calls.push(['status']);
      return { ok: true, relay: { name: 'KANet-MCP-Bot' } };
    },
  };
  const config = {
    host: '127.0.0.1',
    externalToken: TOKEN,
    allowedHosts: ['127.0.0.1'],
  };
  const server = await listen(createGatewayApp({ config, consoleClient }));
  const address = server.address();
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: 'kanet-gateway-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(tool => tool.name).sort(),
      ['kanet.channels.list', 'kanet.messages.read', 'kanet.messages.send', 'kanet.status.get'],
    );
    await client.callTool({ name: 'kanet.channels.list', arguments: {} });
    await client.callTool({
      name: 'kanet.messages.read',
      arguments: { channel: 'dev-coord-testnet', limit: 10 },
    });
    const sent = await client.callTool({
      name: 'kanet.messages.send',
      arguments: { channel: 'codex-coord-testnet', message: 'canary' },
    });
    assert.equal(sent.isError, undefined);
    await client.callTool({ name: 'kanet.status.get', arguments: {} });
    assert.deepEqual(calls.map(call => call[0]), ['list', 'read', 'send', 'status']);
  } finally {
    await client.close().catch(() => {});
    await close(server);
  }
});
