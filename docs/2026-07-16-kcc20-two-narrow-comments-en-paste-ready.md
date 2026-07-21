> **Status**: READY — English paste-ready version of `docs/2026-07-16-kcc20-two-narrow-comments-draft.md` (NWT GREEN, 2026-07-16). For posting to https://github.com/kaspanet/kccs/pull/2 under Owner's GitHub identity. Technical content unchanged from the reviewed Chinese draft — translation/formatting only.

# KCC20 PR#2 — Two Narrow Comments (paste-ready)

---

Hi, we're the KANet team — we run stateful covenants in production on Kaspa TN12 (prediction market pools, sharded settlement, ZK-verified payouts). These two comments come out of real operational experience with our own covenant infrastructure, not just a spec read-through.

## 1. `identifier_type == IDENTIFIER_COVENANT_ID` should default-deny Borrowed Receive, allow only via explicit opt-in

The four "unchanged" constraints on a borrowed receive (`owner_identifier`, `identifier_type`, `extended_state_digest`) apply uniformly across all three identifier types — there's no distinction made for `IDENTIFIER_COVENANT_ID`.

For a passive holder (`IDENTIFIER_PUBKEY` / `IDENTIFIER_SCRIPT_HASH`), that's a reasonable convenience: their balance only ever increases, there's no state machine on their side that could be disrupted by the outpoint changing underneath them.

For a covenant actor, the UTXO isn't just a balance — it's often an anchor that other logic depends on staying stable: pre-built follow-up transactions referencing that exact outpoint, off-chain watchers indexing it, or exit/escape-path logic that checks "is this fund still sitting at outpoint X." Borrowed Receive lets any third party consume and recreate that UTXO (new outpoint, higher amount) with **zero authorization from the covenant** — funds aren't stolen (amount only increases, KAS value can't decrease), but any logic anchored to the specific outpoint can be broken by someone who has no relationship with the covenant at all.

We hit exactly this class of problem in our own architecture — fields like `current_leaf_outpoint` and `side_lock_tx` are live examples of state that depends on outpoint stability, not a hypothetical.

**Suggestion**: when `identifier_type == IDENTIFIER_COVENANT_ID`, Borrowed Receive should default-deny, and only be allowed when the covenant explicitly declares a machine-readable opt-in (e.g. an additional flag in `kcc20_extensions`, or a branch in the covenant's own transfer rules that explicitly accepts the `BORROWED_RECEIVE` witness). The point is to put the decision back in the covenant's own hands rather than assuming by default that outpoint stability doesn't matter to it.

## 2. Descriptor `prefix`/`suffix` should be required to come from a versioned compiled artifact, with round-trip verification against the actual deployed genesis P2SH — on first publish *and* on every subsequent recompile/template upgrade

The current descriptor section doesn't specify where `prefix`/`suffix` come from or how their trustworthiness is established — only that they "identify the covenant template." Any reader/wallet/indexer that decodes a KCC20 covenant's state depends on the descriptor matching the actually-deployed bytecode. If the descriptor is hand-maintained rather than derived directly from the compiled artifact, drift between the two won't cause an immediate error — it'll only surface the first time something actually depends on the mismatch.

We ran into this exact failure mode ourselves: a paired constant in our ZK settlement path (a circuit image identifier and its cryptographically-derived commitment value — structurally the same relationship as "compiled artifact identity" and "a value derived from that artifact") got out of sync during a circuit version upgrade. The image ID changed; the paired commitment wasn't recomputed. It sat latent for over a day before it surfaced — at the exact moment on-chain verification actually depended on it. The failure mode wasn't at initial publish, it was after a later recompile.

**Suggestion**: descriptor `prefix`/`suffix` should (a) be required to come from a versioned compiled artifact rather than a free-form manually-filled field, and (b) require round-trip verification — rebuilding the P2SH script hash from the descriptor and confirming it matches the actually-deployed genesis P2SH byte-for-byte — both on first publish and on every subsequent recompile or template upgrade, not just once at initial release. A descriptor that hasn't self-verified via round-trip shouldn't be trusted by tooling.

---
*(KANet team, contributed from production operational experience on Kaspa TN12.)*
