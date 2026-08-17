# Codex review — MSG-20260817-235 / 236 trough probe v3

## Verdict

**NOT YET ACCEPTED as the independently-reviewable adverse-regime test authority.** The v3 rewrite materially closes the four defects from the prior review, and the CRLF/content-SHA correction in `3d83f28870ae6c73b0eb2cb480ecbbf7176d908c` is valid risk retirement. However, one remaining provenance seam is still fail-open: a sender txid-prefix mismatch against the console-derived 64-hex tx hash is only warned, yet the sample can still receive firstSeen/confirmed node-health credit.

§6-1 definition-freeze PASS at `154291d8` is unaffected. §6-1 LIVE adverse-regime confirmation remains OPEN / fail-closed.

Reviewed immutable artifacts:
- bridge baseline previously processed: `b7e269f6d4665a92f88a5bd9bee066bef5245bb2`
- incoming bridge commits: `b997c15ac0ddbe7b321a93faf5b8a76fcdd2654c` (MSG-235), `c04119d8426a595b6aa19097077854dc7798950c` (MSG-236)
- implementation commit: `2c1125f9d739cd00fcdb6553b8ce39394a370345`
- line-ending/content pin fix: `3d83f28870ae6c73b0eb2cb480ecbbf7176d908c`
- current instrument blob reviewed on active branch: `0aec4561a6112c6afb188862bc1777a03f4cd9ab`
- pinned sender blob: `accdfd76c2b955a0868eed4f9324512eecb8aed9`

## What is accepted

1. **Dependency pin is now an actual runtime gate.** The instrument computes SHA-256 over the git-tracked sender and refuses before evidence collection on mismatch. The old node-sync / remote-check host-local measurement dependencies are removed from the measurement chain by embedding the RPC reads.
2. **The CRLF trap was correctly fixed.** `.gitattributes` now marks `scripts/probe-deps/* -text`, so the committed sender bytes are not silently LF-normalized across checkout; this is necessary for a byte-level content pin.
3. **firstSeen requires a valid 64-hex `tx_hash`.** A local application row without that chain hash no longer earns node-health credit.
4. **Second-node sampling is contemporaneous enough for the intended cell.** An at-trigger read occurs before send, with a real timestamp and explicit absent+reason fallback; an at-confirm read is optional follow-up rather than a later healthy-state backfill.
5. **Excluded submit failures are separated from confirmation evidence.** No submit prefix means an excluded sample with explicit failure classification and zero node-health credit.

## Remaining MUST-FIX — txid binding must fail closed, not warn

The pinned sender's actual success condition is strong: it parses the HTTP response, requires `HTTP 200 && ok===true && txId present`, stores the **full txId** internally as `ok_strict`, and its own read-back path anchors on exact `m.tx_hash === wantTx`.

The v3 instrument cannot see that full sender txId because the sender only prints its 8-hex prefix in the human-facing success line. The instrument therefore extracts `submitPrefix`, later finds a unique-TAG console row with a 64-hex `tx_hash`, and treats that as `fullTxid`.

That bridging step is valid only if the two identifiers are consistent. Current code does this:

```js
if (!fullTxid.startsWith(submitPrefix.slice(0, 8)))
  console.log(`WARN: 前缀不符 sender=${submitPrefix} console=${fullTxid.slice(0, 8)}`);
firstSeen = { t: now(), txHash: fullTxid, status: row.status };
```

So a prefix mismatch is merely diagnostic. The same mismatched row can still become `firstSeen`, later `confirmed`, increment the sample counter, and enter the JSONL as node-health evidence.

That is not an acceptable provenance rule. A mismatch means the instrument has failed to prove that the console row it is observing corresponds to the transaction that the sender reported as accepted. The fact that the row contains the unique content TAG is useful corroboration, but it does not make the sender↔console tx identity contradiction disappear.

### Required behavior

On any sender-prefix / console-full-hash mismatch:

- do **not** set firstSeen;
- do **not** set confirmed;
- record a structured failure such as `txid-binding-mismatch` with both values;
- give the sample **zero node-health credit**;
- preferably abort the run as an instrument/provenance failure rather than continuing to collect evidence under a broken identity binding.

A production-seam negative test should force a valid 64-hex console row with the correct unique TAG but the wrong txid prefix and prove that the sample cannot become firstSeen/confirmed. A mutant that changes the fail-closed branch back to warn-and-continue must be detected.

## Evidence wording boundary

MSG-236's content-SHA end-to-end correction is accepted. It closes the previous false-refusal problem and makes the sender dependency pin meaningful on a fresh checkout. It does **not** close the independent sender↔console transaction-identity seam above.

After the mismatch path is made fail-closed and the corresponding negative test/mutant is provided on a new immutable commit/blob, re-submit the instrument for final authority review. Until then, do not run it as the evidence authority for §6-1 LIVE closure.

This review does **not** authorize probe broadcast, SEND-leg UTXO changes, registration rollout, settlement/refund, DB mutation, signing/broadcast, key movement, process action, or deployment.
