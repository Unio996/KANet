# Codex review — unsynced TN12 cross-node evidence scope

## Scope / Git basis

Bridge basis checked first, using Git objects only:

- prior processed/written bridge commit: `26b9ec14ee04b0f271350ce788f92c020049dae6`
- current `coord/codex-bridge` HEAD before this write: `26b9ec14ee04b0f271350ce788f92c020049dae6`
- Git compare: identical; ahead `0`, behind `0`; canonical-file diff empty
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because bridge had no increment, active `bshard-m3-deploy` was compared from last reviewed `a3bcb47b638489908bad184ff849d9ab6b4d6d91` to current `d0e0e83cc56b409ddb554df8715f40e484a2bc44`: ahead `2`, behind `0`.

Relevant new commits:

- `cbc7731f6ab8db0616ad9997e4b70f9e98d3ac0e` — adds TN12 cross-node confirmation note
- `d0e0e83cc56b409ddb554df8715f40e484a2bc44` — ST-05 v0.2, largely independently re-confirms prior Codex review

TN12 note blob: `4e1dc2018130e3146f7620a464c1245bb99099e6`.

No file-internal timestamp was used for incremental detection.

## ST-05 v0.2

The v0.2 downgrade of `dispute_reveal` from `PROTOCOL_CAPABILITY` to `NOT_PROVEN` is accepted. The new commit independently re-reads the v06/v07 source and reaches the same four mechanical blockers already recorded by Codex: dispute fact unbound, committee identity unbound, no post-settlement continuation, and unconstrained outputs/slashing. Its extra statement that an unused entrypoint witness parameter may be optimized away is correctly kept as unmeasured inference rather than evidence, so no further objection is raised here.

## TN12 cross-node note — narrow observations accepted

The following are useful observations **if the reported runtime reads are accurate**:

1. Two distinct machines/appdirs reported `isSynced=false` and the same frozen `virtualDaaScore` / block-count state over the observed interval.
2. Both reportedly continued receiving blocks/tips while virtual progression remained frozen.
3. The current relay send path does in fact fail closed when `rpc.getServerInfo().isSynced` is false: `_sendKaspaInner()` throws `RPC node is not synced` before UTXO selection/build/broadcast. Keeping that guard is correct; this review does not authorize weakening it.
4. A second machine showing the same symptom materially weakens the hypothesis that **J1tn's machine alone** has a unique appdir/storage defect. It is reasonable to remove “reinstall this one machine because this one machine alone is corrupt” as the leading justification.

## RED: the two machines are not independent at the upstream-input layer

The note calls the second machine “independent evidence”, but also states that **both nodes peer with the same external pair** (`86.48.24.208` / `152.53.236.224`). That creates a common upstream failure domain.

Therefore the experiment gives:

> independent hosts/appdirs + correlated peer inputs

not:

> independent hosts/appdirs + independent network observations

This is enough to weaken a **single-host-specific** corruption hypothesis. It is **not** enough to prove that the causal fault is outside local storage in the general sense. Two nodes can converge to the same frozen state because they consume the same stalled/partitioned/bad upstream view; correlated upstream inputs are precisely the variable that was not separated.

The note itself later admits that it cannot distinguish “the two peers are broken” from “the reachable TN12 region is broken”. That caveat must also constrain the stronger §0/§4 wording.

Required wording change:

- acceptable: “the second host reproduces the symptom, so a defect unique to J1tn's appdir is not supported by this test”
- not established: “the problem is not in any local storage”
- not established: “repair is not on the single-machine side” as a causal fact; only the **original unique-local-corruption rationale** for reinstall is weakened

The §4 one-line rule — “same frozen virtualDaaScore on two independent machines ⇒ problem is not in either local storage” — should not become a reusable invariant in its current form.

## RED: “channel is dead for the whole team / nobody can broadcast” exceeds instrument reach

The note measures two console DBs and two nodes, then concludes:

> all team nodes are unsynced, therefore all relay broadcasts are blocked and no new message can be produced

The code-level second half is valid **per measured relay**: a relay using the current `sendKaspa` path on an `isSynced=false` RPC fails before broadcast.

But the first half is not established by two measurements unless there is separately versioned evidence proving that these two nodes/relays are the exhaustive set of all writers for `dev-coord-testnet`. The document does not provide that topology proof.

So the strongest evidence-supported statement is:

> both measured channel participants stopped at the same message and both measured RPC nodes were unsynced; any writer routed through either measured relay cannot broadcast through the normal `sendKaspa` path while that state persists.

It is not yet evidence for:

> every team writer / every relay / the whole channel has no possible broadcaster.

If the architecture truly has exactly two authoritative channel writers, commit the mapping/topology evidence and bind it to the incident note. Otherwise downgrade “全队” to “两台被测节点/经这两台 relay 的参与方”.

## Evidence-grade problem: the runtime proof is not repository-replayable

The TN12 note explicitly says its probe lives under gitignored `scratch/` and may disappear. The raw RPC outputs, peer-table outputs, console-query outputs, log excerpts, input identities and digests used to support the numeric claims are also not committed as an evidence artifact.

Consequently:

- relay `isSynced` guard semantics: **CODE-LEVEL CONFIRMED**
- the cross-host reasoning limitation above: **CODE-LEVEL / EXPERIMENT-DESIGN CONFIRMED**
- the reported live values and “~15 hours”: **OBSERVED, NOT INDEPENDENTLY REPLAYABLE FROM REPO**
- “both hosts showed same frozen state”: useful operational observation, but not institutional `VERIFIED` evidence until the probe + captured outputs/digests are versioned

For a durable incident corpus, add a small versioned probe (or exact source blob), raw/sanitized outputs from both hosts, node/build/network identity, peer-set capture, query/log capture, and digests. A self-check command pointing to a gitignored script is not a reproducibility package.

## Minimum next discriminator

Do not reinstall or weaken safety gates on the basis of this review. The highest-information next diagnostic is a **third observation with an independent upstream peer set** (or a controlled peer-set perturbation that leaves local storage unchanged). That is what separates host/appdir effects from the shared-upstream failure domain.

For the channel-wide claim, separately establish the writer/relay topology: enumerate all legitimate `dev-coord-testnet` broadcast paths and show whether each is currently bound to one of the two measured unsynced RPCs.

## Decision

- ST-05 v0.2 correction: **ACCEPTED**
- TN12: second-host reproduction materially weakens **unique J1tn-appdir corruption** hypothesis: **ACCEPTED (narrow)**
- TN12: “two nodes prove no local-storage cause”: **OVERSTATED / NOT PROVEN**
- TN12: “channel dead for entire team / nobody can broadcast”: **NOT PROVEN without exhaustive writer/relay topology evidence**
- current relay `isSynced=false` send guard: **CODE-LEVEL CONFIRMED; do not weaken**
- runtime numerical incident evidence: **OBSERVED / NOT YET REPOSITORY-REPLAYABLE**

No production transaction, DB mutation, reinstall, restart, key movement, signer/broadcaster change, settlement/refund, deployment, or money-path authorization is granted by this review.
