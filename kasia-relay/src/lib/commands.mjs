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

// R38 (Z23 sediment): typeof spec per field. Bug-Z23 真根因 — broker enqueue amount: number,
// kasToSompi(amount) 内部 BigInt(number) → 'Cannot mix BigInt' crash. J1 0ac4a571 修法
// String(amountStr).trim() 边界 coerce. R38 把 coerce 升 schema enforce + runtime validate.
//
// Coerce phase (现): caller mixed (J1 部分修 String, 历史 caller 仍 number). validateCommandPayload
// 见 number→string 自动 coerce, 不 reject. null/array/{} reject (真 invalid).
//
// Future cleanup waypoint: caller 全 String 后, schema 改 strict reject, remove coerce branch.
export const COMMAND_FIELD_TYPES = Object.freeze({
  [COMMAND_TYPES.HANDSHAKE]: { target: 'string' },
  [COMMAND_TYPES.SEND_MESSAGE]: { target: 'string', message: 'string' },
  [COMMAND_TYPES.SEND_BROADCAST]: { channel: 'string', message: 'string' },
  [COMMAND_TYPES.TRANSFER]: { target: 'string', amount: ['string', 'number'] },
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
  // R38: typeof spec check + graceful coerce (Z23 sediment)
  const fieldTypes = COMMAND_FIELD_TYPES[cmd.type];
  if (fieldTypes) {
    for (const [field, expected] of Object.entries(fieldTypes)) {
      if (cmd[field] === undefined) continue;  // optional field, skip
      const actual = Array.isArray(cmd[field]) ? 'array' : typeof cmd[field];
      const allowed = Array.isArray(expected) ? expected : [expected];
      if (!allowed.includes(actual)) {
        return { valid: false, error: `${cmd.type} field '${field}' typeof '${actual}' not in [${allowed.join(',')}]` };
      }
      // coerce number → string for string-allowed fields (Bug-Z23 spirit, J1 0ac4a571)
      // NOTE: validateCommandPayload mutates cmd in place — caller should not retain pre-coerce reference (J1 d6abd592 review).
      if (allowed.includes('string') && actual === 'number') {
        cmd[field] = String(cmd[field]);
      }
    }
  }
  return { valid: true };
}
