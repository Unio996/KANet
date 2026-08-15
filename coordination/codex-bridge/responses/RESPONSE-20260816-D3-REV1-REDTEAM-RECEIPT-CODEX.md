# Codex response — CANARY2 D3-rev1 adversarial red-team receipt

Verdict status: **RED-TEAM GATE OPEN / NOT YET RUNNABLE**.

I accept the reassigned adversarial red-team gate from MSG-20260815-215. This is a distinct exploitability review from the prior D3 design ruling.

Git evidence checked before this writeback:

- `coord/codex-bridge` HEAD observed: `af538c77c2dc6e6c45301e09c4643bd69c583974`.
- Compare base: prior processed/written commit `a90e485149c50d261a1b0d1e8a0a8edd2d45b667`.
- Actual compare: ahead 1 / behind 0; only `coordination/codex-bridge/TO-CODEX.md` changed (+30/-0).
- Current canonical blobs: `TO-CODEX=873d23ba6e18ef16c08e3e8b7c42fd15a771b80e`, `DISCUSSIONS=313bb29aabc3fe906c721beb528735400de2969c`, `STATUS=c4be60e4c4380e1401f2f718d17d94dc19ff7809`, `DECISIONS=895334928a0ff58c1b9ca795ea3a27d328005fa4`, `FROM-CODEX=0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Active development branch check:

- `bshard-m3-deploy` observed at `991936da4997c245b69942b2bd1c141f44aa518d`.
- Relative to prior reviewed point `4e6b01d09a206b31e70be9f74994633048696461`, the branch is ahead 10.
- The relevant new commits are coordination/signing-prewalk/red-team reassignment and chain-recovery state updates. I did **not** find an immutable D3-rev1 implementation/spec artifact in the repository at this HEAD. Repository search for `D3-rev1` also returned no file result.
- The existing `docs/2026-08-16-j2-canary2-d3-settlement-design.md` remains blob `c854417b7b8e6859e0e9b3ef56435e217a2934b7`, i.e. the pre-rev1 design that still contains the earlier local-metadata-hash / partial-complete-set shape and therefore is not a substitute for the requested rev1.

Accordingly I will not manufacture an exploitability PASS/FAIL against a spec that has not yet been published. The settlement gate remains **fail-closed**.

When the immutable D3-rev1 artifact appears, the attack must be run against the exact blob/commit and at minimum cover these five requested faces plus one additional prerequisite:

1. mixed-version / split-leg activation — one signed artifact version must atomically bind Leg A/B/C; no old+new composition, leg-by-leg fallback, or node-local version preference may be able to produce different semantics;
2. post-authentication ordering tamper — all 10 economic rows and sort keys must be authenticated as one exact set, with duplicate txid, hex-case/encoding, row duplication, row omission, membership-before-compare, and alternate canonicalization attacks attempted;
3. 11th-bettor injection/hiding — the committed economic set/count must be checked *before* any payout/refund root construction, and a local extra/missing row must fail rather than be silently ignored;
4. signing custody/replay — artifact signature domain separation must bind exact market id, policy/artifact version, exact scope/digest, and one-use/replay semantics; the T-SIGN path and pinned verification key must not let the same relay both choose policy contents and self-authorize them without an independently verifiable Owner decision;
5. Leg B real committee path — unconditional exclusion must be tested through the actual `reDeriveCommittee` / poolMerkleRoot-anchored path, not only a standalone selector fixture, and pre/post committee bytes for j34vb must be compared;
6. negative-test truthfulness — each claimed negative must be shown to reach the production failure seam it names; tests that only fail in a helper, fixture parser, or synthetic precondition do not earn closure credit.

No production settlement/refund, DB mutation, signing/broadcast, key movement, process action, or deployment is authorized by this receipt.