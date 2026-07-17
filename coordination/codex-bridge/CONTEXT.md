# KANet shared coordination context

**Branch:** `coord/codex-bridge`  
**Last updated:** 2026-07-17T13:11:34Z  
**Audience:** Codex and all KANet development agents  
**Purpose:** durable shared context for asynchronous technical discussion  
**Secrets:** forbidden

This file is the compact shared memory for cross-agent coordination. It records only information that another agent needs in order to understand the current system, constraints and active engineering priorities without relying on chat history.

## 1. Owner directives

1. Continue coordination through GitHub files only.
2. Do not deploy the proposed host-side Gateway/MCP bridge at this stage.
3. Keep communication asynchronous; real-time connectivity is not required.
4. Use repository evidence, executable tests and chain receipts instead of unsupported claims.
5. Do not place tokens, keys, mnemonics, relay IDs, private endpoints or other secrets in this directory.

## 2. Coordination roles

- **Owner:** final product and priority authority.
- **Codex:** external architecture reviewer, discussion initiator and independent synthesis/review participant.
- **KANet development agents:** inspect the live codebase and host reality, implement approved changes, report evidence and challenge Codex proposals where code reality differs.
- **Bettor:** current KANet-side coordination owner and landing verifier; execution remains delegated according to role boundaries.

No agent may report another agent's work as started or completed without a named acknowledgement and evidence.

## 3. Current verified coordination state

- The active asynchronous bridge is this directory on branch `coord/codex-bridge`.
- `TO-CODEX.md` and `FROM-CODEX.md` are append-only directional mailboxes.
- `STATUS.md` is the canonical task/status snapshot.
- The proposed runtime Gateway/MCP deployment was explicitly stood down by Owner decision on 2026-07-17.
- Codex has repository write access but no direct listener on the KANet host.
- KANet agents can respond by committing to this branch; the Owner can ask Codex to inspect the bridge.

## 4. Current architectural concern raised by Codex

The latest priority assessment is that KANet should avoid uncontrolled feature expansion until it can preserve, verify and reconstruct critical chain and settlement evidence across pruning, database loss, process restart and agent memory loss.

This is a proposal for engineering review, not yet an Owner-approved implementation decision.

The proposed concern includes:

- raw transaction and settlement evidence retention;
- explicit classification of historical evidence gaps;
- checkpoint and restore-from-empty-state capability;
- independent verification before final success state;
- pruning-distance and archive-lag monitoring;
- machine-enforced Economic Kernel admission rules.

KANet agents are expected to correct this assessment with code-level facts where necessary.

## 5. Evidence hierarchy

From strongest to weakest:

1. chain txid plus retrievable raw transaction/proof and independent verification;
2. reproducible test output tied to a commit SHA;
3. deterministic local receipt/checkpoint tied to code and protocol versions;
4. code inspection with exact file/function references;
5. operator statement without independent evidence.

For chain claims: **No TX, No Truth.**  
For recovery claims: **No tested restore, no recovery claim.**

## 6. Shared vocabulary

- **verified fact:** directly supported by code, test, host observation or chain evidence.
- **proposal:** a suggested design or priority not yet approved.
- **decision:** an Owner or delegated-authority conclusion recorded in `DECISIONS.md`.
- **blocker:** an exact missing dependency, access, decision or failing command.
- **receipt:** non-secret evidence sufficient for another agent to independently inspect the claim.
- **discussion thread:** a structured question and response record in `DISCUSSIONS.md`.

## 7. Update rule

Update this file only when shared context materially changes. Do not use it for conversational replies. Replies belong in the directional mailboxes or `DISCUSSIONS.md`; final decisions belong in `DECISIONS.md`.