# Codex review — D-022 settlement implementation plan / active-line delta

## Git / bridge verification basis

- canonical branch checked first: `coord/codex-bridge`
- HEAD before this write: `37a5e6777429a3b9b2e46910aa8810a79281eadf`
- previous processed/written-back SHA: same SHA; bridge commit delta is therefore zero.
- five canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` `31c745ca162d97c29313368a2860066fb4ad51f9`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no timestamp field was used for incremental detection.

Because bridge itself had no delta, I checked the directly-related active line `bshard-m3-deploy`. It advanced from the prior active checkpoint `358006b4ea92810ccab49d35c8f4c742483178aa` to `229c59da5f1fbc4aa991679bc58219a3d5746cdf` (2 commits):
- `b925dc5ca9732decb60124068dc8f9188df5ab2f` — D-022 Owner decisions / implementation authorization, but explicitly retains per-builder 2.0.1 simnet and separate mainnet execution gates.
- `229c59da5f1fbc4aa991679bc58219a3d5746cdf` — Bettor review of J2 implementation plan `eb361933540a0d6c70142bb2f76a89c18f1cb27f`.

## Independent code/design judgment

### 1. Reusing `covenant_broadcast` is the correct relay boundary

I support rejecting six new relay command kinds. If the relay already treats covenant broadcast as kind-agnostic and the console owns per-kind construction/validation, adding six command names enlarges the privileged IPC/allowlist surface without adding a new trust boundary or validation capability. Settlement-specific caps and structural validation should remain console-side before the existing broadcast funnel.

### 2. D-022 does not remove the production-byte gate

Owner approval to implement and the choice of Route A are not equivalent to permission to execute mainnet settlement. The active decision itself requires every production builder's exact bytes to be accepted by pinned official kaspad 2.0.1 simnet before merge/mainnet progression, and mainnet execution remains a separate Owner gate. Keep `PROTO_SETTLEMENT_DRIVER_ENABLED` default-off and fail-closed.

### 3. MUST-PROVE before coding claim/ticket signing: ticket `bettorPk` key provenance

The plan/review resolves the *contract requirement* correctly: `PoolSideTicket.authorize_spend` requires the ticket bettor signature. But the proposed operational shortcut — use `committee_pubkeys_json[0]` / decrypted committee key as the bettor signing key — must not be assumed from the fact that v0 is single-operator.

The covenant state itself binds a distinct `bettorPk` field, and existing bshard code/data models distinguish `committeePks` from per-bet `bettorPk`. Therefore the implementation must derive the required signing key from the **actual ticket state / bet provenance for the exact ticket being consumed**, then prove that its public key equals that ticket's committed `bettorPk` before signing. If the live Route-A ticket was in fact minted with committee key 0, that equality check will close the issue. If not, silently substituting committee key 0 will produce an invalid witness or, worse, encode a false ownership assumption into production code.

Required regression: fixture where `bettorPk != committeePk[0]` must fail before IPC/signing when only committee key 0 is available; fixture where derived signing pubkey exactly equals ticket `bettorPk` may proceed. Do not log/deposit decrypted private material.

### 4. Repeated commissioner key remains prototype-scoped evidence only

The prior 2.0.1 simnet acceptance with one commissioner key/signature repeated across five slots proves the exact prototype script path accepts that shape; it does not prove distinct-key 4-of-5 ceremony semantics. Implementation may preserve the existing v0 prototype arrangement only if it is explicitly scoped as such and does not generalize the evidence into a production threshold-security claim.

### 5. Ticket reclaim fee remains an implementation gate

Do not turn the simnet fixed `2,000,000 sompi` fee into a production fee algorithm. `getMempoolEntry` is post-admission evidence, while the local mass helper materially underestimates the minimal ticket-reclaim shape. The production builder needs a conservative pre-submit policy/preflight that is independently tested against 2.0.1 node storage/compute mass, with provenance recording both dimensions.

## Current verdict

- D-022 implementation direction: **SUPPORTED WITH GATES**.
- reuse existing `covenant_broadcast`: **SUPPORTED**.
- settlement driver default-off: **REQUIRED**.
- Route-A mainnet execution: **NOT AUTHORIZED by this review**.
- committee-key-as-ticket-bettor-key assumption: **MUST-PROVE exact pubkey equality from ticket provenance before signing**.
- ticket reclaim fee policy: **OPEN / MUST-PROVE**.
- RootClaim partial + removal of `payout >= 1000`: separate new-market branch remains subject to its own 2.0.1 partial-path test.
- refund path / refund_flip production execution remains outside this Route-A implementation closure.

No production funds-path deployment, mainnet signing/broadcast, funded-key movement, claim/refund/withdrawal/reclaim execution, or driver enablement is authorized here.
