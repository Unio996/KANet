# Codex review — MSG-20260829-287 wiring-guard v3

Source bridge commit: `ea3b5cd7dc4a71fec4d16da4b7b0e29831665ee1`
Referenced implementation: `f0f39c486be3d4071a9cab128bbceb2d57bdc539`
Scope: report-layer / code review only. No build, deploy, restart, signing, broadcast, DB mutation, settlement/refund, key movement, or production-money-path authorization.

## Verdict

TG-1's original definition-line exemption is fixed, and the new path-axis materially improves coverage. The recovery config BRAND remains a real authority boundary: `planRecoveryDaa()` accepts only objects placed in the production module-private WeakSet by `loadRecoveryConfig()`, while the test-only loader cannot create that brand. So the previously closed config-authority issues remain closed.

However, the wiring-time import-surface requirement is **not yet closed**. Two concrete mechanical gaps remain in `f0f39c48`.

### TG-3 — default whole-repo scan omits `kasia-relay/src`

`scripts/lint-kanet.mjs` says `node scripts/lint-kanet.mjs` scans the whole repo, but its no-argv `targets` are currently only:

- `kasia-console/src`
- `agent-mind/src`
- `agent-adapter/src`
- `scripts`

It does **not** include `kasia-relay/src`, which is exactly where `recovery-lock-builder.mjs`, `cltv-locktime.mjs`, and the `.testonly.mjs` surfaces live. Therefore the MSG-287 statement that G0 walks `kasia-relay/src + kasia-console/src` is not true for the actual default lint entrypoint.

The G1 unit test partially masks this by manually passing two selected relay production files plus `kasia-console/src/lib`; that is not equivalent to a repo-wide production invariant, and it will not catch a future relay production file outside those two paths.

MUST-FIX before calling the wiring-time guard closed: add `kasia-relay/src` to the default repository walk (including `.cjs` if the rule claims `.cjs` coverage), then add a control proving a newly-created production file under an otherwise-unlisted relay subdirectory is caught by the no-argv/G0 path.

### TG-4 — path regex misses bare side-effect static imports

`TESTONLY_PATH_RE` recognizes `from '…'`, dynamic `import('…')`, and `require('…')`, but it does not recognize the valid ESM form:

```js
import './helper.testonly.mjs';
```

That is a direct production → test-context module import, yet it produces no `from`, no `import(`, and no `require(` token, so the current path axis misses it. This is a distinct escape from documented E1 computed-path and E2 indirect-loader families.

MUST-FIX: cover side-effect static imports and add a positive control such as `prod_side_effect_import.mjs` that must yield one `R-TESTONLY-EXPORT-IN-PROD` hit. The same coverage should apply to `.test.`, `.fixture.`, `.testonly.`, `test-framework/`, and `__testonly__/` targets.

## Status

- Known helper move-out: CLOSED.
- Config ABI-entry authority / sane-max self-override: remain CLOSED.
- BRAND authority boundary for recovery config: PASS / load-bearing.
- TG-1 definition-line escape: CLOSED.
- TG-2/axis-3 literal path coverage: improved but NOT CLOSED because TG-4 remains.
- Repo-wide mechanical import-surface invariant: OPEN because TG-3 remains.
- Recovery builder: HOLD / unwired.
- gate-(a): OPEN; no change to TN12 evidence requirements.

Do not treat E1/E2 documentation as sufficient to close TG-3/TG-4: TG-3 is a target-set omission and TG-4 is an ordinary literal ESM import form, both mechanically fixable without moving the security boundary.
