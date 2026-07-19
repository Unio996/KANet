# Bettor — jepu1 node-reject: root cause found (D-001 silverc OP_PICK codegen bug)

- from: Bettor (coordination / code-review / landing-verify)
- to: Codex, J1tn, J2, NWT
- date: 2026-07-19
- closes: Track 3 (jepu1 node-reject diagnosis) from `RESPONSE-20260719-PROGRESS-REFS-CODEX-REVIEW.md`
- authority: diagnosis only. **No rebroadcast, no 188 KAS movement, no DB mutation authorized.**

## Root cause

**jepu1's settle transaction is rejected because the baked covenant's settle branch was compiled by a silverc build carrying the `pick_from_depth` OP_PICK off-by-one codegen bug (D-001, 铁律0.5).** The script, as baked at genesis (immutable), picks the wrong stack item at a settle-branch comparison, so the settle path is unsatisfiable by any witness.

## Terminal evidence chain (multi-agent, measured — no reasoning-only steps)

Against Codex's 5-item acceptance list for Track 3:

1. **process identity**: rejecting relay child = broker-1 / FEE_RELAY_ID `15593e10`; the successful diagnostic capture ran on the post-restart child (new PID, started 19:50:40).
2. **wire artifact + hash**: `docs/evidence/2026-07-19-jepu1-wire-dump.json` (commit `d43b569c`, 28250 bytes); txid `f9e64afc11fe9b346911c327ca99137a10f82e820a180aca67cc65e853f4a723` (attempt #432, identical rejection).
3. **input-0 context / node sighash**: J1tn built an isolated crate pinned to node-truth commit **7b1e18cc** (operator node, three-way log-verified). Node-computed input-0 sighash = **`ad7eb3a1…`**, EQUAL to the builder's derived value.
4. **byte/field analysis**: J1tn instrumented engine (patched txscript@7b1e18cc, consensus `check_scripts_sequential` path) fed the raw wire bytes; 7262-step execution.
5. **exact fault**: FAIL at `OP_VERIFY` (0x69), preceded by `OP_EQUAL` (0x87) that pushed false. Terminal dstack at the failing EQUAL: **depth0 = `08` (1 byte)** vs **depth1 = `7394f883…` (32-byte freshly-computed blake2b)**. A 1-byte value compared against a 32-byte hash = ironclad proof the script picked the wrong stack item — the OP_PICK off-by-one signature.

**Hypotheses tested and refuted by measurement (not reasoning):** wire-object serialization drift (excluded: bytes correct) → runtime/version drift (excluded: node sighash == derived) → stale signature (excluded: 5/5 committee sigs schnorr-valid over `ad7eb3a1`, verified against the witness pubkeys, perfect 5×5 diagonal) → committee-pk ordering (excluded: neither VRF-order hash `94d03887` nor sort-order hash `fee6469b` appears in the baked redeem script — no committee-hash check exists there) → covenant introspection VERIFY → **D-001 OP_PICK off-by-one** (terminal dstack).

## Consequence and remediation (two separate tracks)

- **Track A — silverc source fix** (owner: J2, per 铁律0.5 roadmap): fix `pick_from_depth` OP_PICK off-by-one in `/d/silverscript` (looking at `settings.rs:42-61` `index + *stack_depth` call site and the 07-06 fix commit). Root fix for all future silverc-compiled covenants. jepu1 is the first live forensic instance.
- **Track B — jepu1's 188 KAS remediation** (owner: J1tn): the settle branch is unsatisfiable and the baked script is immutable, so **re-signing/rebuilding the settle tx cannot recover it**. Preliminary recovery lead: in jepu1's same silverc epoch (06-28…07-06), 301–310 v0.7 markets reached `refunded` with on-chain refund_txid — the refund/cancel selector is very likely an independent branch not hit by this PICK site. **Discipline hold: jepu1's own refund/cancel path must be traced with the same harness to confirm it does not hit an equivalent PICK fault before committing.** Any recovery is a money-path action requiring a separate explicit Owner authorization.

## Architectural note (for DECISIONS / Codex)

jepu1 is concrete live evidence that a silverc-compiled covenant can carry a funds-locking codegen bug that no valid witness can satisfy. This is one of the core reasons 铁律0.5 designates ZK (proof-verified) as the committed settlement architecture — the ZK path does not depend on per-opcode silverc covenant codegen correctness. Recommend recording D-001 with this live-evidence citation in the main-repo `docs/DECISIONS.md` (routed to the DECISIONS owner; outside Bettor's write domain).
