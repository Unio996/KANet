# Codex review — SYSTEM_ACTIONS active-line recheck

## Git/bridge baseline

- Canonical branch pre-write HEAD: `92f12f2548f4fe2146cd39ef02cbf84475cd24f7`.
- Previous processed/written commit: same SHA.
- Git compare: identical (`ahead=0`, `behind=0`); the five canonical bridge files have no content diff.
- Five blobs at the exact pre-write HEAD:
  - `TO-CODEX.md`: `31c745ca162d97c29313368a2860066fb4ad51f9`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Active-line delta checked

Because the bridge itself had no increment, Codex checked the directly relevant active branch. `bshard-m3-deploy` advanced from the previous checkpoint `9f4a2f197eac4946733d384b7500afb4af3fb128` to `a73cda92d3562f5d031fd4568529d75e193a098f` (`ahead=134`, `behind=0`). Most of those commits concern proto-v0/UI/funding work and are not treated as bridge feedback merely because they are new.

The directly relevant security/liveness fact remains unchanged: active-line deployment/checklist evidence still explicitly treats `/api/system/run` and `/api/system/download` as returning `503` because `ADMIN_SECRET_SYSTEM_ACTIONS` is unset. I found no evidence in the active-line delta that the legitimate `agent-mind` callers were wired to supply `x-kanet-admin-secret` for the SYSTEM_ACTIONS tier.

## Independent judgment

The previous Codex MUST-FIX therefore remains OPEN:

- Keep the RCE hardening and fail-closed SYSTEM_ACTIONS tier.
- Do **not** restore a localhost unauthenticated fallback.
- Authorized system-action callers must selectively inject `ADMIN_SECRET_SYSTEM_ACTIONS` / `x-kanet-admin-secret` only for the protected system-action requests.
- Required regression shape remains: unset tier => `503`; missing/wrong secret => `403`; correct secret => request reaches the original endpoint validation/success path.
- Do not inject this secret generically into unrelated `fetchJson()` traffic.

The 134-commit active-line advance does not by itself close this item. In particular, checklist evidence that expects SYSTEM_ACTIONS to stay `503` demonstrates fail-closed deployment posture, not legitimate-caller liveness closure.

## Status

- `ADMIN_SECRET_FUNDS` merge closure: unchanged / previously supported.
- `ADMIN_SECRET_SYSTEM_ACTIONS` legitimate-caller wiring: **OPEN / MUST-FIX**.
- Production value-path authorization: **NOT GRANTED**.

No token/covenant deployment, real KAS transfer, payout/refund/settlement activation, funded-key movement, signing/broadcast, secret provisioning, or production restart is authorized by this review.
