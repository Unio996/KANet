# Codex review — unsynced `prediction_refund_tx` selector offset

## Verdict

`PREDICTION_REFUND_SELECTOR_OFFSET_CODE_DEFECT_CONFIRMED_FOR_CURRENT_SOURCE_FAMILY__DEPLOYED_OFFER_SCOPE_REMAINS_PROVENANCE_GATED__ZERO_RECORDED_REFUND_TXID_IS_CORROBORATION_NOT_CAUSATION__NO_MONEY_PATH_AUTHORIZATION`

## Authority and comparison basis

- Bridge baseline processed by Codex: `24450a83a829d97bd3592bd4530d9a83e9e35af4`.
- `coord/codex-bridge` compared identical to that baseline before this write: ahead 0 / behind 0 / canonical-file diff empty.
- Active branch HEAD inspected: `088a0f8e47a1880b934639a57f6adb4816f4a034` (`bshard-m3-deploy`).
- Active-source commit: `088a0f8e47a1880b934639a57f6adb4816f4a034`.
- Capability-matrix blob: `9fc16a933c28dcd1aaea8f339b27df986ac484b7`.
- Independently inspected source blobs:
  - `kasia-relay/src/relay.mjs`: `aa6fb71f023eba59fd751c451ad00641781fb3ba`
  - `kasia-relay/src/lib/p2sh.mjs`: `1d588b7de1ac4fa95a07404f8b76f5c21a2e1dce`
  - `kasia-console/src/lib/PredictionEscrowUnanimous5.sil`: `2e5b61db1c1f5d9d0e8dc5181e4094694f3d9c70`

Increment determination uses Git commit comparison, blob identity, and actual diff only. No file-internal timestamps are used.

## Independent code-level findings

### 1. Relay intent and emitted selector are inconsistent with the current four-entrypoint covenant

The relay handler accepts only `branch === 1` and `branch === 2`:

- branch 1 is documented and shaped as `refund_both` (two inputs / two outputs), then calls `unlockP2SHDual(..., 1, ...)`;
- branch 2 is documented and shaped as `refund_maker_unjoined` (one input / one output), then calls `unlockP2SH(..., 2, ...)`.

The generic unlock helper encodes the selector as:

```text
0 -> OP_0
1 -> OP_1
all other values -> OP_2
```

Therefore this path cannot emit OP_3 at all.

The current `PredictionEscrowUnanimous5.sil` declaration order is:

```text
0 settle_dispute
1 settle_consensual
2 refund_both
3 refund_maker_unjoined
```

Subject to the compiler's declaration-order selector rule, the relay's branch constants are offset by one entrypoint:

```text
branch 1 -> selector 1 -> settle_consensual, not refund_both
branch 2 -> selector 2 -> refund_both, not refund_maker_unjoined
selector 3 -> unreachable through this handler/helper pair
```

This is a code defect in the current source family, not merely a documentation mismatch.

### 2. Both currently exposed refund branches are structurally expected to fail against that covenant

For branch 1, relay supplies the refund-both transaction shape and a maker signature, but selector 1 dispatches to `settle_consensual`, which requires maker signature, taker signature, and winner plus the consensual output constraints.

For branch 2, relay constructs one input and one output, but selector 2 dispatches to `refund_both`, which requires exactly two inputs and two outputs.

Thus neither exposed branch is compatible with the current four-entrypoint covenant. This conclusion is static and code-derived; no transaction was constructed or broadcast.

### 3. The deployed blast radius is not yet provenance-closed

The defect is confirmed for offers whose deployed redeem bytes were compiled from the inspected current `.sil` family with the asserted selector semantics. It is not yet valid to claim that every historical offer is affected.

Per-offer closure still requires an immutable mapping:

```text
offer_id
escrow outpoint / P2SH address
deployed redeem-script hash
source .sil blob or reproducible byte match
constructor tuple
compiler commit/tree/binary hash
expected selector map
```

Older offers may have been created from a prior two-entrypoint artifact or another source version. Their redeem bytes and P2SH addresses would differ, so they must be classified individually rather than inferred from current source names.

### 4. `refund_txid IS NULL` is corroborating visibility evidence, not causal proof

A current-rowset observation that all refund txid fields are empty is consistent with this mechanism, but it does not prove:

- that every row attempted the handler;
- that no transaction was submitted without application write-back;
- that no historical row was deleted or migrated;
- that the selector defect caused every missing txid.

The accurate status is:

```text
CURRENT_SOURCE_REFUND_PATH_STATICALLY_UNSPENDABLE_FOR_CURRENT_4_ENTRYPOINT_FAMILY
CURRENT_ROWSET_HAS_NO_RECORDED_REFUND_TXID
CAUSAL_AND_HISTORICAL_COVERAGE_UNRESOLVED
```

### 5. Required non-funding next evidence

Before any fix or recovery proposal is considered, provide:

1. a deterministic offline compile receipt proving selector indices for the exact compiler binary used by the inspected source family;
2. a byte-level match from compiled redeem to at least one deployed offer;
3. offline positive/negative interpreter fixtures for selectors 1, 2, and 3 using no live funds;
4. a per-offer provenance manifest separating current four-entrypoint offers from historical variants;
5. a proposed typed entrypoint interface that derives selector from a pinned covenant profile rather than accepting untyped branch integers.

## Safety boundary

This review does not authorize changing the handler, selector constants, covenant, deployed redeem scripts, database rows, or recovery workflow. It does not authorize transaction construction, signing, broadcast, refund, settlement, migration, deployment, or any production/test-asset money-path action.
