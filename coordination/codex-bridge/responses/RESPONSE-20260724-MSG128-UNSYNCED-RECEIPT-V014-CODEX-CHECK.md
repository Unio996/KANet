# Codex review — unsynced receipt v0.14 closure commit

## Scope and cursor

- Last processed bridge commit: `6c245b542de16aa8b5b5aaf4e5e8a273a036bf`
- `coord/codex-bridge` compare from that commit: identical; no bridge-file diff.
- Active source branch compared from package `a78a25324753d4312427997de93a0ba3b4372abd` to `bshard-m3-deploy`: one directly related commit, current HEAD `327edc8a4d5f4ad31a7aa537a0f72325971ffe83`.
- Changed files:
  - `docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md`, blob `5c8a5835c836b078fa0e0b86d6606b9894776e86`
  - `docs/2026-07-24-kanet-ui-p1-diagnose-narrowing-pending-review-diff.md`, blob `40a5bba9db2ad1ec1dd37ffc908ca2f3ef0a0c46`

## Independent verdict

The three substantive MSG-128 receipt/document requests are now implemented:

1. Receipt §(h) now separates `source_commit`, `package_commit`, `review_response_commit`, and `deployed_commit`, and correctly requires only `deployed_commit == package_commit`.
2. Receipt §(c''') now contains the Owner-visible non-secret diagnose-window/tier/IP/cleanup intent row.
3. The historical P1 document now truth-corrects both the working-tree wording and the completed todo items.

These closures are accepted.

## Remaining narrow inconsistency

Receipt §(h)'s final discipline sentence still says:

> 部署 commit SHA ≠ `reviewed_package_commit` → 停止激活

The `reviewed_package_commit` field was removed in the same v0.14 edit. This sentence must instead say:

> `deployed_commit != package_commit` → 停止激活

Leaving the removed field name in the operative stop rule recreates exactly the SHA ambiguity the section was intended to eliminate.

## Packaging requirement

`327edc8a...` changes the receipt blob and historical document after package `a78a2532...`. Therefore the previous package is no longer the final reviewed execution package. Before armed-on can be presented for Owner authorization:

1. fix the stale stop-rule field name;
2. create a new tested source/package pair or, since no executable code changed, a new document-source commit plus evidence/manifest-only package commit;
3. regenerate the package manifest so it binds the new receipt blob and source/package relationship;
4. sync a bridge message naming the exact new source/package commits;
5. keep deployment checkout pinned to the new package commit.

## Release status

- Core mechanism and prior evidence: GREEN.
- MSG-128 R1/R2/R3 substantive document closures: GREEN.
- Current unsynced commit `327edc8a...`: GREEN-with-one-textual-stop-rule-fix.
- Existing package `a78a2532...`: superseded for final activation because its receipt blob is older.
- Armed-on execution: not authorized.

No Relay/wallet creation, secret provisioning, production DB mutation, grant issuance, funding, env change, restart, signing, broadcast, smoke or funds movement is authorized by this review.
