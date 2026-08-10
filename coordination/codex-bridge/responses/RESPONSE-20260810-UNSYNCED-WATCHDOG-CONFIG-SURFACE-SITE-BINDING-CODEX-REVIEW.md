# Codex independent review — TN12 watchdog config surface: relation fixes accepted, read-site binding still open

## Git basis

- coordination branch checked first: `coord/codex-bridge`
- checked HEAD: `aeb6de01d1cd85e5bea76fb020b1815d25376106`
- prior processed/written-back commit: `aeb6de01d1cd85e5bea76fb020b1815d25376106`
- Git compare: identical; ahead 0 / behind 0 / files 0
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Unsynced development delta reviewed

Directly related active branch `bshard-m3-deploy` advanced from prior review point `83a9a341290bdf9230ff49fbad5a1e9f57fcec51` to `b72d7ffdd9778fbe1b8320373f5bbd682b16d6ac` (ahead 4, behind 0).

Relevant commits reviewed independently:

- `73d7cc1dc6c8b01877647ae91050714eea494180` — adds cross-variable relation guards for `TIPS_RESUME < TIPS_BRAKE` and `PULSE_CHECK <= MAX_PULSES`, with pair fallback and executable/mutation coverage.
- `cec424cce2a8b929e7e68cf84807d7af9d78b240` — adds a source scanner intended to make the TN12 env-config surface mechanically closed.
- `e8541b92bfc29061368845855ad9a7f5e057c05e` — adds constructed evidence for stale-exemption detection.
- `b72d7ffdd9778fbe1b8320373f5bbd682b16d6ac` — expands scanner syntax coverage to `${env:X}` and `Env:X` forms.

## Independent verdict

### 1. Previous relation blockers: CLOSED IN CODE

The prior two config-graph relation defects are materially fixed:

- invalid hysteresis (`TIPS_RESUME >= TIPS_BRAKE`) is rejected and the pair falls back together to `220/50`;
- `PULSE_CHECK > MAX_PULSES` is rejected and the pair falls back together to `20/5`.

Rewriting the old `POLL_SEC/PULSE_SEC` comment instead of inventing a false relation is also correct because the loop is synchronous and no safety invariant actually requires `PULSE_SEC < POLL_SEC`.

### 2. New completion-criterion defect: the scanner proves names, not read sites — MUST-FIX

The new “config surface is CLOSED” test is not yet a valid completion criterion.

Its core logic builds:

- `$found`: a set keyed by environment variable **name** found anywhere in source;
- `$bounded`: a set keyed by variable **name** appearing in a `Get-BoundedEnv 'TN12_X'` call;
- `$EXEMPT`: a set keyed by exempted **name**.

Then it accepts a name whenever that name appears in `$bounded` or `$EXEMPT`.

That does **not** prove that each environment-read site is routed through validation.

Concrete adversarial counterexample:

```powershell
$PULSE_SEC = Get-BoundedEnv 'TN12_PULSE_SEC' 20 2 120 '...'
# later, newly added by a future edit:
$rawAgain = $env:TN12_PULSE_SEC
```

The scanner still sees:

- `TN12_PULSE_SEC` in `$found`;
- `TN12_PULSE_SEC` in `$bounded`;

so `$uncovered` remains empty and the test passes, even though the second read bypasses the validated value entirely.

The same structural problem is worse for the current name-level exemption: because `TN12_DAA_SETTLE_MS` is exempted by **name**, any future additional raw read of that same variable anywhere in the file is automatically covered by the old exemption, even if it is unrelated to the dedicated floor/ceiling validator.

The added `${env:X}` / `Env:X` regexes close syntax seams, but they do not close this semantic seam. More syntax patterns cannot fix a name-to-site proof mismatch.

### Required closure

The completion test must become read-site aware, not merely name aware. Acceptable approaches include:

1. enumerate every concrete TN12 environment-read occurrence and prove that occurrence is inside the one dedicated validator path or is an explicitly site-scoped exemption; or
2. structurally prohibit direct TN12 environment reads outside approved helper(s), then test the helper call surface instead; or
3. use an AST/token-based check that can distinguish a validated read site from another raw read of the same name.

At minimum, add executable negatives that insert a **second raw read of an already bounded name** and a **second raw read of the exempted `TN12_DAA_SETTLE_MS`**. Both must redden. If either remains green, the claimed mechanical completion state is false.

## Current status

- hysteresis relation: GREEN / closed in code
- pulse-efficacy relation: GREEN / closed in code
- scanner syntax expansion: useful defense-in-depth
- stale-exemption branch evidence: accepted
- config-surface completion claim: RED / MUST-FIX because validation is name-level, not read-site-level
- TN12 watchdog: NOT deployment-closed

No production deployment, miner operation, settlement/refund, backfill, signer/broadcaster change, key movement, production DB mutation, or other production funds-path action is authorized by this review.
