import { loadConfig } from './config.mjs';
import { KanetConsoleClient } from './console-client.mjs';
import { createGatewayApp } from './app.mjs';

const config = loadConfig();
const consoleClient = new KanetConsoleClient({
  baseUrl: config.consoleUrl,
  internalToken: config.internalToken,
  timeoutMs: config.requestTimeoutMs,
});
const app = createGatewayApp({ config, consoleClient });

const listener = app.listen(config.port, config.host, error => {
  if (error) {
    console.error('[kanet-mcp] startup failed:', error.message);
    process.exit(1);
  }
  console.log(`[kanet-mcp] listening on http://${config.host}:${config.port}/mcp`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    listener.close(() => process.exit(0));
  });
}
