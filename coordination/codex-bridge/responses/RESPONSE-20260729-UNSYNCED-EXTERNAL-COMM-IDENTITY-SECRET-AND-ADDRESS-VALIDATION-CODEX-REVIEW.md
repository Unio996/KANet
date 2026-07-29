# Codex review — unsynced external communication example increment

## Review basis

- Bridge comparison base: `13798e50b2898c2f75222a7ac81fb8d9e11658e5`
- `coord/codex-bridge` current HEAD at review start: `13798e50b2898c2f75222a7ac81fb8d9e11658e5`
- Bridge compare: identical; ahead 0, behind 0; no canonical-file diff.
- Active branch comparison base: `dd6ff19100c1dc94843f0d1f181fbea4ad9b7b21`
- Active branch HEAD reviewed: `e28af260a5bf7f443e1d969e0a2bc3631d34ece1`
- Active compare: 15 commits ahead, 0 behind.
- Relevant blobs:
  - `docs/examples/kanet-external/send-comm.mjs`: `99ddec1894577e927f639bff68604caee2a8c8e2`
  - `docs/examples/kanet-external/README.md`: `0abf0ab39f94891df1828810dda6ddf62e377e01`
  - `docs/iteration/COORD-LEDGER.md`: `ba50f8691df6bedd8f604780cd72c8fa836a8dab`

No file-authored timestamps were used for increment detection.

## Verdict

`EXTERNAL_COMM_SELF_CHECK_EXPANDED__PRIVATE_KEY_DISCLOSURE_DEFECT_OPEN__CANONICAL_ADDRESS_VALIDATION_STILL_OPEN__NOT_SEND_READY`

## 1. New self-check coverage is useful

The increment now exercises input planning and actual `Generator` construction offline, and verifies that the built transaction uses the same input set used by the storage-mass estimate. This is materially better than syntax-only checking and directly guards prior “first real execution” failures.

This narrow improvement is accepted as test observability, not as end-to-end send proof. The code still states that the `--to` path has only been run through node connection, not transaction submission and recipient decryption.

## 2. The example prints the private key in plaintext on every self-check

`printIdentity()` prints `privKeyHex` both when the key is newly generated and when it came from `KANET_PRIVKEY`. This means a persistent identity secret is deliberately emitted to terminal output and therefore can land in:

- CI and automation logs;
- copied support transcripts;
- shell/session capture;
- screen sharing and screenshots;
- process-wrapper logs.

The README also contains a complete private-key sample and instructs users to copy/export the generated secret. Even on TN12, this normalizes unsafe secret handling and makes the example unsuitable as a reusable external integration template.

Required correction:

- Never print an existing `KANET_PRIVKEY` value.
- Prefer writing a newly generated key once to a permission-restricted file or require the caller to generate/provide it separately.
- If a one-time reveal is retained for a disposable test identity, require an explicit flag such as `--reveal-new-private-key`, print a strong warning, and never reveal a key sourced from the environment.
- Documentation examples must use unmistakable placeholders, not a syntactically valid reusable private key.
- Add a regression test proving normal `--self-check` output contains the address but not the secret or the environment value.

This is a security defect in the published example, even though it is not a production money-path deployment.

## 3. Canonical address validation remains incomplete

`xOnlyPubkeyFromAddress()` still manually:

- accepts any prefix before the first colon;
- strips eight checksum characters without verifying the checksum;
- converts the remaining payload itself;
- checks only decoded version and length.

Therefore a wrong-network or checksum-corrupted address can still be accepted and encrypted to the wrong key while producing a valid transaction and txid. The new P2SH negative control does not detect this class.

Required correction remains:

- Parse with the vendored `kaspa-wasm` canonical `Address` implementation.
- Require the exact intended testnet network/prefix.
- Verify checksum and canonical round-trip string equality.
- Require Schnorr P2PK type/version and 32-byte x-only payload.
- Add negative cases for one-character payload corruption, checksum corruption, wrong prefix/network, truncation, appended characters, P2SH, and ECDSA P2PK.

Until this is fixed, the script must not be described as safe for `--to` use.

## 4. Documentation claim boundary

The README’s “照着走” framing is stronger than the evidence. It correctly admits that node/faucet access is unavailable and that full broadcast has not been exercised, but it also presents the file as a complete minimal sender. The safe status is narrower:

- envelope-format demonstration: independently useful;
- offline Generator-construction check: useful;
- recipient-address safety: incomplete;
- secret handling: unsafe by default;
- real TN12 send + inclusion + recipient decrypt: unproven.

The headline and top-level comments should reflect this exact boundary.

## Requested next evidence

1. Secret-redaction regression output showing no private key in normal execution.
2. Canonical-address parser implementation and malformed-address negative suite.
3. Fixed source commit and vendored wasm blob hashes.
4. Disposable TN12 end-to-end receipt: txid, inclusion proof, exact payload bytes, and recipient-side successful decryption.
5. Failure proof showing malformed recipient addresses are rejected before transaction construction or signing.

## Authority boundary

No production deployment, listener exposure, faucet grant, signing, broadcast, settlement, refund, schema migration, restart, or money movement is authorized by this review.
