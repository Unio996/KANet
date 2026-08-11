# Codex review — unsynced Path-C refund authority gap

## Git baseline

- `coord/codex-bridge` checked HEAD: `c674eccdfbc16363458c57d2e7382f3ad30a4370`.
- Last processed/writeback baseline: same SHA. Git compare is identical (`ahead=0`, `behind=0`, `total_commits=0`, no changed files).
- Canonical bridge blobs at that HEAD (re-read from Git objects, not file timestamps):
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Therefore all five canonical-file diffs are empty in this run.

## Unsynced relevant development delta

Active collaboration branch `bshard-m3-deploy` advanced from last reviewed `2863f2e14ee8cf1b062512b9901dd68ad847f522` to `122fb1da5f14aa1f8d5a127130a005de2f514176` (`ahead=18`, `behind=0`). I filtered the range to the D-012/refund-authority thread rather than treating all 18 commits as collaboration feedback.

Relevant evidence includes:

- `71096876c4847bf7b35e78cc5847634670553965`: coordination ledger item (150) says the refund authority predicate is the V2 policy's explicit per-market operator authorization, and reiterates that settlement failure does not confer refund authority.
- `02c2a865f2e0a06f5ec022fc632a90f29d808850`: Path-C execution design for the nine markets; design-only, requiring S1-S4 evidence then explicit per-market operator approval before execution.
- Current `kasia-console/src/lib/pool-refund-builder.mjs` blob at dev HEAD: `d64eda8ef40a92dbac52a914b79ed8131902ce0e`.

## Independent code-level ruling

### 1. The separation of settlement failure from refund disposition is conceptually correct

The new design does **not** simply say `cannot-verify => refund`. It explicitly introduces a separate Path-C policy decision and a per-market approval step. That is directionally consistent with the prior Codex ruling that `cannot-verify` has zero signing authority and that failure to settle does not by itself create refund/cancel authority.

### 2. But the claimed refund "authority predicate" is currently procedural, not mechanically enforced

This is a funds-path blocker.

The actual refund builder states that `refund_draw` is **permissionless**: no committee signature is required; anyone may trigger it after the covenant timeout, and funds are directed to the ticket bettor. `buildRefundCommand()` builds `type='bshard_refund_cancelled'` from pool/ticket state and refund witness. The builder validates template/value conservation, but it takes **no operator-authorization artifact**, approval digest, market-bound authorization token, approver identity/signature, expiry/nonce, or replay-bound intent.

That means S5's "operator explicit per-market authorization" exists only in the operating procedure. The current builder/relay/covenant path cannot distinguish:

- a refund command that was explicitly approved under Path-C for this exact market/row set; from
- the same technically valid refund command constructed without that approval.

The fact that the covenant is permissionless is not itself a defect — permissionless self-refund may be intentional — but it means an internal statement that "operator approval is the authority predicate" is false at the executable boundary unless some mechanically checked gate is added **before the organization-controlled relay/sign/broadcast capability**.

### 3. Therefore do not treat approval of the Path-C document as closure of refund authority

Current verdict:

- `cannot-verify -> no-sign`: prior authority ruling remains in force; I did not find evidence in this delta that weak B-tier evidence should regain signing authority.
- `settlement failure -> refund`: **still forbidden as an implication**.
- Path-C all-bettor / zero-exclusion refund policy: may be a valid disposition policy, but **policy approval alone is not an executable authorization predicate**.
- S1-S4 read-only evidence and dry-run checks: useful preconditions, not funds authority.
- S5 human approval: **RED / MUST-FIX at the machine boundary** if the team intends it to be the safety gate for organization-operated refund execution.

## Minimum closure

Before any organization-operated production refund execution, bind the approval to the executable intent and make the relay/execution layer fail closed without it. At minimum the authorization artifact/check should bind the exact market/shard, enumerated refund scope or a committed digest of it, total amount/output commitment, disposition=`refund`, policy/version, approver identity/role, unique nonce or operation id, and appropriate expiry/replay protection. The builder/relay should verify that artifact before gaining access to the broadcast-capable path. An audit-log entry or pasted approval message alone is insufficient if the executable path never consumes it.

Because the on-chain covenant itself intentionally permits refund without a signature, this gate cannot prevent arbitrary third parties from exercising the covenant. The narrower requirement here is to prevent **KANet-controlled execution infrastructure** from converting an unapproved operational request into a production refund transaction.

No production DB mutation, refund/settlement, signing/broadcast, key movement, watchdog/miner deployment, or other production funds-path action is authorized by this review.
