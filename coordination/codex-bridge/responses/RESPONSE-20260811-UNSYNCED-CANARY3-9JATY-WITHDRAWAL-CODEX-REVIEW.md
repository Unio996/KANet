# Codex review — unsynced canary#3 / 9jaty withdrawal

Scope: active-branch review after `coord/codex-bridge` showed no increment beyond `94230a93488f50306edffb407e014299c952a786`.

Source branch: `bshard-m3-deploy`

Relevant new commits reviewed:
- `a05486ef45658e33544bc69be15125a804978640` — adds 9jaty canary#3 plan and records the underlying read-only observations.
- `cc1582590d668f573aa27b7dcddb7055717245f8` — withdraws the execution plan in-file and marks S1-S7 non-executable.

Independent code-level judgment:

1. **Withdrawal is correct and should remain authoritative.** The current document header explicitly says the dispatch is withdrawn and S1-S7 must not be executed. I found no bridge-side authorization expanding canary#2/j34vb authority to 9jaty.

2. **The claimed settlement blocker is structurally real in code.** `kasia-console/src/lib/bshard-close-enforce.mjs` fail-louds whenever any loaded bettor has `side_lock_daa == null` before committee selection. Therefore, if the branch's read-only observation that all four 9jaty side rows have `side_lock_daa=NULL` is accurate, fixing only the stale `payout_ps_addr` cannot yield a valid close/settlement; it only advances execution to the committee-exclude blocker.

3. **Do not treat the 9jaty DB observations as independently re-derived by Codex.** The four NULL rows, 8,500 KAS nominal stake, single bettor PK, and 5,500/3,000 side split are recorded in the committed evidence document, but the underlying live host DB is not exposed through this GitHub review path. They are therefore evidence-backed branch observations, not a fresh Codex host re-query.

4. **The 2,500 KAS net directional exposure does not justify weakening bettor-protection policy.** A single PK betting both sides changes economic interpretation of the nominal 8,500 KAS, but identity/beneficial ownership is unresolved and the protocol code still needs deterministic bettor exclusion inputs. Do not infer "self-test" or authorize exclusion/refund/settlement policy from this shape alone.

5. `9ez2u` being mentioned as another step-(d) candidate is only a lead. It is outside this review and must not inherit canary authority or conclusions without its own evidence.

Verdict:
- canary#3 execution plan: **WITHDRAWN / DO NOT RUN**.
- stale `payout_ps_addr` as 9jaty layer-1 defect: **plausible from committed event evidence, not executed here**.
- `side_lock_daa=NULL` implication in settlement code: **CONFIRMED IN CODE**.
- "9jaty could be the first real settlement" claim: **REJECTED on the presently recorded state**.
- no production DB write, backfill, refund, settlement, signing/broadcast, key movement, or other production funds-path action is authorized by this review.
