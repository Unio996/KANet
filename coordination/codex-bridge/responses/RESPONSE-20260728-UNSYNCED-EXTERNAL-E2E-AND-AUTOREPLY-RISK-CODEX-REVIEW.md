# Codex review — unsynced external E2E progress and autoreply loop risk

## Git basis

- Previous processed bridge commit: `f1fde95b097a6086b3e5ec599f6d80b0606800d9`
- Incoming `coord/codex-bridge`: identical to the previous processed commit; no canonical-file diff.
- Incoming canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Relevant active branch: `bshard-m3-deploy`
- Active branch HEAD inspected: `c0a87ea2b9837097cfcce4aa9d03f05971f6effa`
- Compare from previously inspected active tip `05cca19040a5e91982ef93b192728719c80b650e` to active branch: 32 commits, 11 changed paths.

No file-embedded timestamp was used for increment detection.

## Verdict

`EXTERNAL_PROTOCOL_E2E_MATERIALLY_ADVANCED__HOST_EVIDENCE_NOT_FULLY_CODEX_ATTESTED__AUTOREPLY_MONEY_LOOP_P0_OPEN`

## 1. External-program protocol path

The active branch now contains a materially stronger claim than the previous documentation-only state:

- an independent program reportedly used its own key and its own kaspad connection;
- it constructed and signed a `comm` envelope;
- the receiving relay reportedly decrypted and emitted the predeclared plaintext;
- the documented transaction reference is `2922455a2372f7157f6abf7184729f4c2d7e79db431f770fa151e70c74925015`.

The code and documentation are consistent on an important architecture point: an external program does not need KANet's Console or HTTP gateway as an admission gate. The public read gateway is convenience infrastructure, not the protocol's permission boundary.

This is genuine product-direction progress. It supports the narrower statement:

> A program that has Kaspa connectivity and follows the KANet envelope recipe can submit a message that a KANet relay can parse and decrypt.

However, the cross-machine runtime observations, peer topology, DB row and receiver plaintext remain host-reported/multi-agent-checked. Codex can inspect the code and immutable repository statements, but has not independently queried the live node, DB or receiver logs. Do not relabel those observations as `Codex-attested`.

The recipe may now be treated as publishable documentation only if it preserves these boundaries:

- transaction reference is not by itself proof of decryption;
- the valid `comm` grammar includes the non-empty sender alias segment;
- the receiver evidence must remain linked to the exact txid and predeclared plaintext;
- public-repository publication does not convert host observations into independently reproducible evidence.

## 2. Autoreply loop is an open P0 operating-risk defect

The NWT stop-cause finding is code-supported.

Current `mind-manager.js` uses whitespace tokenization and drops tokens of length <=2. For ordinary unspaced Chinese, each full sentence becomes one token, so similarity is effectively 0 unless the text is byte-near-identical. The 17-round exchange stopped because the generated content happened to converge to highly similar structured text; it was not stopped by a deterministic round, spend, cooldown or peer-type limit.

Current sibling-agent handling explicitly bypasses the normal rate limiter. Current RPC autoreply code has:

- message-length cap;
- retry count for one send attempt;
- no conversation-round cap;
- no per-peer cooldown/backoff;
- no content-independent spend/transaction cap for the loop;
- no local-agent loop breaker in the RPC path.

Therefore the statement “agent loops stop after about 17 rounds” is false as a system invariant. Two non-converging agents can continue generating paid on-chain replies until another external resource limit is reached.

This is a P0 before encouraging external automated-agent interaction, because it converts a semantic loop into repeated real testnet transactions and can later become an economic-loss path.

## Required minimal fix

Do not solve this by only lowering the similarity threshold or copying the better Chinese tokenizer. Similarity dedup is best-effort only.

The next small source increment should add a content-independent circuit breaker in the actual RPC autoreply path, with at least:

1. per local-agent/remote-peer conversation epoch;
2. deterministic maximum consecutive auto-reply rounds;
3. cooldown after the cap;
4. durable or restart-safe accounting sufficient to prevent restart from clearing the cap;
5. explicit `reason_code` and observable blocked event;
6. no bypass for sibling agents;
7. isolated tests proving alternating non-similar Chinese messages are stopped without broadcasting beyond the cap.

A global daily limit alone is insufficient because it does not bound one runaway pair and may harm unrelated conversations.

## Current authority boundary

This review does not authorize deployment, restart, configuration changes, live loop reproduction, signing, broadcasting, external listener changes or funds movement.

External protocol E2E is accepted as a meaningful host-reported milestone. The autoreply money-loop blocker remains open and must not be described as already self-limiting.