# Codex independent review — unsynced ST-02 cross-node refund custody binding

## Check basis

- Last processed / written-back bridge commit: `8258e70edf309a94ec7044e1ec8cabf94bbf610f`.
- `coord/codex-bridge` HEAD at start of this run: `8258e70edf309a94ec7044e1ec8cabf94bbf610f`.
- Git compare: identical; ahead 0 / behind 0; actual diff empty.
- Canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` = `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No file-internal timestamp was used for increment detection.

Because the bridge had no increment, I checked the directly relevant active branch.

- Previously reviewed `bshard-m3-deploy`: `b4e12048d6a303af6be133a5f0d18d3a1a80f772`.
- Current active HEAD: `c6022cf498005a9e921a01bda585c99924403f89`.
- Git compare: ahead 1 / behind 0.
- Only changed file: `docs/2026-08-07-st02-snapshot-and-operator-replaceability-matrix-v0.1.md`, +26/-0.
- Current ST-02 document blob: `b5eed43060e8bdec18a460c8b36757b7492930eb`.
- Production `kasia-console/src/services/pool-market-settler.js` blob at the same active HEAD: `74231c3c7a67db90f713716ac8d77fa1e7bcea42`.

## Independent code findings

### 1. Narrow current-implementation finding is CONFIRMED

The active ST-02 addition is correct that an observer whose market row carries `maker_relay_id = "cross-node:<pk>"` cannot use the current legacy maker-refund path locally.

This is not just a comment:

1. `buildMakerRefundPreimage()` first resolves the maker payout address with local state:

   `SELECT address FROM relay_nodes WHERE id = market.maker_relay_id`

2. If that local row is absent and the id is a `cross-node:` sentinel, the function explicitly returns:

   `cross-node maker (skip)`

3. If it succeeds, preimage construction is sent through:

   `sendCommandAsync(market.maker_relay_id, ..., 'internal')`

   so the current implementation requires a locally actionable maker relay identity, not merely a globally observed market row.

4. `handleRefunding()` independently contains another explicit `cross-node:` guard and returns `cross-node maker` before the real signature/broadcast path.

5. The structural-failure classifier treats this shape as non-transient, and callers can route it to the frozen/manual-authorization state rather than retrying indefinitely.

Therefore the following statement is code-level supported:

> A node that only has a cross-node sentinel for the maker cannot presently construct and complete the legacy maker refund through this settler path.

This is a real ST-02 replaceability blocker.

### 2. "Bound to the original producer node" is too strong as a protocol claim

The code does **not** prove a cryptographic or physical-host binding to the historical machine that originally created the market. What it proves is a binding to a **locally actionable maker relay identity / maker-key custody domain plus the required local state and tooling**.

That distinction matters. A successor that merely observes/imports market facts but does not possess an actionable maker relay/key cannot act. But the current evidence does not prove that a properly authorised successor could never restore/migrate that relay identity/key material and become locally actionable.

Accordingly, replace the strongest wording:

> refund construction is bound to the original producer node

with the narrower mechanically supported statement:

> the current refund implementation is bound to the node/custody domain on which the maker relay identity and required signing capability are locally actionable; an observer carrying only `cross-node:<pk>` cannot act.

If the intended institutional requirement is "successor without incumbent consent or incumbent key handoff", then this implementation still **fails that requirement**. Copying/migrating incumbent private keys is continuity by custody transfer, not proof of incumbent-independent replaceability.

### 3. `n=1293` is OBSERVED, not yet repository-replayable evidence

The new ST-02 text reports:

- 1293 rows in `unresolved_needs_authorization`; and
- all 1293 with `unresolved_reason = "退款构造结构性失败: cross-node maker (skip)"`.

The code-path interpretation is independently confirmed, but this commit does not add a versioned evidence artifact containing the SQL/result digest/database identity/snapshot identity needed to reproduce the exact `1293` count. Therefore:

- the **mechanism** is CODE-LEVEL CONFIRMED;
- the exact **1293 count** is currently OBSERVED / NOT YET INDEPENDENTLY REPLAYABLE.

Do not promote `n=1293` into the institutional failure corpus as VERIFIED until an evidence package comparable to the G-4/ST-00 packages is committed.

### 4. This does not close the earlier fresh-successor bootstrap gap

Even after correcting the wording above, ST-02 remains NOT_PROVEN overall. A successor still needs independently obtainable and verifiable inputs/capabilities, including at minimum:

- authoritative market state rather than incumbent-local state alone;
- complete enrollment/snapshot reconstruction from an empty successor state (previous `ST02-G0` issue);
- required compiler/redeem/proving artifacts;
- the relevant signer/key custody or a protocol path that does not require incumbent key transfer;
- canonical fee/policy inputs; and
- a tested transaction-construction/broadcast path whose authority does not come from an incumbent-only local identity.

A useful acceptance test is a **fresh successor test**, not a second observer test: start without the incumbent DB/process identity and without copying incumbent private keys, reconstruct all allowed authoritative state, and demonstrate that the protocol either permits the intended action or fail-closes. If key migration is an explicitly accepted operating model, test that separately and call it custody-transfer continuity, not permissionless/operator-independent recovery.

## Verdict

- Current `cross-node:<pk>` observer cannot execute legacy maker refund locally: **CONFIRMED**.
- Current refund path depends on locally actionable maker relay/address/signing state: **CONFIRMED**.
- Physical/historical "original producer node" is the only possible actor forever: **NOT PROVEN / wording too strong**.
- Incumbent-independent successor replaceability: **NOT PROVEN**.
- Exact `n=1293` exposure count: **OBSERVED; evidence package missing**.
- ST-02 overall: **OPEN / NOT_PROVEN**.

No implementation, deployment, key migration, refund, settlement, claim, signing, broadcast, DB backfill, restart, or production money-path action is authorised by this review.