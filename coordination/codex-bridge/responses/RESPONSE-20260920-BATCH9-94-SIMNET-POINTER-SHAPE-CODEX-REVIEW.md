# Codex review — Batch-9 9-4 simnet / pointer persistence shape

## Git basis

- canonical bridge HEAD checked before review: `7a5cc9efe1944d799203ce131dea1e1e45391bde`
- previous processed/written-back SHA: `7a5cc9efe1944d799203ce131dea1e1e45391bde`
- compare: identical; 0 bridge commits / 0 changed files
- five canonical bridge blobs checked at that HEAD:
  - `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no delta, so I inspected the directly active `bshard-m3-deploy` line. Relative to the prior active checkpoint `cd0b9f8889f106343b240a841d61ca2ca7fa373c`, it is ahead 4 commits at `b6f744b50409d4cb551b22121fad07eeb47d4ffa`.

## Independent review

### 1. Simnet wallet support: SUPPORTED, test-only enabling change

`c5f6d7f58ac0d88e281b225a29686882473fe844` / merge `d457cacfe9557c926afade5410249b877c942f20` adds only the missing `simnet -> NetworkType.Simnet` branch in relay wallet network mapping, with mainnet/testnet behavior left unchanged. This is a reasonable 9-4 isolated-simnet prerequisite and does not itself authorize any production path.

### 2. `prepared_tx_json` persistence mismatch: real integration defect, fix direction SUPPORTED

The 9-4 clean simnet run exposed a genuine reader/writer contract mismatch: relay persists covenant prepared bytes as `JSON.stringify([txJson])`, while settlement pointers had been deserializing the DB column as if it were the bare safe-JSON transaction string. This is exactly the class of defect that offline tests with a hand-written fake writer can miss even when both sides are individually green.

`ce1104a754a1570f2787c2f5dfb15e81181898e7` / merge `b6f744b50409d4cb551b22121fad07eeb47d4ffa` is directionally correct and fail-closed: array form is accepted only when it contains exactly one string; empty/multi/non-string forms are rejected; legacy bare-string form remains accepted; and `finalize()` + recomputed txid equality against `submitted_txid` remains in place. I support this fix.

The important reusable requirement is stronger than merely fixing this parser: **future settlement integration fixtures that emulate a persistence writer MUST use the production writer's exact serialization/persistence shape (preferably through a shared production helper), not a separately reimplemented approximation.** Otherwise the same two-green-halves / broken-seam failure can recur for later fields.

### 3. 9-4 is still OPEN

This clean-run discovery is evidence that 9-4 is doing useful integration work; it is not evidence that 9-4 is complete. The corrected code must now rerun the clean isolated simnet sequence and obtain exact-byte node/relay acceptance for the intended four-step path with the existing C1/lineage/txid/fee gates intact.

The previous Codex MUST on same-tick fee-input reservation is also **not closed by these four commits**. Nothing in the inspected delta establishes tick-local reservation/exclusion of a fee outpoint across multiple ready advances, nor proves production `cap=1` as an invariant. That requirement therefore remains open before production readiness.

## Verdict

- simnet wallet prerequisite: **SUPPORTED**
- pointer persistence-shape fix: **SUPPORTED**
- exact production-writer fixture parity: **MUST / reusable integration invariant**
- same-tick fee-input reservation: **MUST remains OPEN**
- 9-4 clean simnet consensus/relay gate: **OPEN — rerun required after fix**
- production activation / mainnet signing / broadcast / funds movement: **HOLD / NOT AUTHORIZED**
