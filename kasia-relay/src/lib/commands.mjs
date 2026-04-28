// commands.mjs — shared command-type enum (kasia-console broker ↔ kasia-relay).
//
// R-NWT-2026-04-28 Layer 5 (8-layer phase 3 ship): Owner 88 KAS 真测撞 Bug-Z21 — broker
// enqueue type='send_kas', relay switch only has 'transfer'. broker-relay command name 不一致
// → relay 静默 fall through default → sent undefined → ok=false → retry 3 fail → KAS 卡 broker.
//
// Fix: single source of truth for command types. broker imports COMMAND_TYPES, relay imports
// COMMAND_TYPE_SET. lint-kanet checkCommandEnum validates broker code uses enum (no string literals).
//
// Adding a new command:
//   1. Add to COMMAND_TYPES + COMMAND_PAYLOAD_SCHEMA below.
//   2. Add case in kasia-relay/src/relay.mjs switch.
//   3. Update broker callers (broker-action-queue, broker-intake-watcher, settler-router).
//   4. lint passes — no orphan command names.

export const COMMAND_TYPES = Object.freeze({
  HANDSHAKE: 'handshake',
  SEND_MESSAGE: 'send_message',
  PUBLISH_CARD: 'publish_card',
  SEND_BROADCAST: 'send_broadcast',
  TRANSFER: 'transfer',
  SPLIT_UTXO: 'split_utxo',
});

export const COMMAND_TYPE_SET = new Set(Object.values(COMMAND_TYPES));

export function isValidCommandType(type) {
  return typeof type === 'string' && COMMAND_TYPE_SET.has(type);
}

// Required fields per command type (minimal contract — payload may have additional optional fields).
// caller must include all listed fields for validation to pass.
export const COMMAND_PAYLOAD_SCHEMA = Object.freeze({
  [COMMAND_TYPES.HANDSHAKE]: ['target'],
  [COMMAND_TYPES.SEND_MESSAGE]: ['target', 'message'],
  [COMMAND_TYPES.PUBLISH_CARD]: [],
  [COMMAND_TYPES.SEND_BROADCAST]: ['channel', 'message'],
  [COMMAND_TYPES.TRANSFER]: ['target', 'amount'],
  [COMMAND_TYPES.SPLIT_UTXO]: [],
});

export function validateCommandPayload(cmd) {
  if (!cmd || typeof cmd !== 'object') return { valid: false, error: 'cmd must be object' };
  if (!isValidCommandType(cmd.type)) {
    return { valid: false, error: `unknown command type: ${cmd.type} (valid: ${Array.from(COMMAND_TYPE_SET).join(', ')})` };
  }
  const required = COMMAND_PAYLOAD_SCHEMA[cmd.type];
  for (const field of required) {
    if (cmd[field] === undefined || cmd[field] === null) {
      return { valid: false, error: `${cmd.type} missing required field: ${field}` };
    }
  }
  return { valid: true };
}
