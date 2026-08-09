# Codex review — unsynced (i) prototype semantic red-team

## Git/bridge basis

- bridge baseline / start HEAD: `eb535ba25beb83f755bd3aa9eb6dbbadd1565905`
- bridge compare baseline..HEAD: identical; ahead=0, behind=0, files=[]
- canonical blobs rechecked from current bridge tree:
  - `TO-CODEX.md` = `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- bridge had no increment, so I checked the directly corresponding active branch.
- `bshard-m3-deploy`: prior reviewed `7af34db2ca72874422d8db619ea46e59aa5501bc` -> current `ad1b8c4dedb8c208c4ec53ed1327f58dfbf53089` (1 relevant commit).
- new evidence commit: `ad1b8c4dedb8c208c4ec53ed1327f58dfbf53089`, adding `docs/2026-08-09-i-proto-redteam.md` (blob `9b414868dff37af8cb979d04334849a106499560`).

## Independent verdict

### 1. Semantic mismatch is real: prototype moves refund NETWORK-fee authority, not market policy-rate authority

`PoolSpine_i_proto.sil` blob `4d2358ffe55d4c7058f76255c8113611be373fd6` adds ctor params `marketMinFee` / `marketMaxFee`, but the only money-bearing use is in `refund_maker_unjoined`:

```
require(tx.outputs[0].value <= makerStakeAmount - marketMinFee);
require(tx.outputs[0].value >= makerStakeAmount - marketMaxFee);
```

This is the same economic slot that v0.7 comments describe as the dynamic miner/network transaction-fee haircut used to avoid the qlfpv hardcoded-fee brick. It is therefore a per-market *refund network-fee bound*, notwithstanding the `market*` names.

By contrast, `settle_aggregate` still constrains broker output 0 only by scriptPubKey + dust (`>=1000`); it does not reference `brokerFeePct` or `oracleFeePct`. So the prototype does **not** raise authority of the market policy rates that the (i) headline was originally about.

**Verdict: red-team H4 / semantic mismatch = ACCEPTED.**

### 2. Enumerator still has an MF-1-style ontology bug

`fee-authority-enumerate.mjs` blob `cf2b979663fec0dc36167f797a7899b002883146` classifies fee family mainly from parameter names. In particular, `marketMinFee` / `marketMaxFee` become `market`, and any market-family range hit is reported as `PER-MARKET(range)`.

That means the verdict can change when the same economic quantity is renamed, without changing what the covenant actually constrains. The new structured comparison logic fixed the older same-line equality false-positive, but it does not solve this higher-level semantic classification problem.

**Verdict: `PER-MARKET(range)` for this prototype is syntactically true but semantically overclaimed. Final DoD authority must be quantity/flow-based, not name-family-based. MUST-FIX before using the enumerator as a positive acceptance oracle.**

Recommended hardening: define explicit authority targets (e.g. `broker_policy_fee`, `oracle_policy_fee`, `network_tx_fee`) and map them to spend-bearing outputs/formulas via AST/data-flow or contract-specific machine-readable metadata. A parameter name alone must never decide which authority target is satisfied.

### 3. Invalid interval is a genuine constructibility/fund-liveness hazard, but the guard must be at creation time

If `marketMinFee > marketMaxFee`, the two refund inequalities imply an empty output-value interval (`output <= stake-min` and `output >= stake-max` with lower bound greater than upper bound). For a state that relies on `refund_maker_unjoined`, that refund path is impossible.

There are additional feasibility conditions beyond only `min <= max`: the allowed interval must intersect the dust-valid output domain, and negative / absurdly large bounds should be rejected. At minimum the market creation/compile path should enforce a canonical domain such as:

- integer/non-negative bounds;
- `marketMinFee <= marketMaxFee`;
- `marketMinFee <= makerStakeAmount - MIN_DUST` (so at least one dust-valid refund output exists);
- policy cap on `marketMaxFee` appropriate to the intended anti-burn semantics.

Important correction: adding these as `require(...)` only inside `refund_maker_unjoined` is **not sufficient** to prevent malformed covenant creation — it merely makes the malformed covenant fail more explicitly when spent. The authoritative market-construction/compiler path must reject invalid parameter tuples before deriving/funding the P2SH, with negative tests proving no address/funding artifact is emitted for invalid intervals. A runtime covenant-side sanity check may be defense-in-depth, not the primary creation invariant.

**Verdict: invalid-interval hazard = RED / MUST-FIX before prototype can be considered constructible-safe.**

### 4. Suggested broker-fee equality is promising but not yet accepted as implementation

The red-team is directionally right that qlfpv's mass-driven variability belongs to the network-fee/refund quantity, not automatically to a deterministic broker policy fee. Therefore an equality tying the broker output to a committed rate need not inherit the refund fee's qlfpv problem.

However, the exact formula, basis (global pot vs shard-local spend), rounding order, integer overflow behavior, zero-fee output shape, and conservation with committee/winner/network-fee outputs remain unverified. The red-team itself marks these as inference/uncompiled.

**Verdict: design direction ACCEPTED IN PRINCIPLE; exact settle formula remains OPEN and must receive compiler mutation tests + positive/negative transaction construction tests before any covenant change is accepted.**

## Required next acceptance evidence

1. Creation-path invalid-bound rejection tests proving malformed tuples emit no fundable covenant/address artifact.
2. Enumerator ontology fix: authority classification independent of parameter naming, with rename-invariance negative controls.
3. A settle prototype that binds the intended `brokerFeePct` / `oracleFeePct` economic outputs, not the refund network-fee haircut.
4. Compiler/redeem mutation proof that the intended policy-rate commitment changes the redeem/address.
5. Positive + adversarial transaction tests covering rounding, zero-fee markets, overflow-safe arithmetic, output-index correctness, and total-value conservation.

No production deployment, funding-path mutation, signer/broadcaster change, settlement/refund action, key movement, or production DB mutation is authorized by this review.
