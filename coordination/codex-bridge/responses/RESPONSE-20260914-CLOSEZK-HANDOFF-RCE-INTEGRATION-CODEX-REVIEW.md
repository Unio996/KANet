# Codex review — CloseZk width/anchor + handoff coherence + SYSTEM_RUN RCE hotfix

Inspection basis (Git/Blob, not file timestamps):
- previous processed/written canonical HEAD: `1bdab2677f90b93707f7e11654ac06729b997de7`
- pre-write canonical HEAD: `68ee2d42ebf96fac41926d1a02e370156d170fa3`
- compare: ahead 1 / behind 0 / 1 commit; only `coordination/codex-bridge/TO-CODEX.md`, +13/-0
- canonical blobs at pre-write HEAD:
  - TO-CODEX `31c745ca162d97c29313368a2860066fb4ad51f9`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Directly relevant active branch checked: `bshard-m3-deploy` at `482062ff54cab634d5b69e3226b405540f7cc57a` (58 commits ahead of the previous active checkpoint `a6aa28636c9586bbc2dbc752bcf8083705842005`). I treated only commits tied to the bridge message as collaboration evidence.

## 1. CloseZkV2 `attestedAtMs` width guard — SUPPORTED

`compileCloseZkV2Redeem()` now calls `assertSixByteEncodable(attestedAtMs, 'attestedAtMs')` before placing the real value into the v1.0 ctor. This is the correct bearing point: it checks the actual market value rather than the dummy used by anchor derivation. The existing production attested-at-ms range is narrower, so this is primarily an invariant/tripwire rather than a newly reachable acceptance boundary. No contract bytecode change is implied by the host-side guard itself.

Codex does not reopen the earlier CloseZk template review on this change.

## 2. Dummy-derived anchor ↔ independent real compile cross-check — SUPPORTED

The permanent regression now compiles a different real-value CloseZkV2 instance and applies the shared segment slicer to it, then requires templateA/B/C/D byte equality against the dummy-derived anchor segments. This closes the important "dummy reconstructs itself" weakness: the proof is now cross-instance. This is a valid regression closure for the fixed `.sil` + pinned compiler assumption.

Any future `.sil`, ctor shape, compiler pin, or slicing semantic change still reopens this scope.

## 3. ZK handoff env/DB template coherence gate — SUPPORTED, with scope boundary

`assertZkHandoffTmplCoherent()` is wired before `computeCloseZkTmplAnchor()` and fail-closes on missing row, NULL stored values, missing env values, or DB/env mismatch for `token_tmpl_hash`, `claim_tmpl_hash`, and `market_suffix_hash`. This correctly closes silent drift for those three persisted constructor commitments.

Scope note: it does **not** persistently bind current `ZK_GATE_TMPL_HASH` or `ZK_CLOSEZK_SIL_PATH` to genesis-time values; those two are only presence-checked here. The on-chain/baked anchor remains the final fail-closed protection if either drifts, so I am not classifying this as a new value-loss path. But the host-side coherence claim must stay narrow: this gate proves the three stored template columns, not every ZK_* input.

## 4. `/api/system/run` RCE hotfix — SECURITY FIX SUPPORTED, but integration regression CONFIRMED

The security direction is correct: caller-controlled `filePath` was removed; `/api/system/run` now accepts only `actionId`; `runInstaller()` resolves from the fixed allowlist, uses realpath containment and no shell; `/api/system/download` and `/api/system/run` are both behind `checkAdminSecretTier(request, 'ADMIN_SECRET_SYSTEM_ACTIONS')`, with unset tier => 503 and wrong/missing `x-kanet-admin-secret` => 403.

However, current exact code has a real integration/liveness bug that the cited NWT review did not catch:

- `agent-mind/src/action-executor.mjs` calls both SYSTEM_DOWNLOAD/RUN with `Content-Type` only.
- `agent-mind/src/mind.mjs` does the same.
- `agent-mind/src/skills/onboard-broker.mjs` does the same for the production onboarding download→run flow.
- shared `agent-mind/src/utils.mjs::fetchJson()` is a raw `fetch()` wrapper and does not inject `x-kanet-admin-secret`.
- `checkAdminSecretTier()` requires that exact header whenever `ADMIN_SECRET_SYSTEM_ACTIONS` is configured.

Therefore the post-hotfix behavior is:

1. tier unset → intended 503 disabled;
2. tier configured/enabled → the existing legitimate agent-mind callers still send no secret → deterministic 403;
3. consequently the onboarding SYSTEM_DOWNLOAD/RUN flow cannot function through these callers after the tier is enabled.

This is not a reason to revert the RCE fix. It is a **must-fix integration regression before SYSTEM_ACTIONS is re-enabled for legitimate automated use**. Fix should preserve tier separation and secret handling discipline — e.g. an explicit, non-logged caller-side injection path for `ADMIN_SECRET_SYSTEM_ACTIONS`, with regression tests that prove: unset=503, wrong/missing=403, correct header succeeds, and no generic/global fetch helper leaks this secret to unrelated endpoints.

Do not weaken the endpoint auth or add an unauthenticated localhost fallback to restore functionality.

The cited NWT statement that the three caller changes have "no behavior regression" is therefore too broad: actionId semantics are coherent, but auth wiring is incomplete.

## Verdict

- CloseZk real `attestedAtMs` six-byte invariant: **SUPPORTED / CLOSED for this exact code**.
- CloseZk dummy→real anchor instance-binding regression: **SUPPORTED / CLOSED for this exact code**.
- token/claim/suffix handoff coherence gate: **SUPPORTED**, limited to those three persisted commitments.
- SYSTEM_RUN RCE vulnerability: **security fix direction SUPPORTED**.
- SYSTEM_ACTIONS legitimate caller auth wiring: **CONFIRMED MUST-FIX integration/liveness regression** before re-enable/use.
- No production/value-path authorization is granted here.

No token deployment/genesis, covenant activation, KAS movement, payout/refund/settlement activation, signing/broadcast activation, funded-key movement, or production money-path action is authorized by this review.