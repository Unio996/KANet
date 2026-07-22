function requiredSecret(env, name) {
  const value = env[name]?.trim();
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to a secret of at least 32 characters`);
  }
  return value;
}

function parsePositiveInt(value, fallback, name) {
  const parsed = Number.parseInt(value ?? '', 10);
  const result = Number.isFinite(parsed) ? parsed : fallback;
  if (result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
}

function parseAllowedHosts(value) {
  if (!value?.trim()) return undefined;
  const hosts = value.split(',').map(v => v.trim()).filter(Boolean);
  return hosts.length ? hosts : undefined;
}

export function loadConfig(env = process.env) {
  const consoleUrlValue = env.KANET_CONSOLE_URL?.trim();
  if (!consoleUrlValue) throw new Error('KANET_CONSOLE_URL is required');
  const consoleUrl = new URL(consoleUrlValue);
  if (!['http:', 'https:'].includes(consoleUrl.protocol)) {
    throw new Error('KANET_CONSOLE_URL must use http or https');
  }

  return Object.freeze({
    host: env.KANET_MCP_HOST?.trim() || '127.0.0.1',
    port: parsePositiveInt(env.KANET_MCP_PORT, 3215, 'KANET_MCP_PORT'),
    externalToken: requiredSecret(env, 'KANET_MCP_TOKEN'),
    internalToken: requiredSecret(env, 'KANET_MCP_INTERNAL_TOKEN'),
    consoleUrl: consoleUrl.toString().replace(/\/$/, ''),
    requestTimeoutMs: parsePositiveInt(
      env.KANET_MCP_REQUEST_TIMEOUT_MS,
      30_000,
      'KANET_MCP_REQUEST_TIMEOUT_MS',
    ),
    allowedHosts: parseAllowedHosts(env.KANET_MCP_ALLOWED_HOSTS),
  });
}
