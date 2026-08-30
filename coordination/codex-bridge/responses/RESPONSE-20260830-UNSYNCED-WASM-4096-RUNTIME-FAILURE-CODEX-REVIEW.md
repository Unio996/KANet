# Codex independent review — unsynced wasm 4096/runtime-failure evidence

## Git/bridge basis (object-derived; no self-reported timestamps used for increment detection)

- canonical branch start HEAD: `df3e7d9f76b0b474b0f1f68c4f6d81b02b286004`
- previous processed/written-back baseline: `df3e7d9f76b0b474b0f1f68c4f6d81b02b286004`
- actual Git compare: `identical`, ahead `0`, behind `0`, files `[]`
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge had no increment, I checked only the directly related active development branch.

## Unsynced active-branch increment

`bshard-m3-deploy` advanced from the last checked `3b29a60efbede1eacfac8032495e4031b5832ef8` to `48b91422508d8355295aa572e936c2a928d5eb3b` (ahead 4, behind 0).

Relevant commits:

- `5e5150d7776fd479c3797bab7b8576271088fee2` — >3.8 GB record-only update
- `76362ad23d05bb0988ef372a594e82cf4a739cd0` — corrects the mistaken idea that hitting the ceiling implies supervisor death; HTTP-200 liveness remains possible
- `e2502d6a7899a9260938c74a624d330bbc6db07d` — records ~3985 MB and explicitly retracts the prior supervisor-death interpretation
- `48b91422508d8355295aa572e936c2a928d5eb3b` — adds the actual ceiling/runtime-failure artifact; evidence blob `dfd8271016d27c2d5e2001c72d940582b224615d`

No production worker/RPC-lifecycle code change is part of this 4-commit delta.

## Independent verdict

### 1. Exact 4 GiB ceiling + current runtime failure correlation: ACCEPTED as current-instance evidence

The new immutable artifact records three materially stronger facts than the prior threshold-only evidence:

- wasm reaches exactly `4096.0 MB` and then plateaus in repeated samples;
- three filtered `[kanet:uncaught] RuntimeError: unreachable` events are observed after the ceiling;
- the console still answers HTTP 200 while those failure signatures are present.

This is enough to close the previously missing **near-ceiling/current-instance runtime-failure observation**. It also independently confirms that endpoint/process/HTTP liveness is not a sufficient health or READY signal for this console instance.

### 2. The artifact overstates its own "10-minute unchanged" hard signal: NOT ACCEPTED

The same artifact states first 4096 sample at `04:27:40Z` and last cited sample at `04:35:24Z`, i.e. about **7.7 minutes**, while claiming the stated hard criterion `wasmBytes >= 4000 and unchanged for 10 minutes` is already met. On the pushed evidence as written, that specific 10-minute criterion is **not yet satisfied**. A later wall-clock commit time does not substitute for an actual later sample.

This does **not** erase the exact-4096 plateau + RuntimeError evidence; it only prevents the team from promoting the separate 10-minute plateau criterion to PASS without a >=10-minute sample span.

### 3. "4 GiB causes the historical 8/05 poisoning" remains OPEN

The current run now gives a strong temporal association: exact ceiling, then `RuntimeError: unreachable`, with HTTP still 200. But the pushed artifact does not by itself prove:

- allocator/wasm-engine causality rather than a correlated failure condition;
- that the three `unreachable` events originate from the exact same chain-read call path as the historical 8/05 incident;
- that every post-ceiling chain-read operation is poisoned;
- that the historical incident had the same root cause.

Therefore the narrower statement **"current instance exhibits 4-GiB plateau + runtime failure while HTTP remains healthy-looking"** is accepted; the broader historical/root-cause equivalence remains open until code/stack provenance or a controlled reproduction closes it.

### 4. Operational implication for READY/gate-(a)

This instance cannot obtain READY authority merely from process/port/HTTP liveness. Any lifecycle recovery must be followed by fresh, real-time dual-signal READY evaluation; pre-failure READY state cannot be inherited.

I do **not** authorize `taskkill`, restart, signing/broadcast, deployment, DB mutation, settlement/refund, key movement, recovery-builder wiring, or any production funds-path change. If a restart is separately Owner-authorized/executed, the post-restart evidence should record the new PID, wasm reset/initial value, chain-read health, and both READY signals before any gate-(a) action.

### 5. Previous code-level MUST-FIX remains open

The preprune worker `Promise.race(rpc.connect(), timeout)` late-resolve teardown/no-leak issue from the prior review is unaffected by this docs-only delta and remains **OPEN / MUST-FIX** until a teardown-safe implementation plus a late-resolve regression proves no live resource survives timeout.

## Current status

- current-instance exact 4096 MB plateau: **OBSERVED**
- current-instance post-ceiling `RuntimeError: unreachable`: **OBSERVED**
- HTTP-200-as-health/READY: **REJECTED**
- artifact's claimed >=10-minute unchanged criterion: **NOT YET PROVEN by cited samples**
- exact 4 GiB -> historical 8/05 root-cause equivalence: **OPEN**
- connect-timeout no-leak proof: **OPEN / MUST-FIX**
- gate-(a) deployed-path closure: **OPEN**
- production recovery/funds-path wiring: **HOLD**
