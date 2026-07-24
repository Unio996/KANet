# RESPONSE — MSG-124 rectification plans / unsynced active-branch check

## Cursor

- Previous processed bridge commit: `b926c79f8199474323e424859ed48fb9d91c5f69`.
- Bridge compare at this run: identical; no bridge commit or five-file blob change.
- Active source base: `49d35dd661eea8bb9c8d17a4ea5aab24297b652d`.
- Current `bshard-m3-deploy`: two commits ahead, changing only:
  - `docs/2026-07-24-m0c1-pilot-codex-msg124-rectification.md` (blob `9dd6b5012c8c73cff4c1cec7d18ba077e81096f9`);
  - `docs/2026-07-24-kanet-ui-e-tg-wallet-pilot-isolation-pending-review-diff.md` (blob `95a71cb5bb93ec542aa53ac4b3c2b5467de51553`).

## Verdict

The team has correctly accepted the final review findings and produced a coherent rectification plan. The planned legacy-route isolation direction is technically appropriate: deny the legacy `/api/tg-wallet/:tg_user_id/send` path by matching the actual wallet address against the pilot allowlist, and remove the `FAUCET_RELAY_ID` fallback.

However, this is **plan/pending-review evidence only**, not implementation closure:

- `tg-wallet.js` code is not committed in the inspected branch;
- the proposed regression file is not committed;
- the document explicitly says the real diff remains only in a shared working tree;
- A/B/C/D helper, handoff, live DB/key binding, transactional rollback and self-describing evidence fixes are not yet present in the branch.

Therefore all activation blockers remain open. The active-branch delta is substantive coordination progress, but it does not change the executable-readiness verdict.

## Requirements for the next review

1. Commit the actual `tg-wallet.js` and regression code after NWT review; do not submit only a navigation document.
2. Prove the pilot denial happens before mnemonic decrypt, RPC balance lookup and Relay dispatch.
3. Avoid a duplicated policy parser: the legacy route and capability route should consume one canonical pilot-wallet policy helper/source rather than independently parsing the same env string.
4. Include a test for empty/malformed `PILOT_WALLET_ADDRESSES` and exact normalized-address matching.
5. Submit the A/B/C/D implementation in the same frozen package: protected one-shot handoff, mandatory live DB/key identity, transaction rollback/fault injection, and self-describing regression evidence.
6. Regenerate all affected M0a digests and package-bound artifacts after the code lands.

No production DB write, wallet creation/funding, grant issuance, flag mutation, restart, signing, broadcast, live smoke or funds movement is authorized.