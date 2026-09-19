# Codex review — active-line autoTaker / Batch-9 baseline

Canonical bridge checkpoint inspected before this write: `7f31b2df4711dfaca0b2c352496d5755c38db3ab`.

## Independent findings

1. **New production-safety blocker: autoTaker is armed by configuration semantics, even though current empty wallet state prevents execution.** The active code checks `autotake_enabled === 'true'`, selects a local relay with a default BNB wallet, and when `autotake_mode === 'auto'` calls `_executeAutoTake()`, which POSTs to `/api/exchange/accept` and explicitly reuses the broadcast/meta/auto-pay path. The v88 migration seeds `autotake_enabled=true` and `autotake_mode=auto`. Therefore an empty `agent_wallets` table is only a contingent data-state interlock, not a durable safety gate. Importing/creating a qualifying wallet can make an inbound external offer spend-capable without a new code deployment.

2. **Owner-level production remediation is required before unattended Console startup can be considered.** I do not authorize the DB mutation here. The production startup sentinel should fail closed unless `autotake_enabled != true` OR `autotake_mode != auto`; relying on `agent_wallets=0` is insufficient. The preferred durable default is migration/config semantics that do not arm auto mode by default, but changing existing production DB state remains an explicit Owner-controlled funds-path action.

3. **P2 autostart remains HOLD.** D-026 startup autoSplit protection is necessary but not sufficient. The unattended-spend inventory must include inbound-event-driven paths such as autoTaker, and the boot guard must verify their durable enable predicates before starting Console. This is stronger than checking only current empty business tables.

4. **Batch-9 baseline progress is useful but does not change production activation status.** Active `bshard-m3-deploy` advanced from the prior checkpoint `d5bafae8002d6e429d916f2103c24baee03c50ec` to `a4289448ef35a945365dc1368796cf372448347d` (22 commits). Batch 9-0 default-budget mutation coverage landed, while batches 6–8 + C1–C3 are being handled as a merge candidate rather than silently assumed present on mainline. That is the correct hygiene direction. The candidate still requires the stated NWT merge review and must preserve the previously reviewed no-wiring boundary for withdraw/ticket_reclaim.

5. **The txid/finalize observation is security-relevant for 9-1.** If deserialization can retain a stale cached tx id after output mutation, any pointer/lineage check that compares `tx.id` without `finalize()` is not evidence that serialized bytes match the submitted transaction. The production pointer path must recompute/finalize before txid equality checks, with a mutation regression proving an output-byte change changes the recomputed id and is rejected against the stored submitted txid.

## Gates retained

- No production settlement-driver enable.
- No mainnet signing/broadcast/funded-key movement authorized by this review.
- P2 unattended autostart remains blocked until durable spend-path predicates, including autoTaker, are fail-closed at boot and the watchdog M1/M2/M3 conditions are actually implemented and runtime-proven.
- Batch-9 production activation remains HOLD; merge/read-only progress is not activation authority.
