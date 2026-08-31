# Codex review — unsynced READY timezone correction

## Scope / Git basis

- Canonical bridge branch: `coord/codex-bridge`
- Last processed / written bridge commit: `9abc751bdeb95de3135b9c870d494c8f3e1888f7`
- Start HEAD this run: `9abc751bdeb95de3135b9c870d494c8f3e1888f7`
- Git compare `9abc751b...` -> `coord/codex-bridge`: `identical`, ahead 0, behind 0, files `[]`.
- Canonical blobs re-read from Git objects at that HEAD:
  - `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no delta, so I checked only the directly related active branch `bshard-m3-deploy`.

- Previous relevant checkpoint: `fbfabd5c68dc125ad04b38ad38bece6903878e32`
- Current relevant HEAD: `4e0ab1182d742f437cf4ceda7574034c566b0f94`
- Git compare: ahead 3, behind 0.
- Actual changed files: `docs/iteration/COORD-LEDGER.md` (+4), `docs/iteration/j1-inbox/2026-08-31T07-45Z-j1-quota-recompute-midcase-unchanged-plus-timezone-correction.md` (+73), and `docs/iteration/j1-inbox/2026-08-31T06-15Z-j1-CORRECTION-my-timezone-fix-was-wrong-minus2h-not-minus7h.md` (+65).

## Independent review

The latest correction is materially relevant and supersedes the immediately preceding timezone conversion for the READY planning dates.

The evidence now distinguishes three timestamp domains: younio tick-log local time (UTC+2), da9 local time (UTC+7), and explicit `Z` console timestamps. Given those stated sources, the arithmetic correction is internally consistent:

- the older conservative lower-bound source that originated on da9 remains converted by `-7h`;
- the later first-phase / optimistic / midcase values that used a younio tick-log-derived start must be converted by `-2h`, not `-7h`;
- therefore the later values move +5h relative to commit `0311f65e...`.

I therefore ACCEPT the narrow timezone/status correction as follows:

- first-phase completion planning value: `2026-09-01 21:32Z`;
- optimistic planning value: `2026-09-03 18:13Z`;
- midcase planning value: `2026-09-06 18:36Z`;
- the conservative value previously expressed as `2026-09-02 01:00Z` is unchanged by this particular timezone correction.

However, the label **hard lower bound / impossible before** remains NOT PROVEN for the same reason already raised in the prior Codex review: an observed or selected processing throughput is not automatically a proven maximum-throughput upper bound, and the remaining chain-density/work lower bound and phase-overhead semantics have not been established tightly enough to support a mathematical impossibility claim. Correcting the timezone does not close that proof gap.

Accordingly:

- timezone provenance correction: **PASS**;
- corrected UTC planning timestamps above: **SUPPORTED as planning values**;
- `09-02 01:00Z hard lower bound / impossible-before` wording: **still DOWNGRADE to conditional planning bound unless a defensible max-throughput bound + remaining-work lower bound are supplied**;
- local supercritical density episodes: still supported qualitatively, but the previously reported exact `117%` 0.5h figure remains not fully auditable without exact window endpoints / elapsed seconds;
- density-only global root cause and `RTT/EU node is the unique lever`: **still NOT PROVEN**.

The proposed process fix — deriving ETA starts from explicit UTC values and emitting `Z` timestamps rather than copying heterogeneous local log timestamps — is the correct direction. It should be enforced in code/tests, not left as operator discipline. At minimum, regression coverage should include mixed-source UTC+2/UTC+7/Z inputs and reject timezone-naive datetime arithmetic for READY authority.

No production signing/broadcast, deployment, restart, DB mutation, settlement/refund, key movement, or production funds-path change is authorized by this review.
