# Codex review — first mainnet settlement round + oracle integration

## Git / evidence basis

- canonical bridge HEAD before this write: `3de270e29025764608177e8ee929a1a712bc794d`
- previous processed/written bridge SHA: same SHA; Git compare: identical, 0 commits, 0 files
- five bridge blobs re-read from canonical branch: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- active branch advanced from last reviewed `b6f744b50409d4cb551b22121fad07eeb47d4ffa` to `1b28d752a5731da50d7989f32dd8e6220261594e`: ahead 9 / behind 0. Relevant evidence reviewed: isolated simnet clean-round RESULT, mainnet enable checklist, first-mainnet-round RESULT, oracle→proto winning_side design v0.1.

No bridge timestamp/self-reported Last-updated field was used for increment detection.

## Independent judgment

### 1. 9-4 clean-path consensus/relay gate: materially satisfied for the tested shape

The isolated simnet round now contains real transactions for genesis, two appends, seal, close_commit, convert_to_claim and claim_draw, with all four settlement intents landing and no post-fix error events. The prior production-writer persistence-shape bug was exercised through the real writer shape rather than the old fake fixture. This is enough to close the narrow **clean, single-winner, isolated-simnet 9-4 acceptance gate** for that shape.

It does **not** close polluted-fee-vector, multi-winner, concurrent-market, adversarial/refund-race or formal oracle-resolution gates. Keep those claims separate.

### 2. First mainnet round: strong positive evidence, but it must not be generalized into production readiness

The mainnet evidence is valuable: one pre-existing market plus one new append traversed seal → close_commit → convert_to_claim → claim_draw on the real mainnet node, with four settlement intents landed, terminal DB state resolved, a 1001-unit claim recorded, and relay KAS decreasing from 4.0899 to 2.5609. That proves the tested exact production path can work against mainnet consensus/relay under this controlled shape.

However this run deliberately reused a market whose deadline was already five days old, so `refund_flip` was already permissionlessly open after seal. The fact that close_commit won the approximately 76-second race is an observed outcome, **not a safety property**. Do not use this run as evidence that the normal lifecycle is race-safe. A normal fresh-deadline mainnet control (or an equivalent proof that removes the race) remains the right evidence before widening usage.

Also, the run is single-market/single-winner. It does not exercise the previously raised same-tick fee-input collision condition. The **same-tick fee-outpoint reservation MUST remains OPEN** unless production is mechanically constrained to one advancing settlement per tick. A successful single-market mainnet round cannot close a concurrency invariant it never exercised.

### 3. Mainnet activation was an Owner decision, not a Codex authorization

The provenance says Owner GO was separately relayed and the funded path was executed. Record that provenance explicitly. My earlier HOLD was a review gate, not authority to override an Owner decision; conversely, this successful Owner-authorized round does not implicitly authorize any subsequent funded round, increased relay balance, wider market set, automated oracle write, or other production funds-path change.

### 4. Oracle→winning_side v0.1: direction supported, but current write-once proposal has an internal semantic conflict

Reusing the existing oracle decision engine rather than creating a second resolver is the right architecture. I support: explicit resolution metadata, proto-market adapter, ABSTAIN on uncertainty, audit columns, and a grace period between decision and irreversible close_commit.

But §4/§5 currently says both (a) winning_side is write-once and (b) a wrong value may be corrected during the grace window. Those are different state machines. Do **not** implement an UPDATE exception that silently mutates `winning_side` in place.

Required design correction: separate **proposed resolution** from **final resolution**. For example, persist an immutable/versioned proposal (`proposed_side`, source/evidence hash, proposed_at, proposal id), allow dispute/cancel/supersede during the grace window with an audit trail, and only after the grace expires atomically finalize `winning_side` exactly once. Settlement must consume only the finalized value. This preserves write-once semantics at the irreversible boundary while still permitting correction before finality.

Additional MUST: oracle committee/result identity and the exact resolution evidence/rule version used for finalization must be bound into the audit record; a later oracle tick must not be able to reinterpret the same market under changed rule/source metadata. Resolution metadata therefore needs immutability/version binding once the market enters the resolvable lifecycle.

### 5. Do not couple oracle finalization to settlement execution in one tick/transactional side effect

The oracle adapter should only produce/finalize the decision record. The settlement driver should independently observe an already-finalized, grace-expired decision and then apply its existing C1/lineage/PMT/builder gates. This keeps the external truth boundary independent from the money-moving boundary and avoids turning a voter cron failure/retry into an implicit settlement retry.

## Verdict

- 9-4 clean isolated-simnet tested shape: **GREEN / narrow gate closed**.
- first controlled mainnet settlement round: **positive production evidence for the exact tested shape; not a blanket production-readiness approval**.
- same-tick fee-input reservation: **MUST still OPEN**.
- stale-deadline/refund-flip race: **not accepted as normal operating pattern**; winning one race is not a guard.
- oracle→proto integration direction: **SUPPORTED WITH MUST-FIX** — split proposed vs finalized resolution; immutable/version-bound evidence; settlement consumes only finalized/grace-expired decision.
- no authorization here for another funded mainnet round, relay top-up, automated oracle finalization, settlement widening, production config/DB/key changes, or any other funds-path action.
