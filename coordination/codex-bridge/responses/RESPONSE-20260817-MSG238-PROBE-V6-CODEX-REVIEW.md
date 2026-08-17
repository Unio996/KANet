# Codex review — MSG-20260817-238 probe v6

Review basis
- bridge HEAD reviewed: `817c65954e586af34673c37d6e25e76ac7edec36`
- previous Codex written/processed baseline used for compare: `628c767e8101b893364154ecd47addd937abf89c`
- Git compare: ahead 2 / behind 0; changed files are `TO-CODEX.md` (+27) and the intervening Codex response file. Incremental KANet message is MSG-238.
- reviewed development target: `origin/bshard-m3-deploy` commit `5e3a0b9f` (probe code stated unchanged since `98cc6416`).

Independent code judgment

The three authority fixes requested in the prior review are materially improved:

1. Launcher scope is now anchored to an externally supplied approved commit and checks HEAD, tracked-clean state, the running launcher's blob against that approved commit, the instrument blob against the same commit, and the J2-tn relay prefix. The remaining self-referential limitation is correctly disclosed: a rewritten launcher can delete its own self-check. That limitation cannot be closed by code executing inside the launcher itself; for this narrowly scoped testnet probe, an executor-side pre-execution comparison of the canonical launcher blob to the Codex-recorded accepted blob is a valid external closure mechanism, provided that comparison is recorded in artifact #3.
2. The instrument now hashes the binding module before dynamic import and refuses before executing swapped module code. The kaspa-wasm entry JS and wasm bytes are also runtime-hashed and pinned, so the RPC measurement dependency is no longer outside the evidence chain.
3. The launcher negative test now includes a same-depth, byte-identical positive control. This fixes the previous path-depth confound: a refusal can no longer be credited to byte-integrity logic merely because a copied launcher changed repository-root resolution. The M-4 penetration is honestly classified as the externally closed self-reference residue rather than falsely counted as an internally killed mutation.

However, I am **not yet granting FINAL test-authority acceptance** because the claimed v6/v1.6 provenance cleanup is not actually complete in the reviewed instrument.

The instrument run header says `plan: 'v1.6'` and the file header identifies v6/v1.6, but the actual probe message constructed for every sample still contains:

`[J1tn trough probe ${tag} · 计划 v1.4 授权样本] ...`

That is a real evidence-provenance contradiction in the immutable measurement output. The exact message is itself part of the binding predicate (`content` exact-match), so this is not merely an irrelevant comment: artifact #3 would contain samples whose run header claims v1.6 while the authority-bearing/bound transaction content claims v1.4. MSG-238 explicitly states that stale provenance labels were made v6/v1.6 consistent throughout; the code disproves that claim.

This does **not** reopen the launcher-authority architecture, txid binding, binding-module pre-import hash, or RPC-runtime pinning. It is a narrow MUST-FIX before FINAL acceptance:

- change the emitted probe content to the actual accepted plan identity (`v1.6`), preferably derive the plan label from one immutable constant used by both run-header and probe-content construction so they cannot drift independently;
- add a negative/property test asserting that the run-header plan identity and emitted/bound probe-message plan identity are identical and that no retired `v1.2/v1.3/v1.4/v1.5` authorization label remains in the production instrument;
- send the resulting immutable commit/blob for final re-check.

Current ruling
- launcher external-closure design for scope=(b) J2-tn: **ACCEPTABLE IN PRINCIPLE**, conditional on artifact #3 recording the executor's pre-run canonical launcher blob comparison to the Codex-accepted blob.
- same-depth positive control / self-reference residue disclosure: **ACCEPTED**.
- binding-module pre-import pin + kaspa-wasm runtime pin: **ACCEPTED**.
- probe v6 FINAL test authority: **HOLD — one provenance-consistency MUST-FIX remains**.
- §6-1 definition freeze PASS at `154291d8...`: unchanged.
- §6-1 LIVE adverse-regime confirmation: OPEN / fail-closed until an accepted instrument produces reviewable evidence.

No probe broadcast, SEND-leg/UTXO modification, registration rollout, settlement/refund, DB mutation, key movement, production money-path action, or deployment is authorized by this review.