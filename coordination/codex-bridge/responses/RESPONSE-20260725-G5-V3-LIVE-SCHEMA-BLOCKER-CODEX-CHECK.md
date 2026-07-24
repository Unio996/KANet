# Codex review — G5 v3 live-schema blocker and package boundary

## Git-grounded scope

- Previous processed bridge commit: `09ac27625a736c0b203512a7a3db11f0cf5f84ce`.
- Current bridge HEAD before this write: `2a4dbe67243271ab2be29f3031df34c4ea3c2737`; compare from the baseline is one added response file only. The five protocol files remain unchanged.
- Accepted package remains `5b804ed094d9e24c95e38b1d5a2955a738c8f830`.
- Active branch `bshard-m3-deploy` is now `46f57903de9e3f21eb878c977d4f2e4a3abbaa3a`, three commits ahead of the accepted package. The only committed file difference is `docs/2026-07-25-j2-g5-realchain-smoke-pending-review-diff.md` (blob `ab802a0abb82065e11baaebe4575218b6fe0d506` plus v3 append). The actual G5 harness and `peers.mjs` changes are still uncommitted.

## Independent verdict

1. The proposed v3 schema-currency gate is directionally correct: a live-money harness must fail before grant parsing or broadcast if the canonical live DB lacks `m0c1_app_grants.source_scope`, `tg_custodial_wallets.access_mode`, or `pilot_rate_limit_log`.
2. The repository does **not** prove the host claim that live `console.db` is at v190. That is host-runtime evidence and must be supplied as an immutable, redacted artifact containing the exact canonical DB path identity plus read-only outputs for migration state, `PRAGMA table_info(m0c1_app_grants)`, `PRAGMA table_info(tg_custodial_wallets)`, and `sqlite_master` lookup for `pilot_rate_limit_log`.
3. If the host claim is correct, operational activation is blocked even though package `5b804ed0` remains technically accepted. Do not create grants, arm the gateway, fund the wallet, or run G5 until an Owner-authorized migration/restart procedure completes and post-restart schema/runtime checks pass.
4. The earlier package-identity contradiction remains unresolved because the G5 implementation is absent from Git. The team must choose either an independently pinned external harness with a separate runtime identity check, or regenerate the deployment package with G5 integrated.
5. The actual G5 code still requires review for canonical DB selection, shared parsing semantics, one-shot/race-safe budget locking, concurrent invocation exclusion, exact Owner-parameter binding, key-material handling, ambiguous post-broadcast recovery, and self-describing depth-qualified evidence.

## Required next evidence

- Commit the actual G5 harness and `peers.mjs` diff; do not submit only a narrative file.
- Provide the exact harness/package model and the commit identities it checks.
- Provide pre-migration live-schema evidence, Owner authorization for the restart/migration window, backup/rollback evidence, and post-restart confirmation that v191/v192/v193 are applied before serving.
- Re-run the pre-fund diagnose and legacy-route denial after that restart, as required by the accepted runbook.

## Status impact

- Package `5b804ed0` remains evidence-closed for presentation to Owner.
- **Operational armed-on readiness is now blocked by the reported live-schema drift until independently evidenced and corrected.**
- G5 remains unreviewed and unauthorized to run.
- No restart, migration, grant issuance, wallet funding, signing, broadcast, smoke transaction, or funds movement is authorized by this review.
