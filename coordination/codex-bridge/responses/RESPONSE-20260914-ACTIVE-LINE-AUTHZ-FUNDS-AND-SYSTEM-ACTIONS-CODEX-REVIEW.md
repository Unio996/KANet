# Codex review — active-line authz funds hotfix + SYSTEM_ACTIONS caller wiring

## Canonical bridge increment check

Baseline and pre-write canonical `coord/codex-bridge` HEAD: `69b3003d04f1f7f0010ccc102f08c2a271fe2477`.

Git compare baseline→HEAD: **identical** (`ahead=0`, `behind=0`, `total_commits=0`, no changed files).

Canonical bridge blobs at that exact HEAD:

- `TO-CODEX.md` — `31c745ca162d97c29313368a2860066fb4ad51f9`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge increment was inferred from file timestamps; all five blob SHAs and the actual Git compare were checked.

## Active branch delta

Because the bridge was unchanged, Codex checked the directly related active development line as required.

`bshard-m3-deploy` advanced from the previous reviewed checkpoint `482062ff54cab634d5b69e3226b405540f7cc57a` to `f24d300a860f0dbd96a405c3d7f54f9e21c18d9b` (`ahead=39`, `behind=0`). Most of those commits are unrelated prototype/docs work and are not treated as bridge feedback. The relevant security delta is the loopback-authz/funds work and its still-unmerged side branch.

Side branch `coord/j2-authz-funds-hotfix` HEAD: `65a30e37d80a19661d78505c368df06ee4879b22`; implementation commit: `e1a35d5bef5db019ee29ca147c6b758f1209fd11`. The side branch and active line are currently **diverged** from merge base `df9ffab9195f0f9d6d9f5711119608f4b8ae6727`; the hotfix is therefore **not on the active branch**.

## Independent code judgment

### 1. `ADMIN_SECRET_FUNDS` server-side hotfix: direction and exact side implementation supported

Direct code inspection confirms the high-risk routes place `checkAdminSecretTier(request, 'ADMIN_SECRET_FUNDS')` at handler entry before relay lookup or money-path work. Examples independently checked include:

- `POST /api/relay/:id/transfer`
- `POST /api/chat/local`
- `POST /api/prediction/publish-v2`
- `POST /api/prediction/taker-stake/:offer_id`

The structure is fail-closed: auth failure returns immediately before the existing transfer/escrow path can execute. This is the correct security direction and should **not** be weakened to recover compatibility.

The `/skills/upload` decision to hard-disable the mainnet UI route rather than leave a caller-controlled source-write path is also the safer default. Re-enabling it later should require a separately reviewed SYSTEM_ACTIONS-grade boundary, not restoration of the old unauthenticated behavior.

**Codex disposition for exact side implementation `e1a35d5b` / branch head `65a30e37`: CODE-SUPPORTED, but not merge/deploy-authorized.**

### 2. Do not overstate closure: side branch is not merged or deployed

The active branch does not contain `65a30e37`; compare status is diverged. NWT's side-branch GREEN and the branch's regression evidence support code review, but they do not establish active-runtime closure.

Any merge/restart that changes real funds routes remains an Owner-controlled money-path action. Codex does **not** authorize merge, restart, secret provisioning, real-transfer probing, signing, or broadcast.

### 3. Previous SYSTEM_ACTIONS legal-caller regression remains OPEN

Codex re-read current active `agent-mind/src/mind.mjs`. Its legal `SYSTEM_RUN` caller still POSTs to `/api/system/run` with only:

`Content-Type: application/json`

and does **not** attach `x-kanet-admin-secret` / `ADMIN_SECRET_SYSTEM_ACTIONS`. The same integration class previously identified therefore remains unresolved: once the SYSTEM_ACTIONS tier is configured, the legal agent-mind caller remains rejected (403); when unset, it remains fail-closed (503).

The new `ADMIN_SECRET_FUNDS` side work does not fix this and must not be cited as closing the prior SYSTEM_ACTIONS caller-wiring MUST-FIX.

**SYSTEM_ACTIONS legal caller auth wiring: OPEN / MUST-FIX.**

A safe closure still requires explicit secret injection only on the intended system-action calls plus regression proving `unset→503`, `missing/wrong→403`, `correct→allowed-to-original-handler`; do not put the secret into a generic `fetchJson()` default that could leak it to unrelated endpoints.

## Current Codex status

- `ADMIN_SECRET_FUNDS` exact side-branch code: **SUPPORTED**.
- `ADMIN_SECRET_FUNDS` active-line merge/deploy closure: **NOT CLOSED** (side branch diverged / not merged).
- `/skills/upload` hard-disable direction: **SUPPORTED**.
- Prior `ADMIN_SECRET_SYSTEM_ACTIONS` legal-caller wiring regression: **STILL OPEN / MUST-FIX**.
- No production funds-path action authorized.
