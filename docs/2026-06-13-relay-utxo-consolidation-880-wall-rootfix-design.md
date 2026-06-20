# Relay UTXO Consolidation — 880-Wall Systemic Root-Fix (Design Proposal)

**Status**: DESIGN COMPLETE + tri-reviewer APPROVED, then **DEFERRED by Owner (r927, 2026-06-13)** as a known-limitation (recorded in `docs/guide/12-known-limits.md` #12). Rationale: it's the *adversarial* face — friendly external onboarding testers won't hit it; the public-testnet thesis demo prioritizes external-agent onboarding (/exchange) over hardening this. Ready to implement (consolidate cron + atomic guard, both hard points closed) whenever the adversarial-load timeline needs it. Interim mitigation: manual relay UTXO merge (transfer-to-self) + `_send.cjs` auto-chunking.
**Owner (slice)**: KANet-UI-tn (认领, Bettor r896/r897 confirmed)
**Adversarial reviewer (determinism面)**: NWT-tn (offered 旁审: relay UTXO ops must not break in-flight broadcast/sign chunk)
**Date**: 2026-06-13
**Trigger**: qr733 chain Tier4 settle (51-input → sign_req 170 chunks) hit the known 880-wall at demo scale → Bettor elevated the root-fix from "deferred slice" to "large-market settle 前置依赖".

---

## 1. Problem (root cause, verified)

Per `project-broadcast-880-wall-deepdive` + code read (`kasia-relay/src/lib/transaction.mjs`):

- **self-full self-send** (broadcast/comm/card/sign_req chunk) = `amount===0n && to===self` → picks the **single largest UTXO** `best`, output = `best − feeReserve`. **1-in-1-out** (transaction.mjs:157-163).
- KIP-9 storage mass for 1-in-1-out ≈ `C × feeReserve / best²` (C=10¹²). **As `best` shrinks, mass grows quadratically.**
- Every self-full broadcast consumes `best` and produces a *smaller* output → over time the relay's `best` is ground down → mass climbs → large payloads (long broadcasts, sign_req chunks) get throttled / truncated / dropped.
- Large-market settle amplifies it: 50 bettors → 51-input settle TX → huge sign_req → 170-chunk cross-node broadcast, each chunk a self-full send on an already-ground-down `best`.

**The wall is not a fixed byte count — it's a function of the relay's current largest UTXO.**

### 1b. Second-order effect — committee comms BLACKOUT (real incident, 2026-06-13)

The 880-wall is **not just "slow/truncated broadcasts."** It can fully **starve a relay's broadcast capacity**, taking that relay's owner dark.

**Real incident (J1 #325)**: while signing qr733, J1's committee broadcaster relay Alice (qzss) emitted the 170-chunk sign_req. Those self-full sends **consumed/exhausted Alice's UTXOs** → for ~42 min J1 could not broadcast *anything* — including his byte-equal arbitration PASS results — until a change output replenished Alice. The team misread this as "J1 node down 42min" (it was UP the whole time; only its broadcast capacity was starved).

This is the **second-order effect**: a committee member, *after* signing a large sign_req, is left UTXO-starved and **cannot communicate** = a committee comms blackout. In a large-market settle this is a hidden kill: the very act of participating in settlement can knock a committee relay offline for tens of minutes.

→ This elevates the root-fix from a **performance optimization** to a **committee-availability guarantee**: consolidation keeps each committee relay's `best` large enough that signing a large sign_req does not exhaust it → the member stays reachable post-signing. This is the **second, stronger motivation** for the slice (alongside §1's throttle/truncation).

*Verification scope (honest)*: qzss is J1's relay, not registered in this node's Console, so this is corroborated by mechanism-match to the verified maker-1 incident (§2) + J1's first-hand account, not a direct UTXO-history forensic from the :3200 side.

## 2. Root fix (the inverse operation is cheap)

Keep critical relays' `best` UTXO large by **periodically consolidating fragments N→1**.

KIP-9 mass for **N-in-1-out** = `C × (Σ(1/output) − Σ(1/input))⁺`. Many inputs (Σ1/input large) + 1 big output → the bracket goes negative → clamped to 0 → **near-zero mass**. So consolidation is KIP-9-CHEAP — it's the *split* (1→N) direction that's expensive (`utxo-split.mjs` already floors fee at `N×200k`).

This is the proven manual fix (maker-1 merge TX 023fc8f2, and historically NWT-tn 84f79939 60-KAS consolidate). The slice = **make it a designed, automated, guarded mechanism** instead of ad-hoc manual TXs.

## 3. Existing building blocks (reuse, don't rebuild — KB confirms no pre-designed mechanism)

| Block | File | Role in this slice |
|---|---|---|
| `splitUtxosRelay(targetCount)` | `utxo-split.mjs` | **Inverse template** — model `consolidateUtxosRelay()` on it (N entries in → 1 output) |
| `filterPendingUtxos()` | `transaction.mjs:147` | **In-flight guard basis** — already excludes UTXOs spent by pending TXs |
| self-send / `sendKaspa` | `transaction.mjs` | TX primitive (N-in-1-out via Generator with all entries → 1 output) |
| relay command dispatch | `relay.mjs:469-490` (`transfer`/`split_utxo`) | where a new `consolidate_utxo` command slots in |
| `maxSafeOutputs` / KIP-9 math | `utxo-split.mjs:25-28` | KIP-9 sizing reference |

## 4. Trigger policy — options (the design choice, KANet-UI domain)

- **(a) Periodic cron (idle-time consolidate)** — every T (e.g. 10min), for each critical relay: read UTXO set; if fragmented (`count > N_hi` OR `best < B_lo`) AND no in-flight sends → consolidate N→1.
  - PRO: proactive; relay always broadcast-ready; runs between settles (no in-flight). CON: needs idle/in-flight detection; a little background TX traffic.
- **(b) Pre-broadcast hook (just-in-time)** — before a large self-full broadcast/sign_req, if `best < needed(payload)` → consolidate first.
  - PRO: zero waste, just-in-time. CON: adds latency to the broadcast; **DANGER** — must run ONLY before the first chunk, never mid-sequence (else = the qr733 ops hazard).
- **(c) sign_req / payload compression (orthogonal)** — reduce chunk count via hash-anchor compression (Path C style). Attacks payload size, not UTXO. Complementary to (a), not a substitute.

**Recommendation (review-affirmed)**: lead with **(a) periodic cron + atomic merge lock + sequence guard** (§5) as the systemic fix; keep (b) as a defensive pre-FIRST-chunk check only; treat (c) as a separate complementary slice.

**Resolved by review:**
- **Trigger threshold (Q3, Bettor probe3)** — the **primary physical trigger** is `best < B_lo` where `B_lo = sqrt(C × feeReserve / mass_limit)` (C=10¹², mass_limit=100k) — i.e. keep `best` large enough that the largest expected chunk's self-send mass `≈ C×feeReserve/best²` stays ≤ limit. `count > N_hi` is **secondary housekeeping only** — do NOT trigger on count alone; `best < B_lo` is the physics.
- **Location (Q4, Bettor probe4)** — **relay-side self-scan**, not central supervisor. Consolidation is relay-local value movement (each relay's own UTXOs), needs no cross-node coordination → relay self-scan is cleanest + scales. Reuse the existing supervisor tick merely as a timer; the decision stays relay-local.
- **Merge-TX self-bound (Bettor probe5)** — if fragments are extremely many (`N > per-TX max inputs / mass`), a single N→1 TX won't fit → need **multi-round merge** (rounds of `maxInputs`, like `splitUtxosRelay`'s inverse, which is already bounded). Confirm `consolidateUtxosRelay` is bounded the same way.

## 5. Hard safety constraint — ATOMIC MERGE LOCK + SEQUENCE GUARD (the two pre-code hard points)

**Consolidation MUST NOT run while any broadcast/sign chunk is in-flight OR mid-sequence on that relay.** (qr733 ops lesson: a transfer-to-self consumes UTXOs the remaining chunks need → double-spends the relay's own sign chunk → breaks the broadcast.)

`pendingCount === 0` ALONE is insufficient — adversarial review (Bettor r901 probe1 + NWT 旁审) found **two distinct races**, both must be closed:

**Race A — inter-chunk (NWT)**: during a multi-chunk sequence (e.g. 170-chunk sign_req sent sequentially), at the instant chunk 50 has landed and chunk 51 is not yet sent, `pendingCount` is momentarily 0 (the un-sent chunks' UTXOs aren't spent yet). A cron firing then would consolidate → consume chunks 51-170's UTXOs → break the sequence.

**Race B — build-window (Bettor)**: `pendingCount===0` is not atomic across build→broadcast. cron reads the UTXO snapshot (pending=0) → builds the merge TX → broadcasts; in that window a settle starts and its first sign_req chunk also grabs `best` from the same snapshot → both the merge TX and the chunk spend `best` → double-spend. `filterPendingUtxos()` only excludes UTXOs *after* they're pending; two TXs built at the same instant both see `best` free.

**Unified guard (焊原子)** — consolidate only when ALL hold, under a mutex:
1. **Per-relay merge mutex** held across the entire build→submit of the merge TX. The broadcast/sign_req sender acquires/respects the **same** mutex → no concurrent send can build from the same free-`best` snapshot (closes Race B).
2. **Active-broadcast-sequence flag** — set when chunk 1 of a multi-chunk send goes out, cleared only when the last chunk lands. Consolidation is forbidden while the flag is set, regardless of instantaneous `pendingCount` (closes Race A).
3. `pendingCount === 0` (necessary, not sufficient — keep as a cheap pre-check).

Equivalently: `canConsolidate(relay) = pendingCount===0 && !activeChunkSequence && acquireMergeMutex()`, mutex spanning build→submit.

## 5b. Determinism disjoint-proof (Bettor probe2 — the second pre-code hard point)

Must **explicitly prove (not assume)** two disjoint UTXO pools:
- The **settle TX** spends **POOL P2SH UTXOs** (bettor stakes locked in the spine) → consolidation never touches these → **settle TX bytes unchanged → cross-node determinism unaffected** (NWT §6Q5 ✓: consolidate touches no canonical/signed/committee_pk_hash/pool-settle payload).
- The **sign_req broadcast** uses the relay's **own P2PK UTXOs** — the *same* pool consolidation moves → this is exactly the in-flight race §5 handles via the mutex/flag (NOT a determinism issue, an ops-safety issue).

Action before code: assert in the implementation that the consolidate input set ⊆ relay-own-address UTXOs, disjoint from any P2SH-spine UTXO. Add a test proving disjointness.

**PROVEN (J2 r885, settler-domain code citation)** — disjoint is structural, not coincidental:
- Settle TX inputs = `pool-market-settler.js:1888-1892` `requiredInputOutpoints` = `spine_lock_tx` (maker stake) + N oracle bonds + `side_lock_tx` (sides) = **all POOL UTXOs at the market-derived P2SH address**.
- Relay broadcast/consolidate UTXOs = the relay's own **P2PK address** (e.g. maker-1 `qqs0yz9h`).
- `P2SH-pool ∩ P2PK-relay = ∅` — different address type + derivation = structurally disjoint.
- ∴ consolidation (relay P2PK transfer-to-self) physically cannot touch settle-TX inputs → settle bytes unchanged → determinism hard-point **closed with code evidence**. The implementation assert above becomes a regression guard, not a discovery.

## 6. Open questions — review resolutions (Bettor r901 5-probe + NWT 旁审)

| # | Question | Resolution |
|---|---|---|
| Q1 | (a) vs (b) vs (a)+(b) | **(a) cron + atomic guard** primary; (b) as defensive pre-first-chunk only. Both reviewers AFFIRM. |
| Q2 | "Critical relay" set | **Still open** — recommend: committee/settler/maker/broker broadcasters (the relays that emit large self-full payloads). Confirm with Owner at scoping. |
| Q3 | thresholds | **Resolved (probe3)**: primary trigger `best < B_lo = sqrt(C×feeReserve/mass_limit)`; count secondary. See §4. |
| Q4 | cron location | **Resolved (probe4)**: relay-side self-scan; supervisor tick only as timer. See §4. |
| Q5 | determinism | **Resolved (probe2 + NWT §6Q5)**: settle TX spends disjoint POOL P2SH UTXOs → bytes unchanged → zero cross-node impact. Must prove disjoint explicitly. See §5b. |

**Both reviewers' verdict: APPROVE direction.** Two hard points to nail *in code* before/while implementing: **(1) atomic merge guard (§5)** + **(2) explicit disjoint proof (§5b)**. One still-open scoping item: Q2 (critical-relay set) — for Owner at排期.

## 7. Non-goals / discipline

- NO code until this design passes channel 对抗审 + Owner sets priority (design-first; 不单方拍; KB-first satisfied).
- This is an **infra/ops slice** — pure value movement; it must never touch a canonical/signed payload (per `feedback-sompi-conversion-display-layer-not-signed-payload` family).
- `_send.cjs` auto-chunking remains the fallback regardless (any-length zero-truncation delivery).
