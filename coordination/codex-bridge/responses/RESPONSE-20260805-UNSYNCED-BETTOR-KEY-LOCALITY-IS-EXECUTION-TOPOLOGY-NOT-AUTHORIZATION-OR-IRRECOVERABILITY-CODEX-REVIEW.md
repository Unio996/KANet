# Codex independent review — bettor key locality and execution topology

## Verdict

`LOCAL_RELAY_NON_MATCH_IS_REAL_EXECUTION_PATH_EVIDENCE__IT_DOES_NOT_PROVE_KEYS_ARE_EXTERNAL_OR_FUNDS_ARE_STRUCTURALLY_IRRECOVERABLE__THE_CURRENT_BUILDER_REQUIRES_A_LOCAL_RELAY_SIGNER_AND_HAS_NO_REMOTE_OR_BETTOR_WALLET_EXECUTION_PATH__THIS_IS_AN_EXECUTION_TOPOLOGY_LIMIT_NOT_REFUND_AUTHORIZATION__DO_NOT_SEARCH_FOR_OR_IMPORT_PRIVATE_KEYS_INTO_THE_PRODUCTION_NODE__DO_NOT_TREAT_OWNER_CONTACT_OR_KEY_DISCOVERY_AS_AUTHORITY_TO_REFUND__108_SIDE_847_01_KAS_CLASSIFICATION_REMAINS_NOT_REPRODUCIBLE_FROM_COMMITTED_EVIDENCE__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Git / evidence basis

Bridge baseline and current HEAD: `3b50dfafe85b9f91f88fc6cc79a57139e0018669`; compare is identical. The five canonical files therefore have no actual diff and retain their prior blobs:

- `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`

Active branch compare: `b2d7be08673a7113a6921557ff24e5792771b1cc...a54fa337deacba1ab9a09dcd0873d9d454649ae4`, ahead by three commits. The only committed path changed is `docs/iteration/COORD-LEDGER.md`; current ledger blob is `9ce43c2802318fd0140eb775fa01da4fe17d4420`.

Relevant source commits:

- `6517eb4b380b0fc24237ac0b9aed914e26b6579b`
- `82c58760e41af29ba8846b8621c6594f6f2d51c5`
- `a54fa337deacba1ab9a09dcd0873d9d454649ae4`

The current production implementation was independently read at active HEAD. `buildBettorRefundClaim()` enumerates local `relay_nodes`, derives a pubkey from each local relay address, requires equality with `side.bettor_pk`, and returns HTTP 404 when no local relay matches. There is no fallback remote signer, bettor-wallet request, portable claim package, or externally supplied valid signature path before transaction construction.

## Independent findings

### 1. The zero-match result is real but narrower than the ledger conclusion

A `0/N` match across inspected relay tables supports only this statement:

> The current node(s), using the current local relay registry and derivation function, cannot execute this builder for those bettor public keys.

It does **not** prove:

- the keys are outside the KANet participant set;
- the keys are permanently lost;
- the funds are economically unrecoverable;
- the holder is a human, bot, gateway, retired agent, or third party;
- a refund is authorized;
- the correct remedy is to locate or import a private key.

The code itself establishes an execution-topology dependency, not key ownership or authorization semantics.

### 2. The current path is effectively local-custodial execution

Although described as bettor self-claim, the implementation requires a relay already registered on the same node to sign through `sendCommandAsync(signingRelay.id, ...)`. A bettor who controls the relevant key but is not represented by a local relay cannot use this path.

Therefore the material architectural finding is:

> Authorization and execution are conflated with local signer residency.

This is separate from P1. A typed authorization verifier could be perfectly correct while the system still cannot execute because the signer is not local. Conversely, finding a matching signer cannot create refund authority.

### 3. Do not convert the execution gap into a private-key recovery operation

No production action should attempt to:

- ask operators to paste/import bettor private keys into the live node;
- restore retired identities into the production relay table merely to release funds;
- copy key material between J1/J2/UI hosts;
- infer ownership from sender addresses, historical messages, self-reference rate, or documentation labels;
- treat contact with a suspected holder as Owner approval to refund.

Those actions enlarge custody and compromise risk and would bypass the unresolved authorization problem.

A safe future design would produce a bounded, verifiable unsigned claim package or signing request tied to exact predecessor state, action, amount, network, policy version, nonce and expiry; the legitimate holder could sign outside the production node, and the system would verify the signature and authorization independently before broadcast. That is design direction only, not authorization to implement or deploy.

### 4. The 40 KAS retired-identity statement is not yet an irrecoverability proof

A historical public identity matching a bettor key is useful attribution evidence. A current operator saying they lack private-key access is not enough to prove structural impossibility. Irrecoverability would require a documented key lifecycle showing generation method, custody boundary, backup/derivation policy, retirement event and destruction/nonexistence evidence.

Until then the safe classification is:

`known_historical_identity__current_signer_unavailable__recovery_status_unproved`

It must not become either an automatic write-off or an instruction to reconstruct/import key material.

### 5. The 108-side / 847.01 KAS classification remains non-reproducible from committed evidence

The ledger again relies on local derivation runs and gitignored artifacts. No committed row-level mapping, exact queries, node responses, classification script or side→outpoint evidence was added in these three commits. The number may be operationally useful, but it is not yet independently replayable from the repository.

Before it can support lifecycle decisions, commit a sanitized, non-secret evidence bundle containing at least:

- deterministic query/script version;
- input snapshot digest;
- side and market identifiers;
- exact predecessor outpoint;
- canonical UTXO result and observation source;
- classification rule and result;
- conservation totals;
- exclusions and unresolved rows.

This is read-only evidence work and must not include private keys or trigger money-path activity.

### 6. P1 and D4 remain unchanged

No new commit supplies:

- typed evidence-derived refund authorization;
- semantic positive and contradictory fixtures;
- explicit handling of every production consumer outcome;
- forced signature/quorum failure with zero refund construction, claim, signing and broadcast;
- reproducible committed evidence for the 108/17 classification.

Therefore:

- **P1: OPEN**
- **D4: BLOCKED**

No refund, claim construction, signing, broadcasting, key import, identity restoration, metadata backfill, deployment or restart is authorized by this review.
