# Codex review — NO-TX merge residual double-pay window + GO-C boot blocker

Review baseline and provenance:

- canonical bridge baseline/current before this write: `fff9bad28351d80a12fd0c909315f664ac9247dd` (Git compare identical; 0 commits / 0 changed files)
- canonical five blobs re-read from that exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch previous checkpoint: `414ba95be214cf7a095f6b649bb6d64533793428`
- active branch inspected HEAD: `9310d5dbcff5bf4827387c356127bdb850e00665`
- real compare: ahead 69 / behind 0 / 69 commits; runtime changes include strict-local/network-single-source, NO-TX submit-intent/landed gates/reconciler, fresh-db startup, and mainnet startup support.
- relevant merged implementation: `91b2ac6c820b13597f9cf7b14ec1b0a227c25749` includes (a) strict LOCAL_ONLY, (b) network single-source, (c) NO-TX implementation from `1d4b7fd219b8dde53bc03b9bc798fbb16e3e446a`.

## 1. NO-TX implementation materially improved and is now actually merged

Independent source inspection confirms the architecture requested in prior Codex reviews is substantially present:

- `submit_intents` is persisted before transfer IPC;
- `prepared_txid` + serialized transaction bytes are persisted before broadcast;
- retry of a prepared intent replays the same bytes and asserts the recomputed txid;
- `replay_bad_json` / txid mismatch fail closed rather than reconstructing a fresh payment;
- exchange/prediction paths now have landed-state gates rather than treating submit success as final chain state;
- tests cover transaction serialization round-trip and covenant-shaped round-trip evidence.

This closes the original simple blind-retry failure mode much better than the earlier design.

## 2. However, F2-R still contains a real residual duplicate-payment window — production value path remains HOLD

This is not just a theoretical objection; the current exact runtime source itself documents and implements the risky branch.

`kasia-relay/src/lib/transaction.mjs::replayPreparedTransactions()` currently decides that a prepared transaction "can never land" when:

1. expected txid is not currently in mempool;
2. target-address UTXO scan does not find an output from expected txid; and
3. one of the old transaction's external inputs is no longer present in the sender's UTXO set.

It then returns `code: 'inputs_spent'`.

Console `resolvePrepared()` interprets `inputs_spent` as authority to mark the original intent `abandoned`, create a new attempt, and allow a newly constructed payment.

The problem is the explicit residual case already noted in source comments:

> old prepared transaction actually landed, recipient immediately spent its received output, recipient is not visible in the watched/indexed evidence path, and the original input is therefore also absent from the sender UTXO set.

Under that state, "input absent from sender UTXO set" does **not** prove "spent by another transaction before the prepared transaction could land". It is equally compatible with "the prepared transaction landed successfully". Rebuilding after that ambiguous observation can pay twice.

Therefore the previous invariant must be tightened:

**`inputs_spent` may authorize rebuild only with positive evidence that the conflicting spender is a different txid from `prepared_txid`; mere absence of the input from the sender UTXO set is insufficient.**

Acceptable directions include a node/indexer primitive that resolves the spender of each outpoint, durable observation of the prepared tx in accepted-chain history independent of whether its recipient output remains unspent, or another proof that distinguishes `prepared_txid spent this input` from `different_txid spent this input`.

Fail-closed rule until that proof exists:

- mempool unknown/absent + target UTXO absent + sender input absent => **AMBIGUOUS / HOLD**, not `abandoned`, not rebuild.

Required negative vector before production acceptance:

1. prepared tx broadcasts and lands;
2. IPC/submitted receipt is lost, leaving console row at `prepared`;
3. recipient spends the received output before recovery;
4. prepared tx no longer appears via target UTXO lookup;
5. sender input is absent;
6. recovery must **not** create attempt `#2` or send another payment.

This is a production money-path blocker. The merged NO-TX code is a major improvement but does not yet establish exactly-once value transfer across the ambiguous crash/recovery boundary.

## 3. GO-C startup blocker is independently confirmed; proposed BROKER_ENABLED gating is directionally correct but not yet accepted

Current exact HEAD `9310d5db...` still has `kasia-console/src/services/broker-intake-watcher.js` evaluating at module top-level:

```js
const BROKER_RELAY_ID = process.env.BROKER_RELAY_ID;
if (!BROKER_RELAY_ID) {
  throw new Error(...);
}
```

So a fresh mainnet console with broker identities intentionally unset cannot import this service successfully. That independently supports the reported GO-C second-start failure.

The proposed fix — broker subsystem disabled by default, conditionally import/start broker modules only when `BROKER_ENABLED=1`, while preserving fail-loud relay-ID validation once broker is explicitly enabled — is the correct safety shape. Removing any legacy testnet fee-relay default is also correct.

Acceptance conditions:

- `BROKER_ENABLED` default must be OFF for fresh mainnet boot;
- when OFF, no broker module with top-level relay-ID requirements may be imported for side effects;
- when ON, missing required relay IDs must still fail loudly before any broker money action;
- no testnet/J2test relay ID fallback may remain in production config;
- fresh empty-identity DB boot must survive long enough to prove all startup imports/daemons are clean;
- this startup fix must not be interpreted as authorization to enable broker or any value path.

Current verdict: **GO-C broker-optional design SUPPORTED; implementation/runtime acceptance OPEN pending exact side-branch diff + NWT + rerun.**

## Verdict

- strict LOCAL_ONLY/network single-source merge: previously supported; now present in the integrated active branch.
- NO-TX/landed-gate merge: **SUPPORTED-CONDITIONAL**, materially improved.
- F2-R `inputs_spent` rebuild criterion: **HOLD / MUST-FIX** because input disappearance alone does not prove a different spender and leaves a residual double-payment window.
- GO-C broker-disabled-by-default direction: **SUPPORTED**, implementation not yet verified at this HEAD.
- production/mainnet value-path authorization: **HOLD**.

No authorization is given here for production payout, escrow/stake, claim/refund, settlement selectors, token deployment, signing/broadcast activation, money-state DB mutation, key movement, or any other real-funds path.