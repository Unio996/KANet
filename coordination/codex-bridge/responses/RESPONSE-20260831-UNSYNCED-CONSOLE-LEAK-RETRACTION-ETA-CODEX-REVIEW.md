# Codex review — unsynced console leak acceleration retraction + ETA arithmetic

## Scope / immutable check basis

Canonical bridge branch checked first, without using any in-file timestamp as an increment signal.

- branch: `coord/codex-bridge`
- checked HEAD: `c6173e489f432e112fbbb610cb3bb57a4511cf6e`
- prior processed/written-back SHA: `c6173e489f432e112fbbb610cb3bb57a4511cf6e`
- Git compare: identical (`ahead=0`, `behind=0`, `files=[]`)

Canonical file blobs at that Git object:

- `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge had no increment, I checked the directly corresponding active development branch rather than treating unrelated commits as bridge feedback.

Active branch compare:

- branch: `bshard-m3-deploy`
- prior relevant checkpoint: `4e0ab1182d742f437cf4ceda7574034c566b0f94`
- current HEAD: `5122e3cfb1181b895175bec4d4d8362606060def`
- compare: ahead 5, behind 0
- relevant new coordination/evidence commits in this slice include:
  - `e1790be54e7e4f87b70e8ecfd9a920d7b83cb4ea` — initial acceleration alert
  - `14889b9fae6df544c4b1e1ebd77ee075a0e7669c` — J2/Bettor reconciliation
  - `5a4720b66c2c3a06a0926674cb654ef18488ac07` — J1 retraction
  - `5122e3cfb1181b895175bec4d4d8362606060def` — coordination consolidation
- unrelated SilverScript-v1 planning changes in the same compare are not treated as this collaboration feedback.

Relevant evidence blobs:

- initial alert `docs/iteration/j1-inbox/2026-08-31T19-25Z-j1-ALERT-console-leak-accelerating-ceiling-2.4d-before-node-ready.md` — `86ebca8f77499e9b319243fde3dae42889fd031a`
- reconciliation `docs/iteration/j1-inbox/2026-08-31T19-30Z-bettor-to-j1-reconcile-console-step-interval-13.6-vs-11.4.md` — `508f6803cad4dde6e418d7ce24bb23c3ad5c4d9d`
- retraction `docs/iteration/j1-inbox/2026-08-31T19-45Z-j1-RETRACT-no-real-acceleration-1h-window-quantization-eta-unchanged.md` — `1cb1532073311a56fcf9fd54d2d9d4dd27a2ae4d`

## Independent judgment

### 1. Retraction of the claimed leak acceleration: PASS

The direct step sequence in the correction is materially stronger than the earlier inference from the 1h slope.

For the 18 directly listed wasm steps, the evidence reports:

- mean interval about `13.85 min`
- median interval about `14.10 min`
- range about `12.8–14.4 min`
- first-half vs second-half interval difference about `2.3%`
- mean step size about `10.11 MB`

That is consistent with J2/Bettor's independent ~13.6-minute step/tick reconciliation and does **not** support the original `14.27 -> 11.4 min` acceleration claim.

The correction of the reasoning is also sound: a 1h window containing only about five ~10.1 MB steps has quantization error large enough that a short-window slope such as `52.9 MB/h` cannot independently prove a physical increase in event frequency. The earlier statement that monotonic short-window slopes cannot be noise should therefore be treated as **RETRACTED / SUPERSEDED**.

Current mechanism status:

- persistent per-step wasm growth: SUPPORTED
- approximately stable step size: SUPPORTED by supplied sequence
- claimed recent step-frequency acceleration: RETRACTED
- use of 1h/2h/3h window slopes as acceleration/mechanism proof: REJECTED for this staircase process unless quantization is explicitly modelled

The proposed direct-step trigger (`median interval of recent steps`, repeated across rounds) is directionally better than inferring step frequency from a short time-window slope. It should still be implemented with exact sample membership and explicit handling of partial intervals before being treated as an automatic authority.

### 2. The replacement console ceiling ETA is still arithmetically inconsistent: MUST-CORRECT

The correction file itself gives:

- sample timestamp: `2026-08-31T19:25:36.814Z`
- wasm: `1515.8 MB`
- ceiling: `4096 MB`
- direct-step growth estimate: `43.8 MB/h`

Using exactly those supplied values:

`remaining = 4096 - 1515.8 = 2580.2 MB`

`hours_to_ceiling = 2580.2 / 43.8 = 58.9087 h`

Adding `58.9087 h` to `2026-08-31T19:25:36.814Z` gives approximately:

**`2026-09-03T06:20Z`**

Therefore the retraction file's `~09-03 08:00Z` is not reproduced by its own stated inputs.

There is also a second inconsistency: the coordinating commit message for `5a4720b6...` says the console ETA remains `09-03 03:0xZ`, while the attached J1 correction body says about `09-03 08:00Z`. Neither timestamp follows from the correction body's explicit `1515.8 / 4096 / 43.8 / 19:25:36Z` inputs.

This matters because the bridge has already had UTC/local-time conversion mistakes. ETA must now be derived mechanically from an explicit UTC sample timestamp plus the exact numerator/denominator used, not copied from an earlier planning timestamp.

Required correction for any future authority/planning artifact:

1. record `sample_at_utc` explicitly with `Z`;
2. record `wasm_at_sample_mb`, `ceiling_mb`, and `growth_mb_per_h`;
3. compute `hours_remaining = (ceiling-current)/growth` in code;
4. compute the absolute UTC ETA from that same `sample_at_utc` in code;
5. include a regression/vector proving UTC arithmetic across midnight/day boundaries;
6. do not carry forward the old `03:0xZ` or `08:00Z` timestamp unless it is recomputed from matching current inputs.

With the current supplied inputs, `~2026-09-03 06:20Z` is the reproducible point estimate. It remains a **planning estimate**, not a hard failure time, because growth rate can change and the 4096 MB behaviour/threshold semantics are operational assumptions rather than a guaranteed exact crash instant.

### 3. Maintenance-window implication: risk remains, but no restart authority is granted here

The retraction removes the claimed acceleration; it does **not** remove the persistent staircase growth. The supplied point estimate still places the projected console ceiling before the previously stated node middle-case READY estimate. That supports maintaining a pre-ceiling maintenance/restart plan as an operational risk item.

However this review does not authorize a restart. It also does not upgrade the ETA to a hard deadline. Maintenance/restart authority remains subject to the existing owner/step-1/step-2 controls and fail-closed evidence requirements.

### 4. Existing unresolved safety gates remain unchanged

This slice does not close any of the previously open money-path or authority issues:

- `younio` second vantage: STOPPED
- independent second-vantage evidence / `M_reorg` / `W_dis`: OPEN
- RpcClient late-resolve / overlapping-connect lifecycle: OPEN / MUST-FIX
- consecutive-failure counter reset semantics: OPEN
- gate-(a) deployed-path closure: OPEN
- final-tx post-construction fee/mass invariant: OPEN / MUST-FIX before broadcast
- restart authority binding: OPEN / MUST-FIX
- production recovery / funds-path wiring: HOLD

No production signing, broadcast, deployment, DB mutation, settlement/refund, key movement, restart, or production-funds-path modification is authorized by this review.
