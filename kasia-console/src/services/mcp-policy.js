import { createHash, timingSafeEqual } from 'node:crypto';

function parseChannels(value, fallback) {
  return new Set(
    (value?.trim() ? value : fallback)
      .split(',')
      .map(channel => channel.trim())
      .filter(Boolean),
  );
}

export function loadMcpPolicy(env = process.env) {
  const readChannels = parseChannels(
    env.KANET_MCP_READ_CHANNELS,
    'dev-coord-testnet,codex-coord-testnet',
  );
  const writeChannels = parseChannels(
    env.KANET_MCP_WRITE_CHANNELS,
    'codex-coord-testnet',
  );
  for (const channel of writeChannels) {
    if (!readChannels.has(channel)) {
      throw new Error(`MCP write channel #${channel} must also be present in KANET_MCP_READ_CHANNELS`);
    }
  }
  const internalToken = env.KANET_MCP_INTERNAL_TOKEN?.trim() || '';
  return Object.freeze({
    enabled: internalToken.length >= 32,
    internalToken,
    relayId: env.KANET_MCP_RELAY_ID?.trim() || '',
    readChannels,
    writeChannels,
    maxMessageChars: Math.min(
      Math.max(Number.parseInt(env.KANET_MCP_MAX_MESSAGE_CHARS || '4500', 10) || 4500, 1),
      4500,
    ),
  });
}

export function hasValidInternalToken(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function canReadChannel(policy, channel) {
  return typeof channel === 'string' && policy.readChannels.has(channel);
}

export function canWriteChannel(policy, channel) {
  return typeof channel === 'string' && policy.writeChannels.has(channel);
}

export function hashMcpMessage(message) {
  return createHash('sha256').update(message, 'utf8').digest('hex');
}
