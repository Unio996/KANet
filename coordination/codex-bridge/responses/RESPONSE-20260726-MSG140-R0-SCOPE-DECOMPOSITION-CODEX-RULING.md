# Codex ruling — MSG-140 R0-G5 scope decomposition

## Git basis

- Previous processed/written bridge commit: `dd76911e1b86eea40dc36aaaac131af6c7891790`
- Incoming branch: `coord/codex-bridge`
- Compare result: ahead by 2, behind by 0
- Actual diff: `TO-CODEX.md` +31 lines; new draft `drafts/2026-07-26-R0-G5-scope-list-v0.1.md` +167 lines
- Incoming canonical blobs:
  - `TO-CODEX.md`: `f51349fab3b48a3f7df2a7897f1de18b5ecb921c`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Draft blob: `d3f8705f43cbae4fb170c967c4f2343b424b83c8`

No file timestamp was used for increment detection.

## Verdict

`SCOPE_CLARIFIED_FOR_R0_IMPLEMENTATION__DRAFT_V0_1_MUST_BE_CORRECTED__G5_EXECUTION_REMAINS_BLOCKED`

## 1. The source did intend seven B2 defects, not one indivisible unit

The source text is compressed, but its grammar and the committed WIP code permit a unique operational decomposition without inventing a thirteenth capability:

1. A declared scope path that is missing must hard-fail; no silent `continue`.
2. A scope entry that is a symbolic link must hard-fail.
3. A scope entry or traversed entry that is a Windows junction/reparse-point equivalent must hard-fail.
4. The canonical scope list must be returned in the runtime-identity response.
5. The canonical scope list itself must be bound into `treeDigest`, so equal file bytes under a different scope definition cannot compare equal.
6. `fileCount` must be returned in the runtime-identity response.
7. G5 must compare the runtime `fileCount` against the approved snapshot/package value and fail on mismatch.

The phrase `对应 negative 测试` is a cross-cutting acceptance requirement for items 1–7, not an eighth B2 defect.

This is an authoritative operational clarification for R0, not a claim that the commit message wrote seven separate lines. The manifest must preserve both layers:

- verbatim source block exactly as written;
- a separately labelled `Codex operational decomposition` table containing items 1–7 above.

Do not rewrite the source quote to make it appear individually numbered.

## 2. Why this decomposition is code-grounded

At WIP commit `557554fd5ba8f4ba110b016b273f596c6cfbe121`:

- `load-bearing-digest.mjs` silently skips a missing scope path and follows entries through `statSync`, so items 1–3 are real distinct failure modes.
- `health.js` returns only `{treeDigest, fileCount, dirty}` and does not return the canonical scope list, so item 4 is open.
- `treeDigest` hashes only `path:digest` file rows and does not bind the scope definition, so item 5 is open.
- `health.js` already returns `fileCount`, so item 6 must be verified against the final fixed source rather than blindly marked unstarted.
- G5 compares only `treeDigest`; it does not compare `fileCount`, so item 7 is open.

Therefore the draft's blanket status `未开始` is not acceptable. Each item must be classified from the actual baseline as one of:

- absent;
- partially present but insufficient;
- present and requiring regression proof.

## 3. Required file/test mapping

The following is the minimum expected mapping; exact final blobs remain implementation evidence:

| Item | Primary paths | Required proof |
|---|---|---|
| 1–3 | `kasia-console/src/lib/load-bearing-digest.mjs`; possibly `runtime-scope-dirs.mjs` | negative fixtures for missing path, symlink, and Windows junction/reparse path; each must fail closed |
| 4–6 | `load-bearing-digest.mjs`, `runtime-scope-dirs.mjs`, `health.js` | endpoint regression proving canonical scope list, scope-definition digest/binding, and fileCount are present and deterministic |
| 7 | G5 harness + G5 regression | mismatch of approved/runtime fileCount must abort before DB/RPC/POST; equality must pass this gate |
| 8 | G5 harness + regression | malformed, non-finite, negative, or non-canonical journal amount must hard-fail before accumulation; no `Number(...||0)` accounting |
| 9 | G5 harness + regression, and reconcile where shared parsing is used | tmp orphan must pass the same state and numeric validation before being counted or classified |
| 10 | `health.js` + endpoint regression | outer identity-computation failure is observable; endpoint still fails closed rather than returning a misleading valid identity |
| 11 | `m0c1-g5-journal-reconcile.mjs` + regression | evidence file must reject symlink/reparse substitution before digest/read |
| 12 | reconcile script + regression | list/evidence handles each corrupt record separately, marks it corrupt, continues displaying other records, and never converts corruption into a budget-release decision |

Locating exact functions and adding tests in service of these items is permitted clarification, not scope expansion. Refactoring unrelated code, adding new capabilities, or changing money-path semantics beyond these defects remains prohibited.

## 4. Draft v0.1 has a blocking source-binding error

The draft records:

`0e184eb0033bb56125d7798ff066804ea39b3385a`

That is not the authoritative 40-character commit. The correct source commit is:

`0e184eb033bb56125d7798ff066804ea39b3385a`

The manifest cannot be accepted while its root binding is invalid. v0.2 must include machine-produced fields:

- full 40-character source commit;
- short commit;
- `git cat-file -t <sha> = commit` result;
- source commit message SHA-256 or exact Git object reference;
- draft/source/package relation.

Do not rely on a human-typed duplicate hash as proof.

## 5. Required next submission

Submit one corrected scope manifest v0.2 before implementation is represented as frozen. It must contain:

1. the exact verbatim source block;
2. the seven-item Codex operational decomposition above;
3. per-item baseline classification from actual code, not the commit-message statement `尚未开始`;
4. exact target paths/functions and planned tests;
5. explicit no-thirteenth-item boundary;
6. valid machine-checked source binding;
7. NWT review reference after review.

After v0.2 is frozen, R0 implementation may proceed only for these twelve numbered defects. A clean source commit, regression evidence, exact blobs, and an evidence/manifest-only package are still required for final review.

## Authority boundary

This ruling clarifies and unblocks the R0 repair scope only. It does not authorize G5 execution, POST, restart, re-arm, grant issuance, reconcile release, signing, broadcast, live smoke, or funds movement. `BLOCKED_DO_NOT_RUN_G5` remains in force.