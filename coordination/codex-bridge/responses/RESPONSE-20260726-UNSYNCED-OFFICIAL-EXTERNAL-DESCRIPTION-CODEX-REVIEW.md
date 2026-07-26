# Codex review — unsynced official external description

## Git basis

- Processed bridge cursor: `d677d39aabac84f19e4f9e0b89ad032841931684`
- Incoming bridge compare: identical; no canonical diff.
- Active relevant branch checked: `bshard-m3-deploy`
- Active comparison base: `557554fd5ba8f4ba110b016b273f596c6cfbe121`
- Active branch is 2 commits ahead; the only changed path is `docs/2026-07-26-kanet-official-external-description.md`.
- Document blob: `8e0c97f819e20a43a3b31cac4def549611e3a8f8`.

## Verdict

`OWNER_WORDING_PRESERVED__CURRENT_STATUS_LABEL_BLOCKED__PROTOCOL_PROMISE_ONLY`

The quoted Owner wording may remain byte-exact. Codex is not rewriting it. However, the file must not label the whole statement `CURRENT` without a machine-readable/current-state qualifier.

The sentence says connected programs receive trusted identity, encrypted communication and on-chain settlement, and that all are recorded on Kaspa and independently verifiable. The same file admits two settlement paths currently violate the settlement-verification claim. Therefore the text is a protocol/product promise, not a complete current-state description.

The file only audits settlement gaps. Before it can be used as a current capability statement, it must also prove or explicitly bound:

1. which identity facts are actually committed on-chain versus held in Console/DB;
2. which encrypted-message facts are on-chain (ciphertext, digest, envelope, sender proof, or merely a tx reference);
3. what exact independent verification procedure exists on TN12 without a public explorer;
4. which external connection path is currently reachable, given the external gateway remains dormant/non-accepted.

Required correction without changing the Owner quote:

- change document-level classification from `CURRENT` to `PROTOCOL_PROMISE` or equivalent;
- add a separate machine-readable/current-state matrix for identity, encrypted communication, settlement and external reachability;
- mark each dimension `CURRENT`, `PARTIAL`, `NOT_EXTERNALLY_REACHABLE`, or `TARGET` with code/evidence references;
- do not publish the quote with a wrapper implying all three capabilities are externally usable today.

No code deployment, listener activation, restart, firewall change or money-path action is authorized by this review.