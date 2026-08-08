# Codex independent review — TN12 receiver sentinel / probe / node-start contract

## Scope and Git basis

Bridge branch checked first at HEAD `8310dfb9efedb1112185e02b22a32ce6a53a4775`, compared against the last processed/written-back commit `8310dfb9efedb1112185e02b22a32ce6a53a4775`: identical, ahead 0, behind 0, no changed files.

Canonical bridge blobs at that HEAD:
- `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because bridge had no increment, active `bshard-m3-deploy` was compared from last reviewed `5f047249436e72ad8a7a0a5097b0434f1d2069fe` to current `677211986ec18fb951721201d8d761c700076c02`: ahead 4 / behind 0. Relevant commits reviewed independently: `a497f24e0092df13376934b4d4327599bde6b40e`, `6ee87683b30bc585449319a65ef56e91613303a8`, `d04c256c1fd1e707d03d07387e77738fb8e42eeb`, `677211986ec18fb951721201d8d761c700076c02`.

## Finding 1 — watchdog round-8 recovery is a real improvement, but residual compound failure remains explicit

`a497f24e...` correctly stops deleting ownership metadata after a failed abort-kill and attempts to preserve the in-memory `{pid, commandLine, startTimeTicks}` via `Write-BestEffortOwnershipRecord`. This materially improves invariant (2): a miner started by the breaker has a chance to remain targetable after write+kill compound failure.

However the code itself correctly admits that if the best-effort recovery write also fails, the orphan remains without ownership record. Therefore this is an accepted reduction of risk, not a proof that the ownership invariant is now absolute. Do not relabel the watchdog as fully closed solely on this patch; the residual should remain an explicit emergency/manual-reconciliation state.

Verdict: **ACCEPTED improvement; residual triple-failure remains known and bounded, not CLOSED as an absolute invariant.**

## Finding 2 — `tn12-node-start.ps1` has a role/default contradiction that can silently change the miner topology

The new launcher says the receiver should dial the teammate/miner over Tailscale and that the miner does **not** need a symmetric `--addpeer`. But the actual parameter default is global:

`[string[]] $AddPeer = @('100.99.147.101:16311')`

and the implementation appends every `$AddPeer` for **both** roles before only conditionally adding `--enable-unsynced-mining` for `Role=miner`.

Therefore a normal invocation with `-Role miner` and no explicit `-AddPeer @()` still gets the receiver-oriented Tailscale peer. The code does not implement the role contract described in the same file.

This matters because the launcher is being promoted as the committed single source of truth for load-bearing flags. A single-source launcher must not require operators to remember an undocumented negative override to obtain the topology the comments claim is canonical.

MUST-FIX: make peer defaults role-specific, e.g. receiver default contains the teammate Tailscale peer while miner default is empty unless explicitly configured. Better: freeze an explicit role config object and print/assert the resulting effective topology before launch.

Verdict: **RED / MUST-FIX before treating `tn12-node-start.ps1` as canonical launch contract.**

## Finding 3 — `starved` diagnosis currently claims a temporal fact without measuring progress over time

`6ee87683...` / `d04c256c...` split health into `runaway`, `catching-up`, `starved`, `behind`, `healthy`. Distinguishing runaway from receiver starvation is correct and operationally important. The absolute sink timestamp is also better than comparing two potentially co-stalled nodes.

But current `diagnose()` defines `starved` as essentially:

- lag above threshold;
- `headerMinusBlock < IBD_GAP`;
- not runaway.

That does **not** prove the node is being starved or making zero progress. A receiver can be far behind, have little/no header-vs-block gap, and still be advancing continuously but slightly slower than network production. The incident narrative's decisive evidence was temporal: four hours of zero progress. The function currently has no previous DAA/block/sink sample and no progress window.

The new `catching-up` branch fixes one false positive shape (headers visibly ahead), but it does not close the general ambiguity between `actively-processing-but-lagged` and `peer-starved/no-progress`.

Because the sentinel is alert-only, this is not a destructive-action bug, but it is a semantic/operational false-alarm bug and should be fixed before `starved` is treated as a proven diagnosis. Require progress evidence across two or more polls: e.g. sink timestamp/virtual DAA/blockCount delta over a bounded observation window, with `starved` only when lag is high **and** progress rate is approximately zero (or materially below a frozen threshold) while not in a known IBD state.

Verdict: **two-mode model ACCEPTED; `starved` label is currently OVERCLAIMED / MUST-FIX diagnostic semantics.**

## Finding 4 — receiver sentinel architecture is sound, but recovery branch remains unverified

`677211986...` correctly avoids automatic remediation on the receiver, uses an out-of-band durable file path in addition to the Kaspa-carried channel path, serializes alert JSON without shell interpolation, and treats probe unreadability as visible rather than healthy. Edge-triggering is appropriate for alarm fatigue.

The commit explicitly says `RECOVERED` was not exercised. Keep that status as **NOT VERIFIED**. The shared `Write-Alert` path is not enough to convert an unexecuted state transition into verified behavior.

Verdict: **sentinel architecture ACCEPTED IN PRINCIPLE; RECOVERED transition NOT VERIFIED; probe classification fix above is prerequisite to trusting `starved` alerts.**

## Net decision

- Watchdog round-8 provenance preservation: ACCEPTED improvement, residual triple-failure explicitly remains.
- Receiver/miner launch script: **RED** until role-specific peer defaults match the declared topology contract.
- Probe: split failure modes is correct, but `starved` must become temporal/progress-based rather than inferred from lag+header gap alone.
- Sentinel: alert-only dual-path design accepted; recovery transition not yet verified.

No authorization is given here for mainnet, production funds, key movement, signer/broadcaster changes, settlement/refund, production DB mutation, or deployment of a production money path.
