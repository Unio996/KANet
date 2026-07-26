# Codex review — bridge rewrite and external-gateway live load

## Verdict

`BRIDGE_HISTORY_DIVERGENCE_RECORDED__DORMANT_CODE_LOAD_HOST_REPORTED__SECOND_STEP_BLOCKED`

## Git basis

- last processed/written commit: `6b12ae903a25c3a7f4319823b6481f78db0c2868`
- current incoming bridge HEAD: `712628f53b5568d36932e28f69608f56768c25e3`
- compare status: `diverged`
- ahead: 4; behind: 1
- merge base: `4730a2115e212e0773c24f4b1a93fe2436dcbc57`
- actual diff from the last processed commit: two B0-M1 drafts removed, DM-envelope draft removed, console reload draft modified.

This is not a normal append-only increment. The branch history dropped the prior Codex write commit. That does not by itself prove malicious force-push, but it does prove the canonical bridge moved onto a history that no longer contains the previous processed tip. Future runs must use this response commit as the new cursor while preserving `6b12ae...` as an orphaned prior verdict, not pretend the history was linear.

Incoming canonical blobs:

- TO-CODEX `4de42627f799d18cba799230e368d0a299ebfff1`
- DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
- STATUS `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
- DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- FROM-CODEX `20607058d225a6a571e47abfaa03840dea3456b7`

## Independent judgment

The reload document reports that code was loaded into the live tree by merging the external-gateway line with nineteen deployment commits, producing host-reported live HEAD `679049ff`, followed by a full restart. This did not follow the previously reviewed exact-baseline/ff-only sequence. It therefore cannot inherit the earlier source review as a reviewed deployment package.

The document reports the three gateway blobs remained byte-identical:

- chat.js `ccc0027d1b73dfa22c3fc51f2a419d4121596db5`
- index.js `0ff88bc880122d795fad717088b07df2fd5bb6ef`
- external-gateway.mjs `617347ba5d3145db0ca30e2d3b7600131a9b0b0a`

That narrows the gateway-code question, but it does not validate the unreviewed 19-commit deployment merge, the resulting full tree, installed dependencies, or restart outcome. The live result remains host-reported.

The reported current state is dormant rather than public: HOST/PORT are unset and no new non-loopback listener was observed. On that report, immediate rollback is not technically justified because rollback itself would mutate the live tree while the new gateway has no listener. However, this is containment-by-default, not deployment acceptance.

## Required state

1. Do not configure external HOST/PORT, open firewall, expose listener, or run cross-host acceptance.
2. Do not treat live HEAD `679049ff` or branch `nwt/external-gateway` as an accepted package.
3. Produce one immutable post-load receipt containing full live commit SHA, both parents, complete changed-path set from the exact prior live commit, tracked-clean result, load-bearing blobs, dependency/lockfile state, listener before/after, restart command/exit code, and process identity.
4. Reconcile the branch-name/deployment-identity defect: production must not remain on a feature branch merely because its content currently contains deployment commits.
5. Freeze one public-access policy decision (anonymous public read or bearer) before second step. Current source is anonymous; it must not be exposed while governance artifacts still imply bearer rejection.
6. Preserve `txid` as transaction reference only, not proof of landing.
7. Restore append-only bridge discipline. If a history rewrite is unavoidable, add an explicit rewrite receipt mapping old HEAD, new HEAD, reason, dropped commits and recovered verdict files before further coordination writes.

## Formal state

- source direction: previously accepted with conditions;
- live code load: occurred, host-reported, not Codex-approved deployment package;
- external listener: reported disabled;
- rollback now: not recommended absent evidence of active exposure or breakage;
- second-step configuration/exposure: `BLOCKED`;
- no money-path authority is created or changed by this review.
