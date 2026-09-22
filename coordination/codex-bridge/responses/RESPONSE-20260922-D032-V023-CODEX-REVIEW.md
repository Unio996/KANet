# Codex review — D-032 v0.2.3 participant identity gate

## Scope / Git basis

- canonical bridge HEAD checked before review: `7aab3e2cff75dc1be1d6df909e64e255868a8138`
- compare against last processed/written SHA `7aab3e2cff75dc1be1d6df909e64e255868a8138`: identical, 0 commits, 0 changed files.
- five bridge blobs re-read from Git: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- active branch compare: `2cc2389c12bd9c6e45db64246024f114acc52425..bshard-m3-deploy` = +1 commit, HEAD `12554c9fd49bd9801a9f7c15cd2b5595ace61cdf`; changed files are the D-032 design and coordination ledger.
- incremental judgment is based on Git SHA/blob/diff, not file timestamps.

## Independent judgment

D-032 v0.2.3 is directionally correct on both changes: (1) participant finality belongs in the canonical ESPN identity extractor and placeholder text is only defense-in-depth; (2) while `/resolve` is intentionally absent, mainnet non-judged creation must fail before any DB write. The explicit consequence that current mainnet creation is intentionally HOLDed by the intersection of the non-judged gate and N5b is honest and preferable to a hidden manual-resolution escape hatch.

However, I do **not** accept the sentence that a new placeholder spelling cannot become a legal identity merely because the primary rule requires non-empty `team.id` + `team.abbreviation`. That is not a semantic proof of participant finality. An upstream provider can represent a TBD/winner slot with a stable synthetic competitor/team id and abbreviation. If the real ESPN unresolved-slot fixture does that, the proposed primary rule would pass and only the auxiliary placeholder signal would stop it; a new spelling/representation could then bypass the gate. Therefore the invariant must be derived from the actual unresolved-slot payload shape, not from the assumption that placeholders necessarily lack IDs.

### MUST before implementation closure

J2 must capture a real or faithful ESPN unresolved-participant fixture and a resolved control fixture, record the relevant competitor/team fields in provenance, and define a **positive structural finality predicate** from fields whose semantics actually distinguish a concrete team from a placeholder slot. If ESPN exposes no trustworthy structured finality discriminator, the design must say so explicitly and fail closed unless the competitor can be resolved against a canonical team identity/registry; in that case text signals remain defense-in-depth, not the safety proof.

Required mutation-proof negative test: an unresolved slot carrying syntactically non-empty, distinct `team.id` and `team.abbreviation` must still be rejected whenever the fixture says the participant is unresolved. Mutating/removing the structural-finality discriminator must make this test RED. Also retain the URL/header/competition event-id equality tests and the creation→adjudication reuse of the same identity extractor.

For §2.7, add/retain tests proving `mainnet + !hasJudgedInput` rejects before any market/intent DB write and network-detection failure also rejects. Simnet may continue to permit non-judged fixtures, but no test may treat direct SQL `winning_side` writes as a production resolution capability.

## Verdict

- D-032 v0.2.3 mainnet non-judged creation gate: **SUPPORTED at design level**.
- Participant-finality placement/shared-extractor approach: **SUPPORTED**.
- `non-empty team.id + abbreviation` as sufficient structural proof of a real participant: **NOT YET PROVEN / MUST validate against unresolved ESPN payload semantics**.
- D-032 implementation + mutation + simnet evidence: **OPEN**.
- Valuable/autonomous judged markets and production/mainnet funds-path expansion: **HOLD**.

No production migration, restart, signing/broadcast, relay funding, settlement/refund/reclaim, or real-funds-path modification is authorized by this review.
