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
  // design-v2 B §2 root-fix (#24): consolidate relay-own fragmented UTXOs N→1 (keep `best` large).
  CONSOLIDATE_UTXO: 'consolidate_utxo',
  // T-J2-2026-05-12 #2 — read-only IPC: console 取 relay child rpc-listener._rpc state snapshot (UI 健康检测 P0 NWT spec).
  GET_RPC_STATE: 'get_rpc_state',
  // Phase 4a SS trustless escrow (Sub 6+8+9) — oracle / maker IPC for prediction market settle TX flow.
  ECDSA_SIGN: 'ecdsa_sign',
  GET_PUBKEY: 'get_pubkey',
  SIGN_INPUT_FOR_SETTLE: 'sign_input_for_settle',
  PREDICTION_SETTLE_BUILD_PREIMAGE: 'prediction_settle_build_preimage',
  // Oracle v0.3 sub 5c (J2 r21 ship 730b910) — 1V1 escrow settle_consensual maker+taker mutual sig preimage build.
  // KI sediment per feedback_ipc_double_enforce_register_both_layers 5/20: relay.mjs L688 case 漏 commands.mjs register
  // → validateCommand reject silent → settler dispatch fail. NWT ad-hoc fix on .105 to unblock oracle happy path.
  PREDICTION_SETTLE_CONSENSUAL_BUILD_PREIMAGE: 'prediction_settle_consensual_build_preimage',
  PREDICTION_SETTLE_TX: 'prediction_settle_tx',
  // Oracle v0.3 sub 5d (J2 r43 ship) — settle_consensual TX submit (= entry 1, 2 sigs per input maker+taker, 2 outputs)
  PREDICTION_SETTLE_CONSENSUAL_TX: 'prediction_settle_consensual_tx',
  PREDICTION_REFUND_TX: 'prediction_refund_tx',
  // B2 v0.5 Sub 2d Phase 2c — pool settle TX submit (= multi-input spine + N sides).
  POOL_SETTLE_TX: 'pool_settle_tx',
  // B2 v0.5 area-4 7c — pool refund_disagreement TX submit (= spine-only, 4 inputs, 3 or 4 outputs).
  POOL_REFUND_DISAGREEMENT_TX: 'pool_refund_disagreement_tx',
  // G2-B 二期 (Bettor r263) — PoolSpine_v06.sil entry 2 refund_maker_unjoined (maker single-sig
  // 0-bet auto-refund). KI sediment 5/20 feedback_ipc_double_enforce_register_both_layers
  // 真复刻 — relay.mjs L709 加 case 漏 register commands.mjs 三层 (COMMAND_TYPES + SCHEMA + FIELD_TYPES),
  // validateCommandPayload reject silent → settler "invalid command type" log + refund 卡 refunding.
  // qlfpv 100 KAS 实测 fire 一次 → 立补三处. 第 N 次复刻, KI 49 同款症状.
  POOL_REFUND_MAKER_UNJOINED_TX: 'pool_refund_maker_unjoined_tx',
  // J2-tn r398 #25 (Bettor r227 ④ catch root cause): relay.mjs L739 case
  // 'pool_side_refund_cancelled_tx' 7132ddd ship 但漏 register commands.mjs 三层 (= KI 49
  // 第 N+2 次复刻同 L44 sediment). validateCommandPayload reject silent → 4 bettor side
  // 12 KAS refund 卡死循环 (= xejkf+zc9jw min_pot refund 路).
  POOL_SIDE_REFUND_CANCELLED_TX: 'pool_side_refund_cancelled_tx',
  // G6 批 3 段① Bettor r311 钦定: Console 手搓 UtxoEntry 喂 WASM panic 第 N+1 次, 转 relay 端
  // 算 mass — relay 用 p2sh.mjs 同 well-tested UtxoEntry pattern. Console 只 IPC 调用拿结果.
  POOL_V07_COMPUTE_REFUND_MASS: 'pool_v07_compute_refund_mass',
  // B2 v0.5 Phase 3 bug 7 fix — confirm transfer UTXO landed in accepted set.
  CHECK_UTXO_LANDED: 'check_utxo_landed',
  // ③ committee chainReader (Bettor r170 + J1 r204/649197d) — Console wraps as chainReader.
  // J1 r204 漏 register 白名单, validateCommandPayload reject silent → relay log "INVALID COMMAND" + settler "Relay not running". KI sediment 5/20 复刻 (relay.mjs L688 pattern), KANet-UI r365 补.
  CHAIN_GET_CURRENT_DAA_SCORE: 'chain_get_current_daa_score',
  CHAIN_GET_BLOCKS_FROM_DAA_SCORE: 'chain_get_blocks_from_daa_score',
  // J1tn r303 (Bettor 钦定 SPC fix + J2 r327 split): SPC walk authoritative endBlock at deadlineDaa.
  // Goes direct to kaspad getBlock RPC via selectedParentHash chain (NOT ring buffer).
  CHAIN_GET_BLOCK_AT_DAA: 'chain_get_block_at_daa',
  // #17 G1 (J1tn r303) — OracleStake_v1 timeout_unlock self-unstake.
  // Single-entry SS contract → scriptSig NO selector (sediment feedback-silverc-single-entry-no-selector).
  STAKE_UNLOCK_TX: 'stake_unlock_tx',
  // bshard M3 fold-carries-KAS (J1 2026-06-15): register/claim/refund relay handlers. 三层注册(KI49 防坑).
  BSHARD_REGISTER_BET: 'bshard_register_bet',
  BSHARD_CLAIM_WINNER: 'bshard_claim_winner',
  BSHARD_REFUND_CANCELLED: 'bshard_refund_cancelled',
  BSHARD_FOLD: 'bshard_fold',
  BSHARD_CLOSE_COMMIT: 'bshard_close_commit',
  BSHARD_SEAL_TO_ROOT: 'bshard_seal_to_root',   // route-split: PoolLeaf seal_to_root OP_3, leaf→root foreign-template 桥
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
  [COMMAND_TYPES.CONSOLIDATE_UTXO]: [],  // #24: no required field (minFragments optional)
  [COMMAND_TYPES.GET_RPC_STATE]: [],  // T-J2-2026-05-12 #2 — read-only, 无 required field
  // Phase 4a SS trustless escrow
  [COMMAND_TYPES.ECDSA_SIGN]: ['message'],
  [COMMAND_TYPES.GET_PUBKEY]: [],
  [COMMAND_TYPES.SIGN_INPUT_FOR_SETTLE]: ['tx_hex', 'input_index'],
  [COMMAND_TYPES.PREDICTION_SETTLE_BUILD_PREIMAGE]: ['p2sh_address', 'required_input_outpoints', 'outputs'],
  // Oracle v0.3 sub 5c — 1V1 escrow settle_consensual maker+taker mutual sig preimage build.
  // KI sediment 5/20: COMMAND_PAYLOAD_SCHEMA missing entry → validateCommandPayload throws "required is not iterable".
  [COMMAND_TYPES.PREDICTION_SETTLE_CONSENSUAL_BUILD_PREIMAGE]: ['p2sh_address', 'required_input_outpoints', 'outputs', 'winner'],
  [COMMAND_TYPES.PREDICTION_SETTLE_TX]: ['p2sh_address', 'redeem_script_hex', 'required_input_outpoints', 'outputs', 'sigs_by_input', 'winner'],
  [COMMAND_TYPES.PREDICTION_SETTLE_CONSENSUAL_TX]: ['p2sh_address', 'redeem_script_hex', 'required_input_outpoints', 'outputs', 'sigs_by_input', 'winner'],
  [COMMAND_TYPES.PREDICTION_REFUND_TX]: ['p2sh_address', 'redeem_script_hex', 'branch'],
  [COMMAND_TYPES.POOL_SETTLE_TX]: ['spine_p2sh_address', 'side_p2sh_addresses', 'spine_redeem_script_hex', 'side_redeem_script_hexes', 'required_input_outpoints', 'outputs', 'spine_sigs_by_input', 'spine_input_count', 'winner'],
  [COMMAND_TYPES.POOL_REFUND_DISAGREEMENT_TX]: ['spine_p2sh_address', 'spine_redeem_script_hex', 'required_input_outpoints', 'outputs', 'spine_sigs_by_input', 'silent_oracle_index', 'signing_pair'],
  [COMMAND_TYPES.POOL_REFUND_MAKER_UNJOINED_TX]: ['spine_p2sh_address', 'spine_redeem_script_hex', 'required_input_outpoint', 'output'],
  [COMMAND_TYPES.POOL_SIDE_REFUND_CANCELLED_TX]: ['side_p2sh_address', 'side_redeem_script_hex', 'required_input_outpoint', 'output'],
  [COMMAND_TYPES.POOL_V07_COMPUTE_REFUND_MASS]: ['spine_p2sh', 'spine_lock_tx', 'spine_redeem_script_hex', 'maker_address', 'maker_stake', 'deadline'],
  [COMMAND_TYPES.CHECK_UTXO_LANDED]: ['address', 'txid'],
  // ③ committee chainReader — get current DAA score 不需 payload field; get blocks 需 min_daa_score.
  [COMMAND_TYPES.CHAIN_GET_CURRENT_DAA_SCORE]: [],
  [COMMAND_TYPES.CHAIN_GET_BLOCKS_FROM_DAA_SCORE]: ['min_daa_score'],
  [COMMAND_TYPES.CHAIN_GET_BLOCK_AT_DAA]: ['min_daa_score'],
  // #17 G1 (J1tn r303) — stake_unlock_tx single-entry P2SH unlock for OracleStake_v1.
  [COMMAND_TYPES.STAKE_UNLOCK_TX]: ['p2sh_address', 'redeem_script_hex', 'to_address', 'lock_time'],
  // bshard M3: relay 自算 per-state 续约地址 + scriptSig 押栈 — cmd 带 witness/inputs/outputs 三块.
  [COMMAND_TYPES.BSHARD_REGISTER_BET]: ['witness', 'inputs', 'outputs'],
  [COMMAND_TYPES.BSHARD_CLAIM_WINNER]: ['witness', 'inputs', 'outputs'],
  [COMMAND_TYPES.BSHARD_REFUND_CANCELLED]: ['witness', 'inputs', 'outputs'],
  [COMMAND_TYPES.BSHARD_FOLD]: ['witness', 'inputs', 'outputs'],
  [COMMAND_TYPES.BSHARD_CLOSE_COMMIT]: ['witness', 'inputs', 'outputs'],
  [COMMAND_TYPES.BSHARD_SEAL_TO_ROOT]: ['witness', 'inputs', 'outputs'],
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
  [COMMAND_TYPES.CONSOLIDATE_UTXO]: { minFragments: 'number' },  // #24: optional
  [COMMAND_TYPES.GET_RPC_STATE]: {},  // T-J2-2026-05-12 #2 — read-only, 无 typeof constraint
  // Phase 4a SS trustless escrow
  [COMMAND_TYPES.ECDSA_SIGN]: { message: 'string' },
  [COMMAND_TYPES.GET_PUBKEY]: {},
  [COMMAND_TYPES.SIGN_INPUT_FOR_SETTLE]: { tx_hex: 'string', input_index: 'number' },
  // p2sh_address allows array for pool multi-p2sh (= spine + N side) per B2 v0.5 Sub 2d Phase 2a-1.
  // sig_op_counts optional per-input array (Phase 3 bug 5 — preimage/final sighash consistency).
  [COMMAND_TYPES.PREDICTION_SETTLE_BUILD_PREIMAGE]: { p2sh_address: ['string', 'array'], required_input_outpoints: 'array', outputs: 'array', sig_op_counts: 'array' },
  // Oracle v0.3 sub 5c (NWT ad-hoc fix .105): consensual same shape as build_preimage + winner number.
  [COMMAND_TYPES.PREDICTION_SETTLE_CONSENSUAL_BUILD_PREIMAGE]: { p2sh_address: 'string', required_input_outpoints: 'array', outputs: 'array', winner: 'number' },
  [COMMAND_TYPES.PREDICTION_SETTLE_TX]: { p2sh_address: 'string', redeem_script_hex: 'string', required_input_outpoints: 'array', outputs: 'array', sigs_by_input: 'array', winner: 'number' },
  [COMMAND_TYPES.PREDICTION_SETTLE_CONSENSUAL_TX]: { p2sh_address: 'string', redeem_script_hex: 'string', required_input_outpoints: 'array', outputs: 'array', sigs_by_input: 'array', winner: 'number' },
  [COMMAND_TYPES.PREDICTION_REFUND_TX]: { p2sh_address: 'string', redeem_script_hex: 'string', branch: 'number' },
  [COMMAND_TYPES.POOL_SETTLE_TX]: { spine_p2sh_address: 'string', side_p2sh_addresses: 'array', spine_redeem_script_hex: 'string', side_redeem_script_hexes: 'array', required_input_outpoints: 'array', outputs: 'array', spine_sigs_by_input: 'array', spine_input_count: 'number', winner: 'number' },
  [COMMAND_TYPES.POOL_REFUND_DISAGREEMENT_TX]: { spine_p2sh_address: 'string', spine_redeem_script_hex: 'string', required_input_outpoints: 'array', outputs: 'array', spine_sigs_by_input: 'array', silent_oracle_index: 'number', signing_pair: 'number' },
  [COMMAND_TYPES.POOL_REFUND_MAKER_UNJOINED_TX]: { spine_p2sh_address: 'string', spine_redeem_script_hex: 'string', required_input_outpoint: 'object', output: 'object' },
  [COMMAND_TYPES.POOL_SIDE_REFUND_CANCELLED_TX]: { side_p2sh_address: 'string', side_redeem_script_hex: 'string', required_input_outpoint: 'object', output: 'object' },
  [COMMAND_TYPES.POOL_V07_COMPUTE_REFUND_MASS]: { spine_p2sh: 'string', spine_lock_tx: 'string', spine_redeem_script_hex: 'string', maker_address: 'string', maker_stake: ['string','number'], deadline: ['string','number'] },
  [COMMAND_TYPES.CHECK_UTXO_LANDED]: { address: 'string', txid: 'string' },
  [COMMAND_TYPES.STAKE_UNLOCK_TX]: { p2sh_address: 'string', redeem_script_hex: 'string', to_address: 'string', lock_time: ['string', 'number'] },
  // bshard M3: 三块 object (witness 含 push 值 + ps_prefix/suffix; inputs 含 redeem/outpoint/current_state; outputs 含 state/amount).
  [COMMAND_TYPES.BSHARD_REGISTER_BET]: { witness: 'object', inputs: 'object', outputs: 'object' },
  [COMMAND_TYPES.BSHARD_CLAIM_WINNER]: { witness: 'object', inputs: 'object', outputs: 'object' },
  [COMMAND_TYPES.BSHARD_REFUND_CANCELLED]: { witness: 'object', inputs: 'object', outputs: 'object' },
  [COMMAND_TYPES.BSHARD_FOLD]: { witness: 'object', inputs: 'object', outputs: 'object' },
  [COMMAND_TYPES.BSHARD_CLOSE_COMMIT]: { witness: 'object', inputs: 'object', outputs: 'object' },
  [COMMAND_TYPES.BSHARD_SEAL_TO_ROOT]: { witness: 'object', inputs: 'object', outputs: 'object' },
});

export function validateCommandPayload(cmd) {
  if (!cmd || typeof cmd !== 'object') return { valid: false, error: 'cmd must be object' };
  if (!isValidCommandType(cmd.type)) {
    return { valid: false, error: `unknown command type: ${cmd.type} (valid: ${Array.from(COMMAND_TYPE_SET).join(', ')})` };
  }
  const required = COMMAND_PAYLOAD_SCHEMA[cmd.type];
  if (!required) {
    // KI hardening 5/26 — enum added without schema entry → defensive: fail-fast clear error, not iterate undefined throw.
    return { valid: false, error: `internal: COMMAND_PAYLOAD_SCHEMA missing entry for ${cmd.type} (sediment 5/26 sub 5c hotfix)` };
  }
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
