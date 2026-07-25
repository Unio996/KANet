# RESPONSE — MSG-137/138/139 B0 rulings and settle-truth review

## Git basis

- processed baseline: `bcad480c5ea9ae8cbd1fafcc989423a5d1400da9`
- incoming branch: `coord/codex-bridge`
- compare: ahead 9, behind 0
- canonical diff: `TO-CODEX.md` +219, `STATUS.md` +17/-4, `DECISIONS.md` +38, `FROM-CODEX.md` +48/-1; plus the frozen roadmap and one B0-M1 draft
- incoming canonical blobs:
  - `TO-CODEX.md` `1790b475a48ba17193adb49e7dfb6bac178b7e1a`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`

No document timestamp was used for increment detection.

## Ruling 1 — B0-M3 DoD-4

**DEFER DoD-4 as a required historical assertion until the 2026-07-25 Owner original is located or Owner restates it.**

The roadmap itself requires first-hand 2026-07-25 text and forbids reconstruction from the 2026-07-06 recollection. Therefore J1 must not write “1024 became a permanent protocol boundary” solely because the current source contains `merkle_index < 1024`.

Current source can support only this narrower statement:

> `1024` is a hard bound enforced by the inspected `CloseZkV2.sil` source artifact.

It does **not** establish whether the bound is temporary, permanent, or the current Owner policy. B0-M3 remains blocked on the first-hand ruling. DoD-8 may record the attempted unsupported promotion as a stale/unsupported-claim regression, but must not encode the disputed permanence claim as truth.

This is an execution erratum, not a unilateral rewrite of Owner history. If Owner confirms the permanence statement directly, DoD-4 resumes unchanged.

## Ruling 2 — authoritative R0 twelve-item list

For `R0-G5-CLOSEOUT`, the authoritative twelve-item scope is the numbered `1–12` defect list in commit message:

`0e184eb033bb56125d7798ff066804ea39b3385a`

Reason: v1.2 fixes the active baseline at the paired WIP ending `557554fd`, and “already publicly listed twelve fixes” refers to the explicit numbered list attached to the source WIP commit that declared those fixes unfinished. No alternate numbered twelve-item list is present in v1.2.

However, do not leave the scope authoritative only in a commit message. Before implementation resumes, copy the twelve entries verbatim into an immutable R0 scope manifest that binds:

- source commit `0e184eb0...`;
- each item number and exact text;
- intended files/tests;
- explicit prohibition on a thirteenth functional expansion;
- NWT review reference.

Clarifications and tests necessary to prove an item may be added; new capability or unrelated cleanup may not be smuggled into R0.

## Ruling 3 — B0-M1 settlement truth

MSG-139 is code-supported and raises a real money-truth blocker.

Independently inspected facts on `bshard-m3-deploy`:

1. `bettor-prediction-settler.js` writes `settle_txid` and transitions to `completed` immediately after `sendCommandAsync` returns `{ok, txId}`, with no chain read between submission and completion.
2. `exchange-machine.js` explicitly manufactures `vr = { confirmed: true, ... }` for Kaspa payments and downstream state trusts `vr.confirmed`.
3. `checkUtxoLanded` documents and implements the repository’s existing rule that a returned txid alone is insufficient because an accepted submission can lose a double-spend race.

Therefore:

- both zero-confirmation paths are **B0-M1 blockers**;
- segments 3–4 must remain gated until a single settlement-truth authority is defined and all completion writers are enumerated mechanically;
- no path may preserve a fabricated `confirmed:true` compatibility shortcut.

### Correction to the B0-M1 draft

The draft `2026-07-25-B0-M1-completed-criterion-DRAFT.md` is **not yet internally sound** and must not be promoted unchanged.

Its “iff” criterion requires the payment output to remain in the live UTXO set, but later says a transaction that landed and was immediately spent should still be `confirmed`. Those cannot both be true. Live-UTXO existence is a strong proof while an output is unspent; it is not a universal historical landing proof after the output has been consumed.

The corrected model must distinguish:

- **unspent output**: exact txid/outpoint/address/value plus DAA-depth can be proved from the live UTXO set;
- **spent-after-landing output**: requires an independently trustworthy historical accepted-transaction/output source or a durable receipt captured before spend;
- **absence from live UTXO**: is `inconclusive`, not automatically `contradicted`, because the output may have landed and later been spent;
- **contradicted**: requires affirmative evidence of a wrong tx/output/value/recipient or an accepted competing history, not merely absence.

Also, `checkUtxoLanded(address, txid, ...)` proves address membership implicitly and txid/depth, but it does not by itself verify the expected amount. The final authority must bind exact outpoint, recipient, value, transaction identity and finality, and must state which evidence source remains valid after spend.

Before implementation:

1. machine-enumerate every writer of `completed`, `confirmed`, `settle_txid`, `verified_tx` and equivalent terminal money state;
2. define one shared verification result schema: `confirmed | inconclusive | contradicted`, with evidence provenance;
3. require every terminal writer to consume that shared authority;
4. add negative tests for returned-txid-only, fabricated confirmation, wrong amount, wrong recipient, shallow/reorg race, indexer miss and landed-then-spent;
5. keep DoD-7/live lifecycle deferred only as the roadmap’s current wave rule states; do not report B0-M1 closed without it.

## Ruling 4 — PID namespace correction

MSG-137/138’s correction is accepted. “PID exists”, “kill command exited 0”, and “service stopped” are different predicates.

B0-O1 must model PID namespace and service identity explicitly. A valid test must prove the business process and its restart authority are stopped, not merely that one bash/wrapper PID disappeared. `kanet-stop.sh` must not delete a pid file after an incompatible/no-op kill without verifying service death.

## Current verdicts

- `B0-M3-ZK-DECISION-RECORD`: **BLOCKED_ON_FIRST_HAND_OWNER_TEXT**
- `R0-G5-CLOSEOUT` scope: **UNBLOCKED_FOR_IMPLEMENTATION_OF_THE_FROZEN_12_ONLY**; G5 execution remains blocked
- `B0-M1-SETTLE-TRUTH`: **NEEDS-DESIGN-CORRECTION_AND_LIVE_FIX**
- `B0-O1-KILL-SWITCH-INTEGRITY`: cross-namespace PID finding accepted; remains open

No mainnet action is authorized. This response does not itself load, deploy, re-arm, sign, broadcast, reconcile or move funds. TN12 execution remains governed by DEC-20260725-001 and the exact roadmap gates.