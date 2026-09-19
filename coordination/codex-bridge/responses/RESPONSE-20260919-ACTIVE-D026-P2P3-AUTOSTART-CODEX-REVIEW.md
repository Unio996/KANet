# Codex review — D-026 / P2-P3 unattended restart safety

Scope: active-line delta after bridge checkpoint `ba356375c935e64d565251d462e5a647ad5a74b6`.

## Independent judgment

1. **D-026 direction: SUPPORTED, implementation still gated.** `autoSplitAll()` being unconditional at console startup is an unattended mainnet spend surface. The Owner decision recorded at active commit `8f66f5ac2761fecbf8900a02b40d822a06d9c3c4` — `UTXO_AUTOSPLIT_ON_START === '1'` only, default OFF, mainnet env omits the key — is the correct fail-closed boundary. Do not treat the decision record as proof that the running console already has the guard; P2 autostart remains blocked until the implementation is merged and the running startup log proves the disabled branch.

2. **P2 NWT MUSTs are technically justified.** A watchdog that starts/claims production `kaspad` must not exit after ownership, because task termination can become an implicit node-kill path. Production ownership must be exact (expected executable/command line + mainnet appdir/17110, and console production path + :3202 + PID identity), not process-name/path-fragment matching; simnet uses the same binary family. Requiring >=3 consecutive ALIVE observations before console startup is appropriate because console startup currently contains autonomous spend-capable components.

3. **Unattended-spend inventory is a prerequisite, not documentation polish.** D-026 closes only startup `autoSplitAll`. The active evidence also identifies `broadcaster-utxo` as an autonomous periodic `split_utxo` path whose execution depends on DB relay state. Therefore P2 must not be enabled merely because D-026 is merged. Before autostart, enumerate every path that can broadcast without an operator after console launch, record its enable predicate and fail-closed state, and verify that inventory against the actual production config/DB. Any unenumerated or config-dependent spend path keeps autostart HOLD.

4. **P3 belongs in the persistent P2 sentinel.** Moving commit-memory detection out of console-spawned PowerShell avoids making the alert depend on the process/memory environment it is supposed to diagnose. `WatchOnly` before task registration is the right staging mode. The monitor must remain non-spending and must not restart or kill node/console by itself.

5. **Evidence correction accepted:** redirected `kaspad` stdout having stopped on 2026-09-14 means it cannot support claims about the 2026-09-19 pre-crash tail. Operational recovery evidence must use the internal node log / RPC / process facts that actually cover the interval. Preserve this distinction in later GO packets.

## Required gates before P2 activation

- D-026 code merged, tests cover unset/`0`/non-`1` => zero `autoSplitAll` calls and literal `1` => intended call; running mainnet startup proves disabled.
- P2 ownership predicates and post-start no-exit behavior pass fault-injection tests; three consecutive ALIVE samples gate console start.
- Complete unattended-broadcast inventory is reviewed against production config + DB, with each path demonstrably disabled or separately authorized.
- Recovery test proves a reboot cannot broadcast a stale prepared settlement intent and that settlement driver remains disabled.
- P3/WatchOnly is alert-only; no automatic production funds action.

**Production funds-path status: HOLD.** This review does not authorize settlement-driver enablement, autostart deployment, signing/broadcast, split-utxo, settlement, claim/refund/withdraw/reclaim, or funded-key movement.