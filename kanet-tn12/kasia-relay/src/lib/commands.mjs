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
  // T-J2-2026-05-12 #2 — read-only IPC: console 取 relay child rpc-listener._rpc state snapshot (UI 健康检测 P0 NWT spec).
  GET_RPC_STATE: 'get_rpc_state',
  // Phase 4a SS trustless escrow (Sub 6+8+9) — oracle / maker IPC for prediction market settle TX flow.
  ECDSA_SIGN: 'ecdsa_sign',
  GET_PUBKEY: 'get_pubkey',
  SIGN_INPUT_FOR_SETTLE: 'sign_input_for_settle',
  PREDICTION_SETTLE_BUILD_PREIMAGE: 'prediction_settle_build_preimage',
  PREDICTION_SETTLE_TX: 'prediction_settle_tx',
  PREDICTION_REFUND_TX: 'prediction_refund_tx',
  // B2 v0.5 Sub 2d Phase 2c — pool settle TX submit (= multi-input spine + N sides).
  POOL_SETTLE_TX: 'pool_settle_tx',
  // B2 v0.5 area-4 7c — pool refund_disagreement TX submit (= spine-only, 4 inputs, 3 or 4 outputs).
  POOL_REFUND_DISAGREEMENT_TX: 'pool_refund_disagreement_tx',
  // B2 v0.5 Phase 3 bug 7 fix — confirm transfer UTXO landed in accepted set.
  CHECK_UTXO_LANDED: 'check_utxo_landed',
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
  [COMMAND_TYPES.GET_RPC_STATE]: [],  // T-J2-2026-05-12 #2 — read-only, 无 required field
  // Phase 4a SS trustless escrow
  [COMMAND_TYPES.ECDSA_SIGN]: ['message'],
  [COMMAND_TYPES.GET_PUBKEY]: [],
  [COMMAND_TYPES.SIGN_INPUT_FOR_SETTLE]: ['tx_hex', 'input_index'],
  [COMMAND_TYPES.PREDICTION_SETTLE_BUILD_PREIMAGE]: ['p2sh_address', 'required_input_outpoints', 'outputs'],
  [COMMAND_TYPES.PREDICTION_SETTLE_TX]: ['p2sh_address', 'redeem_script_hex', 'required_input_outpoints', 'outputs', 'sigs_by_input', 'winner'],
  [COMMAND_TYPES.PREDICTION_REFUND_TX]: ['p2sh_address', 'redeem_script_hex', 'branch'],
  [COMMAND_TYPES.POOL_SETTLE_TX]: ['spine_p2sh_address', 'side_p2sh_addresses', 'spine_redeem_script_hex', 'side_redeem_script_hexes', 'required_input_outpoints', 'outputs', 'spine_sigs_by_input', 'spine_input_count', 'winner'],
  [COMMAND_TYPES.POOL_REFUND_DISAGREEMENT_TX]: ['spine_p2sh_address', 'spine_redeem_script_hex', 'required_input_outpoints', 'outputs', 'spine_sigs_by_input', 'silent_oracle_index', 'signing_pair'],
  [COMMAND_TYPES.CHECK_UTXO_LANDED]: ['address', 'txid'],
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
  [COMMAND_TYPES.PUBLISH_CARD]: { params: 'object' },
  [COMMAND_TYPES.SPLIT_UTXO]: { targetCount: 'number' },
  [COMMAND_TYPES.GET_RPC_STATE]: {},  // T-J2-2026-05-12 #2 — read-only, 无 typeof constraint
  // Phase 4a SS trustless escrow
  [COMMAND_TYPES.ECDSA_SIGN]: { message: 'string' },
  [COMMAND_TYPES.GET_PUBKEY]: {},
  [COMMAND_TYPES.SIGN_INPUT_FOR_SETTLE]: { tx_hex: 'string', input_index: 'number' },
  // p2sh_address allows array for pool multi-p2sh (= spine + N side) per B2 v0.5 Sub 2d Phase 2a-1.
  // sig_op_counts optional per-input array (Phase 3 bug 5 — preimage/final sighash consistency).
  [COMMAND_TYPES.PREDICTION_SETTLE_BUILD_PREIMAGE]: { p2sh_address: ['string', 'array'], required_input_outpoints: 'array', outputs: 'array', sig_op_counts: 'array' },
  [COMMAND_TYPES.PREDICTION_SETTLE_TX]: { p2sh_address: 'string', redeem_script_hex: 'string', required_input_outpoints: 'array', outputs: 'array', sigs_by_input: 'array', winner: 'number' },
  [COMMAND_TYPES.PREDICTION_REFUND_TX]: { p2sh_address: 'string', redeem_script_hex: 'string', branch: 'number' },
  [COMMAND_TYPES.POOL_SETTLE_TX]: { spine_p2sh_address: 'string', side_p2sh_addresses: 'array', spine_redeem_script_hex: 'string', side_redeem_script_hexes: 'array', required_input_outpoints: 'array', outputs: 'array', spine_sigs_by_input: 'array', spine_input_count: 'number', winner: 'number' },
  [COMMAND_TYPES.POOL_REFUND_DISAGREEMENT_TX]: { spine_p2sh_address: 'string', spine_redeem_script_hex: 'string', required_input_outpoints: 'array', outputs: 'array', spine_sigs_by_input: 'array', silent_oracle_index: 'number', signing_pair: 'number' },
  [COMMAND_TYPES.CHECK_UTXO_LANDED]: { address: 'string', txid: 'string' },
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
      // null detect (J2 121c9aa observation): typeof null === 'object' JS quirk, must explicit detect
      const actual = cmd[field] === null
        ? 'null'
        : Array.isArray(cmd[field])
          ? 'array'
          : typeof cmd[field];
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
