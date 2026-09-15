# Codex review — proto-v0 Gate 3 v1 sig_op_count node rejection

Canonical bridge basis: `1ab61590af83cbde31784289d7af3f88cbbcdec0` (no bridge delta from prior Codex writeback; five canonical blobs unchanged).

Active-line evidence inspected independently: `bshard-m3-deploy` HEAD `03eb7f00c11650faa62b6b198291bc18ab0c86a5`, including Gate-3 abort evidence and current `kasia-console/src/lib/proto-tx-assembly.mjs` / relay fresh-sign path.

## Finding

**RED / MUST-FIX. Keep proto driver OFF and do not retry the prepared transaction.**

The current genesis builder constructs a transaction with `version: 1`, but its sole input is created with:

```js
signatureScript: sigScript,
sequence: 0n,
sigOpCount: 1,
computeBudget: 0,
```

That is an internally suspicious v0-style input shape for the v1 covenant transaction and directly matches the node rejection surface: `RpcTransactionInput.sig_op_count is inconsistent with transaction version 1`.

This is not merely a remote-node mystery. The repository already contains a prior v1/covenant incident (escape_trigger, July 2026) where the first protocol-layer correction was `sigOpCount=0 + computeBudget=70` before the transaction advanced to later validation. Therefore the first root-cause check should be the v1 input-field rule itself, not replay/network/RPC timing.

The current relay fresh path deserializes the console-provided tx, signs only declared inputs, finalizes it and submits it; it does not normalize this version/input-field combination. Thus a malformed v1 field choice produced by the console survives through signing to RPC. Offline tests that only deserialize/sign/finalize cannot establish node admissibility for this rule.

## Required closure before any Gate-3 retry

1. Read the exact rusty-kaspa version used by the production node and cite the validation/conversion rule for transaction version 1 `sig_op_count` / `compute_budget` (file + line or immutable source SHA).
2. Enumerate **all** proto-v0 v1 transaction constructors, not only market genesis, and prove their input field shapes obey that rule. Do not patch one call site while leaving register_append/continuations divergent.
3. Add a regression that fails on the current `version=1 + sigOpCount=1 + computeBudget=0` shape and passes only for the node-valid v1 shape. Prefer exercising the same RPC/domain conversion or consensus validation code as the node; a local wasm serialize/sign round-trip alone is insufficient.
4. Because these fields participate in transaction/sighash semantics, rebuild and re-sign from a newly constructed transaction after the fix. Do **not** mutate/replay the existing prepared signed bytes.
5. Preserve the current fail-closed state: driver OFF; existing `genesis_prepared` row retained/auditable until Owner chooses its terminal disposition. No deletion or production money-path action is authorized by this review.

## Independent scope judgment

The Gate-3 abort evidence is consistent with zero chain movement: rejection occurs at node RPC validation and the prepared transaction is reported absent from mempool with funding UTXOs unspent. I accept the stop/no-replay response as the correct safety action, but I do **not** accept a future retry until the exact v1 rule and every affected constructor are mechanically closed as above.
