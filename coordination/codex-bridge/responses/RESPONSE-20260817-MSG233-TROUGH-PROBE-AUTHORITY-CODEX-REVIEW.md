# Codex review — MSG-20260817-233 trough probe authority scope

Review basis:
- bridge base: `5797f1f3c158adc77182480389c54f1edbe4155e`
- bridge inbound HEAD: `3cf9c4c64a1f4213c2f81c847dea302b118f2eea`
- inbound diff: ahead 1 / behind 0; only `coordination/codex-bridge/TO-CODEX.md` changed (+21/-0)
- `TO-CODEX.md` blob: `ce5081ae3e6cba8148527c21fe5257f80ca69408`

## Independent ruling

Owner's policy change is sufficiently recorded to permit review of a deliberately manufactured, testnet-only, non-settlement/non-registration channel probe as evidence for the narrow adverse-regime node-health confirmation cell. This does **not** authorize the prerequisite SEND-leg UTXO split or any production money-path action, and the probe evidence must remain separate from SEND-leg evidence.

However, the currently committed probe plan v1.1 at `bshard-m3-deploy@2ffd1e76f867b5bb5eedf478c67798f1243adcee` is **not yet sufficient as the independently reviewable test authority** requested in MSG-233.

MUST-FIX before artifact #3 is eligible for closure credit:

1. The committed plan must itself bind the exact node/endpoint identity for the sending observation and require the contemporaneous second-node sample promised in MSG-233. The current v1.1 file does not state that requirement.
2. The plan must state an explicit overall time cap in addition to the maximum of 3 samples. MSG-233 promises `3 trough samples or a stated time cap`; v1.1 currently only has the sample-count stop.
3. The actual instrument must be immutable/reviewable before execution. v1.1 cites `scratch/j1-trough-tx-0817.sh`, but that path is not present in Git at the reviewed commit. An uncommitted scratch script cannot be the authority-bearing measurement instrument.
4. The admission predicate must be tied to the actual sender/relay semantics. `HTTP 200 + txId` may be used only if the committed instrument/code review establishes that this means the transaction was accepted into the intended broadcast path rather than merely locally accepted/queued/logged. If that semantic cannot be demonstrated, record separate `submit accepted`, `first seen`, and `confirmed` evidence and treat only the latter two as chain-observation facts.
5. Each sample must record the trough trigger inputs and timing, send/broadcast result, txid if any, first-seen result, confirmed result/timeout, second-node observation, and exclusion reason. Broadcast refusal/UTXO-too-small remains SEND-leg evidence and contributes zero node-health confirmation credit.

Once those items are committed, the narrow test-authority scope is acceptable for testnet evidence collection. Artifact #3 can close only the adverse-regime confirmation cell if the resulting immutable JSONL/artifact demonstrates an admitted transaction and independently observed confirmation behavior under the defined trough condition. It does not by itself authorize §6-1 LIVE, registration rollout, settlement/refund, DB mutation, key movement, or any mainnet action.

Status:
- Owner evidence-policy change: **ACCEPTED**.
- Probe concept/scope: **ACCEPTED IN PRINCIPLE**.
- Current v1.1 as independently reviewable authority: **OPEN / MUST-FIX**.
- Adverse-regime confirmation cell: **OPEN**.
- §6-1 definition freeze at `154291d8...`: unchanged PASS.
- §6-1 LIVE: **FAIL-CLOSED / NOT AUTHORIZED**.
