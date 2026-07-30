# Codex review — M-1.1 §2.4 blind-sign set definition and layer claims

## Authority and compare basis

- Bridge baseline previously processed/written: `86f13b3bfa2bb72e64fd70d83c18a04175519b51`
- `coord/codex-bridge` at start of this run: identical to that baseline (`ahead=0`, `behind=0`)
- Active branch reviewed: `bshard-m3-deploy`
- Active branch HEAD reviewed: `412962175cacef381f78bb7d7e002e87a19abf68`
- New/changed artifact: `docs/2026-07-22-m1-1-command-capability-effect-matrix.md`
- Artifact blob reviewed: `a005cbd374e08e1fc3167d169ab83fede976b6cd`
- Source handler blob sampled: `kasia-relay/src/relay.mjs` = `aa6fb71f023eba59fd751c451ad00641781fb3ba`

Increment determination used Git commit/blob/diff only. File-internal timestamps were not used.

## Decision

`LAYER_SEPARATION_DIRECTION_ACCEPTED__AUDITED_COMMAND_SET_IS_NOT_UNAMBIGUOUS__EIGHT_OF_EIGHT_HANDLER_CLAIM_NOT_YET_REPRODUCIBLE__RELAY_FORWARDING_RISK_CONFIRMED_FOR_SAMPLED_MONEY_PATH_HANDLERS__COVENANT_COVERAGE_REMAINS_TWO_OF_EXPLICITLY_IDENTIFIED_SET_ONLY__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. Separating relay checks from covenant checks is the correct model

The new §2.4 correctly rejects the inference `relay does not check => system has no check`. Enforcement must be attributed to the layer that actually rejects the transaction. The distinction between `unverified` and `verified absent` is essential and should remain.

### 2. The exact "8 commands" set is internally ambiguous

The document currently presents incompatible set descriptions:

- §2.2.2 contains nine blind-sign/sign-submit rows: `PREDICTION_SETTLE_TX` plus eight previously unnamed commands.
- §2.4 is titled "8 条盲签命令".
- §2.4 also says two `*_BUILD_PREIMAGE` commands are inside the eight and are build-only.
- Those two build-preimage commands are not members of the nine-row blind-sign table; they are separately listed in §2.2.3.

Therefore an independent reader cannot determine which exact eight handlers were read. `8/8` is not reproducible until the section contains the literal sorted command-name set and the extraction predicate/commit used.

Required correction:

```text
AUDITED_RELAY_HANDLER_SET = [exact command names]
SET_SOURCE = branch@commit:path#blob
SET_CARDINALITY = N
HANDLER_READ_RECEIPT = command -> case/function -> result
```

Do not use "the eight" as an authority pointer.

### 3. Sampled relay money-path handlers do forward caller-controlled economic structure

Independent source reading confirms the risk direction for sampled handlers:

- `prediction_settle_tx` forwards caller-provided `redeem_script_hex`, required input outpoints, outputs, signatures, winner and optional preimage to `unlockP2SHMultiSig`.
- `prediction_settle_consensual_tx` forwards the analogous caller-provided structure to `unlockP2SHConsensual`.
- `pool_settle_tx` forwards caller-provided spine/side scripts, outpoints, outputs, signatures and settlement parameters to `unlockPoolSpineP2SH`.
- `pool_side_refund_cancelled_tx` forwards caller-provided side script, outpoint, output, lock time and entry index to its unlock builder.

In the sampled relay cases, no caller identity, business amount ceiling, recipient allowlist or request idempotency check appears before dispatch. This supports a serious relay-layer trust-boundary finding.

However, the handler source sampled in this run is not proof for every member of an undefined eight-command set. The document must not promote the sampled conclusion into `8/8` without the exact per-command receipt.

### 4. "Relay signs exactly as instructed" is too broad for build-only commands

A build-preimage handler does not sign or broadcast. It may still be dangerous because it creates a digest later consumed by a signer, but its effect class is different.

Use separate statements:

```text
SIGN_OR_SUBMIT handlers: relay accepts caller-controlled transaction structure and invokes signing/submission path.
BUILD_PREIMAGE handlers: relay constructs caller-directed signing material but does not itself sign or submit.
```

Combining both under "照单签发" erases a material capability boundary.

### 5. Covenant coverage must be attached to command-to-entrypoint mappings

The new section says only two commands have covenant-side material and six remain unread. Directionally honest, but the evidence must bind each command to:

```text
command
builder function
selected covenant family/version
entrypoint/selector
exact deployed redeem/script authority when applicable
verified require/invariant
negative test proving the invariant has power
```

Repository source for `PoolSpine_v07.sil` or `PoolSide_v07.sil` is not enough to establish the deployed covenant version. The document itself notes two v0.7 families and a database version label that cannot disambiguate them. That ambiguity is a deployment-provenance gate, not merely a documentation note.

### 6. `makerStakeAmount 140/140` remains host-reported aggregate evidence here

The section provides a scoped statement and a negative count, which is better than an unscoped claim. But this bridge increment does not carry the immutable row manifest, query, raw result hash or deployed-script mapping needed for independent reproduction. Keep it labelled host-reported until those artifacts are committed.

### 7. Public/internal eligibility cannot be closed by this section

Even after relay and covenant checks are mapped, public eligibility still requires caller authentication/authorization, auditability, idempotency, rate/cost controls, version pinning and revocation. Covenant value conservation is not a substitute for an application capability boundary.

## Required next evidence

Before accepting §2.4 as a closed M-1 evidence card:

1. Add the exact audited command-name set and prove set cardinality mechanically.
2. Attach one handler-read receipt per command.
3. Separate build-only from sign/submit effects.
4. Map every command to builder, covenant family/version and entrypoint.
5. Mark each invariant as `verified present`, `verified absent`, or `unverified`; never collapse `unverified` into `none`.
6. Provide immutable evidence for the 140-row aggregate and deployed script provenance if that claim remains in the card.
7. Run the independent recount with a genuinely different extraction predicate and include both set differences, not only equal totals.

## Safety boundary

This review does not authorize deployment, command exposure, signing, broadcast, settlement, refund, faucet action, covenant replacement, schema migration, node restart or any production/test-asset money-path operation.
