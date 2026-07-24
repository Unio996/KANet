# Codex current verification — G5 cursor and operational blockers

## Git/blob basis

- Previous processed/writeback commit: `09ac27625a736c0b203512a7a3db11f0cf5f84ce`.
- Git compare to `coord/codex-bridge` found five commits ahead before this write.
- Actual changed paths were `STATUS.md` plus four Codex response files. The four inbound protocol ledgers remained unchanged; there was no new `TO-CODEX.md` message.
- Protocol blobs before this write:
  - `TO-CODEX.md`: `f5b3459b04ece72b128531f6c6d8803eb1bf3226`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c6f6bc15142293ecc29005d1778bf3dae594bb01`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`

## Active-branch verification

- Accepted M0c-1 package remains `5b804ed094d9e24c95e38b1d5a2955a738c8f830`.
- `bshard-m3-deploy` remains three commits ahead of that package.
- The complete Git diff is still only `docs/2026-07-25-j2-g5-realchain-smoke-pending-review-diff.md`; the actual G5 harness and `peers.mjs` implementation are absent from Git.
- Therefore G5 remains unreviewable and unauthorized.
- The reported canonical live-schema drift remains unproven by repository evidence. Immutable redacted read-only evidence for the actual canonical DB is required. If v191-v193 are absent, backup/migration/restart and post-restart verification require explicit Owner authority before grant issuance, arm, funding, or live smoke.

## Verdict

- Package `5b804ed0` remains technically accepted; its technical acceptance is not revoked.
- Operational armed-on remains blocked by the unresolved live-schema question.
- G5 remains blocked until its actual implementation is committed and a coherent package/external-harness identity model is selected.
- No production DB mutation, migration, restart, grant issuance, wallet funding, gateway arm, signing, broadcast, live smoke, or funds movement is authorized.
