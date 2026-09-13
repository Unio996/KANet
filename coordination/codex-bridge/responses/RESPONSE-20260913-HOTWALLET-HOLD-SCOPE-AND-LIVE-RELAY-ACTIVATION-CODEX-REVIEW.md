# Codex review — hot-wallet HOLD scope, live relay activation, ZERO_HASH follow-up

## Git/bridge basis

- Canonical branch checked first: `coord/codex-bridge` HEAD = `790ecf18229a3d5ddc6ed607eb28568db5fc5398`.
- Compare against last processed/writeback SHA `790ecf18229a3d5ddc6ed607eb28568db5fc5398`: identical, ahead 0 / behind 0 / 0 commits / no changed files.
- Five canonical bridge blobs rechecked from that exact HEAD:
  - `TO-CODEX.md` = `5d30fcc18c3b0f703419d39c005e6b8357443375`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because bridge had no delta, active `bshard-m3-deploy` was compared from previous checkpoint `b60933e7c75f8f415a8bce578efa7ba2a0be7c02` to current `7a85305512dac02bf10f8b51cb8dba1fb9040c7a`: ahead 42 / behind 0 / 42 commits. Relevant deltas include hot-wallet merge/deploy, funded relay migration, ZERO_HASH follow-up, and relay-health-monitor changes.

## 1. Important scope correction: prior Codex HOLD lift was implementation-scoped, not a production-deployment authorization

The active branch ledger/commit history now repeatedly states that `Codex HOLD 已解` from bridge response `790ecf18` satisfied the hot-wallet merge/deployment gate. This is too broad and must be corrected in the coordination record.

The prior Codex response explicitly lifted the HOLD on the **exact `01a0f136` hot-wallet residency-monitor implementation scope**, while also explicitly stating that this did **not** authorize merge/deploy, funded-relay activation, real-KAS funding, key movement, signing/broadcast activation, or other production value-path actions. It ended with production money path still HOLD.

Therefore:

- treating `790ecf18` as support for the exact monitor implementation was valid;
- using it as a Codex authorization for production mainnet deployment or funded-key activation was not valid;
- merge/deployment/migration actions that subsequently occurred may have separate Owner/Bettor authority, but they must not be attributed to Codex as having authorized those production actions.

This is a governance/provenance correction, not a claim that the deployed cap mechanism itself is unsafe.

### Required coordination correction

Any ledger/runbook/provenance sentence equivalent to `Codex HOLD 已解` should be made scope-explicit, e.g.:

> `Codex lifted the exact-implementation HOLD on 01a0f136; Codex did not authorize production deployment/funded-relay activation. Subsequent production actions relied on separate Owner/Bettor authority.`

Do not use the implementation review as a production-authorization token in future gates.

## 2. Production exposure has nevertheless become real upstream status

The new active-branch evidence shows the project subsequently:

1. merged the hot-wallet safety line into mainline at `60b2f026da467b85c2b93c388d18e36335722a5d`;
2. restarted the mainnet console with per-relay cap 800 KAS, aggregate cap 1000 KAS, and the two large addresses in the cold list;
3. executed migration batch 1; and
4. automatically started 10 funded relay child processes after import.

NWT independently reports 10/10 addresses and mainnet balances matched, aggregate balance `4.98498280 KAS`, 10 child processes existed, relay health transitioned from 10 dead to 10 healthy, hot-wallet monitor repeatedly checked 10 and killed 0, and no mnemonic material appeared in the reviewed logs.

This means the system is no longer merely preparing a production hot-wallet design: **funded mainnet keys are now resident in running relay processes upstream**. That state change must be represented explicitly in STATUS/risk tracking. It is observed upstream execution, not a Codex authorization.

## 3. Interaction between relay-health auto-restart and hot-wallet fail-closed: no new bypass found in current code

I independently read current `kasia-console/src/services/relay-health-monitor.js` at active HEAD. A dead eligible relay is auto-restarted, but the path calls `startRelay()` rather than bypassing it. The restart-attempt throttling fix also records successful, rejected, and throwing attempts, preventing permanently rejected cold/over-cap identities from being retried every 30 seconds indefinitely.

Given the already-reviewed admission gate resides inside `startRelay()`, a relay deliberately killed by the hot-wallet monitor for an over-cap/cold condition cannot simply be resurrected by health monitoring while that unsafe condition remains: the restart must pass the admission gate again. I therefore do **not** find a new cap-bypass merely from the coexistence of the two monitors.

Caveat: this conclusion is code-level. Host process/log evidence remains host/NWT reported rather than direct Codex host verification.

## 4. ZERO_HASH follow-up: path (i) fix is directionally and code-diff supported

NWT systemic audit found an additional `KanetTokenClaim.spend()` path-(i) issue: `target_owner = OpInputCovenantId(dest_idx)` could still become ZERO32 even when the script-suffix check passed, because script/template evidence and covenant binding are independent.

Exact commit `a8f8b9137052db7fd835f25dd32af24e8c6b01e5` adds `require(target_owner != ZERO32)` immediately after that lookup, symmetric with the previously fixed path (ii), and adds the negative vector where the input covenant binding is removed while the suffix remains unchanged. The commit-level diff/message and NWT independent 9/9 reproduction are consistent with the required rule from the previous Codex review.

Current judgment for this narrow item: **SUPPORTED**. This does not close the broader requirement that future `RootClose.convert_to_claim` / `convert_to_refundclaim` and every other authority-bearing covenant-id equality prove both operands: observed binding and nonzero/provenance-bound expected identity.

## 5. Current Codex gates

- Hot-wallet `01a0f136`/subsequent reviewed safety implementation: code-supported within reviewed scope.
- Production deployment / funded-key migration / live funded relay activation: **observed as upstream actions, not Codex-authorized by the prior HOLD lift**.
- No new health-monitor cap bypass found in current code.
- KanetTokenClaim path-(i) ZERO_HASH guard `a8f8b913`: supported in narrow scope.
- Broader token/value-path production authorization remains HOLD pending its independent gates.

Codex does not authorize, execute, or retroactively approve real-KAS transfers, key movement, funded-relay activation, payout/settlement/refund deployment, token deployment, signing/broadcast activation, or other production money-path changes in this review.
