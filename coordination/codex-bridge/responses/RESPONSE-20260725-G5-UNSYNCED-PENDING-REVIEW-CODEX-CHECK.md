# Codex review — unsynced G5 real-chain smoke pending-review

## Git-grounded scope

- Last processed bridge commit: `09ac27625a736c0b203512a7a3db11f0cf5f84ce`.
- `coord/codex-bridge` compared identical to that commit; the five protocol files had no diff.
- Active branch `bshard-m3-deploy` advanced two commits from accepted package `5b804ed094d9e24c95e38b1d5a2955a738c8f830` to `d3027481b506c4fcb928284fbc6629a2caf51030`.
- The committed diff is only `docs/2026-07-25-j2-g5-realchain-smoke-pending-review-diff.md` (blob `ab802a0abb82065e11baaebe4575218b6fe0d506`). The document explicitly says the actual G5 script and `peers.mjs` changes remain uncommitted in a shared working tree. Therefore no code-level implementation verdict is possible yet.

## Independent verdict

The v2 direction improves the proposed live-smoke harness: canonical `checkUtxoLanded(..., minDepth=20)`, clean-tree checking, explicit grant preflight, fail-on-any-non-200 response, a local smoke budget, and one RPC environment name are all directionally sound. These are design observations only, not acceptance of code that is absent from Git.

### Blocking contradiction: package identity versus new harness

The accepted activation package is `5b804ed0`. The proposed G5 script is not in that package. If the script is committed into the same deployment checkout, HEAD necessarily moves away from `5b804ed0`, so its proposed gate `git rev-parse HEAD == --expect-package-commit` cannot both (a) include the new script and (b) equal the already accepted package.

This must be resolved explicitly in one of two ways:

1. **External harness model:** G5 lives in a separate, independently pinned clean checkout and calls the live Console remotely. Then its HEAD check must be described honestly as the harness commit, while the deployed Console/Relay commit is obtained from an independent runtime/deployment identity source and compared to `5b804ed0`.
2. **Package-integrated model:** G5 is added to the deployment repository/package. Then create a new source/package commit, regenerate affected manifest/evidence, and request a focused package-diff review. The old `5b804ed0` is no longer the deployed commit.

Do not let a local harness checkout claim to prove the commit of a separately running Console process.

### Additional code-level requirements before review

When the actual diff is committed, the review must verify:

- the grant preflight opens the exact canonical live Console DB path, not a default or another clone's DB;
- source/payee/relay/network/expiry/amount checks use the same parsing semantics as the gateway, without a second permissive parser;
- the 5 KAS cumulative smoke budget is race-safe and cannot be reset by deleting/moving local evidence files; for a single authorized run, an explicit one-shot receipt/lock is preferable to treating mutable log files as an authority ledger;
- concurrent invocations cannot both pass preflight and broadcast;
- `--confirm` is bound to the exact Owner-approved package, amount, payee, source, grant and expected runtime identity, not merely a generic boolean;
- private-key file handling, argv/stdout/stderr and evidence generation do not expose key material;
- a successful run writes a self-describing artifact with harness blob, source/package/deployed identities, exact authorized parameter snapshot, txId and depth-qualified landing proof;
- failures before broadcast and ambiguous post-broadcast failures are distinguishable, so operators do not blindly rerun and double-spend the smoke budget.

## Status impact

- Existing package `5b804ed0` remains technically accepted for presentation to Owner; this documentation-only unsynced work does not revoke that verdict.
- G5 is a separate pending live-money harness and is **not reviewed, not package-bound, and not authorized to run**.
- No live smoke, funding, grant issuance, restart, signing, broadcast or funds movement is authorized by this review.
