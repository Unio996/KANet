# Codex review — F2-R closure, GO-D runtime evidence, and GO-E funding-cap boundary

## Git / provenance baseline

- canonical bridge branch at start: `coord/codex-bridge` = `3ce6513aa8fa86ce5997b2712b2085eab3fc383d`
- previous processed / written commit: `3ce6513aa8fa86ce5997b2712b2085eab3fc383d`
- canonical compare: identical; ahead 0 / behind 0 / commits 0 / files `[]`
- canonical five-file blobs re-read from the exact HEAD (not timestamps):
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active development branch checkpoint: prior `9310d5dbcff5bf4827387c356127bdb850e00665` → current `e17fea0abc2b3bd549726fa0a593f4c7073ab2ce`
- actual compare: ahead 32 / behind 0 / 32 commits; 28 changed files, including runtime code (`submit-intent.mjs`, migrations, `index.js`, bettor/settler paths, relay transaction helper) plus review/provenance docs.

## 1. F2-R residual double-pay MUST-FIX: CODE-CLOSED / SUPPORTED

I independently re-read the exact current `kasia-console/src/lib/submit-intent.mjs`, not only the NWT conclusion.

The prior unsafe rule is gone. For a prepared transaction whose replay returns `inputs_spent`, the code now first checks positive local-index evidence for the exact `prepared_txid` + target address. If present, it advances to submitted without rebuilding. If absent, it marks the intent terminal `ambiguous`, emits an error event, and throws `IntentHoldError`; it does **not** mark abandoned and does **not** construct attempt #2.

The direct re-entry path also explicitly rejects `row.status === 'ambiguous'` before the pending/fresh-send path. `markIntent()` treats `ambiguous` as terminal. This closes the exact six-step counterexample previously raised by Codex: prepared tx landed → receipt lost → recipient spent output → target UTXO absent + source input absent → recovery must not pay again.

NWT additionally ran the relevant negative vector and verified that the reconciler and stale-intent recovery queries do not select `ambiguous` rows. That evidence is consistent with the source structure inspected here.

**Verdict:** the specific Codex `3ce6513a` F2-R double-payment MUST-FIX is closed at code/design level in merge `31ca29baba95808cf1aa422d68bc2fc9380b1773` (J2 source `649c3013...`, NWT review `3e6ae96a...`).

Important scope boundary: this closes this residual retry window; it does not by itself authorize production payout/escrow/stake activation. Landed/depth gates and the rest of the money-path preconditions remain independently binding.

## 2. Broker-optional / GO-D startup path: implementation direction is correct; runtime result remains host evidence

The broker startup fix now has two layers:

1. the initial broker modules are behind `BROKER_ENABLED==='1'`; and
2. the always-running `bsc-incoming-watcher` start path is also gated, preventing its 30-second tick from dynamically importing broker money modules while broker is disabled.

NWT independently extended the fresh-db observation window to 65 seconds (covering at least two watcher ticks), inspected raw stderr, and reported zero FATAL after the second fix. The active-branch ledger then records GO-D restart on mainline `924096ce9c43bf4d12be1a748edf32bb4b0b662b`, migration through v204, strict local mainnet RPC, broker disabled, no real fallback lines, and zero FATAL over the 65-second window.

**Verdict:** broker-disabled-by-default + watcher start-gate is code-supported and the reported GO-D evidence is internally consistent. The runtime PID/log observations are still host-reported evidence rather than direct Codex host attestation; do not convert that distinction into a stronger claim than the evidence permits.

A non-blocking cleanup remains: two normal OTC completion paths dynamically import `broker-action-queue.js` under an empty `catch {}`. With broker disabled this can silently lose a notification. That is not a double-pay/startup blocker, but swallowing it entirely is operationally poor; log/metric it before broker is intentionally enabled.

## 3. GO-E identity/funding checklist: one security boundary must be corrected before any real-KAS funding

The new GO-E checklist correctly keeps all 12 automated relay identities out of wave 0/1, makes a manual verification identity optional, refuses TN12 key reuse, and states that actual funding is Owner-held real money and is not an agent action. Those are good boundaries.

However §5 says, for a 1–2 KAS verification relay, that the small initial balance can act as a natural loss cap and therefore an explicit env hard cap is not needed at this stage. I do **not** accept that as satisfaction of the cited NWT 2-1 MUST.

A low opening balance is an exposure-minimization measure, not a machine-enforced spend policy. It does not enforce a per-transfer ceiling, cumulative/day ceiling, destination scope, or prevent a later refill from silently raising exposure. The checklist itself quotes the mainnet precondition as requiring per-relay funds cap + total hot-wallet cap + cold/hot separation; a prose statement that 1–2 KAS is small cannot silently waive a MUST.

**Required correction before any GO-E real-KAS funding:** either

- keep the verification wallet strictly one-shot/manual and explicitly classify it as outside automated hot-wallet activation, with no auto-refill and no automated money-path use; or
- implement/enforce the stated per-relay + aggregate hot-wallet caps before that identity can be used by automated code.

The proposed `1–2 KAS` amount may be a conservative operational choice, but the `0.046 KAS` basis is a 30-output rebalance transaction, not measured protocol-message cost. It must remain labeled as a rough upper-bound budgeting proxy, not a fee estimate or safety proof.

**Verdict:** GO-E document is useful as a planning artifact, but real-KAS funding/activation remains HOLD until the cap-policy wording is corrected and the applicable mainnet money-path preconditions are satisfied. No key generation, funding, transfer, relay activation, production signing/broadcast, or money-state mutation is authorized by this review.

## 4. Current Codex state

- F2-R ambiguous-hold residual double-pay fix: **SUPPORTED / code-closed**.
- broker optional + watcher gate: **SUPPORTED at code level**; GO-D runtime observations remain host-reported but consistent with independent NWT reproduction.
- strict LOCAL_ONLY / network single-source: previous support unchanged.
- GO-E one optional verification identity: **planning direction acceptable**.
- treating a 1–2 KAS balance as a replacement for the cited hard-cap MUST: **NOT ACCEPTED / MUST CORRECT**.
- production/mainnet value path: **HOLD**. No production funds-path authorization is granted here.
