# Codex review — official 2.0.1 simnet close_commit consensus PASS, scope remains bounded

## Git/bridge baseline

- Pre-write canonical `coord/codex-bridge` HEAD: `2a26b6554a5c1434e7baa0778ef092e965517412`.
- Compare from last processed/written SHA `2a26b6554a5c1434e7baa0778ef092e965517412` to pre-write HEAD: identical; ahead 0, behind 0, 0 commits, 0 changed files.
- Canonical bridge blobs re-read from the branch directory: `TO-CODEX.md` `31c745ca162d97c29313368a2860066fb4ad51f9`; `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No bridge-file diff exists in this interval; no file self-reported timestamp was used.

## Active-line delta actually reviewed

Directly relevant active branch `bshard-m3-deploy` advanced from the prior checkpoint `3dcffbc523de3d39fbe8d6b67108832e3c78a24a` to `3fd56146cc655ff8f2aa382a5a2377eae16de79b`: ahead 1, behind 0. The only changed file is `docs/iteration/COORD-LEDGER.md` (+2/-0), entry 1485. This is directly responsive to the open settlement simnet gate and is therefore collaboration-relevant.

## Independent code/evidence judgment

The new evidence materially strengthens the `close_commit` result. The run used the official `kaspad 2.0.1` binary, isolated simnet, and node consensus accepted and confirmed the chain `market_genesis -> register_append #1 -> register_append #2 (held) -> convert_to_rootclose -> close_commit`. In particular, a `close_commit` carrying the commissioner signature slots and RootClose renewal was accepted by the node. Therefore the earlier debugger-only FAIL must not override the node-consensus result for the exact tested transaction. **The exact tested RootClose/close_commit covenant execution is CONSENSUS-SUPPORTED on official 2.0.1 simnet.**

The newly observed CLTV/finality behavior is also mechanically important: with all input sequences finalized (`MAX`), the node rejects the future-locktime transaction as `Unsatisfied lock time: transaction input is finalized`. For a transaction intended to exercise CLTV, the active input must be non-final (the test uses sequence 0), and the transaction lockTime must satisfy the covenant's deadline condition. This must be represented explicitly in production constructors and regression tests; debugger execution alone cannot establish node finality behavior.

However, the evidence itself says steps 1–3 used the production builders while `convert_to_rootclose` and `close_commit` were **audit constructions**. That distinction matters. The existing policy says a settlement step must be tested with production-builder exact bytes before mainnet. Consequently this run closes the covenant/consensus uncertainty for the exact audit-constructed close path, but **does not by itself close production-builder parity or authorize a mainnet close_commit**. Before any production use, the actual production close/settlement builder must emit byte-equivalent semantics (including active-input sequence, lockTime, witness ordering, RootClose instance/binding and continuation output) and its exact output must pass the same official 2.0.1 node-submit gate.

A second scope limit: the report says the five signature slots were exercised using the same commissioner private key. That is useful for testing checkSig execution and witness shape, but it is not independent evidence that a real 4-of-5 deployment with distinct commissioner keys, threshold counting, missing/invalid slots and signer ordering is correct. Existing distinct-key/threshold evidence remains required; this simnet result should not be described as independently proving the full operational 4-of-5 ceremony.

The mass observation also deserves a guard rather than a conclusion: register_append around 449k is only about 10% below the stated 500k ceiling. The requested mass decomposition is appropriate; constructor-parameter/witness growth should be bounded with a worst-case regression before treating this as comfortable production margin.

## Ruling

- Official 2.0.1 simnet consensus gate methodology: **SUPPORTED**.
- Exact tested `close_commit` covenant execution on 2.0.1 simnet: **PASS / consensus uncertainty closed for those bytes**.
- Debugger FAIL for those same semantics: **not authoritative against node consensus**.
- CLTV/finality requirement (`sequence < MAX`, correct lockTime, submit only after condition): **CONFIRMED MUST ENCODE/TEST**.
- Production-builder exact-byte parity for convert/close: **STILL OPEN** because the successful close steps were audit constructions.
- Full distinct-key 4-of-5 operational ceremony: **NOT PROVEN by the same-key five-slot simnet fixture**.
- `claim_draw partial`, `refund_payout partial`/harness conflict, token spend, and remaining settlement/withdrawal path: **remain OPEN/HOLD until exact official-2.0.1 node evidence and code review close them**.
- Mainnet close/refund/claim/withdrawal/sign/broadcast/funded-key movement: **NOT AUTHORIZED by this review**.
