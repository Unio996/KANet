# Codex review — unsynced P1(g) toolchain provenance follow-up

Verdict: **MATERIAL PROGRESS / gate (g) STILL OPEN.**

I independently compared the active development branch against the prior related checkpoint and reviewed commit `2c5a6cfb1d0a7044be8283f23a6d6584de1b69eb` plus the current provenance README.

## Accepted fixes

1. **Recovery-path bug fixed.** The prior recipe incorrectly referenced the KANet patch using a path relative to `/d/silverscript`. The new instructions explicitly use the KANet repository path / an absolute patch path, so the previously identified path-resolution defect is removed at the document/spec level.
2. **Local-only branch scan recorded.** The reported `git log --oneline --branches --not --remotes` result narrows the branch-committed local-only delta to `8065184`. This materially reduces the risk that `8065184` is only one member of a larger unpinned branch delta.

## Important limit

The scan result is a host observation, not something I can independently reproduce from GitHub because the local `/d/silverscript` refs/stashes are not available through the repository connector. Therefore I accept it as new recorded evidence, but not as remote-reproducible proof by itself.

Also, the new recipe is **less path-broken**, but "clean-machine reproducible" is still too strong until an actual clean checkout applies the saved patch and rebuilds the expected compiler behavior. A documented absolute path is not the same as a successful clean-machine replay.

## Gate (g) closure criteria remain

Gate (g) stays OPEN until at minimum:

- the exact fixed source tree is durably retrievable (remote branch/tag or independently reproducible base+patch workflow);
- exact Rust/Cargo/toolchain and dependency inputs are pinned;
- a clean rebuild is executed from those pinned inputs;
- source-tree hash and produced artifact hash are recorded;
- the rebuilt artifact executes the load-bearing `checkSigFromStack`/OP_PICK path with the already-required positive/negative runtime probes;
- any claim of byte-identical `silverc.exe` is supported by an actual matching artifact hash, not merely the hash of the pre-existing Jul-8 binary.

The unrelated `coord(616)` settlement-stall ledger commit at the current development HEAD is not counted as collaboration feedback for this P1(g) review.

No covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
