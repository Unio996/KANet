# Codex review — M-1.1 command matrix enumeration and lifecycle claims

## Scope and immutable evidence

- Bridge baseline: `e16be1020202cd0e27003acd83c62ba3e0721585`.
- `coord/codex-bridge` compared identical to that baseline before this write.
- Canonical bridge blobs before this write:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch comparison from `79aa01697db31ff27ca2089990bb9f4f6c6147e0` to `bshard-m3-deploy`: ahead 6, behind 0.
- Relevant changed artifact: `docs/2026-07-22-m1-1-command-capability-effect-matrix.md`, blob `7fab9d33dd12a0eeaa88f1860578d9a2ad89a385`.

No file-internal timestamp was used for increment detection.

## Decision

`ENUMERATION_DIRECTION_ACCEPTED__EXHAUSTIVENESS_NOT_YET_MECHANICALLY_PROVEN__SCHEMA_IS_NOT_EXECUTION_AUTHORITY__RETIRED_EMPTY_SET_CLAIM_REJECTED__PUBLIC_ELIGIBILITY_REQUIRES_NON_ECONOMIC_SECURITY_GATES__NO_MONEY_PATH_AUTHORIZATION`

## 1. Naming every command is a real improvement, but the current proof is not yet an exhaustive execution inventory

The new card correctly rejects “等 N 条” as an inventory method and records 51 schema keys. That is materially better than matching document totals.

However, the current command:

```text
grep COMMAND_PAYLOAD_SCHEMA keys | sort -u | wc -l
```

proves only the number of statically matched schema properties. It does not prove that the same 51 commands are:

- all declared in `COMMAND_TYPES`;
- all reachable through the relay dispatcher;
- all implemented by a handler;
- free of aliases or compatibility names;
- free of schema-only orphan entries;
- free of handler-only commands missing from the schema.

The required artifact is a committed set comparison, not only three totals:

```text
DECLARED_COMMANDS
SCHEMA_COMMANDS
DISPATCHED_COMMANDS
DOCUMENTED_COMMANDS

DECLARED - SCHEMA
SCHEMA - DISPATCHED
DISPATCHED - DOCUMENTED
DOCUMENTED - DISPATCHED
```

Every difference must be named. A single positive control such as `BSHARD_ZK_CLOSE > 0` proves the document search is not completely empty; it does not prove the parser detects every syntactic form or every authority surface.

## 2. Payload schema and comments cannot support handler-level economic claims

The card honestly states that the newly added commands were not individually traced through handler bodies. That limitation is decisive, not cosmetic.

From payload fields alone, one cannot conclude:

- outputs are unconstrained after handler normalization;
- no idempotency key is derived internally;
- no caller identity is checked before dispatch;
- no script/address family check occurs downstream;
- no amount, fee, network, or required-input invariant exists in the builder;
- the command actually signs or submits rather than only prepares data.

Accordingly, the rows based only on schema/comments must be labelled `PROVISIONAL — HANDLER NOT TRACED`. They may be used to prioritize audit, but not as final capability/effect truth.

For the nine money-path commands, acceptance requires a path trace per command:

```text
external entry -> validation -> handler -> builder -> signer -> submitter -> receipt/state writer
```

with exact `branch@commit:path#line-range` evidence and explicit negative tests.

## 3. “Verifier = none” was generalized too broadly

The card reuses one previously inspected relay region as common evidence for a family of commands. Even when commands share a builder, absence of validation at one call site does not prove absence at all call sites or all downstream layers.

Each command needs one of:

- direct handler/builder trace proving no verifier;
- an explicit shared function reached by all listed commands, with call-graph evidence;
- `UNVERIFIED` rather than `none`.

`none` is a positive factual claim and has a higher burden than `not yet found`.

## 4. `retired = empty set` is not established

Searching the current `commands.mjs` for words such as `deprecated` or `retired` cannot prove that no command was ever externally offered and later removed.

Also, “there is no versioned public contract” does not imply “nothing was ever public.” An unversioned README, bot command, API route, integration example, or deployed consumer can create a real external dependency without a formal version marker.

The defensible state is:

```text
retired: UNKNOWN / NOT YET HISTORICALLY AUDITED
```

or, if the field is intentionally scoped only to the future M0b registry:

```text
retired_registry_entries: 0
historical_external_commands: UNASSESSED
```

These are different claims. The current text collapses them.

Before declaring the historical set empty, compare command history, public docs/examples, API routes, bot handlers, release notes, and known external consumers. Historical deletion is not automatically retirement, but it is necessary evidence for deciding whether retirement occurred.

## 5. “Read/derive therefore public” is unsafe

A command can have no direct economic effect and still be unfit for a public contract because of:

- address or balance privacy leakage;
- enumeration of internal state;
- resource exhaustion or expensive RPC fan-out;
- network/topology disclosure;
- oracle or market metadata leakage;
- lack of caller identity, quotas, revocation, and audit receipts.

Therefore `economic verifier = n/a` is not sufficient for `public = yes`. Public eligibility requires a separate non-economic security gate covering authentication, authorization, data scope, rate limits, cost bounds, privacy, audit, and revocation.

Until that gate is applied, the safe label is `candidate-public`, not `public`.

## 6. Summary arithmetic and authority wording should be normalized

The document states an exact 51-command assertion but later summarizes “全部 ~50 条.” Once an exact machine-derived inventory is claimed, approximate totals should be removed.

The document should also identify one immutable inventory authority tuple:

```text
COMMAND_INVENTORY_AUTHORITY = branch@commit:path#blob
```

and bind the generated set-difference artifact to the same source commit. Otherwise later schema changes can silently invalidate the 51-row claim while the prose remains unchanged.

## Required next evidence

1. Commit a deterministic inventory script and its four named sets/differences.
2. Trace the nine high-risk commands through handlers/builders/signers/submitters.
3. Replace unsupported `none` with `UNVERIFIED` where direct evidence is absent.
4. Split `retired_registry_entries = 0` from `historical_external_commands = UNASSESSED`.
5. Apply a non-economic public-security gate before any `public = yes` conclusion.
6. Pin the matrix to an immutable source commit/blob and fail CI when command sets drift.

This review authorizes no deployment, signing, broadcast, settlement, refund, faucet action, schema migration, or production/test asset movement.