# Codex review — unsynced D-012 A2 spec/code drift

## Git/bridge baseline

- Reviewed bridge HEAD: `0f534d72671465eefa3867015a2442bf33c082bc`.
- Previous processed/written-back baseline: same SHA.
- Git compare: identical; ahead 0 / behind 0 / total commits 0 / changed files 0.
- Canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `873d23ba6e18ef16c08e3e8b7c42fd15a771b80e`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No file-internal timestamp was used for increment detection.

## Unsynced active-branch increment

`bshard-m3-deploy` advanced from prior reviewed checkpoint `d6d3ced17462b0da00a2eed6a4983a514c9aa702` to `5e4db049c3d415df06621ab3ac23b0692b93748d` (ahead 1). The new ledger entry (333) says D-012 §6-1 A2 is technically ready after code review of `u1-same-origin.mjs`, and that the sole critical-path blocker is Owner physical-host procurement.

## Independent code/spec ruling

That readiness statement is **too strong**. The landed checker at `52a95a6933c862eb0db7875b25f6f67062c4387c` is still the original Batch A-1 / v1.0-era pure judgement module. Its own commit explicitly says no schema, spawn path, keys, or chain, and the file history shows no later commit to `kasia-console/src/lib/u1-same-origin.mjs`.

The normative spec was subsequently amended after that code landed:

1. `f803496e6ebc59a0f2132088df7d459634018132` added **N8 proof-of-possession**: registration must bind `root_fingerprint + identity_index + relay_id + one-time challenge`, and verification must use the claimed identity pubkey. This is load-bearing because root xpub + non-hardened derived pubkey are copyable public data; without PoP, a caller can copy another domain's root/pubkey pair and create a structurally valid but unauthoritative registration.
2. `d7814f1c67e92ef809a5ce7348810e7743306e22` added **N4-bis**: `custody` must be derived server-side from `relay_nodes` (`mnemonic_encrypted` present AND `privkey_encrypted` absent), and any caller-supplied custody field must not be read.
3. `12b8c1842b185270c674f8ddf52456e29c8fdb97` further strengthened N5 mutual exclusion rationale.

The current `u1-same-origin.mjs` still accepts `reg.custody` as an input to `checkRegistryInvariants()` and only checks whether the supplied string equals `mnemonic`; it has no server-derived custody lookup. It also contains no N8 challenge/PoP verification path. Its header still names v1.0-rc, while the current normative file identifies itself as v1.2-rc.

Therefore:

- **A2 pure same-origin judgement core (`rootFingerprint`, registration derivation binding, SAME_ORIGIN vs NOT_DECIDABLE, N3 same-root multiplicity): ACCEPTED as useful Batch A-1 code.**
- **A2 as the current v1.2 normative registration/invariant gate: NOT COMPLETE.**
- **N8 PoP: OPEN / MUST IMPLEMENT AND TEST.**
- **N4-bis server-derived custody: OPEN / MUST IMPLEMENT AND TEST.**
- **Any statement that "A2 technically ready" or "sole blocker = physical host" is premature unless it is explicitly scoped to the old Batch A-1 checker only.**

At minimum, closure evidence must show the current v1.2 authority chain in executable production-seam tests: caller cannot manufacture custody by declaration; copied root/pubkey without possession fails; challenge is single-use/expired fail-closed; signature is verified against the claimed identity pubkey; and registration data consumed by the checker comes from the server-authenticated record rather than caller-selected values.

This does **not** authorize production key movement, registration rollout, process changes, deployment, settlement/refund, signing/broadcast, or any other production funds-path action.