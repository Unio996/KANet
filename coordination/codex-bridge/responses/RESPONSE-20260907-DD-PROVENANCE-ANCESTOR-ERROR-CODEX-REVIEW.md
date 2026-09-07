# Codex review — D-d provenance now directly inspectable; relaxed ancestor-error path is not fail-closed

- canonical baseline checked: `fdba788a85f360c8df8d9d776d77ea3925689d72`
- active branch checkpoint: `dfdff83c914f85c29a4024cfbedf37a9ac7cd4f3`
- active branch reviewed through: `5a68c7c9785f23ab934cf0a69e7cde999d03d73c`
- relevant provenance commit: `5a68c7c9785f23ab934cf0a69e7cde999d03d73c`
- reviewed patch blob: `feb9cafdb636c87b04b63df6fd2632bdfc9050f0`

## New evidence

The previously missing D-d provenance is now committed under `docs/provenance/2026-09-07-kaspad-dd-syncer-pp-lag-tolerance/`, including `patch.diff`, build logs and manifest. This allows direct code-level review of the D-d classifier rather than relying on team summaries.

Runtime evidence in the new commits also upgrades the incident-recovery result: `tolerance=0` accepted the lagging syncer and the first IBD round later reached `completed successfully`, processing 119,483 blocks. That supports **incident recovery effectiveness** of the deployed value for this episode. It does not by itself establish that unlimited tolerance is an acceptable permanent setting.

## Code-level defect / semantic mismatch

The relaxed-mode ancestor gate is not actually fail-closed on ancestor-query error.

In `flow.rs`, relaxed modes compute:

```rust
consensus.async_is_chain_ancestor_of(syncer_pruning_point, pruning_point).await.ok()
```

so any query error becomes `None`.

But `classify_syncer_skew()` then accepts a past-table member when the ancestor result is either `Some(true)` **or `None`**:

```rust
(Some(p), Some(true) | None) => Some(...Lagging...)
```

and the unit test explicitly requires this behavior:

```rust
// relaxed + ancestor call errored (header pruned) -> fall back to table membership -> Lagging(9)
let v = classify_syncer_skew(&inputs(far, false, None, 16)).unwrap();
```

This conflicts with nearby design language that says the relaxed-mode chain-ancestor gate “must hold” and that the extension is fail-closed. For any lag outside the upstream `<4` window, an inability to prove ancestry is currently treated as permission if the hash appears in the local past-pruning-point table.

### Codex ruling

- upstream/default tolerance=4 semantics preservation: **SUPPORTED**
- bounded/unlimited relaxed table-member acceptance when ancestry is positively `Some(true)`: **REVIEWABLE / SUPPORTED IN PRINCIPLE**
- relaxed acceptance when ancestry check returns error/`None`: **HOLD — not fail-closed**
- `tolerance=0` incident recovery effectiveness: **SUPPORTED for this incident**
- `tolerance=0` permanent/default acceptance: **HOLD**

A safer invariant is: for any candidate outside the original upstream window, acceptance requires a **positively proven** relation, not an unknown one. `Err -> None` should reject, or the code should use a separate explicit proof source with clearly documented safety semantics. If pruned headers make the ancestry query unavailable, that is an evidence-availability problem to solve explicitly; it should not silently collapse into acceptance.

At minimum add negative tests asserting that a beyond-upstream table member with `ancestor=None` is rejected for both bounded relaxed mode and unlimited mode. Keep the upstream `<4` compatibility path unchanged.

## Operational boundary

The successful 119,483-block IBD closes the earlier “intake only” evidence gap for this run, but it does not close long-run D-d safety or resource stability. In particular, the current unlimited setting has a wider acceptance surface than the observed lag-28 requirement and now has the error-to-accept behavior above.

No production payout, settlement/refund selector switch, signing/broadcast, money-state DB mutation, key movement, D-c activation or further D-d deployment is authorized by this review.
