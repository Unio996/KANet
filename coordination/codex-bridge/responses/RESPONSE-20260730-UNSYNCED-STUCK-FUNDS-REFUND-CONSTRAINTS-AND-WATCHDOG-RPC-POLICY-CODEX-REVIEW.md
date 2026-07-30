# Codex independent review — unsynced stuck-funds/refund constraints and watchdog RPC policy

## Git/Blob inspection basis

- Last processed / written-back bridge commit: `2cd2d007f7d86a7caac2b6249e89f65df0fc299e`.
- Initial `coord/codex-bridge` compare against that commit: `identical`, ahead `0`, behind `0`; no canonical bridge file diff existed.
- Canonical bridge blobs at inspection:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Increment detection used Git commit comparison and blob identity only; no in-file timestamp was used.
- Last active-branch source commit already covered by the prior compiler review: `99b13fb2618722a103cd267cd2ff353111542bb5`.
- Current active branch `bshard-m3-deploy` HEAD at final inspection: `79aa01697db31ff27ca2089990bb9f4f6c6147e0`.
- Active compare `99b13fb...` → `bshard-m3-deploy`: ahead `5`, behind `0`; changed paths:
  - `docs/iteration/COORD-LEDGER.md` `+47/-0`
  - `docs/iteration/HANDOFF-NOW.md` `+116/-0`
  - `scripts/kaspad-rpc-probe.mjs` `+102/-0`, blob `18bef3148083e65c9049c751c15d0912ae38c4cc`
  - `scripts/kaspad-watchdog.ps1` `+49/-14`, blob `50c5e097f4b2c55ebff173968c46e7ecfe99a7e9`
- Independently inspected source blobs:
  - `PoolSpine_v07.sil`: `9f41f270ebea456230d76b1184eedfae10cdaa4a`
  - `PoolSide_v07.sil`: `05737141c595d086f2e1301d19c797017c405037`

## Verdict

`STUCK_FUNDS_RECOVERABILITY_REMAINS_HOST_REPORTED__REFUND_CONSTRUCTION_HAZARDS_CODE_CONFIRMED__255_07_KAS_AGGREGATE_REQUIRES_IMMUTABLE_ROWSET_PROOF__RPC_PROBE_DIRECTION_ACCEPTED__WATCHDOG_ACTION_POLICY_STILL_COLLAPSES_DISTINCT_FAILURES__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. The reported 137-address / 33,735 KAS condition is material, but the aggregate remains host-reported

The handoff now reports that `pruned_expired_waived` markets still hold funds, that maker and bettor keys are locally available, and that no recorded refund/settle transaction exists. That is a major state change and deserves a dedicated recovery design.

Codex cannot independently attest the live row set, address derivation, key possession, current UTXOs, or the totals from repository text alone. Before any recovery design is accepted, publish an immutable evidence package containing the exact 137-address deduplicated set, market IDs, protocol versions, source rows/hash, address derivation inputs, RPC responses with tip identity, UTXO values, and the reconciliation from 13,670 maker-side plus 20,065 bettor-side to 33,735 KAS. Key material must not be included.

### 2. The three transaction-construction hazards are confirmed in the repository source

`PoolSide_v07.settled_via_spine()` only requires `tx.inputs.length >= 2`; it places no output/value constraint. Therefore including a side UTXO in a maker-refund transaction can satisfy that side branch while the maker branch constrains the sole output, leaving the side value as miner fee. This is a real silent-loss path.

`PoolSide_v07.refund_market_cancelled()` computes its allowed output range from `tx.inputs[0].value`. Therefore the side covenant UTXO must be input 0; an appended fee input must not precede it.

`PoolSpine_v07.refund_maker_unjoined()` constrains the only output against the constructor constant `makerStakeAmount`, not against actual total input value. Any current spine UTXO value above `makerStakeAmount` cannot be returned by that entrypoint and becomes fee. The entrypoint name is also non-authoritative: the covenant checks maker signature and `deadline + 7200`, but does not test whether bettors joined.

These are code-level findings, not merely restatements of the handoff.

### 3. The reported 255.07 KAS unavoidable burn is plausible but not independently closed

The source proves the per-UTXO upper bound `makerStakeAmount - 50,000 sompi`. It does not, by itself, prove the aggregate `255.07 KAS` figure. That number depends on the exact deduplicated 137-address set, each current UTXO value, and each baked `makerStakeAmount`.

Require a machine-checkable manifest with one row per unique spine address:

`market_ids | address | deployed_redeem_hash | current_utxo_value | makerStakeAmount | max_refund_output | unavoidable_delta`

The sum of `current_utxo_value` must equal 13,670 KAS, the sum of `max_refund_output` must equal 13,414.93 KAS, and the delta must equal 255.07 KAS. The deployed redeem/script bytes, not merely current source, must be used to verify the entrypoint constraints before any transaction construction.

### 4. Recovery must be split into separate transaction families and separately authorized

At minimum, use two independently reviewed builders:

- maker-spine refund: spine covenant input plus only fee inputs needed by that builder, exactly one maker output, with explicit calculation of unavoidable covenant-bounded loss;
- bettor-side refund: exactly one side covenant as input 0, optional fee inputs only after it, exactly one bettor output.

Every proposed transaction needs an unsigned proof package: complete ordered inputs, prevout values/scripts, selected entrypoint, outputs, exact fee, conservation equation, expected script path, deterministic transaction skeleton hash, and negative tests that deliberately swap input order or mix side and spine UTXOs and prove rejection by the off-chain safety gate. No signing, relay, broadcast, or live DB mutation is authorized by this review.

### 5. The RPC probe is a substantial improvement over CommandLine matching

The new probe checks `getBlockDagInfo().network === 'testnet-12'`, requires a positive `virtualDaaScore`, applies bounded timeouts, and emits distinct exit codes for wrong network, empty data, timeout, connection failure, dependency failure, and generic probe failure. This correctly fixes the prior conflation of process observability with node identity/liveness.

### 6. The watchdog still discards those distinctions at the action boundary

Although the probe emits distinct failure classes, `kaspad-watchdog.ps1` increments the same counter for every nonzero code and starts another kaspad after three failures for all of them.

That policy is unsafe or ineffective for several classes:

- code `6` dependency missing and code `-1` probe invocation error mean the observer is broken, not that the node is absent; starting kaspad is unjustified;
- code `2` wrong network means an RPC service is present on the endpoint; starting another instance will normally collide with the occupied port and/or data directory and does not restore identity;
- code `3` empty/invalid data means the node answered but is unhealthy or the response contract changed; a second process is not a demonstrated remedy;
- code `4` timeout may represent a live but wedged target; the current only-start-never-kill policy cannot replace it, so repeated start attempts merely create collision noise;
- only code `5` connection refusal is reasonably close to “target absent”, and even there endpoint occupation, process startup state, and data-directory ownership should be checked before launching.

The stated safety claim that a false positive is harmless because the new process will merely hit the data-directory lock is too weak: it repeatedly archives/renames logs, generates failing processes, obscures the primary incident, and may behave differently if the lock or endpoint assumptions change.

### 7. Required action matrix before loading the new watchdog

The PowerShell layer should preserve the probe taxonomy and apply an explicit matrix:

- `ALIVE`: reset counters;
- `CONNECT_FAIL`: after threshold, verify target process/port absence and then start once with cooldown;
- `WRONG_NETWORK`: alert and stop automatic action;
- `EMPTY_DATA` / `TIMEOUT`: preserve evidence and alert; use a separately authorized recovery policy, not blind parallel start;
- `PROBE_DEPENDENCY_FAIL` / `PROBE_INVOKE_ERROR`: alert that watchdog observability is broken; never start kaspad;
- after any start, retain a persistent attempt/epoch record and do not reset to zero unless readiness is confirmed or a defined cooldown begins.

Also add tests for every exit code and prove the PowerShell action chosen for each. The current commit should not be loaded merely because the probe itself is better.

## Authorization boundary

This review does not authorize constructing, signing, broadcasting, refunding, settling, migrating, restarting, deploying, loading the watchdog, changing node bind state, or moving production/test assets. The stuck-funds recovery and any watchdog recovery action remain subject to the existing design → red-team → code → diff → isolated evidence → explicit authority chain.