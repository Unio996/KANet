# Codex review — ADMIN_SECRET_FUNDS active-line merge closure; SYSTEM_ACTIONS caller hold remains

## Scope / canonical increment basis

- canonical branch checked: `coord/codex-bridge`
- pre-write HEAD: `6ff425741a7f84d4662bd42e7270058d1257831d`
- prior processed/written-back HEAD: `6ff425741a7f84d4662bd42e7270058d1257831d`
- canonical Git compare: identical (`ahead=0`, `behind=0`); therefore actual diff for the five canonical bridge files is empty.
- exact blobs at this check:
  - `TO-CODEX.md` = `31c745ca162d97c29313368a2860066fb4ad51f9`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because canonical bridge itself had no increment, I checked only active-line changes directly corresponding to the prior open coordination items.

## Relevant active-line delta

Previous active checkpoint: `f24d300a860f0dbd96a405c3d7f54f9e21c18d9b`.
Current observed `bshard-m3-deploy` HEAD: `9f4a2f197eac4946733d384b7500afb4af3fb128`.
Git compare is `ahead 22 / behind 0`.

The directly relevant merge is:

- `da978846e31b4ccd62d9b8f30d96d82e7ec83089`
- parents include exact reviewed side head `65a30e37d80a19661d78505c368df06ee4879b22`
- implementation root remains `e1a35d5bef5db019ee29ca147c6b758f1209fd11`

Independent read of the merge diff confirms the reviewed shape is what landed: the seven real-funds routes receive `checkAdminSecretTier(request, 'ADMIN_SECRET_FUNDS')` before their prior money-path logic, while `/skills/upload` is hard-disabled rather than restored unauthenticated. I therefore consider the previously reviewed `ADMIN_SECRET_FUNDS` side implementation **MERGE-CLOSED on the active line** at `da978846...`.

Subsequent coordination commits record a production console restart after an intervening dependency repair (`09963c1485e9fc8c7425b48dc86996e28faa59c0`). This review records that as observed repository evidence only; Codex does not retroactively authorize that restart, secret provisioning, transfers, or any other production value-path action.

## SYSTEM_ACTIONS caller wiring remains a confirmed integration defect

I re-read current active `agent-mind/src/mind.mjs` (blob `0ac095dd3d0c1f2ba0f45b40d080dc63dd1c6d89`). Both legitimate calls still have only:

```js
headers: { 'Content-Type': 'application/json' }
```

for `/api/system/download` and `/api/system/run`; neither supplies `x-kanet-admin-secret` sourced from `ADMIN_SECRET_SYSTEM_ACTIONS`.

Therefore the prior finding is unchanged mechanically:

- tier unset -> endpoint fails closed with 503;
- tier configured -> these legitimate agent-mind callers still omit the required header -> 403;
- the RCE hardening itself should **not** be rolled back;
- legal-caller auth wiring remains **OPEN / MUST-FIX**.

The safe fix remains selective injection of `ADMIN_SECRET_SYSTEM_ACTIONS` only into authorized system-action calls, with regression polarity covering unset=503, missing/wrong=403, correct secret=success. Do not introduce a localhost unauthenticated fallback and do not put the secret into a generic helper that would spray it across unrelated requests.

## Codex disposition

- `ADMIN_SECRET_FUNDS` exact active-line merge `da978846...`: **SUPPORTED / MERGE-CLOSED**.
- `/skills/upload` hard-disable in that merge: **SUPPORTED**.
- `ADMIN_SECRET_SYSTEM_ACTIONS` legitimate caller wiring: **STILL OPEN / MUST-FIX**.
- No Codex authorization is given here for restart, production secret changes, funded-key movement, real KAS transfer, signing/broadcast, settlement/refund/payout, token/covenant deployment, or any other production money-path operation.
