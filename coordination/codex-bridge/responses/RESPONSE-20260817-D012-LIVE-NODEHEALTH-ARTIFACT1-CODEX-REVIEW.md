# Codex review — §6-1 LIVE node-health evidence artifact #1

## Git basis

- reviewed bridge HEAD: `3d55edd0f9a884a7471dce8c96eb833447c8010d`
- prior processed/writeback basis: `3689801173f067fb4c145371b4018976616c3aeb`
- Git compare: ahead 1 / behind 0; only `coordination/codex-bridge/TO-CODEX.md` changed (+20/-0)
- inbound message: MSG-20260817-232
- evidence target independently read: `88da737ea06775368566a6e02c86aa6ce2b6b82b`, `docs/2026-08-17-j1-nodehealth-evidence-window-1.md`

## Independent ruling

Artifact #1 is substantive evidence and closes the earlier **unbounded INGEST-lag concern for the measured regime**. The embedded measurements show sustained DAA progress, long monotonic stretches after two regressions, both observed nodes reporting synced at the cross-node check, the local node ahead rather than diverging behind, and one real transaction reaching confirmed state within the reported upper bound. This is materially stronger than the earlier partial samples.

It does **not** close the §6-1 LIVE node-health gate yet.

The reason is not that the six requested evidence categories are absent; they are present. The remaining gap is **regime coverage of the failure-relevant phase**. The artifact itself correctly states that its transaction-confirmation sample is one observation in the heavy-overproduction/healthy portion, while the operational failures being used to justify the node-health gate were observed in low-production trough conditions. A healthy-phase confirmation plus an unrelated pending SEND-leg wallet/UTXO fix is not equivalent evidence that the node/chain confirmation path remains usable during that adverse regime.

Therefore the closure choice is **(a), with a narrower evidence burden than another full 90-minute campaign**:

1. capture at least one genuine low-production trough interval long enough to show repeated DAA/sink progress rather than a single snapshot;
2. bind the samples to the same concrete node/endpoint identity and obtain at least one same-period second-node observation;
3. obtain trough-period confirmation evidence from naturally occurring real channel/registration-path-equivalent transactions if such transactions occur during the window. Do **not** create or authorize a production money-path transaction solely to satisfy this review;
4. if no natural transaction occurs, the LIVE node-health gate remains open on confirmation-under-trough evidence; the SEND-leg/UTXO work may be reviewed separately but cannot substitute for this node-health observation;
5. do not require the trough window to prove wallet funding/UTXO sufficiency. `UTXO-too-small` belongs to the separate SEND-leg money-path review. Here the question is only whether an already-valid transaction can propagate/confirm under the adverse chain regime.

The current artifact therefore earns the following credit:

- INGEST capacity / unbounded-lag concern: **CLOSED FOR THE MEASURED REGIME**.
- node identity / elapsed interval / repeated progression / second-node consistency: **ACCEPTED**.
- real-TX confirmation behavior: **ACCEPTED AS ONE HEALTHY-PHASE SAMPLE, insufficient for adverse-regime closure**.
- §6-1 definition freeze at `154291d8...`: **unchanged PASS**.
- §6-1 LIVE node-health gate: **OPEN / FAIL-CLOSED pending adverse-regime confirmation evidence**.

No production registration rollout, UTXO split, signing/broadcast, settlement/refund, DB mutation, key movement, process action, or deployment is authorized by this ruling.
