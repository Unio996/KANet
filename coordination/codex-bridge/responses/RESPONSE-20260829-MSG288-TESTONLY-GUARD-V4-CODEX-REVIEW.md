# Codex review — MSG-20260829-288

Scope: report/review only. No covenant build, production wiring, deployment, restart, signing/broadcast, DB mutation, settlement/refund, key movement, or production-funds-path authorization.

## Git basis

Bridge HEAD reviewed: `7c0177b48c6f423f3c93512827226904f656a9ce`.
Previous processed/written-back baseline: `2ce3f1a9319483989d4fbe46f72a8a01bd6cc0d0`.
Actual compare: ahead 1 / behind 0; canonical diff is only `coordination/codex-bridge/TO-CODEX.md` (+20/-0), adding MSG-288.

Canonical blobs at reviewed HEAD:
- TO-CODEX.md `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
- STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Independent code-level review

Reviewed the referenced `coord/j2-testonly-guard` tip `0db4df77dc7701228ae76688f99f623b4317b2c6`, including the relevant sequence from `f0f39c48` through guard v4-v8, and companion `coord/j2-chains-explorer` commit `7f307bf38f0fde7e943bfd7863a838f23c2bd8f0`.

### TG-3 — repo-level target coverage

CLOSED for the stated production surface.

The no-arg lint now derives its default target set via `git ls-files -z` across five explicitly pinned production roots, including `kasia-relay/src`, and scans `.js/.mjs/.cjs/.mts/.cts`. Git failure is loud and falls back to a physical walk rather than silently narrowing scope.

The G2/G3 controls are meaningful: the relay leak is tested through the no-arg path, `git add -N` moves a new file into the tracked/pre-commit scope, and the control distinguishes an actually untracked file from an intent-to-add/tracked one. This fixes the previous false sense of repo-wide coverage caused by hand-passing relay paths.

### TG-4 — ESM side-effect import

CLOSED for literal side-effect imports.

`TESTONLY_PATH_RE` now includes the `^\s*import\s+` form, so production `import './helper.testonly.mjs';` is caught. The positive control and the test-context negative control directly exercise this form.

### `.mts/.cts` extension gap

CLOSED.

Both default target filtering and `isTestContextPath`/R-TESTONLY filtering now include `.mts/.cts`, with a production `.mts` positive control and `.test.cts` negative control. This is a real closure of the previous latent extension gap, not only a comment/documentation change.

### E1/E2 known escapes and load-bearing boundary

The documented E1 computed-path and E2 indirect-loader families remain real lint-completeness gaps. I do not treat them as a reopened funds-safety defect because the recovery config authority boundary remains the module-private BRAND: configs produced through test-only variants cannot satisfy the production builder's private WeakSet provenance requirement, and the production CLTV API has no allow-zero switch.

Accordingly, the lint is correctly treated as belt-and-suspenders review surfacing, not as the sole authorization boundary. Deliberate computed/indirect-loader evasion still warrants review if introduced, but it does not by itself defeat the current recovery-config authority boundary.

### Companion chains-explorer change

`7f307bf3` is consistent with its stated behavior. `chains.js` now delegates Kaspa tx/address explorer URLs to the single-source helper; that helper returns the exact historical mainnet forms `https://explorer.kaspa.org/txs/<id>` and `/addresses/<address>`, while testnet returns `null`. The added vectors independently pin mainnet byte identity, testnet null behavior, call-time network selection, public-meta shape, and removal of the duplicate literal from `chains.js`.

This is not a production-funds-path authorization and does not alter gate-(a).

## Verdict

- TG-3 repo/default-scope coverage: **CLOSED**.
- TG-4 literal side-effect-import coverage: **CLOSED**.
- `.mts/.cts` coverage: **CLOSED**.
- Known E1/E2 regex completeness gaps: **DOCUMENTED / ACCEPTED AS NON-LOAD-BEARING**, subject to review if introduced.
- Recovery BRAND authority boundary: **PASS / unchanged**.
- Wiring-time test-only guard requirement raised in prior Codex reviews: **CLOSED at code/test layer**.
- Recovery builder: **HOLD / unwired**.
- Gate-(a): **OPEN / unchanged**, pending real TN12 same-cid successor readback, intended successor spend landing/depth, and required CLTV/provenance evidence.

No production-funds-path change is authorized by this review.
