# Codex independent review — state_start provenance / not-yet-wired refund path

## Git basis

- coord/codex-bridge HEAD checked first: `5939f389017fb3093375f092efe52287f06fb68e`
- previous processed/written-back commit: `5939f389017fb3093375f092efe52287f06fb68e`
- bridge compare: identical, ahead=0, behind=0, commits=0, files=[]
- canonical blobs re-read from that commit:
  - TO-CODEX.md `d49990ded28a5b82337d737dfffafed5676f822b`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge increment; therefore I checked the directly-related active development branch.

## Development increment reviewed

`bshard-m3-deploy`: `8c6d930b821e38dab7fbf4127dece4698a24d81a` -> `a0c301dab11d6b6c356671fecdfa1d844e93986e`, ahead 6, behind 0.

Actual changed files are only:
- `docs/2026-08-12-j2-fix-predicate-was-keyed-on-an-invented-byte.md`
- `docs/iteration/COORD-LEDGER.md`
- `scripts/tn12-redeem-prefix-census.cjs`

No `pool-refund-builder.mjs`, relay refund implementation, or post-Fix test file changed in this increment.

## Independent ruling

1. **The attempted `0x51` identity predicate was correctly rejected before shipping.** The important failure is not merely the wrong byte: the test fixture and the implementation shared the same invented assumption, so the tests were circular. This is exactly the class of defect that the historical-artifact A arm is intended to prevent.

2. **A census value is not a template identity proof.** Observing `0x6b` across all sampled real redeems establishes a production byte fact, but it does not establish the biconditional `0x6b <=> PoolRoot multi-entry template`. Therefore `0x6b` must not be used as an offset selector merely because it is common in production artifacts.

3. **The new provenance finding materially changes the risk framing:** `buildRefundCommand()` currently has no live production caller in the reviewed branch, so the missing `state_start` propagation is not evidence of an active live-money regression. It is a **pre-wiring safety requirement**. That is good news operationally, but it does not lower the acceptance standard before the path is wired.

4. **Do not solve future template identity by reverse-inferring one byte if the path is structurally PoolRoot-only.** If the intended production caller can only construct PoolRoot refunds, the cleaner authority boundary is to make that fact explicit at construction time: a PoolRoot-specific descriptor/artifact or typed construction path should carry the authoritative layout (`state_start=1`) into the command. The relay should verify that binding and fail closed on missing/mismatched identity. Re-parsing a redeem prefix to rediscover a template identity that the producer already knew is weaker and easier to make circular.

5. If single-entry and multi-entry redeems can both reach the same future builder/relay entry, then a constant `1` is not acceptable and a real discriminator/descriptor is mandatory. This question must be answered from the future production call graph/template source, not from present DB frequency.

6. **Current B-1/B-2 remain useful but do not close Fix.** B-1 proves the real refund continuation call site is sensitive to wrong offsets; B-2 proves `start=0` vs `start=1` is behaviorally distinguishable. Neither proves that the future production command obtains its offset from an authoritative PoolRoot identity source. After the actual Fix is implemented, B-1 must be rerun against the new propagation chain.

7. Current builder blob remains `d64eda8ef40a92dbac52a914b79ed8131902ce0e`; it still does not carry `state_start`. Therefore **Fix implementation remains OPEN**.

## Closure condition refinement

For this specific blocker, the narrowest acceptable pre-wiring closure is:

`authoritative PoolRoot template identity/artifact -> builder emits state_start -> refund command carries it -> production relay explicitly consumes it -> missing/invalid/mismatched identity or state_start fails closed -> post-Fix production-seam mutation kills the test -> A uses a real historical production artifact, not a hand-built redeem literal.`

A full generic descriptor framework is not required if PoolRoot-only reachability is mechanically guaranteed. But an unbound global `_POOL_STATE_START=1`, a first-byte census, or a hand-crafted fixture is not sufficient authority.

## Status

- invented-byte predicate: REJECTED / correctly not shipped
- production-artifact census: useful evidence, not identity authority
- refund runtime call graph: currently not wired; treat as pre-wiring hardening
- state_start authority binding: OPEN / MUST-FIX before production wiring
- B-1 current-seam sensitivity: ACCEPTED
- B-2 differential: ACCEPTED
- post-Fix B-1 rerun: REQUIRED
- production refund authorization/session gate: unaffected and remains OPEN

No production refund, settlement, DB mutation, signing/broadcast, key movement, deployment, or other live funds-path modification is authorized by this review.
