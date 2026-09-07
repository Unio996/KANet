# Codex review — mainnet pivot preconditions / strict local-only boundary

## Check basis
- canonical branch checked first: `coord/codex-bridge`
- canonical HEAD at start: `707f940d0b16fabfeb96548a2bef3387c23dabb4`
- compare basis: same last processed/written-back SHA `707f940d0b16fabfeb96548a2bef3387c23dabb4`
- Git compare: identical, ahead 0, behind 0, files `[]`
- canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no canonical increment, so I checked the active development branch actually associated with the current G-1/G-2/mainnet work.

- active branch checkpoint previously processed: `8315ff804bc5aacfe756343ae897a5849c651c02`
- current active HEAD: `7b79216384b2345e3dc969f47f8086f721ce8e9b`
- compare: ahead 6, behind 0, total commits 6
- actual changed files in the interval: only
  - `docs/2026-09-07-NWT-mainnet-real-money-preconditions-v0.1.md`
  - `docs/2026-09-07-bettor-mainnet-pivot-assessment-v0.1.md`
  - `docs/iteration/COORD-LEDGER.md`
- no runtime implementation diff in this interval.

## Independent findings

### 1. Mainnet pivot direction: supported, but only as staged/read-only-first
The new assessment's core conclusion is technically reasonable: Toccata mainnet readiness moves the limiting risk from Kaspa consensus capability toward KANet's own network selection, signing, submit, state-transition, reconciliation, key custody and covenant migration paths. A read-only first wave is the right shape because it can validate mainnet indexing/discovery/network separation without authorizing money movement.

This does **not** constitute authorization for any production money path.

### 2. `KASPA_RPC_LOCAL_ONLY=1` is still not strict local-only in current code
The new NWT checklist treats `KASPA_RPC_LOCAL_ONLY=1` as a MUST to prevent a healthy same-network public RPC from standing in for the intended local node. That security goal is correct, but the current implementation still does not fully enforce it.

In `kasia-console/src/services/rpc-health.js`, `LOCAL_ONLY` is checked inside `discoverNode()`, so it disables Resolver discovery. But `getWorkingRpc()` still executes `checkConfigured()` after local failure and before discovery. Therefore a DB-configured external endpoint on the same network can still pass `networkId` + `isSynced` and be returned while `KASPA_RPC_LOCAL_ONLY=1`.

So the current variable semantics are actually closer to **"disable resolver discovery"** than **"only trust the intended local RPC"**.

For mainnet money-path gating this distinction matters: a same-network external endpoint can truthfully say `isSynced=true` while the local submit node is behind or unavailable. That recreates the trust-domain split the G-2 design is supposed to eliminate.

Required before treating LOCAL_ONLY as a mainnet safety control:
- strict mode must skip both configured external fallback and Resolver discovery, returning `null` when the intended local RPC fails; or
- replace the name/contract with an explicit trusted-RPC allowlist and bind gate-read and submit RPC to the same trust domain.

Required negative test if strict-local semantics are intended:
`LOCAL_ONLY=1 + local failed + configured external same-network healthy => null`.

Until this is landed and tested, **G-2 strict-local mainnet readiness remains OPEN/HOLD**.

### 3. Address-prefix inference is a real mainnet migration hazard
The new classification identifying `startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'` style code as structurally unsafe is directionally correct. Network identity should come from one explicit configured source; address prefix should be validated against that source, not used to infer it.

The safe invariant is:
`configured network is authoritative` AND `address prefix must match configured network` ELSE reject.

Do not silently map an unrecognized/non-testnet prefix to mainnet. That is fail-open migration behavior.

### 4. Fee correction should replace the earlier ×100 narrative
The newer assessment corrects the earlier double-counting: measured rebalance mass is ~45,994 grams, and the observed TN12 transaction was already paying roughly 110 sompi/gram. Therefore the earlier ~5 KAS/tx extrapolation should stay retracted. The operational issue remains real because automatic rebalance is a recurrent fee burner; it is a cost/control problem, not evidence of a 100× step-change from today's observed relay behavior.

### 5. `NO TX, NO STATE CHANGE` findings are mainnet blockers, independently of G-1
The new checklist identifies paths that can advance application state from a returned txid / submit success without independent landed/depth verification. That is a separate correctness class from node-trust gating. A perfect G-1 gate cannot make `submit accepted` equivalent to `chain landed`.

Before any value-bearing mainnet wave, state transitions that represent payment/payout completion must require an independent landed/depth proof (or an equivalently strong chain-state proof), and failure/unknown must remain non-terminal.

### 6. Do not claim TN12 peer/IBD pathologies "disappear" on mainnet as a safety invariant
Mainnet's larger peer set materially reduces the exact single-forward-peer failure mode observed on TN12, but node lag, stale peers, RPC split-brain, IBD/restart windows and local process failure remain possible. Therefore D-c/D-d may be TN12-specific implementations, but the higher-level node-trust/freshness invariant is still required on mainnet.

## Verdict
- staged mainnet pivot / read-only first wave: **SUPPORTED**
- G-1 production money-path enablement: **OPEN/HOLD**
- G-2 network-id + fail-closed polarity: **SUPPORTED as implemented previously**
- G-2 `LOCAL_ONLY` as strict intended-local-only control: **NOT YET TRUE in current code / HOLD**
- address-prefix inference -> single configured network + prefix consistency check: **SUPPORTED and should be a Wave-0 prerequisite**
- `NO TX, NO STATE CHANGE` repair + submit/land reconciliation: **MUST before value-bearing mainnet phases**
- no production payout / settlement / signing-broadcast / money-state DB mutation / key movement is authorized by this review.
