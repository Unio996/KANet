# Codex independent review — unsynced D2 multiplicity + TN12 progress gate + backfill canary

## Scope / Git basis

- bridge base/HEAD before this write: `6fdb8ab0c3d84ed340321ac572f0405abf3f92e3`
- Git compare `6fdb8ab...6fdb8ab`: `identical`, ahead 0, behind 0, files `[]`.
- canonical blobs re-read from that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no bridge increment, so I followed only the directly related active branch.
- `bshard-m3-deploy`: prior reviewed `d54a3ae56083c64b63bba0f0355d829d81804fa4` -> current `046dd09dc9f2157e810ece23a792c79940c9e3ab`, ahead 16 / behind 0.

No file timestamps were used as increment authority.

## 1. D2 continuation multiplicity: CONFIRMED MUST-FIX, but exploitability not yet proven

I independently read `kasia-console/src/lib/bshard-close-enforce.mjs` at `046dd09...` (blob `7de703d53bb9743d6ed2f73644172dea16fc1f8e`).

`verifyClosePayoutRootBinding()` currently:

1. identifies every output whose `covenant.covenantId` is present;
2. rejects only when the set is empty;
3. checks every such output's `scriptPublicKey` equals the expected continuation P2SH;
4. returns `matchedOutputs: covOuts.length`;
5. does **not** read the output `value` and does **not** require `covOuts.length === 1`.

The live `enforceCloseAttest()` caller then consumes only `d2.ok`; `matchedOutputs` is not used there.

So the current D2 assertion proves only: "all covenant-tagged continuation candidates have the expected SPK." It does not prove there is exactly one authoritative continuation output, nor that a witness-selectable candidate carries the economically intended value.

The inline comment claiming that if all candidates have the correct root/SPK then any `self_out_idx` is safe is therefore over-broad: sameness on SPK/root does not establish sameness on value or economic role.

**Verdict:** `D2 multiplicity/value-source = RED / MUST-FIX before any money-path activation touching this enforcement.`

Minimum closure should include:

- a cardinality/identity invariant derived from the actual close transaction shape, not merely `matchedOutputs` telemetry;
- an adversarial transaction with two covenant-tagged outputs carrying the same expected SPK but different values, proving the verifier rejects the ambiguous form;
- matching fix in the currently unwired V2 twin before it is wired, but do not count the V2 twin as a second live exposure today;
- preserve the existing `tx.version>=1` / sighash covenant-binding checks; do not weaken D2 to make the adversarial case pass.

I am **not** upgrading this to "live exploit confirmed": I have confirmed the code-level verification gap. Whether the current builder/relay/witness surface can actually construct and land the ambiguous form remains a separate evidence question.

## 2. TN12 watchdog: level backstop improved, but the earlier progress-gated pulse blocker is still open

Current `scripts/tn12-mining-watchdog-v2.ps1` blob is `d7e2e1c5927a1561f8e50ad474f83db46d8d741e`.

The change lowering the static backstop below the re-derived mergeset cliff is directionally correct: a level backstop above the failure boundary is not a useful backstop.

However the load-bearing braked branch still executes:

`Start-Miner-Unless-Paused -> sleep PULSE_SEC -> Stop-Miner`

without a pre-pulse independent proof that virtual/accepted progress is currently advancing, without a post-pulse progress/tips efficacy check, and without a bounded pulse budget. The code comment itself relies on the conditional statement "while virtual can advance"; the code does not currently establish that condition before acting.

Therefore the prior blocker remains unchanged:

**`progress-gated pulse = RED / MUST-FIX; watchdog NOT operationally closed.`**

Lowering `TIPS_BRAKE` and improving trend detection do not close this failure mode. They change when the brake engages, not whether a pulse is safe/useful after engagement.

## 3. Historical payout_ps_addr backfill: canary/ALL guards are a real safety improvement, not authority to run

I independently read the new `PS_ADDR_BACKFILL_ONLY` / `PS_ADDR_BACKFILL_ALL` gates in `scripts/backfill-payout-ps-addr.mjs`.

The structure is sound as an operator-intent guard:

- confirmed write with neither `ONLY` nor explicit `ALL` fails closed;
- `ONLY` and `ALL` together fail closed;
- canary exact-match filtering happens after full divergent enumeration;
- zero-match canary fails loudly rather than falling through to full-run or silent no-op;
- `NO_CHAIN` remains mutually exclusive with confirmed writes.

**Verdict:** `canary/full-run intent guard = ACCEPTED IN CODE as defense-in-depth.`

This does **not** close the outstanding money-path acceptance requirement: a real funded divergent shard still needs exact-outpoint chain confirmation -> one-row mutation -> gate-green evidence with no unrelated DB mutation. No production backfill is authorized by this review.

## 4. V2 refund gate status

The current v0.3.1 design still self-identifies as design-only / zero code. The two V1-compiler-in-V2-path defects and the separate gate-2 trigger/orchestration problem therefore remain OPEN. No technical state change justifies relaxing the previous hold.

## Current consolidated verdict

- D2 V1 continuation multiplicity/value-source: **newly confirmed RED / MUST-FIX**.
- D2 V2 same-shaped verifier: **fix before wiring; not a second live exposure today**.
- TN12 static level backstop: **improved**.
- TN12 progress-gated pulse: **still RED / NOT operationally closed**.
- payout_ps_addr canary/full-run intent guards: **accepted as defense-in-depth**.
- real historical backfill positive acceptance: **still OPEN**.
- V2 refund gate-2/gate-3 implementation: **still OPEN**.

No authorization is given for production refund/settlement, backfill, watchdog deployment/restart, miner action, signer/broadcaster change, DB mutation, key movement, or any production funds-path modification.
