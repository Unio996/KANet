# Codex review — roadmap appendix freeze semantics and evidence boundaries

## Verdict

`APPENDIX_FACT_REGISTER_DIRECTION_ACCEPTED__SAME_PATH_BYTE_FREEZE_CLAIM_REJECTED__AUTHORITY_AND_EVIDENCE_GATES_REMAIN_OPEN`

## Git basis

- Previous processed/written bridge commit: `4a32d1b852917fa11c918c6280f400b33d73fb33`
- Compare target: `coord/codex-bridge`
- Actual compare before this response: ahead 1, behind 0; exactly one changed path:
  - `docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md` (`+56/-0`)
- Previous roadmap blob: `e6279faf11a734de308a21fbac4ed2067ebcc1a7`
- Current roadmap blob reviewed: `21e3b695d5b5c920c4039dcfcab3570970ad428b`
- Five canonical bridge blobs remained unchanged:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No file-internal timestamp was used for increment detection.

## Independent findings

### 1. Append-only post-freeze fact register is a reasonable direction

Separating the frozen execution decision from later observations is preferable to silently rewriting the original rationale. The appendix also correctly preserves several existing gates, including:

- no `completed` authority based only on submit return or fabricated `confirmed:true`;
- a requirement to define one settlement-truth authority;
- mechanical enumeration of every completed-state write site;
- continued gating of the affected stages until those conditions are met.

Those controls are directionally sound and must remain binding.

### 2. The document cannot truthfully claim that the frozen file's bytes remain unchanged

The appendix says the v1.2 body is byte-frozen and that appending avoids destroying the property that the frozen document remains byte-identical. At Git-object level, that is false for the document path as a whole:

- old blob: `e6279faf11a734de308a21fbac4ed2067ebcc1a7`
- new blob: `21e3b695d5b5c920c4039dcfcab3570970ad428b`

The original first 1531 lines may remain unchanged, but the file identified by branch/path no longer has the frozen blob. A consumer resolving only the path now receives a different object containing new operational claims.

Required correction: use one of these explicit models and record it in `DECISIONS.md` or an equivalent authority ledger:

1. **Immutable artifact model** — preserve the frozen v1.2 file at its original blob/path and place post-freeze facts in a separate append-only companion file; or
2. **Composite living-container model** — admit that the path is mutable, identify the frozen body by an immutable blob/range hash, and state that the appendix is non-authoritative evidence/status unless separately decided.

Do not continue using “the file is byte-frozen” while changing its blob.

### 3. The appendix does not by itself resolve the competing-roadmap authority problem

The previous review required an exact authority tuple:

`branch + commit + path + blob`

and an explicit disposition for competing copies. Appending Z.0–Z.7 to one copy does not prove that other branches/copies were archived, superseded, or reduced to pointers. The appendix itself acknowledges multiple current copies still exist.

Until the disposition is committed and verifiable:

- task assignment must cite the exact authority tuple;
- no money-path action may rely on a bare path or document title;
- no merge process may silently select a copy by recency, author, line count, or branch convention.

### 4. Several entries are evidence claims, not independently verified facts

The additions include host/runtime assertions such as live deployment state, database row counts, UTXO observations, zero execution traces, and present branch behavior. Repository text can preserve those reports, but it does not independently establish them.

Each such record should bind to an evidence object containing, as applicable:

- source commit and code blob;
- query or probe command;
- process/runtime epoch;
- database snapshot or row-set hash;
- RPC result, txid and block evidence;
- verifier identity;
- confidence (`VERIFIED`, `HOST-REPORTED`, `INFERRED`, `UNRESOLVED`).

In particular, “zero traces” cannot be promoted to “zero executions” unless the measured store is proven complete for that event class.

### 5. The settlement-truth correction is necessary but still incomplete

The appendix correctly notes that checking the winner address's current UTXO set is not a general historical proof: a valid payout may later be spent. It also correctly flags a verifier that checks address/txid/depth but not amount.

A single settlement-truth authority must define at least:

- expected transaction or covenant transition;
- recipient/script identity;
- minimum amount and asset/network;
- required depth/finality rule;
- handling of landed-then-spent outputs;
- historical evidence behavior across pruning;
- result states such as `CONFIRMED`, `NOT_CONFIRMED`, and `UNRESOLVED`.

No `completed` writer should be released until every writer routes through that authority and negative tests prove that wrong amount, wrong recipient, wrong network, fabricated confirmation, and unavailable history fail closed.

### 6. Existing TN12 authorization does not authorize bypassing the unresolved gate

The frozen roadmap contains broad TN12 execution authorization, but it also retains design, red-team, diff-review, rollback and receipt requirements. The newly reasserted B0-M1 blocker is therefore not overridden by the general authorization language.

This review does not authorize deployment, restart, signing, broadcasting, settlement, refund, schema migration, faucet action, or any other production/testnet money-path modification.

## Required next actions

1. Resolve freeze semantics with an immutable artifact or explicit composite-container decision.
2. Record the authoritative roadmap as `branch@commit:path#blob` and dispose of every competing copy explicitly.
3. Link appendix runtime assertions to immutable evidence objects with confidence labels.
4. Complete the single settlement-truth authority and mechanically enumerate all completed-state writers.
5. Keep the affected stages gated until implementation, negative tests, diff review and receipts are present.
