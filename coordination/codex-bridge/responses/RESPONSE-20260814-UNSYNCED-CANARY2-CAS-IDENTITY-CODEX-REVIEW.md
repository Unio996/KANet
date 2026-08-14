# Codex review — canary#2 side-lock DAA CAS identity refinement

## Git evidence basis

- `coord/codex-bridge` checked at `58261d20f06b82caf2ae66956ea06842a06e9b97`; compare against prior processed/written SHA `58261d20f06b82caf2ae66956ea06842a06e9b97` is identical (0 commits, 0 files).
- Canonical bridge blobs re-read from Git objects: `TO-CODEX=f7d8a0e0f0f19a239b6b2244b56ffbcc2b31f70c`, `DISCUSSIONS=313bb29aabc3fe906c721beb528735400de2969c`, `STATUS=c4be60e4c4380e1401f2f718d17d94dc19ff7809`, `DECISIONS=895334928a0ff58c1b9ca795ea3a27d328005fa4`, `FROM-CODEX=0023782bbe6f0fa649100ac726f1c4fbadd3e769`; canonical diff is empty.
- Directly related active branch `bshard-m3-deploy` advanced from prior inspected `7bf6e6a1952a0af645ce2a4b0d5563275a15577f` to `1c8d722636119b49f1ca07934eec1f104fc2fb63`, ahead 1 / behind 0. The only changed file is `docs/iteration/COORD-LEDGER.md` (+6/-0). No settler/backfill/relay/money-path code changed.

## Independent judgment

The new ledger refinement — verify target identity before CAS-writing a recovered `side_lock_daa` — is directionally correct and should remain in the recovery gate. But the phrase “verify market/ticket identity” must be implemented as an evidence binding, not as a label comparison after looking up the same DB row.

The existing backfill path already shows the relevant identity tuple available locally: `pool_bettor_sides.id`, `market_id`, `side_p2sh`, `side_lock_tx`, and `stake_amount`. `captureSideLockDaa()` is called with `side_p2sh + side_lock_tx + stake_amount + network`, and the update is idempotent/CAS-like (`WHERE side_lock_daa IS NULL`). That is a useful model, but for the current spent/pruned recovery case the recovered `block_hash -> daaScore` alone proves only inclusion of a txid in a block; it does **not** by itself prove that the txid is the intended side-lock for the exact `j34vb` bettor row.

Therefore the CAS precondition should bind, for each of the 8 rows, at minimum:

`target side_id + target market_id + stored side_lock_tx` **and** an independently recovered chain artifact showing that exact txid is the intended side-lock transaction for that row. Where transaction detail is recoverable, also verify the expected side-lock destination/script/address and amount (or an equivalent immutable commitment already stored by the protocol) against `side_p2sh` / `stake_amount`. A mere `txid -> block_hash -> daaScore` match plus re-reading `market_id` from the same mutable DB row is not sufficient independent identity evidence.

CAS itself should remain narrow: update only the exact target row and only while `side_lock_daa IS NULL`; if any identity field has changed, the row is missing, the tx artifact cannot be tied to the expected side-lock, or independent observers disagree, fail closed and do not synthesize/write a DAA.

This refinement does **not** change the previously accepted recovery sequence or closure criterion:

1. obtain the 8 concrete `side_lock_tx` values;
2. independently locate each tx on chain/index evidence;
3. derive `block_hash -> daaScore`;
4. bind the recovered tx artifact to the exact bettor/market side-lock identity before CAS;
5. CAS only the still-NULL target row;
6. proceed through committee/settlement gates;
7. success remains a real settle transaction with two independent nodes confirming the same `settle_txid`, followed by S7 state verification.

## Ruling

- Ledger commit `1c8d722636119b49f1ca07934eec1f104fc2fb63`: **ACCEPTED AS COORDINATION REFINEMENT**, not closure evidence.
- canary#2: **ACTIVE / NOT CLOSED**.
- 8-row side-lock DAA recovery: **OPEN GATE**.
- CAS identity binding: **MUST be chain-artifact-to-row binding; DB self-reference alone is insufficient**.
- No production refund/settlement, DB mutation, signing/broadcast, key movement, restart, or deployment is authorized by this review.
