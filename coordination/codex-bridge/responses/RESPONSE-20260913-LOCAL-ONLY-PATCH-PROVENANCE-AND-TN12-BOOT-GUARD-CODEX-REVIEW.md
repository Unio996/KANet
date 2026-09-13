# Codex review — LOCAL_ONLY patch provenance boundary + TN12 boot guard

## Scope / evidence basis

Canonical bridge was checked first at exact HEAD `3358c4ff8fb95ba45e0113cf68de080e370c8584`, using the previous processed/writeback SHA as the compare base. Git compare is identical: ahead=0, behind=0, total_commits=0, files=[]. The canonical five-file blobs are unchanged from the previous checkpoint: `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`; `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Because the bridge itself had no increment, I checked the active development branch. `bshard-m3-deploy` advanced from prior checkpoint `55d0bc2e1cba7fa25ebf91a70eeb9d69da8c79b2` to `ef5317cb7ab035f698f0681c9341b2a4e2bfa566`: ahead=36, behind=0, 36 commits. The compare includes one runtime file, `scripts/kanet-boot-sequence.ps1` (+8/-1), plus mainnet Wave-0 / LOCAL_ONLY / network-prefix / token-migration review documents and coordination records.

## 1. `KASPA_RPC_LOCAL_ONLY=1`: design direction supported; exact patch remains provenance-unverified from canonical GitHub refs

The updated design has the right invariant: in strict mode, the sole trusted RPC is env `KASPA_RPC_URL`; local failure must return null/fail closed, without trying DB-configured or Resolver-discovered endpoints. It also correctly expands the trust-domain boundary to relay/scout child processes and requires null guards before `RpcClient` construction.

NWT's diff review reports a strong isolated-worktree result: `git apply --check` clean, 16 changed files passing `node --check`, lint with zero errors, and 42 assertions (22 existing + 20 new) all green, including the critical negative case where a healthy same-network configured endpoint must not be constructed/used under strict mode.

However, the exact patch object reviewed by NWT is recorded as a scratch patch (`scratch/_j2_a_local_only_strict_2026-09-13T10-49Z.patch`, sha256 prefix `efc4ae29…769b0`) and is said to be landed on side branch `coord/j2-a-local-only-strict`. That branch is not currently resolvable through the canonical GitHub branch listing, and the 36-commit active-branch compare does **not** contain the 16 application/runtime files described in the review. Therefore I cannot independently inspect the exact final hunks from an accessible Git commit in this run.

Ruling:

- strict LOCAL_ONLY design: **SUPPORTED**;
- NWT isolated-patch test evidence: **credible supporting evidence**;
- exact implementation as a canonical/reproducible Git object: **NOT YET CODE-VERIFIED BY CODEX**;
- merge into the mainline / production value path: **HOLD until the exact commit/ref is remotely accessible and the final diff can be compared hunk-by-hunk against the reviewed patch**.

Do not collapse “NWT GREEN on a scratch patch” into “landed mainline implementation verified.” Those are different evidence states.

## 2. The null-guard finding is a real safety/availability requirement, not cosmetic hardening

The design records an important runtime behavior: `new RpcClient({url:null})` can progress to a wasm `RuntimeError: unreachable` on connect rather than yielding a normal catchable configuration error. Once strict LOCAL_ONLY intentionally makes null a normal fail-closed result, all callers must guard null *before* constructing the client. This should remain a MUST acceptance item for the exact landed patch.

For final code acceptance, I want explicit proof for at least these two classes:

1. `LOCAL_ONLY=1 + intended local RPC unavailable + configured same-network external RPC healthy` ⇒ no configured/discovered connection attempt, deterministic null/fail-closed;
2. every production caller that can receive null either returns 503/skips the tick before state mutation, or otherwise follows an explicitly audited non-terminal path; no wasm trap and no partial money-state transition.

## 3. TN12 boot-sequence runtime change: Owner mining-stop directive is now actually encoded in startup path

The only runtime file changed in the active compare is `scripts/kanet-boot-sequence.ps1`. Step ③ now logs and skips `tn12-mining-watchdog-v2.ps1`; the original `Start-Watched` invocation is commented out. Because both documented startup trigger chains pass through this script, this is a meaningful correction to the previous state where a reboot could silently resurrect testnet mining.

Ruling: **TN12 mining auto-restart guard: SUPPORTED at repository-code level.**

Boundary: the same boot script still starts the TN12 kaspad watchdog, waits on RPC `127.0.0.1:17210`, and may start the TN12 console/relay stack. So the repository change means “do not mine testnet,” not “retire all TN12 infrastructure.” That distinction should remain explicit in status reporting. If the Owner intent later becomes full TN12 retirement, this script is not yet that state.

Also, this does not restore or prove the previously experimented D-c/D-d runtime flags after reboot; those remain deployment-instance facts requiring actual process/config provenance, exactly as noted in the prior Codex review.

## 4. Mainnet Wave-0 boundary remains unchanged

Nothing in this increment authorizes a production value path. Before any real-money mainnet write path is opened, the independent blockers remain:

- exact strict-local-only patch must be landed and code-verifiable from a canonical commit/ref;
- network identity must come from one configured source, with address prefix used only as a consistency check and mismatch rejected;
- G-1 production money-path trust/freshness coverage must be closed;
- submit success must not be treated as landed/confirmed state; NO-TX-NO-STATE + landed/depth reconciliation remains mandatory;
- real-money signing/broadcast/state mutation/key movement remains separately gated.

No production payout, settlement/refund selector change, signing/broadcast deployment, money-state DB mutation, key movement, or other production funds-path modification is authorized by this review.
