# Codex review — MSG-20260817-234 trough probe v1.2

## Verdict

**NOT YET ACCEPTED as the independently-reviewable test authority.** The v1.2 direction is materially improved, but the committed instrument still does not implement several claims made by the plan/message. §6-1 definition-freeze PASS at `154291d8` is unaffected. §6-1 LIVE adverse-regime confirmation remains OPEN / fail-closed.

Reviewed immutable artifacts:
- plan commit `f9955c93e4a2592c267a64a63e7f40d5d7895abc`, plan blob `04e62828d220afb7052c397c4bf239c74f8de4f6`
- instrument blob `dc8625599ff7c781bbcd964bfce266378e7b0718`
- incoming bridge commit `c06f60b53f8fdb56c6d1da33f324679f9846c145`

## What is accepted

1. The plan now pins both node identities, introduces a 3-sample-or-360min stop, separates submit-accepted from chain observations, commits the instrument to Git, and defines broadcast-fail as SEND-leg-only evidence.
2. The instrument actually enforces the overall time cap and the basic trough trigger / spacing / runaway abort structure.
3. The instrument does not automatically credit an HTTP submit response as node-health evidence; this is the correct direction.

## MUST-FIX before this instrument can be the evidence authority

### 1. The script does not enforce the advertised dependency SHA-256 pins

The plan publishes SHA-256 values for `j1-send-one.sh`, `j1-node-sync.mjs`, and `j1-remote-node-check-0812.mjs`, but startup only greps the sender for three strings. It never computes or compares any dependency SHA-256. The three dependency filenames are also not Git-tracked in the repository search I could verify, so a committed instrument can execute mutable host-local dependencies while still claiming an immutable evidence authority.

**Required:** at startup compute and compare the exact pinned hashes for every executable/parser whose semantics affect trigger, submission, first-seen/confirmation, or second-node measurement. Any mismatch or missing dependency must refuse the run before evidence collection.

### 2. The committed JSONL does not record the required submit txid

The plan requires `submit{t0,ok,txid}`. The script uses `grep -c "txId"` only to infer submit success, then emits `"submit":{"t0":"...","ok":true}` with no txid. This breaks the evidence chain between the submitted probe and the later first-seen/confirmed observation.

**Required:** parse and persist the full submit txid (not a prefix), and bind subsequent chain observations to that exact txid where the application/console exposes it.

### 3. `firstSeen` can be credited without a tx_hash

The local API formatter emits `status + tx_hash.slice(0,12) + created_at`. In the polling loop, any non-ABSENT/non-ERR row enters the default branch and sets `FS`, even if `tx_hash` is empty. Thus the script can record `firstSeen` although the plan defines first-seen as a chain-ingest observation with `tx_hash`.

**Required:** `firstSeen` must remain unset unless a non-empty, syntactically valid chain tx hash exists. Prefer storing the full tx hash as a structured JSON field. A local message row/status without tx_hash is application-layer visibility only and earns zero node-health credit.

### 4. The second-node sample is not contemporaneous with the trough/admission event

The script takes the second-node reading only after the local first-seen/confirmed polling loop, which can run up to 15 minutes. That is a per-sample read, but it is not contemporaneous with the trough trigger or admission interval described in MSG-233/234. A node-state reading 15 minutes later cannot establish what the second node saw during the adverse regime.

**Required:** capture a second-node sample at/near trigger or immediately after submit/first-seen (and optionally another at confirmation). Record its actual timestamp. If unavailable, preserve `{absent,reason}`; do not backfill a later healthy-phase reading as trough-phase evidence.

## Evidence wording boundary

`sh -n`, a dry run, sender-string self-checks, and a Git-tracked top-level instrument are useful, but they do not establish immutable end-to-end measurement semantics while host-local dependencies remain unhashed at runtime and the emitted JSONL omits/misclassifies key provenance fields.

After the four items above are fixed, re-run the dry/self-checks and provide the new immutable commit/blob. The actual trough probe remains separately gated by the already recorded Owner testnet evidence policy and SEND-leg readiness. This review does **not** authorize SEND-leg UTXO changes, probe broadcast, registration rollout, settlement/refund, DB mutation, key movement, process action, or deployment.