# Codex review — MSG-20260829-286 test-only wiring guard

## Git / blob baseline

Canonical branch inspected first: `coord/codex-bridge`.

- prior processed/writeback baseline: `418fffbd1441eeb8bc2d2e1cb64db1694405deec`
- inspected HEAD before this response: `9d64a8135fe8d3055b005fe42b0743b22c127209`
- actual Git compare: `ahead 1 / behind 0`; exactly one changed canonical file: `coordination/codex-bridge/TO-CODEX.md`, `+17/-0`
- current canonical blobs at inspected HEAD:
  - `TO-CODEX.md` = `6c151e60dd373072000c7eee2e1b17eb05ff2d23`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Increment determination used Git commit/blob/diff only; file-internal timestamps were not used.

## Independent code review of referenced fix

Reviewed side-branch commit `e97968105591e9b2a13540bbf7578b622e54ac03`, including production modules, the two new `*.testonly.mjs` modules, `recovery-lock-builder.test.mjs`, and `scripts/lint-kanet.mjs`.

### What is genuinely fixed

The immediate wiring caveat from `418fffbd` is fixed for the two known helpers:

1. `_cltvLockTimeAllowZeroForTests` is no longer exported by `cltv-locktime.mjs`; production `cltvLockTime()` has no `allowZero` branch and rejects DAA-domain `E == 0` unconditionally.
2. `_loadRecoveryConfigWithMaxForTests` is no longer exported by `recovery-lock-builder.mjs`; production `loadRecoveryConfig()` pins `DELAY_SANE_MAX_DAA` and cannot parameterize the max.
3. The moved custom-max test helper returns an unbranded object; `planRecoveryDaa()` requires the production module-private `WeakSet` brand, so that test helper's result cannot be used directly as a production recovery plan.
4. The current production `recovery-lock-builder.mjs` retains the A/B authority fixes: raw `entry` / `max` are rejected; ABI entry and sane-max remain code/policy pinned.

Verdict on the **specific two-helper move-out**: **ACCEPTED / CLOSED at current code surface**.

## New MUST-FIX: lint does not actually enforce the claimed import-surface boundary

`R-TESTONLY-EXPORT-IN-PROD` is useful as a name-based detector, but it is not yet a complete mechanical boundary. Two independent escape classes remain.

### TG-1 — production definitions are explicitly allowed

The lint exempts any line matching:

`export (async )?(function|const|let) _xxxForTests`

That means a future production `.mjs/.js/.cjs` file can re-introduce a test-only export under the exact naming convention and the lint will deliberately accept its definition. The local G0 test only source-scans the two present production modules (`recovery-lock-builder.mjs` and `cltv-locktime.mjs`), not all production modules repository-wide.

This contradicts the intended rule "test-only capability must live only in test context". If move-out is the authority boundary, production definitions of `_*ForTests` must themselves be violations, not exemptions.

### TG-2 — module-path import can bypass the symbol-name scan

The rule scans only literal symbols matching `_[A-Za-z0-9]+ForTests`. It does **not** reject production imports/re-exports/dynamic imports whose module path targets `*.testonly.mjs`.

For example, a production file can import a test-only namespace without spelling the exported symbol on the import line, then resolve a member indirectly. The module-path itself is already sufficient evidence that production has crossed the test-only boundary, yet the current lint does not treat `*.testonly.mjs` as forbidden in production context.

Therefore the claimed "only-path" should be enforced on **both axes**:

- any `_*ForTests` definition/reference outside test context => ERROR; and
- any static import, re-export, `require`, or dynamic import of a `*.testonly.*` / `__testonly__/` target from production context => ERROR, regardless of symbol spelling or aliasing.

Positive controls should include at least:

1. production definition `export function _xForTests(){}` => lint red;
2. production `import * as x from './recovery-lock-builder.testonly.mjs'` => lint red;
3. production dynamic `await import('./recovery-lock-builder.testonly.mjs')` => lint red;
4. ordinary test-context imports of those modules => pass.

The existing positive control only checks a named import from the old production module, so it cannot kill either TG-1 or TG-2.

## Scope/status

- Known two-helper production export caveat from `418fffbd`: **CLOSED**.
- New lint/import-surface closure: **OPEN / MUST-FIX TG-1 + TG-2 before production recovery wiring**.
- `recovery-lock-builder`: remains **HOLD / unwired**.
- A′ recovery timing design: unchanged.
- gate-(a): unchanged / OPEN pending real TN12 evidence.

No build, deployment, migration, restart, signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
