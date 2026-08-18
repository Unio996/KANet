# Codex review — §6-1 unsynced host-privilege deployment blocker

- from: Codex
- scope: review of `bshard-m3-deploy` commit `e86463164181c6280e8e8a49eda6241c368f42e8`
- authority boundary: review only; no process kill, deployment, registration rollout, DB mutation, signing/broadcast, settlement/refund, or production-money authorization is granted here.

## Git-grounded facts

1. `coord/codex-bridge` had no canonical increment from the prior processed/written SHA; the relevant state change exists only on the active development branch.
2. `e8646316...` changes only `docs/iteration/COORD-LEDGER.md`; it introduces no new production code or tests.
3. At the referenced code target `8c902f74b705818e9147adf84a48f6b098474e93`, `kasia-console/src/index.js` does contain graceful `SIGTERM`/`SIGINT` handlers that call `shutdown()` and stop relays/adapters before exit.
4. At the same target, `kasia-console/src/api/identities.js` contains the real `/api/identity/u1-register` Fastify route inside `registerIdentityRoutes(fastify)`. It creates the canonical challenge store and fail-closes with 503 if the challenge table/migration is unavailable.

## Independent assessment

The new ledger entry is a substantive deployment-state change and should be preserved: the team reports that Owner authorized the §6-1 TN12 deployment, but the old Console process could not be stopped by the available non-elevated agent sessions, so deployment had not begun when the entry was written.

However, Codex cannot independently verify from GitHub the host-only claims about PID 13140 ownership/privilege, current in-flight money-path emptiness, the exact on-disk DB/WAL state, or whether every non-elevated termination path was actually exhausted. Those are host observations, not Git evidence.

One wording must be tightened: `WAL crash-safe ⇒ force-kill won't corrupt the 13.4GB DB` is too absolute. SQLite WAL is designed for process-crash recovery, but that does not by itself prove this particular live DB/WAL/SHM set, application state, or surrounding side effects are guaranteed harmless under a forced termination. Treat WAL crash-safety as a risk-reduction property, not a proof of zero corruption or zero recovery work.

## State / required evidence after the host action

- `§6-1 definition / wiring review`: prior closure remains unchanged.
- `§6-1 deployment`: `AUTHORIZED-BY-OWNER / NOT-YET-STARTED` at the evidence point represented by `e8646316...`.
- `host privilege blocker`: accepted as a specific **host-reported blocker**, not independently Codex-attested.
- `§6-1 LIVE`: not closed by this ledger entry.

After any separately authorized elevated stop/start, the closure evidence should bind the same deployment episode and at minimum show: old process no longer owns the intended port; new process identity differs from the old one; the intended `8c902f74...` code target is actually what started; v197/canonical challenge table is present; `/api/identity/u1-register` changes from pre-deploy absence to the expected fail-closed application response; existing relay/channel service is restored; and there is no evidence of DB integrity failure. If any of those fail, classify the deployment as incomplete and stop rather than promoting the run to LIVE.

This review does **not** authorize the elevated kill or any deployment action, and it does not authorize production money-path modifications.