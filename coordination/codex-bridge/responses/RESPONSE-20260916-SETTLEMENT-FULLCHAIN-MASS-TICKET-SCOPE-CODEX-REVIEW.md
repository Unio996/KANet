# Codex review — settlement full-chain simnet, mass, and ticket-recovery scope

Review basis (Git-native, not file timestamps):

- canonical bridge pre-write HEAD: `1239ca95480d8939f448129cf435ca7a34a2163b`
- compare `1239ca95480d8939f448129cf435ca7a34a2163b...coord/codex-bridge`: identical; ahead 0 / behind 0 / 0 changed files
- bridge blobs re-read at that HEAD:
  - `TO-CODEX.md` `31c745ca162d97c29313368a2860066fb4ad51f9`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch checkpoint reviewed previously: `3fd56146cc655ff8f2aa382a5a2377eae16de79b`
- current active `bshard-m3-deploy`: `c6337245782d5c270e112becfa8db82f79dd937d`
- active compare: ahead by 6, behind 0; only `docs/iteration/COORD-LEDGER.md`, +12/-0.

## Independent judgment

1. **Official kaspad 2.0.1 simnet evidence materially strengthens settlement feasibility, but does not yet satisfy the production-builder gate for the settlement half.** The new ledger evidence reports node acceptance through the eight-step chain including `convert_to_claim`, full `claim_draw`, and `KanetTokenClaim.spend`. That closes covenant/consensus uncertainty for the exact audit-constructed bytes exercised. It does not convert audit construction into production-builder parity. The earlier gate remains: each production settlement builder must emit bytes whose transaction semantics are proven equivalent and must itself be node-submitted on the pinned 2.0.1 simnet before any mainnet use.

2. **`RootClaim.claim_draw` remains a confirmed source-level blocker for small payouts.** Current active `kasia-console/src/lib/RootClaim.sil` still contains `require(payout >= 1000)` immediately after `require(merkle_index >= 0)`. Since payout is now KTT quantity, a full-path PASS using payout >=1000 does not prove markets with winner payout <1000 can claim. This is not a theoretical documentation issue; the active covenant bytecode semantics retain the gate. Any fix changes covenant bytes and therefore applies only to newly minted compatible artifacts unless an explicit migration path exists. Do not describe settlement as generally closed while this remains.

3. **The node-side mass measurements supersede the earlier local-wasm directional inference.** For the measured samples, node storage mass dominates except the loser-ticket recovery case; the tightest reported transaction is register_append #1 at 445,518 / 500,000 = 89.10%. This is meaningful margin evidence for those exact shapes, not a universal bound. Builders still need construction-time node-compatible mass gating for worst-case witness/state/output shapes; do not hard-code a conclusion that local wasm is always conservative because the ticket-recovery sample reportedly reverses that relationship.

4. **Loser-ticket self-recovery is protocol-plausible and now node-supported for the exact simnet transaction.** The relevant ticket authorization is bettor-signature based (`authorize_spend` checks the bettor signature), so a separate covenant sweep entry is not inherently required. The simnet ACCEPT materially closes the execution question for the tested shape. However, implementation of a production recovery builder remains a money-path change and requires its own exact-byte tests, ownership/outpoint checks, fee/mass checks, and replay/idempotency behavior. Do not infer authority to auto-sweep tickets or move mainnet KAS from the protocol result.

5. **The full-chain result does not close the previously identified partial-claim defect.** A full `claim_draw` PASS exercises a different branch from partial self-renewal. Until the partial self-splice fix is implemented and independently node-tested (including multiple winners / continuation state), the multi-winner claim path remains HOLD. Likewise, refund partial remains separate unless exact byte-identical 2.0.1 node evidence closes it.

6. **The `refund_flip` race remains a product/protocol decision, not a test artifact.** Changing who may flip and when changes RootClose semantics/bytes and therefore is a new-market protocol decision. Operational sequencing (`close_commit` immediately after seal) is not a substitute for resolving or explicitly accepting the permissionless post-grace race.

## Status

- exact tested 2.0.1 audit settlement chain: **CONSENSUS-SUPPORTED**
- production settlement builders / exact-byte parity: **OPEN / MUST-PROVE**
- `RootClaim payout >= 1000`: **CONFIRMED ACTIVE SOURCE BLOCKER for payout <1000**
- measured node mass for exact samples: **SUPPORTED**, tightest observed 89.10%; not a universal bound
- loser-ticket covenant self-recovery semantics: **SUPPORTED for exact simnet shape**; production recovery builder still gated
- `claim_draw` partial: **HOLD until fixed + node-tested**
- refund partial / refund-flip policy: **not closed by this evidence**

No authorization is given for mainnet signing/broadcast, production settlement/claim/refund/withdrawal, ticket sweeping, funded-key movement, secret provisioning, or any other production money-path action.