# Codex review — unsynced payout_ps_addr backfill strict-outpoint fix

## Git baseline

- bridge baseline / HEAD before this write: `fa0dc42d4834bceb2f4f441d298514b1ae80204f`
- Git compare baseline→`coord/codex-bridge`: identical, ahead 0, behind 0, files `[]`
- canonical bridge blobs re-read from that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active directly-related development branch: `bshard-m3-deploy`
- last reviewed dev SHA: `88eb2446f95050b9c055fe3928cd7b56103e683f`
- current dev SHA inspected: `7af34db2ca72874422d8db619ea46e59aa5501bc`
- compare: ahead 5 / behind 0. Directly relevant backfill fix commit: `c3d7f94f382b212584259d4a7ae7634ce55fe080`.
- current relevant blobs at dev head: `scripts/backfill-payout-ps-addr.mjs` `3e96c94efb0ce146d7b523770668be4ce7e4b1d5`; `scripts/backfill-payout-ps-addr.test.mjs` `791d00e8def816211fdea2aee8012180747a3a72`.

## Independent code judgment

### Previous malformed-outpoint→index-0 blocker: CLOSED IN CODE

The prior RED path was real: malformed `payout_ps_outpoint` values could be transformed into output index `0` before `verifyRedeemMatchesChainObservedOutput`, allowing the verifier to attest a different outpoint from the one stored in DB.

Commit `c3d7f94...` removes that fallback rather than trying to compensate after verification. `parseOutpoint()` now fail-closes before any chain probe unless the value is exactly one 64-hex txid plus one canonical non-negative decimal index. Missing/extra separators, non-hex txid, empty/non-decimal/negative/fractional/leading-zero index and out-of-range index are rejected. The verifier is now passed only `parsed.txid` and `parsed.index`; there is no invalid→0 substitution.

The malformed branch also has the correct authority semantics: it does not probe chain, does not backfill, reports the row separately, and in confirmed mode records a skipped event. This preserves the key invariant: if the exact DB outpoint is not trustworthy, no chain observation of a substituted outpoint may authorize a DB mutation.

The added negative fixtures exercise the malformed shapes requested in the previous review, and the commit explicitly retains the important limitation that an offline fixture cannot prove the complete false-confirmation chain end-to-end. That limitation is correctly stated rather than hidden.

**Verdict:** previous strict-outpoint parsing RED/MUST-FIX = **CLOSED / ACCEPTED IN CODE**.

### What this does *not* close

This does not authorize the historical backfill itself. The positive money-bearing path remains unverified here: an actually divergent funded shard must be shown to satisfy exact-outpoint chain confirmation, then the one-way `addr ← p2sh(current redeem)` update, then the existing coherence gate must turn green, with no unrelated row mutation. The developer commit itself states the script has not been run against a real database.

Accordingly:

- strict parser / no-default invariant: **GREEN in code**;
- malformed rows cannot authorize a substituted chain probe: **GREEN in code**;
- historical funded-row positive acceptance: **OPEN**;
- real DB backfill / production mutation: **NOT AUTHORIZED by this review**.

No settlement/refund, signer/broadcaster, key movement, production DB mutation, deployment, or production funds-path action is authorized here.
