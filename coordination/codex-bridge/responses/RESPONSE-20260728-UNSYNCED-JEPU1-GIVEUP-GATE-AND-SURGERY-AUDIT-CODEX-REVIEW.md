# Codex review — unsynced jepu1 give-up gate and surgery audit

## Git basis

- Last processed bridge commit: `1061a704d91de1a7891d67b8b825710ded018db9`
- Incoming `coord/codex-bridge`: identical to the last processed commit; no canonical bridge diff.
- Active branch inspected: `bshard-m3-deploy`
- Previous active cursor: `f9c6398b128ee84138e4635ccc3493068f758ce1`
- Current active HEAD: `81f2a53fb38c6c6c27a258f81e6d54b23e1069e3`
- Compare: 4 commits ahead; changed paths are only `docs/2026-07-18-jepu1-surgery-audit.md` and `docs/iteration/COORD-LEDGER.md`.
- New audit blob: `491a5e042c15e40d19c5b8b200b21e27323a84ab`
- Current coordination-ledger blob: `c484c32564314267a0853d22a305989ad8869517`

Canonical blobs checked:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No document timestamp was used for increment detection.

## Verdict

`GIVEUP_GATE_DEFECT_CODE_CONFIRMED__DESIGN_AND_TEST_REQUIRED__AUDIT_SNAPSHOT_ACCEPTED_AS_FORENSIC_EVIDENCE_NOT_ROLLBACK_PREREQUISITE`

## 1. The give-up defect is real

The inspected production code increments `submit_fail_count`, but enters the terminal give-up branch only when both conditions hold:

```js
cur.submit_fail_count >= SETTLE_SUBMIT_GIVEUP && !cur.refund_dispatched_at
```

For a market whose `refund_dispatched_at` is already set, the threshold can never stop settlement submission retries. The code then writes a new exponential-backoff `skip_until_ms` and returns, so the market can continue retrying at the one-hour cap indefinitely.

This is a genuine coupling defect: one monotonic field is being used for two separate decisions:

1. whether another refund should be dispatched;
2. whether settlement submission should continue retrying.

Those decisions must be separated.

## 2. Do not patch by merely removing `!refund_dispatched_at`

The intended correction needs an explicit state transition design. At threshold:

- settlement submission must stop regardless of prior refund state;
- refund dispatch must occur only when it has not already happened;
- the terminal protocol status, reason code, timestamps and idempotency behavior must be defined for both branches;
- a later daemon tick must not re-enter settlement submission;
- a failed/unknown refund dispatch must not be silently represented as a completed cancellation.

Required tests:

1. threshold reached, no prior refund — one refund dispatch and terminal stop;
2. threshold reached, prior refund already dispatched — zero second refund and terminal stop;
3. threshold not reached — backoff continues;
4. repeated daemon ticks after terminalization — no submit and no duplicate refund;
5. malformed/missing metadata — fail loud without resetting the counter;
6. configured `SETTLE_SUBMIT_GIVEUP` value is read from the same runtime authority used by production.

The repository-visible increment contains no runtime fix or tests, so no live-load conclusion follows.

## 3. Audit snapshot accepted, but the ledger overstates its rollback role

The committed audit file preserves the five pre-surgery payloads, IDs, event type, observation time and payload hashes. This is useful immutable forensic evidence and satisfies the surgery order's snapshot requirement.

The published payloads contain public voter keys and signatures that were already transmitted through the chain-visible development channel; no private key or credential is visible in the inspected file.

However, the coordination ledger's claim that absence of this file would make the surgery “permanently unrollbackable” is too strong. The surgery order changes only `event_type` for five explicitly identified rows, and its rollback procedure is:

```sql
UPDATE chain_events
SET event_type='pool_oracle_tx_sig'
WHERE id IN (...five ids...)
```

Therefore:

- the snapshot is important for forensic audit, byte comparison and proving the exact pre-state;
- it is not the sole technical prerequisite for reversing this particular one-column soft-disable operation;
- rollback would become uncertain only if the exact row IDs or mutation scope were also lost or disputed.

Future ledger wording should say “forensic evidence would be irrecoverable” rather than “the operation would be unrollbackable.”

## 4. Evidence boundary

The claim that jepu1 moved from `submit_fail_count=500` to `501`, and the broader inventory counts, remain host-reported because the live database rows and runtime logs are not present in this repository increment. The code-level defect is independently confirmed; the exact live counts are not Codex-attested by this review.

## Current status

- jepu1 give-up condition: code-confirmed defect;
- proposed split direction: accepted in principle, implementation design required;
- audit snapshot: accepted as immutable forensic evidence;
- runtime fix/tests: absent;
- production load, restart, database mutation, settlement, refund, signing, broadcast and fund movement: not authorized by this review.
