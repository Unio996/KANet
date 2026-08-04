# Codex review — live worktree is a deployment queue; injection tests require isolation

## Verdict

`TIMELINE_CORRECTION_ACCEPTED__06C1747C_IS_THE_RELEVANT_PRODUCTION_CODE_COMMIT__630FE304_WAS_DOCUMENTATION_ONLY__THE_PRIOR_CONCLUSION_OF_INTENTIONAL_GATE_DEPLOYMENT_REMAINS_UNCHANGED__BUT_THE_OPERATIONAL_BOUNDARY_IS_STRONGER_THAN_BRANCH_OR_COMMIT_CONTROL__ON_THIS_HOST_WRITING_UNREVIEWED_BYTES_INTO_THE_LIVE_WORKTREE_CAN_QUEUE_THEM_FOR_UNATTENDED_SUPERVISOR_RESTART__MUTATION_OR_INJECTION_TESTS_MUST_RUN_IN_AN_ISOLATED_CHECKOUT_OR_WITH_SUPERVISOR_PROVABLY_DISABLED_FOR_THE_FULL_WINDOW__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

1. The timeline correction is valid. Commit `06c1747c6b7fb57fe8068771e19f4c6af151dac1`, authored and committed at `2026-08-04T08:44:46Z`, is the commit that actually modified `kasia-console/src/api/pool.js` and moved the P1 gate before relay matching. The previously cited `630fe304` was a documentation record, not the production-code arrival event. Therefore repository history must use the commit that changed the relevant production file, not the later commit that announced or summarized it.

2. This correction does not reverse the earlier deployment conclusion. The gate move in `06c1747c...` was an intentional reviewed change and was subsequently loaded. The correction changes the chronology and the evidentiary method, not the authorization status of that already-performed deployment.

3. The newly stated operational boundary is materially stronger and correct for the described topology: where the production process may restart automatically from the same checked-out worktree, the dangerous event is not only `commit`, `push`, or an explicit deployment window. Saving modified bytes into that live worktree may make them eligible for an unattended supervisor restart. Therefore a prohibition phrased only as “do not deploy” or “do not merge to the branch” is insufficient.

4. The same fact invalidates mutation testing in the live checkout as a generally safe procedure. Temporarily removing an authorization gate, disabling a verifier, or changing a dispatch predicate creates a real interval in which an automatic restart could load the deliberately weakened version. A test passing after restoration does not prove that no unsafe version was loaded during the interval.

5. Required test discipline:
   - run gate-removal, verifier-disable, and other mutation/injection experiments in an isolated checkout/worktree/container that no production supervisor can load;
   - if an isolated environment is impossible, prove before mutation that the relevant supervisor and all alternate launchers are disabled for the entire mutation window, record that proof, and independently verify the production process was not restarted from the mutated tree;
   - restore and hash-check the production worktree before re-enabling any launcher;
   - do not treat “no incident observed” as evidence that the procedure was safe.

6. The two later commits concerning RPC degradation sampling are operationally relevant to another incident line but do not constitute new P1 authorization or D4 closure evidence. They are not being counted as refund-path collaboration evidence in this review.

7. No new typed evidence verifier, semantic positive control, contradictory-fixture rejection, forced quorum/signature failure test, or zero refund/claim/sign/broadcast production trace was added in this increment. P1 remains OPEN and D4 remains BLOCKED.

## Required status language

Use the following distinction going forward:

- **code reviewed**: static/diff review completed;
- **code present in live worktree**: bytes are available to an unattended restart and therefore operationally deployment-eligible;
- **code loaded**: a production process has started from those bytes;
- **money-path authorized**: explicit separate authorization exists for the exact production action.

These states must not be collapsed.

## Non-authorization

This response does not authorize typed-authorization implementation in the live worktree, mutation testing in the production checkout, restart, deployment, refund construction, claim construction, signing, broadcast, settlement, migration, or movement of production/test assets.
