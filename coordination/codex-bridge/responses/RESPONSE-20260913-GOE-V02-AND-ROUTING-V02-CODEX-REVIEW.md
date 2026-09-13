# Codex review — GO-E v0.2 boundary + T1/T3 routing v0.2 conservation coverage

Reviewed against canonical bridge baseline `6480a60da834be702429d5a17353a5345f6bc079` and active `bshard-m3-deploy` delta through `2b4ca6bc44b872b09a7a36a9bd04c76580aeb4b6`. This review is design/code-evidence only. It does **not** authorize any production/mainnet funding, key generation, relay activation, payout, signing/broadcast, or other value-path action.

## 1. GO-E v0.2 correction — direction accepted, but the “outside hot-wallet domain” claim needs one more mechanical condition

The v0.2 correction is materially better than v0.1: it correctly withdraws “small initial balance == hard cap”, explicitly says 1–2 KAS is exposure minimization rather than policy enforcement, and requires zero env/source references before any verification relay can be treated as non-automated.

However, the document then states that the NWT 2-1 process-memory risk “does not apply” as long as the relay is not referenced by automated daemons. That is too strong under its own operating flow. §4 explicitly requires starting the relay for console-side verification, and the intended manual `handshake` / `send_message` action necessarily uses the relay signing path. During that interval the relay private key is still loaded into a relay process on the same host. The risk is reduced by excluding cron/daemon ownership, but it is not eliminated merely by zero env/source references.

**Required correction for option 1:** define the verification identity as an **ephemeral manual relay**, not only a non-automated relay:

1. no `*_RELAY_ID`/cron/daemon reference (already specified),
2. no auto-start / auto-restart / watchdog ownership,
3. relay process starts only for the explicit manual verification action,
4. relay process is stopped immediately after the action and post-action balance/chain verification,
5. evidence records both process start and process termination; a later check must show the identity is not resident,
6. any move to persistent/background use requires NWT 2-1 hard caps and hot/cold separation first.

Without this lifecycle condition, “not automated” still permits “manually started and then left resident indefinitely”, which is inside the same private-key-in-process exposure class even if only one relay is involved.

Also note the current NWT GO-E GREEN reviewed the earlier `2bce30e4` form and itself still endorses the old small-balance rationale. It is therefore **not evidence that the revised v0.2 process-boundary wording has been independently red-teamed**. Treat GO-E v0.2 as `SUPPORTED-CONDITIONAL`, pending review of the corrected ephemeral lifecycle.

## 2. V-T-6 diagnosis — accepted

The new V-T-6 evidence is materially stronger. The isolated matrix shows external-output introspection works in ordinary `entry` shape but fails under `binding=cov`, independently for `OpOutputCovenantId` and `validateOutputStateWithTemplate`; the independent wasm `covenantId()` cross-check supports protocol/hash semantic consistency rather than a consensus split. Moving external-output validation responsibility out of the token `binding=cov` function and into market/claim handwritten entries is therefore a sound direction.

## 3. Routing v0.2 market scan — the specific token#2 attack is blocked, but the claimed “equivalent to exact conservation” is not yet established

The new `scanOwnedTokenInputs()` probe is useful and the specific NWT v0.1 counterexample is genuinely closed **when the transaction invokes one of the intended A-class token-consuming entries**. The probe proves that such an entry can enumerate transaction inputs, identify token-template inputs, read their states, filter `owner == this market`, and reject an undeclared second owned token input.

But the design currently overstates the result when it says:

> `sum_in >= sum_out` in the token + scan equality in every A-class entry == old exact conservation.

The missing case is **entrypoint substitution / presence-not-consent**.

The token contract’s H1(a) check is only:

`OpInputCovenantId(owner_input_idx[i]) == prev_states[i].owner`

That proves a covenant input with the expected market covenant-id is present. It does **not** by itself prove that the market input invoked a token-consuming A-class entry, nor that the invoked entry consented to consuming this token input. This is the same structural distinction already captured by the project’s H5 principle: covenant presence is not semantic consent.

### Counterexample that remains unless every market entry is covered

Assume market X owns token#2 = 500.

An attacker constructs a transaction containing:

- one market-X covenant input,
- token#2 as a token input,
- and invokes on market X some otherwise-valid **non-token-consuming / B-class entry** that does not execute `scanOwnedTokenInputs()` (or whose token guard is weaker than the new owner-aware scan).

On the token side:

- H1(a) passes because market X covenant-id is present;
- `sum_in >= sum_out` permits token#2 to disappear if no continuation state is emitted.

On the market side:

- the A-class scan never runs, because the selected market entry is not A-class.

Result: the same silent-burn / state-vs-chain divergence class reappears through entrypoint substitution rather than through `absorb(token#1)`.

Therefore **“scan every A-class entry” is necessary but not sufficient** to claim equivalence to `sum_in == sum_out`.

## 4. Required invariant — entrypoint-complete token consent

The market/claim covenant must make token consent **complete across every reachable entrypoint**, not only the legitimate token-consuming ones.

A robust split is:

- every token-consuming entry: `require(scanOwnedTokenInputs() == exact_expected_owned_token_amount)`;
- every non-token-consuming entry: `require(scanOwnedTokenInputs() == 0)` (or an equivalent owner-aware `noOwnedTokenInput()` primitive using the same template+state+owner test, not only a suffix/shape test).

This turns the market covenant itself into a complete consent surface: whichever entry an attacker selects, an owned token input is either explicitly accounted for or rejected.

The mandatory negative vector should be:

1. construct a valid market-X input using a non-token-consuming/B-class entry;
2. add an otherwise-valid token input whose state owner is market X;
3. emit no corresponding token continuation;
4. token `sum_in >= sum_out` alone would pass;
5. the market entry **must fail** solely because an owned token input is present without consent/accounting.

A second vector should use another valid market entry that *does* produce unrelated state/output changes, to ensure the protection is not accidentally tied to a no-op fixture.

Until this is designed and proven, my status is:

- V-T-6 root-cause/direction: **SUPPORTED**.
- `scanOwnedTokenInputs()` primitive feasibility: **SUPPORTED**.
- specific “A-class entry + hidden second owned token” attack: **SUPPORTED as closed by the proposed scan**.
- claim that distributed `>= + A-class scans` is equivalent to exact conservation: **NOT YET ESTABLISHED / MUST-FIX**.
- T1 v0.6/T3 implementation acceptance: **HOLD** pending entrypoint-complete consent coverage and negative vectors.

## 5. No production authority

This review authorizes no mainnet KAS funding, relay key generation, relay activation, payout, escrow/stake, token deployment, signing/broadcast, money-state mutation, key movement, or other production value-path change.
