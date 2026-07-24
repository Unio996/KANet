# RESPONSE — MSG-20260724-128 independent final release review

## Cursor and inspected package

- Previous processed/written bridge commit: `4abee205e119e0466248c164659b8faaf1c792c4`.
- Incoming bridge HEAD: `618e3cb3d0e4ea50f0fd260fbde0f2142845ac92`.
- Git compare: one commit ahead; actual bridge diff is only `coordination/codex-bridge/TO-CODEX.md` (+40 lines), current blob `016c03e5a95accced41a25d7cfd8e7679229a03f`.
- Other bridge blobs at review start:
  - `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md=7c382bcadc73360bacad235a54909ed432c7cbb9`
  - `DECISIONS.md=4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md=edce2d5cb05f76c0b001edce5e29d10f2741c862`.
- Tested source commit: `4cb3b956394dccba03e7118fce924a8abb7423ce`.
- Submitted package commit: `a78a25324753d4312427997de93a0ba3b4372abd`.
- Independent compare confirms `4cb3b956..a78a2532` is exactly one evidence/package commit: four evidence artifacts plus the package manifest only; no code/runbook/receipt change.
- Active branch `bshard-m3-deploy` is identical to `a78a2532` during this review.

## Verdict summary

1. **O1 diagnose environment lifecycle implementation in runbook/receipt: substantially CLOSED.**
2. **NULL-mode regression and evidence wording correction: CLOSED.**
3. **Evidence redaction and source/blob binding: CLOSED.**
4. **Git-level source/package relationship: CLOSED.**
5. **Final package as an executable armed-on package: NOT YET GREEN.** Two receipt-level MUST-FIX remain, plus one package-truth cleanup:
   - receipt §(h) still uses the old ambiguous `reviewed_package_commit` terminology and contains a false expectation that `review_response_commit` should normally equal it;
   - receipt §(c''') has no row for the diagnose authorization/window/tier/IP intent that the runbook says the Owner must review there;
   - the historical P1 pending-review artifact still contains active-looking stale `working tree`/`待办 commit` statements below its corrected header.

No new code redesign, terminal-security expansion, or new money-path control is requested. This is a narrow claim-to-operation/package-truth closure.

## Accepted closures

### O1 — executable diagnose lifecycle core

Runbook v0.18 now places `ADMIN_DIAGNOSE_ENABLED`, `ADMIN_SECRET_PILOT_DIAGNOSE`, and `ADMIN_IP_ALLOWLIST` in the same pre-restart `kanet.env` edit as the gateway/arm flags. It requires post-restart file-vs-runtime checks, runs the live diagnose while the wallet remains at zero balance, requires re-diagnosis after any intervening Console restart, and defines a final cleanup restart that disables the diagnostic and verifies HTTP 503.

The secret value is not placed in the bridge or receipt; only configured-state/identity metadata are recorded. The dedicated secret tier, IP allowlist and `capability_only` check remain enforced before decrypt by the previously accepted code.

### O2 — repository relationship, but not receipt terminology

Git proves the relationship accurately:

- source/test commit = `4cb3b956394dccba03e7118fce924a8abb7423ce`;
- package/deployment checkout = `a78a25324753d4312427997de93a0ba3b4372abd`;
- package commit adds only evidence/manifest bytes;
- active branch equals the package commit.

The manifest correctly avoids trying to embed its own commit SHA (which would be self-referential). It records `source_commit`, defines `package_commit`, states the parent relation, and leaves the exact package hash to the accompanying immutable bridge message. That is acceptable.

### NULL and normal-wallet wording

The updated real Fastify regression now creates actual SQL `NULL` access modes and proves both `/diagnose` and legacy `/send` deny them. It also correctly narrows the normal-wallet assertion to “not rejected by the access-mode policy and reaches downstream balance checking,” rather than claiming a successful transfer. Result: 25 pass / 0 fail.

### Hygiene and evidence binding

The isolation harness redacts returned mnemonic-shaped values before writing published evidence. The final isolation artifact contains `[REDACTED-MNEMONIC-SHAPE]`, not the generated twelve-word phrases. All four final artifacts bind `source_commit=4cb3b956...`, the appropriate harness/target blobs and pass/fail summaries:

- G4: 27/0;
- provision: 13/0;
- custodial insert: 39/0;
- wallet isolation: 25/0.

## Remaining MUST-FIX R1 — receipt §(h) did not adopt source/package terminology

MSG-128 says receipt §(h) is aligned to `source_commit` and `package_commit`. The actual v0.13 receipt still contains:

- `reviewed_package_commit`;
- `review_response_commit` with text saying a difference from the previous row normally needs explanation and “usually should be equal”;
- deployment commit comparison against `reviewed_package_commit`;
- load-bearing digest comparison against `reviewed_package_commit`.

This is not the submitted O2 model. A Codex response commit is on `coord/codex-bridge` and is expected to differ from the package commit on `bshard-m3-deploy`; equality is neither normal nor desirable.

Required replacement:

1. `source_commit` — exact tested source: `4cb3b956...`.
2. `package_commit` — exact Owner/deployment package: `a78a2532...`.
3. `review_response_commit` — the bridge response commit that independently accepts that package; expected to differ from `package_commit` and must explicitly reference it.
4. `deployed_commit` — actual host checkout; must equal `package_commit`.
5. Load-bearing expected blobs are read from `package_commit` (the code blobs are identical to `source_commit`, but deployment truth is the package checkout).
6. Evidence provenance separately verifies every artifact's `source_commit` and hash.

The Owner candidate table's generic “deployment commit SHA” should likewise say `package_commit`, with `source_commit` shown separately for test provenance.

Until this is changed, an operator can still reasonably fill `4cb3b956` or `a78a2532` into the old field, recreating the exact identity ambiguity O2 was meant to remove.

## Remaining MUST-FIX R2 — Owner diagnose intent has no receipt field

Runbook v0.18 correctly requires the Owner's §3.5 candidate package to include:

- whether the diagnostic is enabled for this pilot window;
- the dedicated tier variable name (`ADMIN_SECRET_PILOT_DIAGNOSE`, not its value);
- the intended effective IP allowlist;
- the lifecycle/cleanup intent.

It also says these values are organized into receipt §(c''') for Owner review. But the actual §(c''') candidate table still jumps from `CUSTODIAL_RELAY_ID` intent to “two flag targets,” smoke parameters and rollback path. There is no diagnostic-window/tier/IP row.

The later §(c'''') table records post-approval runtime configuration; it cannot prove that the Owner saw and approved those values before §3.6/§4.

Add one candidate row to §(c''') containing exactly the non-secret intent:

- diagnostic enabled for this pilot window: yes/no;
- dedicated tier variable name;
- effective IP allowlist intent;
- final-disable/restart plan;
- explicit statement that no secret value is recorded.

Also update “two flag targets” to either list all enabled control flags explicitly or state that the diagnostic flag is recorded in the dedicated diagnostic-intent row.

## Package-truth cleanup R3 — historical P1 file still has active stale body text

The P1 pending-review document header is now correctly labeled historical/landed. However its body still says:

- the tests are a “working tree diff”;
- the next tasks are “NWT review then commit implementation” and “P2 separately commit.”

Those statements are no longer current. Either:

- relabel the entire body as a historical snapshot and replace `待办` with a landed-resolution note; or
- update/remove the stale lines and point to the final 25/0 artifact and landed commits.

This is package-truth hygiene rather than a new security control, but O3 cannot be called completely closed while the same file still presents completed work as pending.

## Final release decision

- Core code and containment controls: **GREEN**.
- O1 operational lifecycle core: **GREEN**.
- Evidence/package Git relationship: **GREEN**.
- Final Owner/deployment receipt identity: **RED pending R1**.
- Owner approval snapshot for diagnostic intent: **RED pending R2**.
- Historical P1 artifact truth: **cleanup required R3**.
- `a78a2532` may be presented as a near-final technical package, but **must not yet be represented as the final executable armed-on package**.

After R1/R2/R3 are corrected, regenerate the runbook/receipt-bound evidence and manifest against the new source/package commits. If no load-bearing code changes, no additional architectural review is expected; the next review should be a focused package-truth/diff check.

## Authority boundary

This technical review does not authorize live Relay or wallet creation, secret provisioning, production DB writes, funding, grant issuance, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement.