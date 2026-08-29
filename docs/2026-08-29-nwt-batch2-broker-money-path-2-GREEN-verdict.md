# NWT verdict — batch-2 `coord/broker-money-path-2` = GREEN

> Author: NWT (adversarial review) · 2026-08-29 · head `8473f1ec` (vs `fe6ad45e`) · for Owner report via Bettor.
> This doc authorizes no deploy/money action. It is the durable evidence chain for the batch-2 GREEN verdict delivered to Bettor (review messages), so the approval trail is findable in origin.

## Verdict

**batch-2 (`coord/broker-money-path-2`, head `8473f1ec`) = GREEN.** Deploy remains Owner's call (batch-1 `66b5d38c` / batch-2 `8473f1ec` reported together; two user-facing changes ride along — see §Deferred).

## Money-path items reviewed (all GREEN)

| Item | Defect | Fix | Verified |
|---|---|---|---|
| P2 | send-after-write (broker fallback) | write-ahead intent before `placeCexOrder` | source |
| P11 | double-withdraw | `reserveWithdraw` CAS + `tx.immediate()` + peer-serial-lock + idempotent revert | source |
| DEFECT2 | BUY fallback `transferUsdt` imported-never-called | `manual_refund_pending` + hold-monitor | source |
| DEFECT1 | `executeHedge(finalOffer)` arg-shape (object→`.slice` throw, swallowed) | mirror `:1153` (`.id`+args); vectors 4/4 | mutation 3/1 (own) |
| **DEFECT1b** | hedge gate `SELECT meta` = non-existent column ⇒ throw-caught ⇒ hedge dead since 4/22 | narrow catch (`no such column` only, re-throws others) → `hedge_gate_error` event + skip (money-safe, hedge stays off) | mutation (own) |
| with-timeout (c) | `evm-transfer` unbounded (ethers v6 300s) | `withTimeout` 120s; other 4 entries already capped (CEX 5-10s / adapter 45s / exchange-client `FETCH_TIMEOUT_MS`) | grep-verified all 4 |
| rejectAfterMs | peer-lock unbounded hang | 180s reject > handler max-normal-time; reuses `service_busy` | source |
| P7-bis | timeout→reopen wipes `payment_tx` ⇒ re-pay | `guardReopenIfSettled` (payment_tx OR delivery_tx ⇒ CAS `matched→verifying`, before broadcast) at BOTH reopen sites | mutation (own) |
| P7-bis (ii) | `_autoPayExchange`/`_autoSettleAsset` transfer-first (no CAS) | `_reservePaymentIntent` CAS `WHERE payment_tx IS NULL` (PENDING sentinel) + `_finalizePaymentIntent` `WHERE payment_tx=marker`; both taker-pay paths | mutation (own) |
| processPaymentSubmit | peer/HTTP hash clobbers a local PENDING sentinel | dual-layer: app-layer early-return + SQL predicate `AND (payment_tx IS NULL OR payment_tx NOT LIKE 'PENDING:%')` | mutation (own) |
| tpf remote-paid | Gate1 atomicity rested on fragile "no-await-in-span" | `WHERE id=? AND payment_tx IS NULL` (refactor-proof; guard travels with write) | mutation (own) |

## Independent mutation evidence (NWT own worktree, per-commit checkout, node_modules junctioned)

| Head | Baseline | Mutation | Result |
|---|---|---|---|
| `9c80babc` hedge-gate | 6/6 | — (baseline on independent checkout) | green |
| `042ffdea` reopen-guard | 6/6 | drop delivery_tx half of `guardReopenIfSettled` | 4/2 (V3 + V6 red) |
| `81282118` payment-intent | 7/7 | strip SQL predicate | 6/1 (X-e2 red) |
| `8473f1ec` (final) | 8/8 | strip `AND payment_tx IS NULL` (hit reserve `:2203` + tpf `:2464`) | 6/2 (X-b + X-f red) |

All predicates load-bearing (non-vacuous). Reserve/finalize CAS gives per-offer auto-pay idempotency; fail path leaves the PENDING marker ⇒ reopen-guard treats it as settled → verifying = fail-closed.

## Owned miss

"explorer 无暴露" (my earlier message) was **wrong**: `exchange.eta:535` (`KANet.explorerTxUrl(...getPaymentTx...)`) and `:1357 getExplorerUrl` build explorer URLs from `payment_tx` via `getPaymentTx` ⇒ a PENDING sentinel renders a dead link. My grep was too narrow (searched the `.mjs` helper `buildExplorerUrl` + a literal `txs/${payment` pattern; missed the `.eta` client helpers + the `getPaymentTx` indirection). J2's reader-audit caught it. Re-assessed: both are **operator-console only** (not user DMs) ⇒ cosmetic dead-link on the rare stuck-PENDING case, not money-unsafe, not user-facing ⇒ **not a blocker**.

## 定级

- **DEFECT1b = P2** (dormant money-path; family: catch-swallowed-throw + query-schema drift; hedge silently off 4 months = unhedged risk, not a direct loss).
- **P7-bis = P1** (agent USDT double-pay; retail `is_dex_broker=1` exempt; race-reachable on degradation days).
- **(c) re-deliver = P1, no separate P0** — `_autoSettleAsset` writes `payment_tx` (taker payment); `delivery_tx` written only at `→completed` (post-matched); both reopens `WHERE matched` ⇒ delivery never in the reopen window ⇒ risk is re-pay not re-deliver.

## Deferred (non-blocking)

- Two user-facing changes ride the deploy (Owner-gated): TN12 `TX:` dead-link removal in `dm_kas_delivered` (mainnet two-line byte-identical, TN12 → `TX: <txid>`); `service_busy` i18n reuse for the peer-lock reject.
- operator `exchange.eta` PENDING-guard (`startsWith('PENDING:')` on the two explorer links) — next batch, operator-UX only.
- recovery-builder wiring-guard (`_*ForTests` move-out + lint `R-TESTONLY-EXPORT-IN-PROD`) — side branch `coord/j2-testonly-guard`, NWT audits on landing; TO-CODEX ack in `docs/2026-08-29-nwt-TO-CODEX-wiring-guard-accept.md`.
