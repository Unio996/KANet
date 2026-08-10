# Codex review — watchdog bounded-feedback closure + settle-config safety

Scope: independent code review of unsynced `bshard-m3-deploy` changes after prior reviewed head `b6bbc83a51bf0885d08a9a54d021579ee524c48a`, through `1f43e2d0e10343b36c97408a8ae12dc0b5dceb50`.

## Verdict

1. **Previous self-evidence blocker: CLOSED IN CODE under the explicitly weaker bounded-feedback invariant.**

The current braked loop no longer authorizes pulse N+1 from the top-of-loop `daaAdvancing` that pulse N itself may have created. Instead, each pulse is scored in its own pre/post DAA window; unknown pre/post halts; non-advancing post halts; a hard `MAX_PULSES` budget caps a continuously successful-but-ineffective episode. This is materially different from the prior self-authorizing loop.

I accept the revised invariant as stated: this is **not proof of independent background progress while the miner is stopped**; it is a bounded feedback controller where one pulse is deliberately spent to discover a transition into the wedged regime. Do not relabel it as the stronger invariant later.

2. **Post-stop settle ordering: ACCEPTED IN DIRECTION.**

`Stop-Miner -> Start-Sleep -Milliseconds $DAA_SETTLE_MS -> Get-DaaNow` is the correct ordering for the race NWT identified. The added mutation that moves the settle after the read targets the right failure class.

3. **New MUST-FIX before deployment: safety-critical settle interval is externally overrideable without domain/floor validation.**

Current code:

```powershell
$DAA_SETTLE_MS = if ($env:TN12_DAA_SETTLE_MS) { [int]$env:TN12_DAA_SETTLE_MS } else { 1500 }
```

The safety argument immediately above this line says the explicit settle window exists so the guarantee survives a future faster `Get-DaaNow`, and that 1500 ms is chosen from the braking machine's measured max (~483 ms). But the environment override can currently set `0`, a small positive value below the measured envelope, or a negative value. In those cases the code and the stated guarantee diverge:

- `0` / too-small positive values silently remove or weaken the explicit settle guarantee; today's ~9.5 s probe latency masks this only accidentally.
- negative / malformed values can turn a safety setting into runtime failure rather than a deliberate fail-closed configuration decision.

This is not a request to hard-code a universal cross-machine 1500 ms value. The code itself correctly says the number does not transfer between machines. The requirement is that a deployment cannot silently claim the measured settle guarantee while accepting an unvalidated override that invalidates it.

### Required closure

At minimum:

- parse the override fail-loud/fail-closed;
- require a valid positive domain;
- bind any accepted override to an explicit deployment-specific measured floor/safety margin, or remove the override until such a measurement/registration mechanism exists;
- add executable negatives for zero, negative, malformed, and below-registered-floor values;
- retain the ordering mutation test.

If the intended policy is simply `TN12_DAA_SETTLE_MS >= 1500` on this host, say and test exactly that. If portability is required, encode a separately registered/measured minimum rather than allowing an arbitrary raw environment value.

## Remaining boundaries

- This review does **not** authorize watchdog deployment/restart or miner operations.
- A quiet production log after deployment would still be `not yet exercised`, not evidence that the gate works under load.
- The existing D2 continuation multiplicity/value-source RED from the prior review is unaffected by these watchdog commits and remains OPEN.
- V2 refund/backfill/money-path items remain separately gated.

Source commits reviewed: `5d44706b138093ad11fb1113021c579b2f490a3d`, `fa22cfed8f71eb50fb354eb69fb475e54ae88b37`, `1f43e2d0e10343b36c97408a8ae12dc0b5dceb50` (ledger-only `cdb30d76497abb2abe422689211f58b768c8d2ef` does not change the code verdict).
