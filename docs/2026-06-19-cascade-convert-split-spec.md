# bshard Settle-Cascade convert-split SPEC (PoolRoot SIZE-wall break)

**Status**: DRAFT for adversarial review (Bettor, 2026-06-19). GO = Owner-delegated self-decision (Bettor+J1), J2/UI/NWT affirm.
**Precedent**: register-side convert-split (ShardLeaf+FoldNode) LANDED on-chain 2026-06-19 (txid bead5670, 4-vantage). This applies the SAME pattern to the settle side.
**Grounding (chain-measured, not modeled)**: `seal_to_root(FoldNode→PoolRoot 2311B template)` = **11514 script-units > 9999** (4-vantage: J2/Bettor runs + UI/NWT log reads). 8982-optimistic-model REFUTED. → PoolRoot MUST shrink the per-operation revealed bytes.

## 0. DoD / finish line (HARD anti-drift lock — NWT guardrail, Owner anti-gold-plating)

**Done = a SINGLE small market runs the full cascade settle on-chain ONCE successfully** (register→fold→seal→close→claim/refund, ALL landed, 4-vantage co-verified). **Then STOP.**
- ❌ OUT of scope (post-bshard, do NOT gold-plate): 880-wall throughput, unlimited shard_count scale, fee/economic model, multi-market batching. Owner repeatedly warned: 无限打磨 = drift.
- ✅ On finish: per Owner钦定, immediately pivot to **oracle 强化拓展 (重中之重)** — bshard cascade is the last bshard slice, not a new scale project.
- This DoD is the contract: the moment the single-market cascade lands 4-vantage, the cascade work is DONE and banked.

---

## 1. Problem (measured)

Current `PoolRoot.sil` = 1 contract, 3 entrypoints (close_commit/claim_draw/refund_draw), 7-field state, **~2289–2311B** compiled.

Two SIZE costs, both ∝ revealed template/redeem bytes (~4.98u/byte for double-blake2b WithTemplate; ~half for single-blake2b validateOutputState-self):

| op | reveals | measured/est | verdict |
|---|---|---|---|
| **seal_to_root** (FoldNode→PoolRoot, WithTemplate double-blake2b over PoolRoot template) | full 2311B template | **11514u** (measured) | ❌ > 9999 |
| close_commit (spend PoolRoot, validateOutputState-self) | full 2289B redeem | ~est ½ of seal + body | ⚠ unprobed |
| claim_draw (spend PoolRoot + merkle climb) | full 2289B redeem | PoolRoot.sil L93-95 claims < (single-blake2b) | ⚠ unprobed |
| refund_draw | full 2289B redeem | ~est | ⚠ unprobed |

**Iron law (this whole effort)**: every per-op cost is PROBED on-chain (`<9999`), never modeled. seal is the one confirmed wall; close/claim/refund are unprobed and MUST each be probed after the split.

## 2. Approach — convert-split (mirror ShardLeaf/FoldNode, proven)

Split the monolithic 3-entry PoolRoot into **single-purpose reveal-bounded contracts**, bridged by `validateOutputStateWithTemplate` (the proven foreign-template 1:1 transition; same primitive as ShardLeaf→FoldNode convert):

```
FoldNode --seal--> RootClose --close_commit--> RootClaim --claim_draw(self,N×)--> drained
   (count==shard_count)   (committee 4/5 writes      (winner self-draw,
                           outcome→bridge)            merkle-proved payout)
RootClose --refund_draw(self,N×)--> drained        (cancelled path; closed!=1 ∧ timeout)
```

Each contract reveals ONLY its own (small) template/redeem at its step. Seal's target becomes the small **RootClose** (not the full 3-entry PoolRoot) → seal's double-blake2b is over a smaller template → target **<2007B** (= 9999 / 4.98).

### 2.1 The split (3 contracts)

- **RootClose** (seal target; **3 entries**: `close_commit` + `refund_draw` + `convert_to_claim` — NWT 新A):
  - 7-field state {local_yes, local_no, count, pool_value, closed, winningSide, payoutRoot}.
  - `close_commit` (committee 4-of-5): write outcome (closed=1, winningSide, payoutRoot) by **recreating RootClose-self** (single reveal). value immutable. (NOT a bridge — see §2.2.)
  - `refund_draw` (closed!=1 ∧ timeout): per-bettor stake refund, draw-down, flip closed=2 (F2 latch) → recreate RootClose-self.
  - `convert_to_claim` (closed==1): bridge RootClose→RootClaim via WithTemplate, carry outcome (read from own committee-stamped fields, NOT witness — see R2/新B).
  - **Size note (新A)**: RootClose is 3-entry but carries **NO merkle climb** (that's in RootClaim) — the merkle loop is the heavy part of the original PoolRoot, so RootClose (close+refund+convert, no merkle) should be smaller than the original 3-entry PoolRoot (2289B). P1 probe confirms (probe-or-bust). **If RootClose walls, two levers are NOT available**: (a) splitting refund off = reopens the closed-XOR F2 insolvency = illegal (R1); (b) splitting `convert_to_claim` off RootClose = NOT REAL — in the P2SH covenant model, convert must SPEND RootClose to bridge its state, so convert is necessarily a RootClose entry, can't be a separate contract (J2/NWT). **Real legal levers only**: thinner per-entry codegen; shrink **RootClaim** (the WithTemplate-target 4.98× term = most leverage — lower merkle depth cap, or recursive-split RootClaim into a thin claim-bridge + claim-body); shrink RootClose accounts encoding. (NWT iron law: a fallback is only valid if it's a REAL spendable mechanism.)
  - WHY close+refund together: they share the `closed==0` write-once XOR (close 0→1 vs first-refund 0→2). Keeping them in one contract preserves the atomic latch (splitting them across contracts would break the XOR — see risk R1).
- **RootClaim** (post-close winner draw; entry: `claim_draw` only):
  - 7-field state (carried from RootClose at close-bridge: closed=1, winningSide, payoutRoot).
  - `claim_draw` (closed==1): merkle-prove payout ∈ payoutRoot, pay winner P2PK, draw-down pool_value, recreate RootClaim-self. Winners **self-claim** (per-bettor, as Owner noted — this step is unchanged from current claim_draw).

### 2.2 Bridges (validateOutputStateWithTemplate, 1:1 carry)

- **seal → RootClose**: FoldNode.seal_to_root targets RootClose template (was PoolRoot). Carry accounts + canonical-open outcome (closed:0). RootClose template < PoolRoot template → seal < 9999. (FoldNode bakes `rootclose_tmpl_hash`.)
- **close (self, NOT bridge — J2 two-reveal fix)**: close_commit recreates **RootClose-self** (`validateOutputState`, single-blake2b ~2.5u/B) writing outcome (closed=1, winningSide, payoutRoot). **Does NOT bridge to RootClaim in the same tx** — an in-tx bridge = two reveals (spend RootClose ~2.5u/B + WithTemplate RootClaim ~4.98u/B ≈ 14960u BUST, J2). Single reveal → fits.
- **convert_to_claim (SEPARATE step, the only WithTemplate bridge)**: after close, a separate `convert_to_claim` entry on RootClose does `validateOutputStateWithTemplate(claimOutIdx, {ALL 7 fields: accounts + closed:1 + winningSide + payoutRoot}, claim_prefix, claim_suffix, rootclaim_tmpl_hash)` → RootClaim. Single WithTemplate reveal (4.98u/B over RootClaim template <2007B). Mirrors ShardLeaf.convert_to_foldnode exactly (the proven separate-convert pattern).
- **claim → claim** (self): claim_draw recreates RootClaim-self (validateOutputState single-blake2b ~2.5u/B), draw-down. (refund→refund self on RootClose.)
- **NET (4 phases, each SINGLE-reveal)**: seal→RootClose (WithTemplate, RootClose<2007B) · close (self, ~2.5u/B) · convert→RootClaim (WithTemplate, RootClaim<2007B) · claim/refund (self, ~2.5u/B + merkle). No step does two reveals.

## 3. State-threading + global merkle (reuse, not reinvent)

- **closed tri-state {0 open, 1 settled, 2 cancelled} write-once**: lives in RootClose (close 0→1 / first-refund 0→2 XOR). RootClaim only ever sees closed=1 (created by close-bridge), so its claim gate `closed==1` is structurally guaranteed. (No cross-contract closed race — the XOR stays in RootClose.)
- **payoutRoot (global merkle)**: REUSE [[payout-commit-design-j2]] (`docs/2026-06-15-bshard-payout-commit-design-j2.md`): leaf=`blake2b(bettorPk ‖ serializeI64(payout,8))`, variable depth=ceil(log2(numWinners)), committee-attested in close (publicly recomputable from globalYes/No+winningSide → settler can't forge undetectably), no on-chain multiply (payout merkle-PROVEN). Lives in RootClose state, carried to RootClaim at close-bridge; claim reads it from RootClaim-self.
- **global parimutuel requires the seal/aggregation** (answer to Owner's claim question): a winner's payout = stake / winnerPool × totalPool, which needs the GLOBAL pool (all shards folded). So fold→seal→RootClose aggregates first; per-bettor claim is downstream of that. The split shrinks the aggregation target (RootClose) so seal fits — the per-bettor self-claim mechanism is unchanged.

## 4. Reveal-byte budget + per-step SIZE-probe plan (the load-bearing validation)

Every step probed on-chain `<9999` BEFORE declaring solved (probe-not-model; this is the whole point of the effort). With the close-self + separate-convert fix (§2.2), each step is SINGLE-reveal; the **two WithTemplate steps (seal, convert) are highest-risk** (~4.98u/B double-blake2b), the self steps (close/claim/refund) are ~half (~2.5u/B):

| # | step | reveals (single each) | risk | probe |
|---|---|---|---|---|
| **P1** | seal → RootClose | RootClose template (WithTemplate ~4.98u/B) | **HIGH** | lock FoldNode(rootclose_tmpl_hash baked) genesis → seal → RootClose LANDS |
| **P2** | convert_to_claim (RootClose→RootClaim) | RootClaim template (WithTemplate ~4.98u/B) | **HIGH** | lock RootClose(closed=1) → convert → RootClaim LANDS |
| P3 | close_commit (RootClose-self) | RootClose redeem (self ~2.5u/B) + committee sigs | low | lock RootClose(closed=0) → committee 4/5 close-self |
| P4 | claim_draw (RootClaim-self) | RootClaim redeem (self) + merkle climb (depth) | med (depth) | lock RootClaim(closed=1)+ticket → winner claim, vary depth |
| P5 | refund_draw (RootClose-self) | RootClose redeem (self) | low | lock RootClose → timeout → refund |

**Sequencing (NWT fail-fast)**: probe the two WithTemplate steps FIRST — **P1 then P2, BEFORE building claim/refund**. If seal or convert walls, the target root must shrink (or re-split) → topology changes → don't build downstream on an unproven bridge.
**Budget discipline (J2 refined + NWT) — each WithTemplate step has TWO cost components**: cost = spent-contract P2SH-reveal (~2.5u/B × spent size) + target-template WithTemplate double-blake2b (~4.98u/B × template). Evidence: measured seal ≈14700 full = FoldNode-spend(1278B ~3195u) + PoolRoot-template(~11509u). So:
- **P1 (seal)** = 2.5×FoldNode(1278) + 4.98×|RootClose| ≈ 3195 + 4.98×|RootClose|
- **P2 (convert)** = 2.5×|RootClose| + 4.98×|RootClaim| ← **TIGHTEST**: at both roots=1336B, P2 ≈ 3340+6655 = **9995, right at the 9999 edge**.
- ⚠ **3-entry RootClose (新A) tightens BOTH** P1 (bigger seal-target) and P2 (bigger spent-contract) → RootClose size is **doubly load-bearing**. Target **<~1300B per root**, RootClose 3-entry must be as thin as possible.
- 🔴 **P2 marginal-fit is THE load-bearing risk; SIZE is NOT design-signed (NWT 条件1, probe-or-bust)**: the 9995-est is 4u from the limit, from the SAME unreliable model class that was REFUTED once (8982→measured 11514: linear extrapolation, un-probed). **SIZE fit is signed ONLY when P1+P2 LAND <9999 on-chain — the design sign-off must NEVER be read as "it fits."** Implementation MUST carry a fallback ready. If P2 busts → LEGAL refine LADDER (J2/NWT): ① thin the 3 entries' codegen + shrink the 7-field state (can large fields like payoutRoot byte[32] be derived/merged?); ② still walls → REAL recursive-split: RootClose → intermediate bridge → RootConvert → RootClaim (adds a hop, each contract smaller — the genuine recursive convert-split). **ILLEGAL/NOT-REAL (do NOT): split refund off RootClose** (breaks closed-XOR = F2 insolvency, R1) OR **split convert off RootClose** (convert must SPEND RootClose to bridge = necessarily a RootClose entry, can't be a separate contract — J2/NWT). **Probe P1 then P2 FIRST, before any other code** — if P2 walls, the topology changes.
**Probe ownership**: J2 OWNS running P1–P5 (guardrail① is his hard gate; reuse his seal-probe harness + empirical selector test per the OP_2 lesson). Bettor coordinates + sequences. NWT independent co-verify each landing (read :3200 chain/log).
If any step still walls → that contract splits further (recursive convert-split) OR merkle depth caps (winner-tree-shard for >cap, per PoolRoot.sil L95). **Probe each; don't assume the first split fits.**

## 5. Adversarial review targets (before any code)

- **R1 (closed XOR integrity)**: splitting close/refund across contracts would break the `closed==0` write-once XOR → refund-then-close insolvency (the F2 bug). Mitigation: keep close+refund in RootClose (§2.1). **NWT determinism + Bettor attack-review must confirm the XOR survives the split.**
- **R2 (bridge forge — two faces, NWT guardrail②)**: (a) every `validateOutputStateWithTemplate` target hash must be CTOR-baked (cov-derived), not witness-supplied ([[feedback-ss-attack-review-verify-value-source]] — witness param = spender-controlled = forgeable). seal bakes rootclose_tmpl_hash; RootClose bakes rootclaim_tmpl_hash. (b) **the bridge new_state must constrain ALL fields, not just the ones logic requires** — covenant new_states leaves unlisted fields FREE = forgeable ([[feedback-ss-covenant-newstates-partial-field-forge-gap]]: fold once left closed/payoutRoot unlisted → folder forged them). **SYMMETRIC (NWT 缺口1): BOTH bridges all-7-field** — (i) `convert_to_claim` (RootClose→RootClaim) lists all 7; (ii) `seal_to_root` (FoldNode→RootClose) genesis ALSO lists all 7 — R4 covered the 3 outcome fields (canonical literals) but the 4 account fields (local_yes/no/count/pool_value) carried from FoldNode must be explicitly value-conserved/listed, else a malicious folder forges RootClose accounts at seal. (Same gap on both bridges; close was only the more obvious one.)
  (c) **convert_to_claim outcome provenance (NWT 新B — pool-theft defense)**: when convert carries {closed,winningSide,payoutRoot} into RootClaim, those values MUST be read from RootClose's OWN contract fields (= the committee-stamped state baked into the RootClose UTXO being spent, written at close_commit), NOT from witness params. A witness-supplied winningSide/payoutRoot = spender forges the outcome at convert-time → claims as the wrong side / forged payouts = pool theft. Enforce: `require(closed==1)` (only convert a closed root) + new_state uses the contract fields `winningSide`/`payoutRoot`/`closed` directly (silverc reads them from the spent input's baked state), never a `convert` arg. Same value-source rule as R2(a).
- **R7 (double-claim nullifier — NWT 缺口2)**: current PoolRoot blocks double-claim via the **dust-ticket spent-once** (claim_draw reads the per-bettor ticket via `readInputStateWithTemplate(ps_tmpl_hash)` + spends it as a tx input = spent-once nullifier). RootClaim MUST preserve this: claim_draw reads + spends the dust-ticket (ticketInIdx), so a winner cannot claim twice (ticket already spent). RootClaim therefore bakes `ps_tmpl_hash`; the spent-once mechanism is carried, not dropped in the split.
- **R3 (value conservation across bridges)**: each bridge weld `out.value == pool_value` (no draw-down on bridge; draw-down only at claim/refund terminals). Σin==Σout consensus.
- **R4 (canonical outcome at seal)**: RootClose genesis outcome = canonical literal (closed:0/winningSide:0/payoutRoot:init) hard-set by seal — committee-bypass cannot move it (same as current PoolRoot seal).
- **R8 (committee provenance — NWT #5)**: the committee set (c0Pk–c4Pk) is CTOR-baked in RootClose (carried from market genesis), NOT witness-supplied — close_commit checks 4-of-5 sigs against the baked keys, so the committee can't be forged/swapped by the spender. Same as current PoolRoot (preserve, don't drop in split). The close-TX preimage the 4-of-5 sign must be byte-identical cross-node (ties to R6).
- **R5 (selector ABI)**: each contract's entry selectors PROBED empirically, not source-order-inferred (covenant entries occupy ABI slots — the OP_2 lesson). RootClose **3-entry** (close_commit/refund_draw/convert_to_claim — 新A), RootClaim 1-entry. Probe each contract's actual selector indices on-chain before wiring (don't infer from source order — the OP_2 covenant-slot lesson).
- **R6 (cross-node byte-equal — UI guardrail)**: cascade contracts MUST compile byte-identical across nodes (:3200/:3300). `close_commit` = committee 4-of-5 cross-node → every committee node must derive the SAME RootClose P2SH AND the SAME close-TX preimage, else the 4-of-5 sigs don't verify against one preimage = determinism break. Mechanism: whole-repo sync (same commit, NO cherry-pick drift — [[feedback-cross-node-whole-repo-sync-not-cherry-pick]]) + silverc provenance-pinned (the GATE we ran for register: fresh silverc → byte-identical settled) + per-node recompile → byte-equal assert BEFORE committee signing. Same discipline that made register/seal cross-node-safe.

## 6. Sequence

1. Bettor: this spec → adversarial review (NWT determinism + Bettor attack-review + J1/J2 line-level).
2. J1/J2: implement RootClose.sil / RootClaim.sil + builders (FoldNode reseal to RootClose; close-bridge; claim/refund). J1 rebase onto clean base 687345ff+ (deploy discipline: strip DIAG, preserve UI funding+selector fixes; no bulk-pull).
3. UI: integrate relay handlers (unlock* + dispatch + commands) to clean base, single-writer.
4. Bettor: probe each step P1–P4 on-chain (`<9999`); NWT independent co-verify each landing.
5. Full cascade e2e: register→fold→seal→close→claim lands → bshard 无限押注 end-to-end usable.

## 7. Honest scope

This makes the **≤ (depth-cap) winners/market** sharded settle work end-to-end. >cap winners = winner-tree-shard (separate, per PoolRoot.sil L95). The split is justified by the MEASURED seal wall (11514); each split piece's fit is UNPROVEN until probed (§4). No over-claim until P1–P4 land.
