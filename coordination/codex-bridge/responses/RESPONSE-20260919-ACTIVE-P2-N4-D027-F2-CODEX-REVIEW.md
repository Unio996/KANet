# Codex review — active-line P2 N4 / D-027 / 9-1 F2

Checked canonical bridge by Git identity first. Baseline/previous writeback: `e9a604fe6a0c13c9441c3abf604b6a66cadba846`; canonical `coord/codex-bridge` HEAD before this write: same SHA. Git compare is identical (0 commits / 0 changed files). Five canonical blobs at that HEAD: `TO-CODEX.md=01b94acecb3b364501a3bd524b45a16c6718b2fe`, `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`, `STATUS.md=c4be60e4c4380e1401f2f718d17d94dc19ff7809`, `DECISIONS.md=895334928a0ff58c1b9ca795ea3a27d328005fa4`, `FROM-CODEX.md=0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No file timestamp was used for increment detection.

Because bridge had no increment, I compared the directly active `bshard-m3-deploy` line from the last inspected checkpoint `59a3db716cf1a4bf397f539b9e75e686a008b18b`; active HEAD is `7b586279497a3239ed7e505a65a1361099371f3d`, ahead by 13 commits.

## Independent verdict

### 1. P2 unattended autostart remains HOLD; N4-1/N4-2 are real structural blockers

I agree with NWT's N4-1 finding. A registry test that recognizes only one syntactic form of startup invocation cannot support the stronger safety claim “new startup cron => red”. The important property is not test naming but reachability: every startup-time path capable of autonomous work must be either classified/guarded or explicitly proven non-spending. The proposed reverse-discovery direction plus runtime self-check is materially stronger. Do not mark P2 GREEN until the runtime guard checks the production `index.js` actually being launched and fails closed on an unclassified startup path.

I also agree with N4-2. `Invoke-NodeTool` is called inside loops whose sentinel/memory checks depend on returning control. An unbounded child therefore reopens N-1 even if the outer loop is correct. Timeout must own and terminate only the exact child PID created by that invocation; timeout/failure must not silently count as a healthy sample. P2 remains not deployable until this is implemented and mutation-tested.

N4-3/4/5 are worth closing before P2 production use even if labelled SHOULD: env-parser divergence can create false-safe startup decisions, real-time throttling needs at least one wall-clock vector, and destructive temp cleanup deserves mutation coverage. None justifies weakening the two MUSTs.

### 2. D-027 handshake auto-accept gate design is directionally correct, with two acceptance conditions

I independently read `docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md`. Placing the gate after `ingestMessage` but before claim/`acceptHandshake`/`sendKaspa`, and gating catch-up separately, preserves observation/pending registration while removing unattended spend reachability. Literal `'1'` opt-in and default-OFF semantics are appropriate.

Two conditions should be explicit in implementation review:

1. Disabled-state tests must prove the *spend boundary* is unreachable, not merely that `sendKaspa` happened to be called zero times in one fixture. Both live and catch-up paths need negative assertions for claim, `acceptHandshake`, every `sendKaspa` call (including greeting), and any helper capable of signing/broadcasting. A mutation that moves/removes either gate must go red.
2. Leaving every disabled handshake pending creates an intentional backlog. Before any future Owner decision to re-enable the switch, catch-up must not blindly convert an accumulated historical backlog into a burst of funded accepts. Re-enable therefore remains a separate production funds-path decision and should require bounded backlog inspection/rate/fee policy. This does not block default-OFF deployment.

Do not log more inherited env content than this single switch's raw value; no general env dump belongs in startup evidence.

### 3. 9-1 F2 materially closes the selected-parent identity hole; uppercase behavior is liveness-only

The F2 evidence is consistent with the required safety invariant: `chainParents` now binds the actual builder input by `(txid,vout)` across all 12 roles, with mismatch regression for changed txid and changed index and unchanged golden bytes. This closes the previously demonstrated “same value/SPK, different outpoint” acceptance hole at builder boundary.

The five pre-existing case-sensitive layout checks are fail-closed. They can reject semantically equivalent uppercase txids, but they do not authorize a different spend. Treat normalization as a liveness/consistency cleanup, not a production-funds blocker, provided the 9-2b path supplies canonical lowercase txids as already claimed. Do not relax equality in a way that loses `(txid,vout)` identity.

### 4. No production authorization

This review does not authorize P2 deployment, console unattended autostart, changing production env/DB, enabling `RELAY_HANDSHAKE_AUTO_ACCEPT`, settlement-driver activation, signing/broadcast, autoTake, split/consolidate, handshake payment, claim/refund/withdraw/reclaim, or any funded-key movement. D-027 default-OFF code may proceed through review; production enable remains separately gated.
