# Codex review — unsynced M-1.1 boundary facts, redeem integrity, and refund evidence

## Verdict

`REDEEM_PROVENANCE_GAP_CONFIRMED__BRANCH_SELECTOR_IS_CONTRACT_SPECIFIC_NOT_RELAY_AUTHORITATIVE__ZERO_RECORDED_REFUND_TXID_DOES_NOT_PROVE_ZERO_EXECUTIONS__EIGHT_COMMAND_SCOPE_REMAINS_AMBIGUOUS__NO_MONEY_PATH_AUTHORIZATION`

## Git evidence boundary

- Bridge baseline processed by Codex: `955a50fdef1a1787535ba7b38857774b8ff7fc30`.
- `coord/codex-bridge` compared identical to that baseline before this write.
- Active branch baseline previously inspected: `412962175cacef381f78bb7d7e002e87a19abf68`.
- `bshard-m3-deploy` is four commits ahead; the only changed path is `docs/2026-07-22-m1-1-command-capability-effect-matrix.md` (`+117/-3`).
- Current matrix blob inspected: `ae27c434748b41378dd3598a1257226fcbd91e9d`.
- Referenced source blobs independently inspected:
  - `kasia-console/src/services/pool-market-settler.js`: `50edcfff4e62c6fede97d0a3b32f519785b15ec4`
  - `kasia-relay/src/relay.mjs`: `aa6fb71f023eba59fd751c451ad00641781fb3ba`
  - `kasia-relay/src/lib/p2sh.mjs`: `1d588b7de1ac4fa95a07404f8b76f5c21a2e1dce`

Increment judgment is based on Git compare, blob identity, and source content, not document timestamps.

## Independent findings

### 1. Create-time-stashed redeem bytes are used at settlement without a pinned compiler/source authority

The settler parses `market.metadata`, reads `spine_redeem_script_hex`, and turns those bytes directly into the redeem script used by the refund/settlement path. The inspected path does not recompile the covenant or bind the bytes to a compiler commit, source hash, template family, constructor tuple, or deployment receipt.

This confirms a provenance and integrity gap. A protocol label such as `v0.7` is not enough to identify the actual covenant bytes.

Required closure artifact per market/UTXO:

```text
market_id
outpoint
p2sh_address
deployed_script_public_key
redeem_script_hex_sha256
source_template_path_and_blob
constructor_tuple
compiler_repo_commit_tree_and_binary_hash
create_txid_and_block_reference
```

The authority must be the deployed script/redeem relationship, not the current `.sil` file or a mutable metadata label.

### 2. The current text should distinguish two different missing checks

The source shows more than one unlock shape:

- `unlockP2SH` queries UTXOs using the separately supplied `p2shAddress`, then inserts the supplied `redeemScript` into the signature script.
- Other paths may derive an address from the supplied redeem before finding a requested outpoint.

Both lack comparison against an independently pinned expected redeem hash, but they are not the same failure mode.

Accurate wording:

```text
No inspected path binds the caller/metadata-supplied redeem bytes to an independent canonical deployment manifest.
Some paths select UTXOs by a separately supplied P2SH address; others derive the lookup address from the supplied redeem. Neither proves that the redeem is the intended market covenant.
```

Do not collapse all seven helpers into “the redeem decides which UTXO is spent” unless a per-helper call-path table proves that exact behavior.

### 3. Branch numbers are transport values; entrypoint meaning is covenant-specific

`prediction_refund_tx` maps branch `1` and `2` to OP_1 and OP_2 in relay code. `unlockP2SH` merely serializes the selected opcode. Its generic comments (`release/refund/arbitrate`) are not an authority for a particular deployed PredictionEscrow covenant.

Therefore the document is correct to mark branch-to-entrypoint semantics unresolved. Closure requires:

```text
command -> handler -> helper -> selector opcode -> deployed covenant family/version -> source entrypoint -> byte/deployment provenance
```

A relay comment or helper JSDoc cannot close this mapping. No transaction needs to be broadcast to verify it: compile the pinned source deterministically, compare the resulting redeem bytes/address to the deployed authority, and execute selector-level negative/positive tests in an isolated interpreter or non-funded fixture.

### 4. `refund_txid IS NULL` for current rows does not prove that no refund ever executed

The reported database observation can support only:

> In the inspected current `exchange_offers` rowset, no row contains a recorded `refund_txid`.

It does not independently prove:

- no refund transaction was ever submitted or landed;
- no historical row was deleted, migrated, replaced, or written by another database;
- no refund happened without the application persisting the txid;
- no landed transaction is now below pruning/history availability.

The sentence “this refund path has never successfully executed” is therefore too strong unless joined to immutable chain receipts, historical database provenance, writer-path audit, and a positive-control test showing this field is reliably populated after a known successful refund.

Status should remain:

`NO_REFUND_TXID_RECORDED_IN_CURRENT_ROWSET; EXECUTION_HISTORY_UNRESOLVED`

### 5. The “eight blind-sign commands” scope is still not reproducible

The previous review found that the document alternated among nine sign/submit commands, eight previously unnamed commands, and a set that also included build-only preimage commands. The new §2.5 continues to refer to “the eight” without publishing the exact command set.

Every aggregate statement in §2.5 must name the audited set explicitly and bind each command to handler/helper/covenant evidence. Until then, findings may be accepted for named sampled paths, not promoted to `8/8`.

### 6. Process-membership authorization is an architectural fact, but not a complete caller model

The relay child-process IPC boundary means possession of a process channel can amount to broad capability. That supports the stated absence of per-command cryptographic caller authorization. However, the final threat statement must also enumerate who can create/inherit that channel, process-spawn authority, restart/configuration authority, and whether any wrapper constrains command schemas before relay dispatch.

“Process membership = full authority” is acceptable only after those ingress paths are mechanically enumerated; otherwise it remains a strong but incomplete architectural summary.

## Required disposition

1. Revise §2.5.2 to separate address-selected and redeem-derived lookup paths.
2. Downgrade the current-rowset refund observation from “never executed” to “no recorded txid in inspected rows; history unresolved.”
3. Publish the exact audited command set and per-command call-path receipts.
4. Add an immutable deployed-covenant provenance manifest before relying on stored redeem bytes for any new money-path action.
5. Keep refund construction, signing, submission, settlement, migration, and deployment behind separate Owner authorization and red-team gates.

No production or test-asset money-path modification, refund, signing, broadcast, deployment, or migration is authorized by this review.
