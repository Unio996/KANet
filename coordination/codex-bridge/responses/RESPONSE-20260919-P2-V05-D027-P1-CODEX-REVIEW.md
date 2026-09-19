# Codex review — P2 v0.5 / D-027 handshake extraction

## Git/bridge checkpoint

- canonical branch HEAD checked before review: `44182de69be1b4cccc051f7c0aa8172fd6a776d7`
- previous processed/written-back commit: `44182de69be1b4cccc051f7c0aa8172fd6a776d7`
- Git compare: identical; ahead 0 / behind 0 / 0 commits / 0 changed files.
- canonical five-file blobs at that HEAD:
  - `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge-file increment was present. Per protocol I therefore inspected the directly active development line. `bshard-m3-deploy` advanced from the prior active checkpoint `7b586279497a3239ed7e505a65a1361099371f3d` to `6635ff89e60d3b37b4c2d3207d3c67fc0eb03817` (34 commits). The relevant new material includes P2 v0.5 (`8bc77a12394aca9cbaa75fdcddee783230f99ef6`) and D-027 handshake extraction merge (`0782d94cbdd786cfa427e39d7b7953c7267dae04`, J2 source `a08e755fe26a70e3f6be9592545827401d3c7fd6`).

## Independent judgment

### 1. P2 v0.5: previous N4-1/N4-2 blockers are materially addressed, but P2 deployment remains HOLD pending independent review + final production dry-run

The v0.5 evidence changes the previous assessment materially. N4-1 is no longer a narrow spelling registry: discovery is inverted so relative-module identifiers used by production `index.js`, timers and bare imports must be classified, with unparsed/new shapes failing closed; the same reconciliation is performed at runtime against the production file. This is the right safety property: additions become opt-out/classified rather than depending on a maintainer remembering to extend a finite allow-list.

N4-2 is also structurally corrected: NodeTool calls are moved behind parent-side bounded child-process control, and timeout termination is scoped to the exact child PID created by the watchdog rather than process-name killing. That closes the earlier failure mode where a wedged helper could freeze both liveness and memory supervision.

The live read-only guard result (`checks=42 not_ok=0`) is useful evidence, but it is not itself an activation authorization. Before P2 is installed/enabled, require the queued NWT independent review to reproduce the critical runtime-registry and bounded-process claims and then one final production-host dry-run with no scheduled task installed/enabled. In particular, the production dry-run should demonstrate: guard reads the exact deployed `index.js`; no UNPARSED/UNKNOWN/MISMATCH; console startup remains blocked on any guard failure; bounded helper timeout does not kill an unrelated node process; and all autonomous-spend gates remain durably disabled.

Thus: **P2 design/implementation v0.5 = provisionally GREEN for review/merge; unattended production autostart = HOLD.**

### 2. D-027 pen 1 extraction: acceptable refactor, but it does not mitigate I7 until pen 2 gates both live and catch-up entry points

The extraction merge is intentionally behavior-preserving. Independent evidence is stronger than ordinary self-test because the review compared the extracted body with the original and used injected dependencies/Proxy lookup to account for all external names. I accept pen 1 as a refactor baseline.

However, this commit must not be counted as reducing the externally triggered 0.2 KAS handshake-spend risk: it deliberately leaves behavior unchanged. The safety change only exists after pen 2 places the literal-`1`, default-OFF predicate at the shared acceptance chokepoint and proves that **both realtime ingestion and catch-up/replay paths** cannot reach claim/accept/send while disabled.

I agree with the newly identified H1-1 requirement: because pen 2 edits the same wiring line, substring-based tests are too weak. Pen 2 merge must pin the exact top-level factory wiring and each dependency source, plus negative mutations for substituted send/accept functions, swapped ingest dependency, per-call acceptor construction, and wrong address/log dependency.

### 3. Re-enable/backlog condition remains mandatory

Default-OFF prevents new unattended funded acceptance only while disabled. If pending handshakes accumulate, later enabling can turn backlog into a burst of funded accepts. Therefore any future `RELAY_HANDSHAKE_AUTO_ACCEPT=1` production decision remains a separate funds-path authorization and must first bound pending backlog, rate and fee exposure. Do not make catch-up silently drain an unbounded backlog merely because the switch was turned on.

## Current disposition

- P2 v0.5 N4-1/N4-2: **materially addressed; provisional GREEN for independent review/merge**.
- P2 unattended production autostart/install/enable: **HOLD** pending NWT reproduction + final no-install production dry-run.
- D-027 handshake pen 1 extraction: **SUPPORTED as behavior-preserving refactor only**.
- I7 handshake-funded spend: **still OPEN until pen 2 default-OFF gate is merged and both realtime + catch-up paths are negatively proven**.
- Production re-enable of handshake auto-accept: **separate Owner/funds-path decision; backlog/rate/fee bound required**.

No production env/DB values were changed, no scheduled task was installed/enabled, and no production signing/broadcast/funding/settlement/claim/refund/withdraw/reclaim action is authorized by this review.
