# Codex review — G-2 local-only semantics and S-2 independent-upstream boundary

## Check baseline

- canonical branch checked at: `7875d719c0b9231e09edc98de654193a72fe1b5c`
- previous processed/write-back baseline: `7875d719c0b9231e09edc98de654193a72fe1b5c`
- canonical compare: identical, ahead 0, behind 0, total commits 0, files `[]`
- five canonical blobs at that exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge itself had no delta, so the associated active branch was checked from the previous checkpoint.

- active branch: `bshard-m3-deploy`
- compare base: `a2797a252e06e375f26757f6476a653d75b77131`
- observed head: `8315ff804bc5aacfe756343ae897a5849c651c02`
- compare: ahead 6, behind 0, total commits 6
- substantive runtime files include `ibd-tick-gate.mjs`, `kaspa-rpc-shared.mjs`, `rpc-health.js`, `preprune-capture-worker.mjs`, settler/filter code and associated tests.

## 1. G-2 landed code: fail-closed gate direction is supported

Independent source review confirms the important G-2 polarity change is real in landed code:

- `ibdGateSkip()` now permits execution only when `gate.isSynced === true`; missing gate, RPC/read error, network mismatch, undefined/null sync state all skip.
- `_readNodeSynced()` reads `KASPA_RPC_URL` directly, checks `getServerInfo().networkId === KASPA_NETWORK`, and returns fail-closed on timeout/error/unreadable sync state.
- the shared RPC layer has a local-key rebuild path after repeated health/business connection failures, with a rebuild interval and process-wide cap.

This fixes the previously confirmed `rpc-fail => resume` polarity defect for the sites actually wired through this gate. The boot evidence showing all 15 sites in `skip ... isSynced=false` while the forward peer is unavailable is consistent with the new code.

**Verdict:** G-2 gate polarity/network-identity implementation: **SUPPORTED**. Runtime self-heal acceptance is still **OPEN** until a real kaspad restart/stuck-client episode produces the intended `REBUILD ... source=rpc-health` followed by `BACK-TO-LOCAL` and the gate remains closed throughout the failure interval.

This does **not** close G-1: the production money-path direct-submit coverage work is explicitly not in the G-2 commit.

## 2. New finding: `KASPA_RPC_LOCAL_ONLY=1` is not actually strict local-only

The current `getWorkingRpc()` sequence is:

1. check local;
2. if local fails, call `checkConfigured()` and return a configured DB `rpc_url` if its data check succeeds;
3. only after that call Resolver discovery.

`KASPA_RPC_LOCAL_ONLY=1` is consulted inside `discoverNode()` only. Therefore it disables Resolver discovery, but it **does not disable the configured-URL fallback**.

Because `checkConfigured()` now verifies network identity and `isSynced`, this is not the old cross-network/mainnet failure. But it is still materially different from a strict invariant of “only the intended local node may be used.” If the DB contains a valid external TN12 RPC URL, `getWorkingRpc()` can still return it while `KASPA_RPC_LOCAL_ONLY=1` is set.

**Verdict:** the statement “LOCAL_ONLY means no public/non-local fallback” is **NOT ESTABLISHED by the current code**.

Recommended correction before calling this boundary closed: either (a) when `LOCAL_ONLY`, bypass both configured and Resolver non-local candidates, permitting only `KASPA_RPC_URL`; or (b) rename/document the flag as “disable discovery” and separately enforce an explicit trusted-RPC allowlist. Tests should include `LOCAL_ONLY=1 + local failed + configured public same-network healthy => null`, if strict local-only is the intended policy.

The money-path gate currently reads the intended local URL directly, so this finding does not by itself prove a money-path bypass. It remains important for console-wide trust semantics and for any caller still using `getWorkingRpc()`.

## 3. S-2: a second node only removes the single-forward-peer dependency if its upstream is independent

The operational motivation for S-2 is sound: the active evidence shows the sole forward sync peer has been unavailable for more than an hour, and D-c/D-d cannot create missing future blocks.

However, “N2 and the current node are each other's future” is not guaranteed merely by running a second pruned node and adding them to each other. If N2 is bootstrapped from the current node and both ultimately depend on the same external forward source, loss of that source leaves both nodes at the same stale frontier. They provide process/host redundancy, but **not forward-chain-source redundancy**.

For S-2 to close this failure mode, acceptance must prove:

- N2 has at least one independent forward TN12 peer/source not identical to the current node's sole upstream;
- the current node can advance from N2 when the original forward peer is deliberately unavailable;
- N2 can itself continue advancing when the current node is unavailable;
- a controlled single-upstream failure demonstrates failover within the target interval without manual reconfiguration.

Also, do not institutionalize `--ibd-syncer-pp-lag-tolerance=0` on N2 as the permanent redundancy design. Unlimited tolerance remains under HOLD because the custom D-d relaxed path previously reviewed can accept a past-table member when ancestry proof is error/unknown. It may be used only under whatever separate incident-recovery authority already governs it; permanent N2 configuration should return to a bounded/fixed-safe policy after bootstrap/recovery.

**Verdict:** S-2 as a redundancy direction: **SUPPORTED-CONDITIONAL**. “Two hosts = two independent forward sources”: **FALSE unless independently demonstrated**.

## 4. Other boundaries unchanged

- G-1 production money-path: **OPEN / HOLD**. G-2 is not the G-1 direct-submit coverage fix.
- G-1 `H=50`: **HOLD**; existing healthy evidence continues to support testing/shadowing `H=0` plus a freshness/stability condition.
- D-c activation effectiveness with an available forward peer: **SUPPORTED**.
- D-d `tolerance=0` incident-recovery effectiveness: **SUPPORTED**; permanent/default safety: **HOLD**.
- No authorization is given here for production payout/refund/settlement selector changes, signing/broadcast changes, money-state DB mutation, key movement, or any other production-funds-path modification.
