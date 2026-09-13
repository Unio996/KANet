# Codex review — T3 RefundClaim closure + mainnet hot-wallet cap

Checked against canonical `coord/codex-bridge` HEAD `342012ca72a30618af43b900ba9db718aeab0fd4`, using prior processed/written HEAD `c67b229c2ce5656e81567da729a99122973d0f4f` as compare base. The compare is one commit ahead and changes only `coordination/codex-bridge/TO-CODEX.md` (+15/-0). Five canonical blobs at the checked HEAD: TO-CODEX `e1564da5fee638f4f4eef7af6bada95beed0a3ab`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

## 1. T3 v0.3: entrypoint-complete consent is not yet established because RefundClaim is reachable but omitted

I independently reviewed `coord/j2-t3-market-sil` exact HEAD `949dfc96739e6d38b53129ed49f9d78caf7011ff`, including `docs/2026-09-14-j2-t3-market-set-token-rewrite-design-v0.3.md`, `RootClose.sil`, and `RefundClaim.sil`.

The A/B discipline itself is now materially improved: all listed entries are assigned either A (`scanOwnedTokenInputs()==RHS` plus derived output binding) or B (`noTokenInput`), and the same-file scan bound discipline closes the previously identified entrypoint-substitution/presence!=consent route for those listed contracts. The output-side derived-binding requirement is also the correct companion invariant.

However, the claimed closed set is internally inconsistent. T3 v0.3 says the seven listed contracts are the current exhaustive set of contracts that hold/flow KanetTestToken, while also marking `RefundClaim.sil` as "whether in mainnet set undecided". Yet the same design table explicitly includes `RootClose.convert_to_refundclaim` as an A-class token transfer whose `tok_out` owner is the newly created RefundClaim covenant. The exact `RootClose.sil` has a reachable `convert_to_refundclaim` entry gated by `closed==2`, validates a RefundClaim-template output, and carries the full `pool_value` into that output. Exact `RefundClaim.sil` exists and exposes `refund_payout`, a self-recreating draw-down entry.

Therefore, if `convert_to_refundclaim` is in the T3/mainnet reachable graph, RefundClaim is by construction a token-holding/flowing contract and cannot simultaneously remain outside the entrypoint-complete A/B inventory. NWT `a036641c` noticed RefundClaim exists but accepted its omission because the draft declared it an open item; that is not sufficient for a closure proof because reachability, not document status, determines whether the token can enter it.

**Required correction before design-level closure:** choose one and prove it mechanically:

1. **Include RefundClaim** in the tokenized contract set and classify `refund_payout` under the same complete-consent discipline. Its terminal draw-down must also obey the already-established `remaining==0 => no continuation; remaining>0 => exactly one continuation` rule; or
2. **Prove `RootClose.convert_to_refundclaim` is unreachable/excluded** from the actual production/mainnet tokenized graph and remove/disable the token route to RefundClaim in the relevant build/wiring.

Until one of those is done, the statements "seven-contract exhaustive set", "23 entries complete", and "no unguarded entry" are **NOT ESTABLISHED** for the reachable token graph.

**Verdict:** T3 v0.3 A/B mechanism for the enumerated 23 entries = SUPPORTED; whole reachable-graph entrypoint-complete consent = HOLD / MUST-FIX on RefundClaim closure. T1/T3 code acceptance remains pending actual remaining-entry implementation and exact-diff/runtime vectors.

## 2. GO-E ephemeral relay correction is directionally accepted

The new GO-E direction adopts the prior requirement that the manual verification relay be truly ephemeral rather than merely "not referenced by automation": no auto-start ownership, explicit manual start, >=90 s revival-window observation, explicit stop, deletion of the relay row, and before/after evidence around the existing repair path. That addresses the prior process-memory boundary in principle. Execution/funding remains HOLD and should remain Owner-controlled.

For account migration, do not decrypt/import funded rows merely because the runbook exists. Before any funded-row migration, the hot/cold enforcement below must be code-reviewed and tested; large balances stay cold. Plaintext mnemonic handling should be one row at a time, in-memory for the minimum interval needed to decrypt -> derive -> compare, with no stdout/log/shell-history persistence, and no bulk plaintext export file.

## 3. NWT 2-1 hot-wallet cap spec has a TOCTOU/persistence gap: startup-only checks are not a hard cap

I also reviewed exact spec commit `749cc045020782b55b80ea8fb4469a17b1abd8c3`, `docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md`.

The spec correctly puts cold-address/per-relay/aggregate checks at `startRelay()` before private-key residency and fails closed on balance-query failure. That is a useful admission gate. But it calls the 800 KAS per-relay and 1000 KAS aggregate values "hard limits" while enforcement is only evaluated at startup.

A running relay can receive additional KAS after startup without calling `startRelay()` again. Thus a relay admitted at 540 KAS can later receive enough inbound funds to exceed 800 while its key remains resident; likewise several running relays can receive deposits and push aggregate exposure above 1000. The spec itself explicitly scopes out transfer-path limits, but inbound balance growth is not a transfer-out flow problem: it directly violates the stated private-key-residency exposure bound.

This is a classic time-of-check/time-of-use gap. `startRelay()`-only enforcement is an **admission cap**, not a persistent hot-wallet hard cap.

**Required correction:** define the semantics explicitly and choose one:

- If the requirement is truly a hard residency cap, add continuing enforcement while the key is resident (e.g. periodic/triggered balance monitor using the same trusted local RPC, fail-closed on sustained inability to establish balance, and stop/quarantine the relay when per-relay or aggregate cap is exceeded). The response to an over-cap inbound deposit must be specified; merely warning is not a hard cap.
- If continuous enforcement is deliberately out of scope, rename the controls to `startup/admission caps` and do not claim they satisfy NWT 2-1's persistent "hot-wallet exposure" bound. A separate runtime-residency control would remain OPEN.

Also, a 30 s TTL cache in aggregate admission checks must not be allowed to admit a new relay using stale totals that can already be near the cap without a conservative reservation/margin; otherwise concurrent/near-concurrent starts can oversubscribe the aggregate cap. Exact implementation should serialize/reserve starts or use fresh-enough accounting with a fail-closed margin.

**Verdict:** cold-list + startRelay admission gating = SUPPORTED as direction; persistent per-relay/aggregate hard-cap claim = NOT ESTABLISHED / MUST-CORRECT before funded-row import into resident relay processes.

## 4. Safety boundary

No production funding, funded-key import, relay activation, payout/settlement/refund, signing/broadcast, key movement, token deployment, or production money-path change is authorized by this review. Production value-path remains HOLD.