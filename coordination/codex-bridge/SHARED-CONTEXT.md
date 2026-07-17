# Shared context for Codex ↔ KANet development agents

Last updated: 2026-07-17

This file is the stable, human-readable context layer for ongoing coordination. It exists so a newly started Agent can understand the collaboration boundary before replying.

## Current operating mode

- Coordination is asynchronous and GitHub-file-based.
- The active branch is `coord/codex-bridge`.
- The Owner decided on 2026-07-17 not to deploy the host-side MCP/Gateway path. No outbound host port, runtime gateway, dedicated relay, or remote MCP registration is part of the current plan.
- Code changes still belong on normal feature branches and pull requests. This directory carries context, questions, decisions, acknowledgements, blockers, results and evidence links.
- Secrets are forbidden in this directory.

## Required reading order for any Agent joining the discussion

1. `README.md` — protocol and write rules.
2. `SHARED-CONTEXT.md` — stable collaboration context.
3. `STATUS.md` — canonical task state.
4. `THREADS.md` — active questions and requested feedback.
5. `DECISIONS.md` — accepted decisions and superseded positions.
6. `FROM-CODEX.md` or `TO-CODEX.md` — append-only message history.

## Roles currently visible in the collaboration

- **Owner** — final product and risk authority.
- **Codex** — external reviewer, synthesizer and repository participant; does not claim background execution.
- **Bettor** — KANet-side coordination owner and verifier; structurally separates coordination from execution.
- **KANet-UI** — host deploy/operations execution domain when explicitly assigned.
- **NWT / independent security reviewer** — security-boundary review when requested.
- **Maker, Broker, Oracle / Verifier, Executor / Infrastructure** — protocol/economic roles whose feedback may be requested on relevant threads.

A role name is not proof that an Agent is executing a task. A named ACK and status update are required.

## Evidence discipline

- Chain claim: txid plus independent read-back or verification evidence. **No TX, No Truth.**
- Code claim: commit SHA, PR, exact file path and relevant test summary.
- Deployment claim: process/health receipt, configuration boundary and independent observation.
- Architecture claim: explicit assumptions, affected authority boundary and unresolved risks.
- If evidence is missing, write `unverified` rather than inferring completion.

## Current strategic questions

The bridge should be used to obtain independent Agent feedback before major direction changes, especially for:

- preservation and reconstruction of pruned chain evidence;
- Economic Kernel machine-enforceable gates;
- role/authority separation across Oracle, Verifier, Judge, Submitter and Executor;
- disaster recovery and checkpoint reconstruction;
- ordinary-user receipts that remain independently verifiable;
- any proposal that opens a new host attack surface or changes wallet authority.

## Update rule

This file should change only when stable context or an Owner-level operating decision changes. Day-to-day discussion belongs in `THREADS.md` and the two append-only mailboxes.
