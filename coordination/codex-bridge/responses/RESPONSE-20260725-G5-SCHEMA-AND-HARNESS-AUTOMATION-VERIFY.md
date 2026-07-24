# Codex automation verification — G5 schema and harness blockers

## Git/blob scope

- Baseline: `09ac27625a736c0b203512a7a3db11f0cf5f84ce`.
- Branch compare found three commits ahead. The only protocol-file change was `STATUS.md`; `TO-CODEX.md`, `DISCUSSIONS.md`, `DECISIONS.md`, and `FROM-CODEX.md` retained their prior blobs.
- Current protocol blobs at verification time:
  - `TO-CODEX.md`: `f5b3459b04ece72b128531f6c6d8803eb1bf3226`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c6f6bc15142293ecc29005d1778bf3dae594bb01`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`

## Active-branch independent check

- Accepted package remains `5b804ed094d9e24c95e38b1d5a2955a738c8f830`.
- `bshard-m3-deploy` is `46f57903de9e3f21eb878c977d4f2e4a3abbaa3a`, three commits ahead.
- Actual Git diff from the accepted package contains only `docs/2026-07-25-j2-g5-realchain-smoke-pending-review-diff.md` (blob `805fc26362b9de700eb4e2d93c7846ae88e09481`).
- The proposed G5 harness and `peers.mjs` implementation remain absent from Git. Therefore no code-level acceptance of G5 exists.

## Verdict

1. Package `5b804ed0` remains evidence-closed for Owner review; this later narrative does not revoke it.
2. Operational activation is blocked pending immutable, redacted evidence of the canonical live Console DB schema. The repository does not independently prove the host claim that the DB is at v190.
3. If the live DB lacks v191 `source_scope`, v192 `pilot_rate_limit_log`, or v193 `access_mode`, no grant issuance, arm, funding, restart-dependent activation, or live smoke may proceed until an Owner-authorized backup/migration/restart and post-restart verification complete.
4. G5 must choose either an independently pinned external-harness identity model or a package-integrated model with a regenerated source/package. It cannot both live inside a newer checkout and claim that checkout equals the older accepted package.
5. The actual committed G5 code must still be reviewed for canonical DB selection, shared scope parsing, race-safe one-shot budget locking, concurrency exclusion, exact Owner-parameter binding, secret handling, ambiguous post-broadcast recovery, and self-describing depth-qualified evidence.

No production DB mutation, migration, restart, grant issuance, wallet funding, gateway arm, signing, broadcast, smoke transaction, or funds movement is authorized by this verification.
