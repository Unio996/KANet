# Codex review — settlement v0.8 / Owner-decision scope

## Inspection basis

- canonical bridge pre-write HEAD: `53edaca5e81bd91a4219efa113c53aa1c9243487`
- previous processed/write-back HEAD: same SHA
- canonical compare: identical; 0 commits; 0 changed files
- five canonical blobs re-read from the canonical HEAD:
  - `TO-CODEX.md`: `31c745ca162d97c29313368a2860066fb4ad51f9`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch checkpoint previously inspected: `c6337245782d5c270e112becfa8db82f79dd937d`
- active branch current HEAD: `358006b4ea92810ccab49d35c8f4c742483178aa`
- active compare: ahead 1, `docs/iteration/COORD-LEDGER.md` +2/-0
- directly inspected referenced artifacts:
  - settlement design v0.8 commit `2bcc6c397445621e6ff1dbb05f84a5fd3243724e`
  - NWT simnet/mass/ticket evidence commit `50019d4f3892a0f00aa34cceee482c9cfc675230`
  - current `kasia-console/src/lib/RootClaim.sil`

No file self-reported timestamp was used for incremental detection.

## Independent assessment

### 1. v0.8 is materially improved, but this is not a production-money-path authorization

The design correctly incorporates the node-observed storage/compute mass split, withdraws the false assumption that local wasm mass has a stable bias direction, and removes the unnecessary PoolSideTicket covenant-change/sweep proposal after a real simnet `authorize_spend` acceptance.

I support using the pinned official 2.0.1 simnet as the mandatory builder gate. I do **not** authorize mainnet settlement, signing/broadcast, claim/refund, withdrawal, ticket reclaim, funded-key movement or any other production money-path action.

### 2. Ticket reclaim: covenant conclusion supported; fee policy remains an implementation blocker

The NWT transaction proves that the existing `PoolSideTicket.authorize_spend` path can consume a losing ticket with the bettor signature; therefore a new `.sil` sweep entry is not required.

However, the evidence also exposes a concrete builder problem: the successful probe deliberately paid 2,000,000 sompi while the observed node dimensions imply a much lower mass-based amount, and the existing local helper would under-estimate this transaction shape by roughly an order of magnitude. `getMempoolEntry` is post-admission evidence, so it cannot by itself be the production builder's pre-submit fee oracle. The implementation must define and test a conservative pre-submit fee policy (or another node-supported preflight mechanism) that does not depend on learning the authoritative mass only after successful mempool admission. A hard-coded probe fee is evidence, not a fee algorithm.

Therefore: **ticket-reclaim covenant path = SUPPORTED; production reclaim builder = still gated on fee/mass policy + exact-byte 2.0.1 node acceptance + idempotency/outpoint ownership.**

### 3. RootClaim small-payout blocker is source-confirmed

Current `kasia-console/src/lib/RootClaim.sil` still contains `require(payout >= 1000);`. This is a real source-level liveness restriction, not merely a design note. A full-claim sample with payout 1000 does not prove payouts below 1000.

For new markets, the safest semantic direction is to remove the arbitrary legacy `1000` business threshold unless a protocol-level minimum is separately justified. If an output-level economic/dust constraint is needed, it should be derived from the actual token/covenant output validity/economic rule rather than silently reusing an unrelated historical literal. Whatever Owner selects, the partial branch self-renewal fix and the small-payout rule must be tested together on official 2.0.1 with at least: payout=1 (or protocol minimum), payout=999, payout=1000, two-winner partial-first-claim, second/final claim, duplicate slot rejection, wrong ticket, and conservation failure.

This changes template bytes and therefore applies only to newly minted markets unless an explicit compatibility/recovery path proves otherwise.

### 4. refund_flip policy is a product/security decision, not closed by simnet

The design correctly moved the decision to the actual race source: who may call `RootClose.refund_flip` and when. Existing-market behavior cannot be retroactively changed because the template hash is already committed.

For new markets, a commissioner-priority window followed by a longer permissionless fallback is technically preferable to an immediate permissionless `deadline + 2h` race because it preserves the liveness escape hatch while reducing accidental/adversarial preemption of a valid committee close. The exact windows are policy parameters and require Owner selection. Implementation must separately prove both time branches and the boundary timestamps under consensus median-time semantics.

### 5. Implementation approval must remain narrower than execution approval

If Owner approves item ① (implementation stage), that should authorize code/design/test work only under the stated builder-by-builder official-2.0.1 gate. It must not be interpreted as approval of item ② (settling live market `a59c7b48`) or of any production signing/broadcast. Those are distinct decisions and should remain distinct in the ledger and command gates.

## Current disposition

- settlement v0.8 design direction: **SUPPORTED WITH IMPLEMENTATION GATES**
- node-side mass evidence: **SUPPORTED for the exact tested transaction shapes; not a universal future upper bound**
- losing-ticket covenant reclaim: **CONSENSUS-SUPPORTED on exact simnet sample; production builder still OPEN**
- RootClaim `payout >= 1000`: **CONFIRMED SOURCE-LEVEL MUST-FIX for new-market small-payout liveness**
- RootClaim partial self-renewal: **must remain in the new-market fix/test package**
- refund_flip timing/authority: **OWNER POLICY DECISION REQUIRED; existing markets unchanged**
- live market `a59c7b48` route-A execution: **NOT AUTHORIZED BY CODEX REVIEW**
- production settlement/refund/claim/withdraw/reclaim signing or broadcast: **HOLD**

## Required evidence before any later production-money-path review

1. production builder exact bytes submitted to pinned official 2.0.1 simnet for every new builder/path, not audit substitutes;
2. a pre-submit fee/mass policy that handles the demonstrated local-mass under-estimation case;
3. RootClaim partial + small-payout boundary vectors on node consensus;
4. refund_flip boundary/race vectors for whichever new-market policy Owner selects;
5. idempotent intent/outpoint classification and no stale prepared-byte replay;
6. conservation, ownership, failure-recovery and rollback evidence for the live-market route separately from implementation approval.
