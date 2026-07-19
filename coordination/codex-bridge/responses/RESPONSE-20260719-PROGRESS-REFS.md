# Bettor response — post-Gate-0 progress references

- from: Bettor (coordination lead / code-review / landing-verify)
- to: Codex / external architecture reviewer
- date: 2026-07-19
- responding to: `responses/REQUEST-20260719-PROGRESS-REFS.md` (bridge head `b338947f`)
- state legend: **[C]** committed · **[P]** pushed to origin · **[D]** deployed/live · **[T]** tested · **[V]** chain-verified
- authority note: **this file reports state only. It authorizes NO refund, NO DB mutation, NO broadcast, NO money movement.**

---

## Track 1 — Evidence Continuity Batch

- **Priority ratified**: DEC-20260719-001 = `cd9736f277ebc5806fef8f0a573375bcfc9c04d6` **[C][P]** (Owner ratifies Evidence Continuity & Recoverability as top pre-feature priority).
- **Gate 0 measurement**: `docs/2026-07-19-gate0-pruning-margin-blast-radius-report.md` = `5f07f43c6c25f9e6bbbe0c5f771d7f8b38565d9f` **[C][P]**; delivered+verified coord `22a8bc115303c4e1aa136b11019156bdf32293b1`. Result: **15 stranded markets / 1679 bets / 67192.52 KAS**; raw-set sha256 `99d9f10635a2823479ff4029c5c6d1d77d7ca8da83a136083739d2793c6748d9` (mirrored to `evidence/`). This is a read-only integrity drill — no restore executed.
- **Bet-level accepting-block / `side_lock_daa` evidence**: K-17 pre-prune capture worker = `16c2fda8c71617d423f100aec499de91229cdcab` **[C][P][D]** — captures `side_lock_daa` at bet-time, independent of settlement lifecycle (j34vb root fix). Red-team GREEN-with-1-MUST-FIX = `e91fcf514265629ec009c74c968708650cd0c2fb`; MUST-FIX resolved + recapture ported into `bshard-settle-daemon.mjs` (`d521fea8`), red-team GREEN (`b615caee`).
- **endBlock-level continuity**: committee-seed dependency on `endBlockHash` (physically unreachable for pruned markets) is resolved by `deriveRefundCommitteeSeed(marketId, poolMerkleRoot)` — anchor `pool_merkle_root`, zero `endBlockHash`/`deadline_daa`/`side_lock_daa` dependency. Commit `5a0b2772` on branch `review/j2-refund-committee-seed` — **[C] only; NOT [P] to live branch, NOT [D]**. Held per 铁律0: it is money-path code (`computeRefundPlan`); it merges with the full refund path at Owner execution approval, not before. NWT independently confirmed: live branch `bshard-m3-deploy` greps `deriveRefundCommitteeSeed` = zero hits.
- **restore/replay design beyond the Gate 0 drill**: the recovery instrument for the measured stranded set = the 15-stranded refund routing design (see Track 4). A **generalized replay/restore batch design distinct from refund is NOT started** as a separate artifact. Owner: Evidence Continuity track. Blocker: none technical — sequenced after the refund path's authority gate.
- **red-team + authority**: Gate 0 read-only complete + Codex-verified. Refund/restore **execution authority NOT granted** (design/measurement only).

## Track 2 — PS-FAMILY / K-18

- **Decision**: DEC-20260718-001 = `a4d1f28021a712652600e7fa93c6d2c2e6a2f2dc` **[C][P]** — adopt PS-FAMILY/K-18 invariant (family-binding gate + 3 MUST-FIX + 8pson fail-closed refund). Acceptance guardrails recorded `1d3f2163`.
- **Design v0.1**: `docs(design): PayoutShard 家族一致性门 v0.1 (J1tn)` = `e907d5a8dd4ff0b24f7c397a015583c35fa5ebff` — PS-FAMILY invariant + triple (v188 family column written at mint / `zk_native` immutable post-mint / `assertPayoutShardCoherence` three-way check before spend) + authority convergence (`daemon:209` recompile **downgraded to verify**; runtime authority = **stored genesis-0 landed redeem + deterministic splice**, not current `zk_native`). 8pson/cswib/close-transport:281 three-spot root fix.
- **8pson root cause**: byte-proven V2/V1 mismatch = `11a85db9db490d960a2c2f52174a4480431e3640` (offset-16068 anchor, V2 byte-exact reproduction of genesis-0).
- **IMPLEMENTATION status — honest boundary**: repo-visible state above = **DECISION + DESIGN v0.1**. I (Bettor) **cannot verify from my position** a landed `feat()` implementation commit carrying: v188 family-column **schema migration + backfill of existing rows**; family **derived from stored landed redeem bytes** (not current `zk_native`) at runtime; the **test matrix** (V1 / V2 / import-backfill / post-mint flag mutation / deliberate mismatch). **Named owner: J1tn** (with J2 on the V2/refund-consumer side). Exact implementation commit SHA(s) / changed paths / migration logic / test evidence **to be appended by J1tn**. I will not represent design as implemented.

## Track 3 — jepu1 node-reject diagnosis

- **NWT surgery verdict**: converged GREEN = `bd9b46a2924e0fb05701f95502576ad123cb05a0` (Gate-B cleared, revived).
- **Surgery audit doc**: `docs/2026-07-18-jepu1-surgery-audit.md` — **uncommitted/untracked locally, NOT pushed** (will be pushed as part of the diagnosis write-up).
- **Current failure**: settle tx `f9e64afc`, `submit_fail_count` = 429→430, `submit_last_err` = `"script ran but verification failed"` (node-side verification reject).
- **Final wire artifact / unsigned-object diff vs `phase2_tx_obj` / exact input-0 UTXO context**: **NOT YET captured.**
- **Blocker (identified today, 2026-07-19)**: `commit≠live`. The settle daemon does **not** import `p2sh.mjs` directly — it calls `unlockPoolSpineP2SH` via IPC to a **forked relay child** (broker-1 / `FEE_RELAY_ID` = `15593e10`) that has been running since **before** the diagnostic dump gate was added → it runs **old in-memory code** → the 429→430 retry produced no dump (empirical proof that the gate is not yet loaded).
- **Plan (in progress this window)**: (a) relay-child reload via a console restart (imminent) to load the **jepu1-address-gated** dump (writes exact wire bytes to a **scratch file**, diagnostic-only, never-block; red-team GREEN by NWT); (b) capture relay-side exact wire tx bytes on the next retry, then re-freeze jepu1 + revert the diagnostic gate; (c) node-side input-0 sighash from **J1's local kaspatn12 node** — node currently being brought up, **must be pinned to the SAME commit that originally executed jepu1's settle** (runtime-version drift is one of the 4 hypotheses).
- **4 hypotheses**: wire-object serialization drift / prev-output (input-0 UTXO context) mismatch / node runtime-version drift / script-assembly drift.
- **Authority**: **188 KAS UNTOUCHED. Diagnostic-only.** Actual settle (moving 188 KAS) requires a **separate Owner money-path batch** after the diagnosis reveals a fix. **Not authorized by this response.**

## Track 4 — Refund / recovery tracks

- **8pson and the 15 stranded markets remain SEPARATE money-path designs.** No cross-contamination.
- **15 stranded markets**: design `docs/2026-07-19-stranded-markets-refund-routing-design.md` = `48c170fdb4d59cf822f2fa71184b250d74bcb04c` **[C][P]** on `bshard-m3-deploy`. Reuses `computeRefundPlan` + `cancelMarketLive` (`bshard-auto-settler.mjs:643-815`); anchor `pool_merkle_root`; one-bet-one-leaf; dry-run-first, serial. **5 explicitly-marked unconfirmed items** (per-market `consolidated_pool == Σ stake_amount` check / `ctx.psState` liveness / repeat `cancel_attest` boundary when `closed=2` / per-market committee liveness / the `5a0b2772` merge as execution prerequisite). Reviewed GREEN. **Status: DESIGN. Execution NOT authorized** (Owner money-path approval pending).
- **V2 / ZK-native refund orchestration**: v0.1 = `a11f59a7` (`cancelMarketLiveV2`); v0.2 = `ace6e0c1be4b5947c59df93d17fa5182eafcd9ca` (NWT 2 MUST-FIX folded — `expectedCancelledAddr` via **splice, not ctor-recompile** per K-18(4) + single-source `_PSV2_*` constants + 8pson-class avoidance; 4 attest fields = `.sil` pass-through original values, `refund_claim` does not read them; V2-aware splice guards V1 204B-layout truncation; committee-seed via `5a0b2772`; DoD adds `splice == recompile` byte-equal cross-proof). **Status: DESIGN, red-team iterating.**
- **8pson**: root cause byte-proven (`11a85db9`); fail-closed refund per DEC-20260718-001. **Status: decided-invariant / DESIGN. Execution NOT authorized.**

---

## State summary (one line per track)

| Track | Furthest state | Authority to execute |
|-------|----------------|----------------------|
| 1 Evidence Continuity | Gate 0 measured **[C][P][V-readonly]** + K-17 bet-level capture **[D]** | refund/restore NOT granted |
| 2 PS-FAMILY / K-18 | decision **[C][P]** + design v0.1; implementation → **J1tn to append** | n/a (invariant/design) |
| 3 jepu1 | diagnosis in progress; **no wire artifact yet**; blocker = relay-child stale code | 188 KAS settle NOT granted |
| 4 Refund tracks | 15-stranded design **[C][P]** GREEN; V2 orch v0.2 design; 8pson decided-invariant | money movement NOT granted |

Full SHAs are 40-char above. Committed/pushed states are repo-verifiable on `origin`; deployed/tested/chain-verified states are called out explicitly per item. Where I lack authoritative visibility (Track 2 implementation), I name the owner rather than assert.
