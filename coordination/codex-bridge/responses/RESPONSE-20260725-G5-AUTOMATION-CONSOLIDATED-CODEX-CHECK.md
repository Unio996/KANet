# Codex consolidated check — G5 schema and harness state

## Git/blob basis

- Increment baseline: `09ac27625a736c0b203512a7a3db11f0cf5f84ce`.
- Compare to `coord/codex-bridge` found four commits ahead. The actual changed paths were `STATUS.md` and three added Codex response files; `TO-CODEX.md`, `DISCUSSIONS.md`, `DECISIONS.md`, and `FROM-CODEX.md` retained their prior blobs.
- Current protocol blobs before this write:
  - `TO-CODEX.md`: `f5b3459b04ece72b128531f6c6d8803eb1bf3226`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c6f6bc15142293ecc29005d1778bf3dae594bb01`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`

## Independent active-branch verification

- Accepted M0c-1 package remains `5b804ed094d9e24c95e38b1d5a2955a738c8f830`.
- `bshard-m3-deploy` is three commits ahead of that package, but the actual Git diff contains only `docs/2026-07-25-j2-g5-realchain-smoke-pending-review-diff.md` (blob `805fc26362b9de700eb4e2d93c7846ae88e09481`).
- That document explicitly states the G5 harness and `peers.mjs` implementation remain uncommitted. Therefore G5 has no reviewable code diff and no execution authorization.
- The proposed v3 schema gate is directionally correct, but the repository does not prove the host claim that canonical live `console.db` is at v190. Operational activation requires immutable redacted read-only evidence for the canonical DB schema and migration state.
- If v191 `source_scope`, v192 `pilot_rate_limit_log`, or v193 `access_mode` is absent, Owner-authorized backup/migration/restart and post-restart verification are hard prerequisites before grant issuance, arm, funding, or live smoke.
- G5 must choose one coherent identity model: a separately pinned external harness with an independent deployed-runtime identity check, or a package-integrated harness followed by a regenerated source/package review. A newer harness checkout cannot truthfully claim its own HEAD equals the older accepted deployment package.

## Verdict

- Package `5b804ed0` remains technically evidence-closed for Owner review.
- Operational armed-on remains blocked by unverified/reported live-schema drift.
- G5 remains unreviewed because the actual harness and `peers.mjs` diff are absent from Git.
- No production DB mutation, migration, restart, grant issuance, wallet funding, gateway arm, signing, broadcast, live smoke, or funds movement is authorized.
