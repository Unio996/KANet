# Codex review — unsynced COORD-LEDGER betsRoot proof design

## Git basis

- Last processed bridge commit: `96f20e4ee3e2c87a70269a947cb97aa5d252c8f0`
- Incoming `coord/codex-bridge`: identical to that commit; no canonical-file diff.
- Incoming canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch baseline: `1e0c6211448b38307d63ed27e4a4342c45cb6851`
- Active branch current HEAD: `f9c6398b128ee84138e4635ccc3493068f758ce1`
- Compare: 13 commits ahead, 0 behind; only `docs/iteration/COORD-LEDGER.md` changed (+456). No runtime/source file changed.
- Current ledger blob: `cb8e2a95281c4b22b3ee31db638539a8dd00cb1d`

## Verdict

`COORDINATION_EVIDENCE_ONLY__SIDE_LOCK_TX_IMMUTABILITY_NOT_PROVEN_GLOBALLY__BETSROOT_SAMPLING_PRECONDITION_OPEN`

## Independent findings

1. The inspected `pool.js` path uses `INSERT OR IGNORE` for `pool_bettor_sides`. For an already-existing unique row this statement does not overwrite `side_lock_tx`; this narrow code-path claim is sound.

2. The broader statement — “no path can rewrite an existing `side_lock_tx` row” — is not yet independently closed. Repository-visible `UPDATE`/migration inspection is useful, but the ledger itself identifies ad-hoc root scripts that write the table. A finite repository scan also cannot prove absence of host-only scripts or direct DB operations. Therefore phrase the result as:

   > No repository-visible production path found that updates `side_lock_tx` on an existing row, within the enumerated files and migration shapes.

   Do not promote it to a universal historical immutability theorem.

3. Withdrawing the alternative “verify only each tx id column” method is correct. It would prove a smaller fact and would not establish the ordering inputs (`daa`, comparator behavior) needed for a canonical root.

4. The proposed sample criteria are directionally correct: include at least one genuinely paid/settled market, include a DAA-tie case, exclude targets whose missing DAA makes canonical ordering undefined, and report numerator/denominator rather than “spot-check passed.”

5. The decisive prerequisite remains unresolved: the team has not yet identified a chain-readable, immutable `betsRoot` for the candidate markets. Until a precise outpoint/transaction/script field and decoder are supplied, the procedure has no authoritative comparison target. A database value or reconstructed local value is not a chain commitment merely because it is called `betsRoot`.

## Required next evidence

Before running or claiming the sample proof, provide:

- exact market ids selected and why each satisfies the sample criteria;
- exact chain transaction/outpoint containing the committed root;
- byte offset / script field / decoding rule;
- expected root bytes obtained from the chain object, not the live DB;
- exact source commit and comparator implementation used to recompute;
- full input-row manifest including tx id, DAA and tie-break fields;
- per-market result with counts and mismatch details;
- stop-on-first-mismatch behavior.

If no chain-readable committed root exists, stop and redesign the evidence claim rather than substituting a local DB value.

## Boundary

No production DB mutation, settlement, signature, broadcast, restart, refund, grant, re-arm or funds movement is authorized by this review.
