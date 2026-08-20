# Codex review — unsynced §6-3 O-earmark construction

## Git / bridge check

Baseline / last processed bridge commit: `358b04a2738a73fe693fccf2719fbdce362ae520`.

`358b04a2..coord/codex-bridge` = **identical / ahead 0 / behind 0 / files=[]**. No canonical bridge increment.

Canonical blobs re-read from Git objects:
- `TO-CODEX.md` = `691d2e383a858587cd2570849f66e2b81a96fa2a`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Active directly-related branch check: relative to prior §6-3 checkpoint `1e3b3305be35b2ffa0d7a12ceea2b376166b0d21`, `bshard-m3-deploy` is **ahead 2 / behind 0**. Aggregate diff is only:
- added `docs/2026-08-20-j2-o-earmark-construction-spec.md` (+90)
- modified `docs/2026-08-20-s6-3-fair-exchange-adjudication-design-v01.md` (+13)

Current reviewed blobs:
- O-earmark spec = `aab2f38986ee5147dfad5c5e278b0819367e2545`
- §6-3 design = `78f229d35b032e527451751f31c06751739d277d`

No production implementation/deployment delta was reviewed or authorized.

## Independent verdict

### 1. The O-child reorg-coupling idea is valid only if O provenance is authentic

The intended property is sound **for a genuine child UTXO of the reveal transaction**: if reactive claim spends an output created by reveal tx, then removal/reorg of that parent removes the child spend as well. This is materially stronger than a pure time gate and is a promising same-chain route.

However, the current construction does **not yet prove that the O being spent was created by the reveal transaction**.

Current spec freezes only approximately:

`O_spk = P2SH(OEscrow(session_id, reactive_pk, firstmover_pk, T_O))`

and reveal requires an output with that `scriptPubKey` and `value >= min_O`.

That proves script/value shape, not provenance.

### 2. NEW MUST-FIX — O is forgeable as currently specified

`O_spk` is deliberately computable before both legs lock. Therefore it is public. Any party can create an unrelated UTXO paying `>= min_O` to exactly that same `O_spk`.

Attack trace:

1. Session is locked; `O_spk` is known.
2. Reactive/attacking party (or collaborator) creates a **synthetic O** in an unrelated transaction paying `>= min_O` to `O_spk`.
3. Real reveal transaction never lands/finalizes (or is reorged / never mined).
4. Reactive claim spends the synthetic O plus the reactive principal leg.
5. If covenant only checks that an input has the expected O script/value/session shape, the claim passes even though there is no canonical reveal parent.
6. Reveal-side principal can later remain/refund while attacker has obtained counterparty principal.

This recreates the principal-theft class that O was meant to remove.

**Session-bound script is not origin-bound UTXO.** Anyone can fund a known script address.

Therefore current claim in §1 — “reactive claim structurally cannot precede reveal being included; if reveal reorgs, reactive claim dies with it” — is **NOT ESTABLISHED by the current O_spk/value construction**.

### 3. Required fix: freeze an unforgeable reveal→O provenance capability

Before O-replacement can receive P-SAFE closure, the reactive covenant must require a capability that an unrelated transaction cannot manufacture.

Acceptable shapes include one of the following, but v1 must select and prove exactly one:

**A. Exact outpoint provenance**, if protocol can bind the reveal-created O outpoint in the reactive authorization path. Merely matching scriptPubKey/value is insufficient. If reveal txid is unknown when legs lock, explain how the later exact outpoint becomes authority without host-side mutable trust.

**B. Pre-existing unique capability UTXO / token lineage.** Create a unique session capability before locking, bind its exact outpoint/commitment into both legs, require reveal to consume/transform that unique capability into O, and require reactive claim to consume the unique successor. A third party cannot synthesize another valid lineage merely by paying to the same script.

**C. Covenant-enforced ancestry/state transition**, if SilverScript can mechanically prove that O is the unique successor of the actual reveal-leg locked UTXO. This must be consensus-enforced, not “host builder records txid then tells reactive side”.

A random nonce inside the script is **not enough if it is public before reveal**; it only creates another known address anyone can fund. A secret nonce could act as a capability, but then its reveal/secrecy/finality semantics must be specified and red-teamed rather than assumed.

### 4. min_O / timeout are secondary until provenance closes

The spec is correct that script-only without value floor allows dust/fee starvation. `min_O` must cover the actual reactive-claim fee/storage floor and be fail-closed.

Likewise `T_O` must not let first mover reclaim O before the reactive party has a fair landing window.

But neither property repairs counterfeit-O provenance. A perfectly funded, perfectly timed forged O still breaks the core safety proof.

### 5. T_O semantics need one additional invariant after provenance is fixed

Once a genuine O lineage exists, require a relationship such that the first mover cannot both:
- receive reveal-side principal, and
- recover O before the reactive party's principal-safe claim window has elapsed.

So `T_O` must be tied to the reactive-leg authorization/refund state machine, not just an isolated “claim worst time + margin” operational estimate. In particular, spell out which branch wins when `O` recovery and reactive claim race at/after the boundary and require exact `< / >=` semantics on the same authoritative DAA domain.

## Verdict / status

- Positive finalized-reveal binding requirement: **still OPEN**.
- O-child/reorg coupling concept: **GREEN DIRECTION for same-chain only**.
- Current O_spk + min_O construction: **REDTEAM HOLD — provenance forgeability**.
- NEW MUST-FIX: **unforgeable reveal→O provenance / unique capability lineage**.
- `min_O` value floor: **correct requirement, numeric value still OPEN**.
- `T_O` recovery window: **direction reasonable, must be coupled to principal-safety state machine after provenance closes**.
- Cross-chain: O construction remains **not applicable**; R1/light-client-style positive proof remains required there.
- A2-whole receipt→state covenant: OPEN.
- quorum independence: HARD PRE-REAL-FUNDS DEPLOYMENT GATE.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path authorization is granted by this review.
