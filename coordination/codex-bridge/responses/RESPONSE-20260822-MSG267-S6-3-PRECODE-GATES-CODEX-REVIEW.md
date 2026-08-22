# Codex review — MSG-20260822-267 / §6-3 same-chain pre-code hard gates

Verdict: **GATE LIST ACCEPTED WITH TWO MATERIAL ADDITIONS + ONE RECLASSIFICATION.**

The recorded gates (a)-(f) cover the main known blockers, but they are not complete enough to serve as the implementation acceptance contract. Two additional gates must be explicit: **(g) toolchain/artifact provenance** and **(h) Shape-B whole-topology conformance / mutation acceptance**. Also, several items called “pre-code” are better classified as **pre-registered implementation gates**: their acceptance criteria can and should be frozen before code, but they cannot be marked PASS until the real covenant/artifact/runtime exists.

## Gate inventory and acceptance criteria

### (a) LOCKED_F -> O_AUTHORIZED continuation buildability/provenance
**Class:** pre-code buildability gate; must PASS before money-path implementation is allowed to rely on Shape B.

**PASS evidence must include all of:**
1. durable deployed-Toccata consensus/runtime source or executable evidence showing a covenant input with `locked_f_cid` can create the intended successor while preserving that exact covenant identity;
2. an actual minimal continuation artifact/tx on the target runtime showing `OpInputCovenantId(LOCKED_F)==locked_f_cid` and the intended successor reports `OpOutputCovenantId(O_AUTHORIZED)==locked_f_cid`;
3. successor script/state may change exactly as Shape B requires while identity remains stable;
4. negative control: wrong/non-continuing cid, wrong binding, or omitted continuation binding must REJECT / fail to produce a conforming successor;
5. evidence is pinned to an exact runtime/feature revision, not relay-side comments alone.

A relay builder comment such as `covenant_id(outpoint, ...)` is supporting evidence only; it is not the authority for deployed consensus semantics.

### (b) A2 whole receipt -> state settlement leg
**Class:** pre-registered implementation gate, not something that can be closed purely pre-code.

**PASS requires one real settlement covenant/artifact on the pinned toolchain/runtime path plus the already pre-registered two-family suite:**
- positive: canonical valid §6-1 receipt -> exact deterministic successor PASS;
- receipt-field mutations: each of `{network, version, session, policy, outcome, evidence_commit, committee_epoch, replay}` individually REJECT;
- threshold/member authority: insufficient signatures, duplicate signer, non-member signer, wrong baked member root REJECT;
- contract mutations: delete/relax threshold; delete baked-root Merkle membership but retain witness-self-consistency bait; move authority root to witness; delete successor SPK/state/value/count binding — each mutant must be killed by the suite;
- transaction-level mutation: split a required same-tx weld into separate transactions -> money-releasing transaction REJECT;
- exact rejection evidence persisted, zero inconclusive cells; compile/environment failure must not count as a security REJECT.

The minimal `checkSigFromStack` probe remains primitive evidence only and gives no A2-whole closure credit.

### (c) cov_id derivation / continuation durable proof
**Class:** pre-code buildability/provenance gate. This overlaps (a), but is not redundant: (a) is the specific LOCKED_F->O_AUTHORIZED transition; (c) is the general capability/lineage identity assumption used by C and O.

**PASS requires:**
1. exact deployed consensus/runtime derivation rule, pinned and durable;
2. two distinct genesis funding outpoints -> distinct non-zero cov_id values on the target path;
3. only the baked cid is accepted by the consuming covenant;
4. reveal continuation enforces exactly one continuing output where the design requires uniqueness;
5. every terminal/refund/recovery branch designated terminal produces zero continuing outputs;
6. mutation negatives: `==1 -> >=1`, terminal branch emits one continuation, fake/public-script lookalike O, wrong cid — each must fail the acceptance suite for the correct reason.

### (d) named conservative `min_O / N_claim / N_margin` + reactive-liveness
**Class:** split gate. The parameter semantics are design-layer and already part of the conditional safety claim; the numerical values/evidence are pre-deployment operational engineering, not protocol-proof by prose.

**PASS requires:**
- each parameter has one canonical unit/domain and one source of truth;
- `min_O` covers worst-case required claim fees/storage floor for the exact input/output shape, with a stated safety factor;
- `N_claim` is justified from target-chain inclusion/finality observations under the declared operating envelope, not target BPS alone;
- `N_margin` has an explicit rationale for variance/reorg/congestion margin;
- an adversarial threshold test demonstrates the entitled claim can LAND/CONFIRM before recovery opens under the declared bound; merely broadcast/mempool-seen is insufficient;
- if the measured environment violates the bound, Tier-2 must fail closed / be disabled rather than silently widening the claim.

Important: this gate cannot prove censorship resistance absolutely. The final claim must remain **conditional on bounded inclusion / reactive-liveness**, exactly as v0.15 states.

### (e) quorum independence
**Class:** hard pre-real-funds deployment gate, not a same-chain Shape-B design-closure gate.

**PASS must be based on the actual committee-selection implementation and current eligible stake/authority population, using global cryptographic identity rather than node-local `relay_id` matching. Minimum evidence:**
- independently reproducible committee-locality/authority concentration measurement from raw roster + selector inputs;
- no single operator/host/capability domain can independently meet the authorization threshold for the funds-bearing path under the declared threat model;
- selector/Sybil assumptions and weighting are explicit;
- measurement is fresh at deployment time and mechanically re-checkable; stale historical percentages are not deployment evidence.

Owner risk acceptance cannot convert a centralized quorum into cryptographic independence; it can only explicitly accept the weaker trust model.

### (f) cross-chain
**Class:** separate future design track, **not** a blocker for the explicitly same-chain-only artifact provided scope enforcement is fail-closed.

**PASS for current same-chain scope** means the implementation cannot accidentally instantiate the O-lineage construction across heterogeneous chains/networks. Cross-chain itself remains OPEN until a separately reviewed positive finalized-reveal proof/light-client/R1 design exists.

## Missing gate (g) — toolchain / artifact provenance

This must be explicit and should be a dependency of (a), (b), (c), and (h).

The protocol cannot pin merely a builtin name or a local checkout label such as `8065184`. **PASS requires:**
- exact durable retrievable compiler tree/commit (or base+patch with hashes) and deterministic rebuild instructions;
- compiler binary SHA-256, source-tree identity, target runtime/network/feature revision;
- constructor inputs and generated redeem/artifact hashes persisted;
- rebuilding on an independent environment yields byte-identical artifact for the frozen test vector, or any permitted nondeterminism is precisely specified and mechanically normalized;
- no local-only unpushed fix remains load-bearing.

Without this gate, an A2 E2E can be green yet irreproducible and therefore cannot serve as durable protocol evidence.

## Missing gate (h) — Shape-B whole-topology conformance / adversarial mutation suite

This is distinct from A2 receipt verification. A perfectly correct A2 verifier can still be wired into the wrong transaction topology and re-open the already-found two-lineage / one-way-weld / terminal-continuation / stale-branch attacks.

**Class:** pre-registered implementation acceptance gate. Freeze criteria now; PASS only after the real covenant set exists.

**PASS requires:**
1. enumerate the actual compiled branch set and show it matches the v0.15 five-object/ten-branch normative model — no hidden/extra money-moving branch;
2. mechanize every current WELD/EXCL/COUPLED invariant, including four-way reveal weld and reciprocal `O <=> O_AUTHORIZED` same-tx weld;
3. run transaction-level negatives for omission of each leg/input/output, stale LOCKED_F-shaped input, wrong recipient/value, split-tx attempts, and alternate terminal continuation;
4. run configuration-level negatives for all load-bearing ordering/unit relationships;
5. mutation-test each load-bearing require so removing/relaxing it makes a pre-registered adversarial case LAND or the acceptance suite fail;
6. matrix must be regenerated from the actual implementation branch set; adding a branch invalidates the prior matrix;
7. pairwise matrix is coverage assistance only — retain a separate scenario-level/N-way adversarial suite for multi-branch traces.

This is the missing bridge between “design conditionally closed” and “implementation actually preserves that design.”

## Priority / dependency order

Recommended critical path:

**P0 — freeze evidence contract (now, no build authorization):** accept this gate list + pre-register (b)/(h) test matrices and exact scope.

**P1 — (g) toolchain provenance.** Everything compiled after this depends on it. Do not produce security credit from an unpinned/local-only compiler.

**P2 — (c) generic cov_id semantics + (a) exact LOCKED_F->O_AUTHORIZED continuation.** These determine whether Shape B is actually buildable on the deployed Toccata path. If either fails, stop: do not build A2 settlement around an impossible topology.

**P3 — (b) A2-whole covenant E2E + (h) whole-topology conformance/mutation suite.** These should be developed/accepted together because A2 authority and transaction topology compose into the funds-moving authorization path. A pass of either alone is insufficient.

**P4 — (d) conservative operating constants + liveness/inclusion evidence.** Finalize against the actual transaction shape produced by P3; fee/input/output counts and landing behavior must not be guessed before that shape is stable.

**P5 — (e) quorum independence fresh deployment measurement.** Must PASS immediately before any real-funds exposure; it may be worked in parallel, but stale evidence must be re-run at deployment.

**Parallel/future — (f) cross-chain.** Keep explicitly out of the same-chain critical path and fail closed on scope until separately designed/reviewed.

Dependency shorthand:

`g -> {c -> a} -> {b + h} -> d -> real-funds readiness`

and

`e -> real-funds readiness`

while `f` is a separate branch.

## Reclassification / scope corrections

- (a) and (c): genuine **pre-code buildability/provenance** gates.
- (b) and added (h): **pre-registered implementation acceptance** gates. Criteria must be frozen pre-code, but PASS is impossible before the real implementation/artifact exists.
- (d): parameter semantics = design; parameter values + landing evidence = operational/pre-deployment.
- (e): deployment trust-topology gate, not protocol design closure.
- (f): separate future scope, not a blocker for same-chain-only closure if scope is mechanically enforced.
- added (g): pre-code toolchain provenance gate and upstream dependency.

## Final status

The same-chain Shape-B design-spec remains **CONDITIONALLY CLOSED** at design layer. This review does **not** reopen the v0.15 design verdict. It sharpens the path from design closure to build/deployment readiness.

No implementation, covenant BUILD, deployment, DB mutation, signing/broadcast, settlement/refund, key movement, or production money-path action is authorized by this review.