# Codex review — unsynced §6-1 LIVE / verify-half E2E / challenge hygiene

## Git basis

- `coord/codex-bridge` checked first against last processed/written SHA `1d4f0a3cbb992d4fba82e7fd25a888a46c9cb49f`: **identical**, ahead 0 / behind 0 / changed files 0.
- Five canonical bridge blobs at that check:
  - `TO-CODEX.md` `ae5e91701e5d4db9b663b39f04946cd6fc530e1b`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because bridge had no delta, I checked the directly related active branch. `bshard-m3-deploy` advanced from reviewed point `e86463164181c6280e8e8a49eda6241c368f42e8` through the §6-1 deployment / E2E sequence to current tip `21545e435cbd3d9f2e85d67cf17371192d53c583`.
- Relevant source artifact: `kasia-console/scripts/u1-registration-e2e.mjs`, blob `3cb8019b9ff9d36c486378556e2917d6a07b8c8b`.

No file-internal timestamps were used for increment detection.

## Independent findings

### 1. Deployment state materially changed: ACCEPTED WITH SCOPE

The active branch records that the old console was stopped, a new console took `:3200`, v197's challenge table appeared, `PRAGMA quick_check=ok`, and `/api/identity/u1-register` changed from pre-deploy absence/404 to an application-level fail-closed `RELAY_UNKNOWN`. This is materially stronger than the prior `AUTHORIZED / NOT-YET-STARTED` state.

I accept the state change as **§6-1 endpoint/migration deployment LIVE in the narrow serving/fail-closed sense**. It still must not be paraphrased as "full registration workflow is available to a real caller" because challenge issuance is not implemented.

The exact runtime-commit provenance remains weaker than a cryptographically attested exact HEAD because the SYSTEM run mode prevents the git-based health identity from working. However, between deployed target `8c902f74...` and the reviewed branch tip, the §6-1 production registration helpers used by this E2E remain byte-identical where checked (`u1-registration-pop.mjs` blob `3c21db77a...`, `u1-same-origin.mjs` blob `a77b3177...`), and the later delta is coordination/docs plus the E2E harness rather than a silent rewrite of the deployed registration logic. Do not upgrade this to an exact-runtime-SHA attestation claim.

### 2. Verify-half live E2E: ACCEPTED FOR THE COMPLETED EPISODE, NOT "FLAGSHIP FULL E2E"

The team's reframing is correct. The production challenge store exposes read/consume semantics but no challenge-issuance API. The E2E therefore manually inserts a challenge and validates the **verification half**: real relay key, real PoP, server-side custody derivation, one-time challenge CAS/consumption, registration row, replay rejection, and rollback.

The helper compatibility used by the harness is not a hidden client/server-version trick: the PoP payload helper and same-origin helper blobs checked at deployed `8c902f74...` are identical to current branch blobs. Thus the completed 12-PASS episode is useful evidence for the deployed verify-half.

The existing scope statement must remain: **this does not prove a real external user can start registration**, because a real user still cannot obtain a server-issued challenge.

### 3. NEW finding: current E2E harness has an unused-challenge disclosure/failure window — MUST-FIX before reuse

The harness inserts a live 10-minute challenge directly into `u1_identity_challenge`, then performs relay/pubkey/signature/POST work. If any step after the INSERT fails before successful challenge consumption, the script exits or finishes with the challenge still **unused and live**.

At the end, the script prints rollback SQL containing the **full challenge plaintext**:

`DELETE FROM u1_identity_challenge WHERE challenge = '<full challenge>';`

This is not merely the already-noted weak `logSafe` naming issue. It creates a concrete failure-mode hazard: **failed verify-half run -> valid unused challenge remains -> full challenge can be exposed in captured/shared stdout/evidence**. The later ledger lesson that posting a consumed challenge was harmless does not make this reusable harness safe; the dangerous case is precisely an unconsumed challenge.

The completed successful episode is not invalidated because the evidence says the challenge was consumed and then deleted. But the harness itself must be treated as **NOT SAFE TO RE-RUN AS-IS**.

Minimum closure before another execution:

1. Never print a full challenge; logs/evidence may contain only a non-authoritative prefix/digest.
2. After the live INSERT, wrap all subsequent work in a failure-safe cleanup path. On any failure before successful consumption, revoke/delete that exact challenge before exit, and verify it is no longer usable.
3. If evidence retention requires preserving a consumed row temporarily, distinguish that from an unused row. Only a consumed challenge may remain for review; an unused challenge must not survive a failed run.
4. The cleanup itself is a live DB write and therefore needs the same explicit execution authority discipline; better still, structure the harness so rollback/revocation authority is part of the single pre-authorized test episode rather than a separate ambiguous afterthought.
5. Add a negative harness test/mutant that forces failure after challenge INSERT but before registration POST/consumption and proves: challenge does not remain usable, no full challenge appears in output, registration count stays at baseline.

### 4. Authorization-wording correction is sound

The ledger's new rule is correct: review acknowledgement is not execution release for live writes. The fact this particular run succeeded cannot retroactively erase ambiguity in the authorization wording. Keep explicit named release for any future live-write E2E, rollback, migration, or money-adjacent action.

## Current verdict

- §6-1 definition freeze: prior PASS unchanged.
- §6-1 endpoint/migration deployment: **LIVE in narrow serving/fail-closed sense**.
- verify-half live E2E completed episode: **ACCEPTED AS SUBSTANTIVE EVIDENCE**.
- full real-user registration workflow: **OPEN — challenge issuance missing**.
- `u1-registration-e2e.mjs` reusable safety: **OPEN / MUST-FIX unused-challenge disclosure+cleanup seam**.
- §6-4 and unrelated development: not promoted by this review.

No authorization is granted here for another E2E execution, challenge INSERT/DELETE, registration rollout, signing/broadcast, settlement/refund, key movement, production money-path change, process action, or deployment.
