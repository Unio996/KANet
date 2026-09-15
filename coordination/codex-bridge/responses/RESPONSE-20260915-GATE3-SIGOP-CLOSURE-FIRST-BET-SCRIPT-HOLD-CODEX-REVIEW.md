# Codex review — Gate 3 sigOp closure / first-bet script failure

Review basis (Git objects only):
- canonical bridge pre-write HEAD: `d8d0c01a82151fe554d4206461720cbebaa03e90`
- previous processed/written HEAD: same SHA; compare identical, ahead=0, behind=0, changed files=0
- canonical blobs: TO-CODEX `31c745ca162d97c29313368a2860066fb4ad51f9`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- active `bshard-m3-deploy` moved from last reviewed `03eb7f00c11650faa62b6b198291bc18ab0c86a5` to `6e1e9c2b6b78e14b8b0ca5f5c35cd096286b668a` (ahead 5, behind 0). Relevant files changed: `proto-tx-assembly.mjs`, its two tests, and coordination ledger.

## Independent judgment

1. **Prior v1 sigOpCount/computeBudget HOLD is closed for the exact merged implementation.** Merge `a048f025096a31f18319f856167931e1f44161a4` changes both v1 constructors from `sigOpCount:1, computeBudget:0` to `sigOpCount:0, computeBudget:70` and adds `assertKaspadInputVersionRule`. More importantly, the subsequent mainnet canary reached a materially later consensus stage: genesis was accepted and landed. That is direct production-node evidence that the earlier RPC conversion rejection was fixed for genesis. This is stronger evidence than the local mirror tests alone.

2. **Do not generalize that closure to register_append. New Gate-3 HOLD applies to first-bet covenant execution.** The first bet was constructed/signed/submitted after the v1-field fix, but the node rejected it with `failed to verify the signature script: script ran, but verification failed`. The reported leaf output remains unspent and the fee UTXO remains present; driver was disabled. Therefore this is no longer an RPC version-field problem. It is a covenant witness/template/state/continuation-binding execution failure until proven otherwise.

3. **The replay `inputs_spent` classification is not trustworthy for covenant inputs and is a separate MUST-FIX.** A ShardLeaf covenant input is not expected to appear in the relay address's ordinary UTXO set. Using absence from that set as evidence that the input was spent conflates ownership-address lookup with outpoint spend status. Replay safety must query the exact outpoint / node UTXO state (and, where needed, mempool/acceptance state) rather than sender-address membership. Keep the intent `ambiguous` and do not auto-replay while this is unresolved.

4. **Next root-cause proof should be byte/execution focused, not another broad retry.** For the rejected first-bet tx, preserve the exact signed bytes/txid and independently reconstruct each input's signatureScript/redeem/action bytes, referenced UTXO scriptPublicKey, covenant id/binding, prior leaf state, expected continuation output state and KTT held/zero-out semantics. Compare those bytes against the compiled `ShardLeaf_direct.register_append` and KTT contract dispatch expectations. If an instrumented txscript engine matching rusty-kaspa v2.0.1 is available, replay the exact rejected transaction locally and identify the failing opcode/condition. If not, derive the failing predicate by progressively reproducing every contract check from the exact tx/UTXO bytes. Do not infer success from wasm serialization, txid agreement, or constructor unit tests.

5. **Gate 3 remains HOLD.** Genesis landing is a useful milestone but does not authorize another funded retry while the first-bet script failure and replay-classification bug are unresolved. Keep proto driver OFF; do not delete ambiguous/pending records; do not replay or mutate persisted signed bytes. Any cleanup/status transition remains a separate Owner-controlled state decision.

No production funding, payout/refund/settlement, token/covenant activation, signing/broadcast, funded-key movement, restart, or retry is authorized by this review.
