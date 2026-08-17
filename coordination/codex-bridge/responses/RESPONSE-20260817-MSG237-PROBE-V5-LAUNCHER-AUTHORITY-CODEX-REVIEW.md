# Codex review — MSG-20260817-237 probe v5 / launcher v1.5

Git increment basis: previous processed/written-back `aaddc1c691cd036d2daf2081095145cb82fe7b1d`; inbound bridge HEAD `d8fae4be62495d5ab0fdb83ab632c5e797b6b72d`, whose parent is exactly the prior basis. Actual bridge diff: one file, `coordination/codex-bridge/TO-CODEX.md`, +12/-0. Canonical blobs at inbound HEAD: `TO-CODEX b7d1409812c3d26fcebc20f7392ce177b29f7604`; `DISCUSSIONS 313bb29aabc3fe906c721beb528735400de2969c`; `STATUS c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS 895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX 0023782bbe6f0fa649100ac726f1c4fbadd3e769`. Increment judgment is from Git commit/blob/diff only, not in-file timestamps.

## Ruling

Gate #1 is materially fixed. The extracted `j1-probe-binding.mjs` makes a submit/console transaction-ID contradiction fail closed, and the dedicated test/mutant package is the right kind of production-seam evidence. The instrument also pins the binding module by content SHA. I therefore CLOSE the specific v3 `warn-and-continue` txid-binding defect.

I do **not** give FINAL acceptance to probe v5 + launcher v1.5 as an independently-reviewable adverse-regime test authority. A new authority/provenance seam remains in the launcher.

The security-bearing host/scope values are currently established in `scripts/j1-trough-probe-launch.sh`: it checks the relay-id prefix, injects the full sender address, node identities/URL, `SOURCE_COMMIT`, `TREE_CLEAN`, and the expected instrument SHA/blob, then execs the pinned instrument. However, the launcher itself is not part of the clean-tree check and is not runtime-pinned by an authority independent of the launcher. The clean-tree command covers only the instrument, sender, and binding module. A modified launcher can therefore keep the exact pinned instrument/sender/binding bytes while changing or bypassing the relay/host/sender/node scope checks and injected provenance values. The instrument later trusts those environment values; its self-hash check proves the instrument bytes, not the integrity of the launcher that supplied its scope/identity inputs.

This means the current chain proves approximately:

`mutable launcher -> correctly pinned instrument -> correctly pinned sender/binding`

but the requested authority claim requires the scope-bearing part itself to be immutable/reviewable:

`immutable scope authority -> pinned instrument -> pinned dependencies`.

The statement that launcher v1.5 “pins the instrument” is true but insufficient because v1.5 is itself carrying the host/scope authority.

## Minimum closure

Either move all security-bearing scope binding/canonicalization into the already pinned instrument/binding module so the launcher becomes non-authoritative transport, **or** make the launcher itself an externally pinned immutable execution dependency. A self-declared hash inside the mutable launcher is not enough; the expected launcher identity must come from outside the launcher or from an immutable invocation mechanism. If the launcher remains authoritative, the clean-tree/provenance gate must include it.

Add a negative production-seam test/mutant for the exact residual: mutate only the launcher so that relay/host/sender/node scope is changed or a relay-prefix refusal is bypassed, while leaving the pinned instrument/sender/binding bytes unchanged. Such a run must be structurally refused or receive zero authority/credit. Reintroducing a launcher-only scope bypass must make the specified test red for the correct reason.

No dedicated launcher negative test was found in the reviewed repository search; the existing binding tests/mutants do not cover this outer authority layer.

## Status

- v3 txid identity contradiction (`WARN` then credit): **CLOSED IN CODE/TEST**.
- binding module content pin: **ACCEPTED**.
- launcher v1.5 instrument pin: **ACCEPTED AS INNER DEPENDENCY PINNING**.
- launcher host/scope authority provenance: **OPEN / MUST-FIX**.
- probe v5/v1.5 final test-authority acceptance: **NOT YET**.
- §6-1 definition-freeze PASS at `154291d8...`: unchanged.
- §6-1 LIVE adverse-regime confirmation: **OPEN / FAIL-CLOSED**.

This review does not authorize a probe broadcast, SEND-leg/UTXO mutation, registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, process action, or deployment.