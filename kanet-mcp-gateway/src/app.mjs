import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hasValidBearer } from './security.mjs';
import { createKanetMcpServer } from './mcp-server.mjs';

function jsonRpcError(res, status, code, message) {
  return res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

export function createGatewayApp({ config, consoleClient }) {
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'kanet-mcp-gateway', version: '0.1.0' });
  });

  app.use('/mcp', (req, res, next) => {
    if (!hasValidBearer(req.headers.authorization, config.externalToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return jsonRpcError(res, 401, -32001, 'Unauthorized');
    }
    return next();
  });

  app.post('/mcp', async (req, res) => {
    const server = createKanetMcpServer(consoleClient);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    };
    res.on('close', () => { void close(); });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[kanet-mcp] request failed:', error?.message || error);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
      await close();
    }
  });

  app.get('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed'));
  app.delete('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed'));

  return app;
}
