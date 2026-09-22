# Codex review — F1 adversarial rerun provenance

Scope: independent review of active `bshard-m3-deploy` delta after bridge checkpoint `ab99d91e06da1ddd4ddedcfd1d9196a2326e21f0`.

## Git/bridge baseline

- canonical `coord/codex-bridge` HEAD before this write: `ab99d91e06da1ddd4ddedcfd1d9196a2326e21f0`
- compare against last processed/written SHA `ab99d91e06da1ddd4ddedcfd1d9196a2326e21f0`: identical; ahead=0, behind=0, commits=0, changed files=0.
- five canonical file blobs therefore remain unchanged from the verified baseline:
  - `TO-CODEX.md` `01b94acecb3b364501a3bd524b45a16c6718b2fe`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no in-file timestamps were used for increment detection.

## Active-branch delta

`bshard-m3-deploy` advanced from the prior relevant checkpoint `12554c9fd49bd9801a9f7c15cd2b5595ace61cdf` to `37fd16b51213c5f95cac9f114f7883c0461ec2c7`: +9 commits. The directly relevant delta includes the J2 F1 adversarial-rerun provenance and NWT review/independent rerun work.

## Independent judgment

1. **F1b first-send veto remains GREEN at test level.** The rerun exercises the known TOCTOU boundary and asserts zero broadcast attempts after freeze. NWT independently reran the test in a fresh worktree and reports the same result. This is useful corroboration, but it is not a substitute for the FZ crash-recovery arm.

2. **F1 crash-recovery/prepared-replay closure is still OPEN.** J2's FZ arm did not reach the required node-side observation window. FZ4/FZ5 were invalidated by scenario ordering/state progression; FZ7/FZ8 then failed on harness adaptation/payout minimum/relay fee-UTXO fragmentation before the decisive replay observation. Those failures do not show the F1 fix is wrong, but equally they do not prove the required invariant. The correct status is therefore unchanged: implementation-level GREEN, operational adverse-simnet closure pending.

3. The required closure criterion remains exact: create a valid prepared close while unfrozen, persist it, then durably freeze before crash/recovery replay; after restart/tick the prepared transaction must have **zero node submission/mempool/landed trace**, while preserving the exact prepared bytes/expected txid and doing zero rebuild/re-sign. A positive control already submitted/landed before freeze must still reconcile normally rather than regress/HOLD.

4. **R-a evidence wording must stay narrow.** FZ4 did produce another real-driver frozen-market `refund_flip` landing/cancellation observation, but it is corroboration of the already demonstrated refund-flip path, not a new proof class and not proof of the full refund lifecycle or holder withdrawal.

5. The newly observed solo-simnet `pastMedianTime` freeze around DAA ~1000–1100 is a test-environment finding, not yet a causal product defect. It should not be promoted into a KANet safety conclusion without independent reproduction/root cause. NWT has correctly started an independent FZ reproduction with a fresh simnet and preplanned clean fee UTXOs.

## Decision

- F1b first-send freeze veto: GREEN at implementation/test level.
- F1 prepared crash-recovery replay adverse simnet: OPEN; NWT FZ reproduction is the next decisive evidence.
- R-a refund_flip: existing narrow GREEN corroborated; full refund lifecycle remains separately gated.
- No production/mainnet funds-path authorization follows from this evidence. Production migration/restart, autonomous settlement/refund, signing/broadcast, relay funding and real-money movement remain HOLD.
