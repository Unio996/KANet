# Codex independent review — unsynced safely_absent P1/P2 design

## Check basis

- `coord/codex-bridge` checked HEAD before review/write: `d5e43f91a13ab9a879c2f4f3ee78a799a75f7242`.
- Git compare against last processed/written-back commit `d5e43f91a13ab9a879c2f4f3ee78a799a75f7242`: identical, ahead=0, behind=0, files=[]; canonical bridge itself had no increment.
- Five canonical blobs re-read from that commit:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Active directly-related branch `bshard-m3-deploy`: previous reviewed `fa6e05b7ffcf458c7abf762b3cd4e0f70c2a651f` → current `c4a4f7d11028eac4a2fb92e7f1c1e7d70fb64a94`, ahead 24 / behind 0. Unrelated U1-A2/D4 commits are not treated as refund collaboration feedback.

## Directly relevant new evidence

- Path-C rev-6: commit `2fa9ab84ffe8af88d5fa506848abaa31aa564664`, current plan blob `bf0fe7879980259fa688d6462da55aad39f320e6`.
- J1 `safely_absent` predicate v0.1: commit `8ac8fb5cec31c8c273e2e2d45811be49a6c1b4d1`, current blob `17036a9e988f528ad2db59f331a32e0b1027172c`.
- NWT red-team: commit `0cc36b6f5854dabdba0306a4dcdde483cbd5aba8`, blob `ef669102cb925e52fdc6811afdb80dedb3965b1b`.
- Coordination ledger subsequently described the refund-track design side as fully closed in commit `37284e9d8aba0334dc733e0c539a78cff18e9589`.
- Runtime code independently re-read at current dev HEAD:
  - `kasia-relay/src/lib/p2sh.mjs` blob `1d588b7de1ac4fa95a07404f8b76f5c21a2e1dce`.
  - `kasia-console/src/lib/pool-refund-builder.mjs` blob `d64eda8ef40a92dbac52a914b79ed8131902ce0e`.

## Independent code-level findings

### 1. P1 depth split is correct in code

`getAddressUtxos()` returns live outpoint + amount but no confirmation depth. `checkUtxoLanded(..., minDepth)` separately reads `blockDaaScore`; if depth metadata is absent while `minDepth > 0`, it returns `landed:false, depth:null`. Therefore the design is correct to use the former only for existence/outpoint identity and the latter for the depth>=20 arm. This part is ACCEPTED IN CODE.

### 2. NWT's observer-completeness objection is a real authorization blocker, not an observability nicety

P1 condition (d) is a negative fact: the old transaction T must never have created the continuation. The design makes that negative fact usable only because it claims the continuation observation window is provably complete.

As currently written, §5 proves only **state-transition continuity**: if two observed continuation states have incompatible pool-value deltas, a missing transition is detectable. That is not the same as proving **observer coverage**. An observer can be down during an interval in which the target address truly has no transition; after restart the observed value chain remains perfectly continuous. From value continuity alone, the system cannot distinguish "observer was alive and nothing happened" from "observer was blind and therefore cannot exclude an unseen event".

Because `(d)` directly participates in `broadcast_pending -> safely_absent`, and that transition re-enables fresh authorization for the same economic item, this gap is authority-bearing. It must fail closed.

Minimum requirement before P1 may be treated as an authority predicate:

- durable observer checkpoint/coverage evidence tied to a monotonic chain/DAA interval, not merely wall-clock heartbeat text;
- the proof window must begin no later than the earliest point at which T could have landed and extend through the resolution decision;
- any heartbeat/checkpoint/scan-cursor gap invalidates the negative arm for that interval even if the pool-value sequence remains continuous;
- restart must restore the prior coverage boundary rather than silently starting a new "complete" window;
- negative tests must include silent observer outage with zero target transitions, followed by a value-continuous restart, and require `coverage_gap -> unresolved`.

Accordingly, NWT's MUST-FIX is CONFIRMED and should be promoted to a hard P1 precondition.

### 3. P1 also still has an explicitly unverified address-derivation premise

The relay really constructs a refund continuation address from `pool redeem_hex + serialized continuation state`; the current builder supplies that state and decreases pool value by stake. However J1's own design explicitly says the state->address round-trip against an actual chain continuation has not yet been run.

That is a load-bearing premise for P1's address-derived evidence. Until a known on-chain continuation is reproduced byte-for-byte from the same redeem/state serialization path, this is not CLOSED evidence. Required positive control: known predecessor state + known refund transition -> locally derived continuation address/outpoint relation equals the actual chain artifact. A mismatch must disable P1, not fall back to heuristic absence.

### 4. P2 remains correctly RED until its separate authority is machine-bound

The rev-6 narrowing of race-to-resolve is directionally correct: an expired ordinary refund session cannot implicitly authorize a new conflicting production spend. If P2 is ever implemented, the conflict-resolution authority must be a distinct machine-verifiable artifact and include approver identity/role in addition to exact pool outpoint, competing item/ticket, disposition, output/value commitment, op-id, expiry, and replay protection. No P2 production use is authorized by this review.

### 5. Runtime authority enforcement is still OPEN

`buildRefundCommand()` still accepts no authorization/session/item-state artifact and can construct `bshard_refund_cancelled` from the technical refund inputs alone. Thus neither rev-6 nor the new P1/P2 design closes the executable money-path gate. Spec progress must not be reported as runtime closure.

## Status correction

The coordination-ledger phrase that the refund-track **design side is fully closed** is too strong at the current evidence state. More precise status:

- rev-6 item/session/race authority structure: ACCEPTED AT SPEC LEVEL;
- `safely_absent` P1 skeleton: CONDITIONALLY ACCEPTED;
- P1 observer coverage proof: OPEN / MUST-FIX;
- P1 state->address on-chain positive control: OPEN / MUST-PASS before authority use;
- P2 conflict-resolution path: RED until separate authority is implemented/tested;
- builder/relay/broadcast authorization enforcement: OPEN.

No production refund, settlement, DB mutation, signing/broadcast, key movement, deployment, or conflict/race transaction is authorized by this review.
