# Codex review — unsynced external communication and coordination increment

## Review basis

- Bridge baseline reviewed/written: `c5ba0d99506cfda2fe5d07c648438dcb0b5cb8e0`
- Bridge compare before review: `c5ba0d99506cfda2fe5d07c648438dcb0b5cb8e0...coord/codex-bridge` = identical, ahead 0, behind 0
- Active branch baseline: `e28af260a5bf7f443e1d969e0a2bc3631d34ece1`
- Active branch HEAD reviewed: `e7306d88faaaf88f62e9c8f778de8778a40ab7ba`
- Active compare: ahead 12, behind 0
- Changed paths: external example README/script, coordination ledger, handoff
- `send-comm.mjs` blob reviewed: `c6c69eb9dc0e4ee1d95f7a06d783025d12bc940e`

No file self-reported timestamps were used as an increment cursor.

## Verdict

`SECRET_OUTPUT_DEFECT_FIXED__CANONICAL_ADDRESS_PARSE_DIRECTION_ACCEPTED__PUBKEY_EXTRACTION_BYTE_PROOF_STILL_REQUIRED__READONLY_ANALYSIS_SCOPE_ACCEPTED_WITH_AUTHORITY_BOUNDARY`

## 1. Private-key output defect is materially fixed

The example now distinguishes ephemeral from environment-provided keys and defaults to never printing either key. A generated key is revealed only under the explicit `--reveal-new-private-key` flag, while a `KANET_PRIVKEY` value is never echoed. The self-check also asserts that the displayed identity lines contain the address but not the private key unless the narrow ephemeral/reveal condition is satisfied.

This closes the previously identified default secret-disclosure defect. Keep the rule that an environment-provided key must never be printable, even when `--reveal-new-private-key` is present.

## 2. Canonical `Address` parsing is the correct validation boundary

Replacing hand-written checksum/prefix acceptance with `new Address(...)`, followed by explicit `kaspatest` and `PubKey` checks, is the correct direction. It removes the earlier class of malformed-checksum, arbitrary-prefix and P2SH-as-recipient failures before transaction construction.

However, the code still manually derives the x-only key from `parsed.payload` by mapping bech32 characters, slicing eight symbols, converting bits, and dropping a version byte. The parser proves that the address is valid; it does not by itself prove that this secondary extraction reproduces the exact 32-byte key represented by the address for this vendored wasm API/version.

Before calling the recipient path closed, add byte-level positive proof:

1. generate a fixed private key/keypair;
2. derive its canonical address through the same vendored `kaspa-wasm` build;
3. run `xOnlyPubkeyFromAddress(address)`;
4. compare the result byte-for-byte with the keypair's independently exported x-only public key;
5. repeat for several keys and include at least one key whose compressed SEC prefix is `03`;
6. assert canonical address round-trip equality and retain the vendored wasm blob/version in the receipt.

The `03` case matters because the encryption code always reconstructs a compressed recipient point with prefix `02`. That is valid only if the protocol intentionally uses the even-Y lift of an x-only Schnorr key and the receiving implementation derives the same ECDH point. The existing self-encryption test does not independently prove cross-implementation interoperability because sender and self-check may share the same assumption. Preserve the earlier requirement for an actual receiving-side decrypt using the production-compatible receiver.

Current status:

`ADDRESS_SYNTAX_AND_TYPE_GATE_ACCEPTED__RECIPIENT_POINT_INTEROPERABILITY_NOT_YET_BYTE_PROVEN`

## 3. Self-check quality improved, but it is still not a broadcast proof

The self-check now exercises input planning, storage-mass calculation and `Generator` transaction construction with shaped fake UTXOs. This is useful and catches code that syntax checking cannot reach.

It still does not prove:

- a real TN12 UTXO can be consumed;
- the transaction is accepted and included;
- fees/change match the constructed transaction;
- the intended recipient can decrypt the on-chain payload;
- malformed recipients are rejected before signing/submission in the real path.

The source comment correctly states that `--to` has only been run through node connection. Keep that limitation prominent in the README and do not label the example send-ready until the disposable TN12 end-to-end receipt exists.

## 4. Read-only claim-audit scope reduction is accepted, with one boundary

The coordination increment correctly recognizes that if full outbound message bodies already exist in `messages`, adding a new live write path in `mind-manager` is unnecessary. Reframing the first-stage investigation as read-only analysis is preferable to modifying a user/money-path component merely to duplicate data already present.

But the four claimed inputs have different authorities:

- conversation parties and asserted text may come from `messages`;
- actual transaction count, amounts and outcomes must come from chain/RPC evidence;
- truth/falsity requires a deterministic claim-to-chain mapping, not keyword matching or operator interpretation;
- absence of a success trace cannot prove the RPC path was unused if successful calls are not instrumented.

Therefore the read-only analyzer must emit an evidence manifest per finding containing message row identity/hash, extracted claim, chain query inputs, chain result/txid/block evidence, comparison rule and confidence. It must fail as `UNRESOLVED`, not `FALSE`, when the claim cannot be mapped deterministically or required chain history is pruned/unavailable.

The ledger's correction that a zero count from a log which never receives that event is a non-measurement is accepted. Do not rehabilitate that number merely because it coincides with a valid database query result.

## Required next evidence

1. Byte equality between extracted recipient x-only key and independently exported keypair public key, including an odd-Y/`03` compressed-key case.
2. Cross-implementation envelope decrypt using the actual receiver path.
3. Disposable TN12 txid, inclusion proof, fee/change accounting and receiver plaintext receipt.
4. Malformed checksum, wrong network, P2SH, ECDSA-address and trailing-data rejection before signing.
5. Read-only claim-audit output schema with row/blob hashes and deterministic chain evidence mapping.

## Authorization boundary

This review does not authorize production deployment, public listener exposure, faucet use, signing, broadcast, settlement, refund, restart, schema migration or any production money-path modification.