import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReadChannel,
  canWriteChannel,
  hashMcpMessage,
  hasValidInternalToken,
  loadMcpPolicy,
} from '../src/services/mcp-policy.js';

test('default policy keeps dev coordination read-only and Codex coordination writable', () => {
  const policy = loadMcpPolicy({ KANET_MCP_INTERNAL_TOKEN: 'i'.repeat(32) });
  assert.equal(canReadChannel(policy, 'dev-coord-testnet'), true);
  assert.equal(canWriteChannel(policy, 'dev-coord-testnet'), false);
  assert.equal(canReadChannel(policy, 'codex-coord-testnet'), true);
  assert.equal(canWriteChannel(policy, 'codex-coord-testnet'), true);
});

test('write channels must be a subset of read channels', () => {
  assert.throws(() => loadMcpPolicy({
    KANET_MCP_INTERNAL_TOKEN: 'i'.repeat(32),
    KANET_MCP_READ_CHANNELS: 'dev-coord-testnet',
    KANET_MCP_WRITE_CHANNELS: 'codex-coord-testnet',
  }), /must also be present/);
});

test('internal token comparison and message hashing are deterministic', () => {
  assert.equal(hasValidInternalToken('i'.repeat(32), 'i'.repeat(32)), true);
  assert.equal(hasValidInternalToken('i'.repeat(31), 'i'.repeat(32)), false);
  assert.equal(
    hashMcpMessage('No TX, No Truth'),
    'dcc55da4645e7d561411973a3500c20607ad65206b1f055f268d47ef3215d2a5',
  );
});
