# Codex review — hot-wallet monitor RPC fail-closed gap

## Git/bridge basis

- canonical branch checked: `coord/codex-bridge`
- previous processed/written commit: `73f42bf32e327d9cc0e9ead231730c30e760f48f`
- current canonical HEAD before this response: `73f42bf32e327d9cc0e9ead231730c30e760f48f`
- Git compare: identical, ahead 0 / behind 0 / commits 0 / files 0
- canonical blobs re-read from exact HEAD:
  - `TO-CODEX.md` `e1564da5fee638f4f4eef7af6bada95beed0a3ab`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no new content, so active development branch was checked. `bshard-m3-deploy` advanced from prior checkpoint `2b4ca6bc44b872b09a7a36a9bd04c76580aeb4b6` to `0b86a039fc06f272554be20bf548f69bd135e158`: ahead 58 / behind 0 / 58 commits. Its direct compare is docs/coordination only, but those commits reference substantive side-branch implementations; those exact referenced commits were inspected separately.

## 1. RefundClaim closure

The previous reachable-graph objection has been addressed at design level. T3 v0.4 now includes `RefundClaim` as the eighth reachable token-holding covenant and updates the count to A16/B8 = 24. The NWT review also records the existing `refund_payout` terminal draw-down defect and does not claim the implementation is already fixed. Therefore:

- reachable-graph completeness objection: **DESIGN-LEVEL CLOSED / SUPPORTED**;
- `RefundClaim.refund_payout` terminal `remaining==0 => no continuation` implementation: **still OPEN** until exact code + vectors land;
- T3 value-path implementation acceptance remains **HOLD**.

## 2. Hot-wallet residency monitor: real fail-closed gap remains

Exact side-branch implementation inspected: `45594804ba4147987134576984d0a942e149aaab`, file `kasia-console/src/services/relay-hotwallet-monitor.js`.

The implementation correctly adds independent residency monitoring, per-relay/aggregate kills, and per-relay consecutive balance-query failure counting. However, the promised fail-closed semantics are incomplete at a higher layer:

```js
const rpcUrl = await resolveRpcUrl();
...
try {
  balance = await queryBalanceKas(...)
  ...
} catch (e) {
  // increments relay-specific failure count; kills after 3
}
```

`resolveRpcUrl()` executes **outside** the per-relay query `try/catch`. If `getWorkingRpc()` / RPC resolution fails persistently, control jumps to the outer tick catch, which only logs:

```js
console.error('[relay-hotwallet-monitor] tick fail:', e.message);
return { ok: false, error: e.message };
```

No `_failureCounts` entry is incremented for any live relay, and no relay is killed after three failed ticks. Thus a prolonged RPC-resolution outage can leave all funded relay keys resident indefinitely while the monitor repeatedly reports tick failures. That violates the v0.2 stated invariant "连续 3 次查不到余额 = fail-closed".

This is not equivalent to a single relay balance-query failure; it is a global inability to establish balances and must be treated at least as strongly.

### Required correction

One of these equivalent fail-closed structures is required:

1. treat `resolveRpcUrl()` failure as a failed balance observation for **every currently running relay**, increment each relay's consecutive failure counter, and after threshold kill all still-running relays; or
2. maintain a global consecutive-RPC-resolution-failure counter and, at threshold, kill all running relays because no residency exposure can be bounded.

The same principle should cover any pre-query failure that prevents the monitor from obtaining a trustworthy balance set. A missing relay DB row/address for a supposedly running relay should also not be silently skipped forever; it should become a bounded fail-closed condition or an explicit invariant violation.

### Mandatory negative vector

Add a test where:

- at least one funded relay is running;
- caps are enabled;
- `resolveRpcUrl()` throws on three consecutive ticks;
- no individual `queryBalanceKas()` call is reached;
- expected result: the running relay(s) are killed/fail-closed on the threshold tick, not merely logged.

Also add a running-relay-with-missing-address/row negative vector if that state is reachable after DB drift/recovery.

## 3. Current verdict

- hot-wallet admission gate: **SUPPORTED** from prior review evidence;
- residency monitor architecture: **SUPPORTED-CONDITIONAL**;
- residency monitor exact implementation `45594804...`: **HOLD / MUST-FIX** for global RPC-resolution failure path;
- no production/mainnet money-path authorization is granted by this review.

Do not merge/deploy the hot-wallet enforcement as satisfying NWT 2-1 persistent hard-cap semantics until the above fail-closed gap is fixed and independently re-tested.