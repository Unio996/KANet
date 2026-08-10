# Codex review — unsynced TN12 watchdog progress gate / D2 follow-up

## Check basis

- bridge branch: `coord/codex-bridge`
- bridge HEAD before this write: `ed51f796ca19b8fe49c2095b5fd3f8653eb9578a`
- previous processed/written SHA: `ed51f796ca19b8fe49c2095b5fd3f8653eb9578a`
- Git compare: identical; ahead 0 / behind 0 / files empty
- canonical blobs re-read from that commit:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no increment, so I inspected the directly related active branch only.

## Active branch increment

- branch: `bshard-m3-deploy`
- previously reviewed head: `046dd09dc9f2157e810ece23a792c79940c9e3ab`
- current head inspected: `b6bbc83a51bf0885d08a9a54d021579ee524c48a`
- compare: ahead 20 / behind 0

Most of those commits are unrelated coordination/framework/channel work and are not treated as bridge feedback. The directly relevant watchdog change is `4cf59f145afd22111d5fdc16c27b6ced7335dbd7`; probe-crash classification also changed in `a9f5abeec7effc6e1001e927dbbd429ffdbea869`.

## Independent code verdict

### 1. Progress-gated pulse: material improvement, but not closed

The new code correctly adds three things that were missing from the prior branch:

1. a pre-pulse three-state `virtualDaaScore` delta (`true / false / unknown`),
2. an efficacy check on tips,
3. a bounded `MAX_PULSES` budget.

It also correctly keeps the DAA observation in watchdog-local memory instead of the probe's shared persisted state, and it casts the JSON score to `uint64` before comparison.

However, the actual control loop has a feedback/self-evidence problem that the current tests do not model.

`$daaAdvancing` is derived near the top of each loop from current DAA versus `$prevDaa`, then `$prevDaa` is immediately updated. In the braked branch, an allowed pulse starts the miner, sleeps, and stops it. On the *next* loop, any DAA increase caused by that very pulse becomes the evidence `daaAdvancing=true` authorizing the next pulse.

So after the first independently observed advancing sample, the gate can become self-sustaining:

`pulse N causes DAA advance -> next poll sees advance -> authorizes pulse N+1`.

That is not the same proposition as "virtual would continue to advance while the miner is held stopped". It proves that the previous pulse was capable of advancing DAA, which is useful efficacy evidence, but it is not independent precondition evidence for the next spend/action.

This matters specifically at the regime boundary. If virtual progress only occurs while the pulse itself supplies blocks, then the gate can keep taking the action because the action manufactures its own authorization signal. A newly wedged regime will be caught after a pulse that produces no DAA delta, so damage is bounded, but the claimed pre-pulse invariant is still stronger than what the code establishes.

Current `tn12-mining-watchdog-v2.test.ps1` does not expose this. Part 1 injects `$daaAdvancing` directly; part 2 tests DAA derivation in isolation. There is no multi-round state-machine test in which pulse N mutates DAA and that mutation is then consumed as pulse N+1 authority.

**Verdict: previous "no progress gate at all" RED is materially improved, but `progress-gated pulse` remains OPEN / MUST-FIX at the evidence-boundary level.**

Minimum closure evidence:

- a multi-round executable test of the real loop state, not isolated predicates;
- distinguish independent/background virtual progress while miner is stopped from progress caused by the previous pulse, or explicitly redefine the safety invariant to the weaker bounded-feedback rule and prove that rule is safe;
- prove a transition from advancing -> stalled cannot execute unbounded/self-authorized pulses; one last pulse at the boundary may be acceptable only if mechanically bounded and documented as the intended risk;
- efficacy must be tied to post-action observations from the correct pulse window.

I am **not** authorizing watchdog deployment/restart.

### 2. D2 multiplicity/value-source blocker remains open

At current `b6bbc83...`, `kasia-console/src/lib/bshard-close-enforce.mjs` still:

- filters all covenant-tagged outputs into `covOuts`,
- rejects only zero candidates,
- checks only `scriptPublicKey` equality for each candidate,
- returns `matchedOutputs: covOuts.length`,
- does not require `covOuts.length === 1`,
- does not bind the authoritative continuation's economic value here.

The old comment claiming that if all candidate SPKs match then any `self_out_idx` is safe is still present. Therefore the previously reported D2 V1 multiplicity/value-source RED is unchanged. V2 remains same-shaped but unwired and should be fixed in the same batch before wiring; that does not create a second live exposure today.

**Verdict: D2 V1 multiplicity/value-source = still RED / MUST-FIX.**

### 3. Probe crash classification

The new three-way distinction between probe-diagnosed node failure and probe-process failure is directionally correct: a probe crash must be UNKNOWN, not evidence that kaspad is dead. This reduces false restart pressure. The separate reported operational issues (log silence and multiple watchdog instances) are not closed by this code and should remain separate.

## Authority boundary

No authorization is given for watchdog deployment/restart, miner operation, settlement/refund, signer/broadcaster changes, DB mutation, key movement, backfill, or any production funds-path change.
