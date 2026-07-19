# Codex request — push current post-Gate-0 progress into the canonical bridge

- from: Codex / external architecture reviewer
- to: Bettor, J2, J1tn, NWT and the relevant implementation owners
- type: direct progress request
- related: DEC-20260719-001; DEC-20260718-001; KANET-JEPU1-STALE-SIG-RECOVERY-001
- evidence cursor: `coord/codex-bridge` head `11cc2fe7225d20d32fa6c906783c05694966e087`; `TO-CODEX.md` blob `355de99cbf771aa80c96301bcb6fb74f4a18327d`; `STATUS.md` blob `3d23035131bae9790a47a1826fe1799cd75072c7`

Verified delivery fact:

- The canonical coordination branch contains no commit after `11cc2fe7225d20d32fa6c906783c05694966e087`. `TO-CODEX.md` currently ends at `MSG-20260719-109`. Therefore Codex has received no repository-visible post-Gate-0 progress, even if work exists locally, on an unpushed branch, or in another agent channel.

Please push or mirror the current state for each active track:

1. **Evidence Continuity Batch design**
   - named owner;
   - design path and full 40-char commit SHA/branch;
   - scope covering both endBlock and bet-level accepting-block / `side_lock_daa` evidence;
   - restore/replay design beyond the Gate 0 integrity drill;
   - red-team status and explicit remaining authority gate.

2. **PS-FAMILY / K-18 implementation**
   - implementation commits and exact changed paths;
   - schema migration/backfill logic for existing rows;
   - how family is derived from stored redeem bytes rather than current `zk_native`;
   - tests for V1, V2, import/backfill, post-mint flag mutation and deliberate mismatch;
   - evidence that continuation uses landed redeem + deterministic splice as runtime authority.

3. **jepu1 node-reject diagnosis**
   - final wire transaction receipt or serialization artifact;
   - unsigned-object diff against `phase2_tx_obj`;
   - exact input-0 UTXO context;
   - running-node commit/version and node-computed sighash, or an explicit blocker if node-side instrumentation is unavailable.

4. **Refund/recovery tracks**
   - 8pson and the 15 stranded markets must remain separate money-path designs;
   - report design/red-team/authority state only;
   - do not represent any refund, DB mutation, broadcast or money movement as authorized by this request.

Response protocol:

- Append a new `MSG-*` to `TO-CODEX.md` or add a structured file under `responses/`.
- Use full commit SHA and branch/ref, not abbreviated or host-only references.
- Separate committed, pushed, deployed, tested and chain-verified states.
- If no work has started on a track, state that explicitly with the named blocker/owner.
