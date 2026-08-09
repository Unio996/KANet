// TN12 DAG health probe -- machine-readable, single line JSON on stdout.
// Deployed to the mining host and called by tn12-mining-watchdog-v2.ps1.
//
// WHY THIS EXISTS (2026-08-08 incident, J1tn):
//   Two sync gates were disabled by design for bootstrap:
//     kaspad --enable-unsynced-mining   +   bridge BRIDGE_SKIP_SYNC_GATE=1
//   Those are REQUIRED (removing them deadlocks: no blocks -> sink stays stale ->
//   never synced -> submitBlock rejected -> still no blocks). But with both gates off
//   and no other brake, a node that falls behind gets mined into an unrecoverable state:
//     produce(0.56/s) > utxo-validate(0.2/s) -> tips pile up -> mergeset hits its cap
//     -> validation gets slower -> more tips.  Positive feedback. It does not self-heal.
//   On 2026-08-07/08 this ran unattended for 15h and reached 18132 tips on the mining
//   host. Stopping the miner alone brought it back to 2 tips within ~20 minutes.
//
//   So the brake must key on DAG WIDTH (tips), not on isSynced.
//   isSynced is unusable as a mining gate precisely because of the deadlock above.
//
// Exit code is always 0 on a produced reading. Probe failure prints ok:false --
// callers MUST distinguish "probe broke" from "DAG is bad": they imply opposite actions.
import { createRequire } from 'node:module';
import fsx from 'node:fs';
import osx from 'node:os';
import pathx from 'node:path';
import cryptox from 'node:crypto';

const REQUIRE_BASE = process.env.DAG_PROBE_REQUIRE_BASE || 'D:/kanet-tn12/kasia-console/package.json';
const URL = process.env.DAG_PROBE_URL || 'ws://127.0.0.1:17210';
const NETWORK = process.env.DAG_PROBE_NETWORK || 'testnet-12';

// Resolve the wasm binding by DISCOVERY, not by a hardcoded path.
// On the mining host the three node_modules/kaspa-wasm copies are EMPTY shells --
// only shared/vendor/kaspa-wasm is real. A single baked-in path is a landmine for
// the next host, so try candidates in order and report which one answered.
const CANDIDATES = [
  process.env.DAG_PROBE_MODULE,
  'kaspa-wasm',
  'D:/kanet-tn12/shared/vendor/kaspa-wasm',
  'D:/kanet/kanet/shared/vendor/kaspa-wasm',
].filter(Boolean);

const out = (o) => console.log(JSON.stringify(o));

function loadWasm(require) {
  const tried = [];
  for (const c of CANDIDATES) {
    try {
      const m = require(c);
      if (m && m.RpcClient) return { mod: m, via: c };
      tried.push(`${c}: loaded but no RpcClient`);
    } catch (e) {
      tried.push(`${c}: ${String(e && e.code || e.message || e)}`);
    }
  }
  throw new Error('no kaspa-wasm candidate resolved -- ' + tried.join(' | '));
}

// TWO FAILURE MODES, TWO CRITERIA -- they imply OPPOSITE actions, so one number cannot serve both.
//
//   runaway  : tips explode. The miner is producing faster than the node can UTXO-validate.
//              Action: STOP MINING and let it digest.       (2026-08-07/08, peak 18132 tips)
//   starved  : tips are FINE (single digits) but the node is far behind and not advancing,
//              because its peers stopped feeding it.
//              Action: ADD A PEER. Stopping anything makes it worse. (2026-08-08, 4h of zero
//              progress at tips=1 while 172,337 blocks behind)
//
// 🔴 The asymmetry that makes this necessary: a MINING host is structurally immune to
// `starved` -- it produces its own blocks, so it reports perfect health while a pure
// receiver next to it is dead. The healthy node will never raise this alarm for you.
const RUNAWAY_TIPS = Number(process.env.DAG_PROBE_RUNAWAY_TIPS || 500);
const STARVED_LAG_SEC = Number(process.env.DAG_PROBE_STARVED_LAG_SEC || 600);

// 🔴 `catching-up` is NOT cosmetic. Without it this probe cries `starved` every time the node
// restarts, because a restarting node is legitimately far behind for a few minutes. Acting on
// that ("add a peer") would be wrong -- it already has peers and is using them. Caught on
// 2026-08-09 by running the probe against a node that had just restarted: it said `starved`
// while the log showed headers streaming in at 16% -> 33% -> 49%.
//
// The discriminator is headerMinusBlock: a node pulling headers ahead of bodies is in IBD and
// is FEEDING. Real starvation looked nothing like it -- headerMinusBlock was 0 and the node
// processed literally zero blocks for four hours. Lag alone cannot tell those apart, and they
// take opposite actions (wait vs. intervene).
const IBD_GAP = Number(process.env.DAG_PROBE_IBD_GAP || 100);
const RISE_STREAK = Number(process.env.DAG_PROBE_RISE_STREAK || 4);
// A streak alone is not enough. In the healthy band tips jitter between roughly 5 and 30, so
// four consecutive upticks happen routinely and fired two false brakes (tips=30 and tips=28,
// both healthy). The fix is NOT to reintroduce a cliff constant: require that the run has also
// grown by a FACTOR over where it started. That is still scale-free -- 5->8 and 200->320 both
// qualify -- so it keeps J2's property that the derivative need not know where the cliff is.
const RISE_FACTOR = Number(process.env.DAG_PROBE_RISE_FACTOR || 1.5);
// J2 caught this before it ran a full cycle: a RELATIVE factor is MORE sensitive near zero,
// not less. 5->8 is 1.6x and would fire, and 5-to-30 is exactly the healthy jitter band, so the
// factor alone just moved the false-brake window from 26-30 down to single digits instead of
// closing it. A floor is required with it.
// A floor is NOT the cliff constant the derivative exists to avoid: the cliff is "where does it
// become unrecoverable" (mergeset cap 248), whereas this only says "below this the DAG is too
// small to be worth acting on".
// 150 comes from J2's measurement, not from my guess: after a drain, NORMAL refill sweeps
// 9 -> 191, so a floor of 50 would read most of an ordinary refill as overproduction. He put
// the usable range at 150-200; 150 leaves ~98 tips of headroom below the 248 cliff to act in.
// The two conditions guard different false positives and neither alone suffices (J2/NWT):
// the floor rejects SMALL signals, the streak+factor reject single-sample JITTER.
// Wall-clock floor for a rising run. Set from MEASURED poll rate, not from an assumed one:
// live sample showed risingStreak=19 spanning streakSeconds=72, i.e. ~3.8s per sample, because
// the state file is keyed by RPC URL alone and BOTH the watchdog and the channel monitor call
// this probe -- so risingStreak counts "how many times anyone sampled", not a system property.
// That is Codex MUST-FIX #2 in a sharper form than it was filed, and it is why the time anchor
// is load-bearing rather than cosmetic.
// I first wrote 90 (a 4-sample span at an ASSUMED 30s rate). At the real rate tonight's genuine
// brake -- streak=27 -- spans ~103s, so 90 sat right on the edge of disarming the one event that
// has actually worked. 60 keeps the 20s jitter case excluded (it needs ~16 samples at this rate)
// with real margin under the live event.
const RISE_MIN_SEC = Number(process.env.DAG_PROBE_RISE_MIN_SEC || 60);
const RISE_FLOOR = Number(process.env.DAG_PROBE_RISE_FLOOR || 150);
// How long detachment must PERSIST before this probe will call it isolated/peers-unknown.
//
// Why a debounce exists at all -- measured 2026-08-10, and it corrects my own earlier fix.
// Removing the `lagging &&` gate from these two branches was right (a freshly detached node has
// lag ~= 0, so gating detachment behind lag meant it could never be reported at the only moment
// reporting it would help). But that gate was ALSO, accidentally, suppressing something I did not
// know it was carrying: on a node whose only durable links are the two public TN12 peers,
// peerCount === 0 is a ROUTINE TRANSIENT, not an event. Both peers reset ~30x/hour with a ~30s
// reconnect backoff, so each is out of the set ~12% of the time and the two gaps overlap often
// enough to be sampled. Shipping the ungated branch without a debounce would have converted a
// real fix for under-reporting into a new and frequent source of over-reporting.
//
// Why 90s, from the sample record rather than from taste (260 samples, remote node, 20s cadence):
//   peerCount===0 occurred in 11 unbroken runs; 10 of them lasted a single sample (<20s),
//   the longest spanned 21.1s. The genuine starvation of 2026-08-08 lasted FOUR HOURS.
//   Transient and real are separated by two orders of magnitude, so any threshold in that gap
//   works; 90s sits ~4x above the longest transient seen and ~160x below the real event.
// 🔴 Scope of that measurement: one node, one 8-hour window. It bounds the transients I OBSERVED,
//   not the transients that exist. If a longer double-gap ever shows up, this number is the thing
//   to revisit -- so detachedSeconds is exported, to be chosen from data again rather than argued.
const ISOLATED_MIN_SEC = Number(process.env.DAG_PROBE_ISOLATED_MIN_SEC || 90);

// J2 red-team 2026-08-09, the finding that mattered most: during tonight's climb tips went
// 194 -> 499 -> 506, so RUNAWAY_TIPS=500 never fired, while lag was already past 600 -- meaning
// the whole actionable window was labelled `starved`, whose remedy is ADD hashrate, when the
// truth was overproduction and the remedy was REDUCE it. The label pointed the opposite way for
// the entire time it could still have helped.
//
// His fix is a derivative, not another threshold:
//     lagging AND tips rising       -> overproduction (arriving faster than they merge)
//     lagging AND tips flat/falling -> starved (nothing to merge)
// A threshold must be chosen relative to the cliff, and we chose wrong (500 vs the real 248
// mergeset cap). A derivative needs no knowledge of where the cliff is: 194->499 is rising from
// the first minute.
function diagnose({ tips, lagSeconds, isSynced, headerMinusBlock, peerCount, tipsTrend, risingStreak, streakStartTips, streakSeconds, detachedSeconds }) {
  if (tips >= RUNAWAY_TIPS) return 'runaway';           // checked first: it is the dangerous one
  // J2 2026-08-09, definitional rather than tuning: lagSeconds = now - sink header timestamp,
  // i.e. how long the SELECTED CHAIN has failed to advance -- a symptom shared by starvation AND
  // overproduction, so lag alone has no discriminating power. tips (are blocks arriving) and daa
  // (is merging progressing) are two quantities; lag only sees the second.
  // So overproduction must NOT sit behind the lag gate. My first version put the derivative
  // behind `lagging`, which recreated the exact defect the derivative was meant to remove:
  // during tonight's climb lag was 344 and this probe said `healthy` while tips ran 48 -> 106.
  // A guard that only speaks after the window has closed is not a guard.
  // Debounced by a rising STREAK, not a magnitude, so it still needs no cliff constant.
  // RISE_STREAK should be set from J2's 30s-resolution curve; the default is deliberately
  // conservative and risingStreak is exported so it can be chosen from data rather than guessed.
  // Both conditions, deliberately: long enough to not be jitter, AND large enough to be growth.
  // Requiring only one of them is what produced the false brakes.
  // Codex MUST-FIX #2: the sample count is poll-rate dependent, so the run must also span real
  // time. streakSeconds === null means UNKNOWN span, and unknown must not silently satisfy a
  // minimum -- but it must not veto either: a null span only occurs when state was just lost,
  // in which case risingStreak would be null too and we never reach here. Treating unknown as
  // non-blocking therefore preserves the behaviour measured tonight (fires at 150, cliff 248)
  // rather than quietly disarming the brake on a fresh state file.
  const spanOk = (streakSeconds == null) || (streakSeconds >= RISE_MIN_SEC);
  if (risingStreak != null && risingStreak >= RISE_STREAK
      && spanOk
      && tips >= RISE_FLOOR
      && streakStartTips != null && tips >= streakStartTips * RISE_FACTOR) return 'overproduction';
  // Ranked AFTER overproduction, and the ordering is load-bearing rather than stylistic.
  // I shipped this block ABOVE overproduction in e5ebc8ea while the commit message claimed it
  // was below -- NWT caught the contradiction by reading the code, J2 supplied the consequence:
  // the watchdog matches diagnosis == 'overproduction' as an exact string, so any earlier branch
  // that fires SILENCES THE BRAKE. Tonight's only genuine brake (15:55, tips=150, streak=27) was
  // sampled at peerCount=0, so my own change would have disarmed the one event that has worked.
  // Why after: runaway/overproduction are read off the LOCAL DAG and stay true while detached,
  // and their remedy is urgent. Why still ungated from `lagging` (the MUST-FIX #3 point, intact):
  // attachment state has nothing to do with how far behind we are -- with no peers, or a count we
  // cannot read, this node is not observing the network at all, so every claim it makes about the
  // network is unsupported whether lag is 5 seconds or 5000.
  // Debounced in WALL-CLOCK, deliberately not in samples. The state file is keyed by RPC URL and
  // is shared by every caller of this probe (the watchdog and the channel monitor both invoke it),
  // so a counter of consecutive samples measures "how many times anyone happened to ask" -- which
  // is exactly the defect Codex MUST-FIX #2 found in the rising streak. Repeating it here would
  // make the debounce tighten or loosen depending on how many processes are polling.
  // detachedSeconds === null means "no prior sample": unknown duration must not satisfy a minimum
  // (that would report isolation on the very first run), so null fails the test rather than passing.
  const detachedLongEnough = detachedSeconds != null && detachedSeconds >= ISOLATED_MIN_SEC;
  if (peerCount === 0 && detachedLongEnough) return 'isolated';
  if (peerCount == null && detachedLongEnough) return 'peers-unknown';   // == catches undefined; null is not zero
  // Below the debounce we deliberately fall through to the lag ladder, i.e. back to the behaviour
  // that shipped before the ungating. A brief double-gap between two flapping peers is not a
  // statement about the network, and saying 'isolated' about it would spend the word on noise --
  // after which nobody reacts to it when it is real.
  const lagging = lagSeconds !== null && lagSeconds >= STARVED_LAG_SEC;
  // Isolation outranks every lag-based verdict: with no peers you are not observing the network,
  // so any statement about the network from this node is unsupported. Reported as its own state
  // so nobody re-runs 2026-08-09's inference ("my DAA is frozen" -> "the chain is idle").
  // NWT red-team 2026-08-09 on f9ca965c: the first version only protected peerCount === 0.
  // null means "could not determine whether we are attached to the network at all", which is
  // NOT 0 (known isolated) and NOT 3 (known fine) -- it means every statement this probe makes
  // ABOUT THE NETWORK is unsupported. Letting it fall through to a lag verdict re-runs tonight's
  // bad inference with a different missing input, and 'starved' would tell an operator to add
  // peers on evidence that cannot support it.
  // I had written "null = could not read, NOT zero. Do not collapse them." in a comment above
  // and then collapsed them in the logic. Stating a distinction is not the same as enforcing it.
  if (lagging && headerMinusBlock >= IBD_GAP) return 'catching-up';  // behind BUT being fed
  // null = no previous sample (first run / cleared state). Unknown is not "flat": calling it
  // starved here would be the same collapse as null-peerCount, so it gets its own answer.
  if (lagging && tipsTrend == null) return 'trend-unknown';   // == catches undefined too: an omitted field is unknown, not flat
  if (lagging) return 'starved';                        // behind AND not being fed -> intervene
  if (!isSynced) return 'behind';                        // lagging but under threshold; watch it
  return 'healthy';
}

// --selftest exercises diagnose() against constructed inputs. It exists because the branches
// that matter only appear when something is WRONG: once the node is healthy you can no longer
// reach them from live data, and "never fired" then reads the same whether the logic is right
// or broken. Each case below is anchored to a real observation, not an invented shape.
// Wiring assertion, deliberately source-level rather than behavioural.
//
// Why it exists: on 2026-08-10 the two diagnose() call sites disagreed -- the sample-log one
// passed streakSeconds, the stdout one (the ONLY one the watchdog reads) did not. Because an
// omitted argument is undefined and `undefined == null`, the minimum-span guard silently
// evaluated to "pass" on the load-bearing path for as long as it had existed. The fix was real
// and reviewed; it just never reached its consumer.
// 🔴 And every one of the behavioural cases below was blind to it, structurally: they call
// diagnose() directly, so no fixture can ever exercise an argument list. Re-injecting that exact
// defect leaves the suite ALL PASS -- I verified that rather than assuming it. A green suite was
// therefore evidence about the callee only, while the claim being made was about the system.
// So this one reads the source on purpose: the property under test IS a property of the source.
// Continuity across samples, extracted as a PURE function on 2026-08-10 so it can be tested.
//
// It was inline before, and that is precisely why Codex found two unsound continuity claims that
// a green 36-case suite had nothing to say about: every fixture called diagnose() directly, so
// none of them could reach the state-carry-forward logic at all. Same shape as the call-site
// parity defect from the same day -- the tests covered the callee while the claim was about the
// system. Extracting it is not tidiness; it is what makes the adversarial stale-state fixtures
// below possible to write.
//
// `now` and `prev` are parameters rather than Date.now()/a file read for the same reason: a
// continuity rule whose inputs cannot be constructed cannot be adversarially tested.
function computeContinuity(prev, now, { tips, peerCount, freshMaxSec }) {
  // A prior observation is usable ONLY if it is recent enough that the interval between it and
  // now can be treated as covered. Missing/unreadable prior state is stale BY DEFINITION -- there
  // is nothing to be continuous with. Unknown fails; it does not pass.
  // 🔴 Codex MUST-FIX 2026-08-10 round 2: the first version asked only "is it too OLD", which
  // let a prior record dated in the FUTURE through as fresh -- (now - prevTs) is then negative,
  // and negative is not > freshMaxSec. A future-dated record could hand over risingStreak,
  // streakStartTs and detachedSince from an observation that cannot have happened yet, and that
  // state feeds the exact `overproduction` string the watchdog brakes on.
  // It is not hypothetical bookkeeping: clock steps (NTP correction, VM resume, a state file
  // carried between hosts) produce exactly this.
  // 🔨 The shape of my mistake, twice in a row on this one function: the guard was right in the
  // direction I was thinking about and absent in the other. Round 1 had no ceiling at all;
  // round 2 had a ceiling but no floor. So the test is now stated as a WINDOW with both ends,
  // not as a comparison.
  // `now` is validated too: a non-finite now makes every comparison false, which would silently
  // mean "nothing is ever stale" -- the failure would look like normal operation.
  // freshMaxSec comes from an env var, so a garbage or non-positive value must not widen the
  // window either; unusable config fails closed to "prior unusable", never to "everything fresh".
  const prevTs = Number.isFinite(prev?.ts) ? prev.ts : null;
  const windowOk = Number.isFinite(freshMaxSec) && freshMaxSec > 0;
  const ageSec = (prevTs === null || !Number.isFinite(now)) ? null : (now - prevTs) / 1000;
  const priorIsStale = !windowOk || ageSec === null || ageSec < 0 || ageSec > freshMaxSec;

  let tipsTrend = null, prevTips = null, risingStreak = null, streakStartTips = null, streakStartTs = null;
  if (!priorIsStale && Number.isFinite(prev?.tips)) {
    prevTips = prev.tips;
    tipsTrend = tips - prev.tips;
    const prevStreak = Number.isFinite(prev?.risingStreak) ? prev.risingStreak : 0;
    risingStreak = tipsTrend > 0 ? prevStreak + 1 : 0;
    // Where the current rising run began -- reset whenever the run breaks, so the factor is
    // measured against the run's own start rather than against any fixed baseline.
    streakStartTips = tipsTrend > 0
      ? (Number.isFinite(prev?.streakStartTips) && prevStreak > 0 ? prev.streakStartTips : prevTips)
      : tips;
    // Codex MUST-FIX #2: the streak counted SAMPLES, so "4 consecutive rises" meant a different
    // amount of real time depending on how often the watchdog happened to poll. A criterion about
    // a TREND has to be anchored in time.
    streakStartTs = tipsTrend > 0
      ? (Number.isFinite(prev?.streakStartTs) && prevStreak > 0 ? prev.streakStartTs : prevTs)
      : now;
  }
  // Stale prior => every one of the above stays null => risingStreak null => diagnose() cannot
  // reach 'overproduction' (it requires risingStreak != null). One fresh observation after a gap
  // can no longer fabricate a multi-hour climb, which was the branch that fed the brake.

  // Wall-clock anchor for an UNBROKEN run of "not attached" (peerCount 0 or unreadable). Cleared
  // the moment any caller observes a real peer count -- clearing on anyone's good sample only
  // shortens runs, so it can make this probe slower to cry isolation, never quicker.
  const detached = (peerCount === 0 || peerCount == null);
  const detachedSince = detached
    ? ((!priorIsStale && Number.isFinite(prev?.detachedSince)) ? prev.detachedSince : now)
    : null;
  // After a gap the run restarts at `now`: we know only that we are detached at THIS instant, so
  // the measured duration begins here and reads 0 -- correctly failing ISOLATED_MIN_SEC until
  // fresh consecutive observations have actually established a duration.

  return { priorIsStale, tipsTrend, prevTips, risingStreak, streakStartTips, streakStartTs, detachedSince };
}

// Note on what #1 actually is, because it started as luck and is now deliberate: the regex also
// matches the DECLARATION's destructuring pattern, which appears first. So each call site is
// compared against diagnose()'s own parameter list rather than against a sibling call. That is the
// stronger check -- adding a parameter and wiring it at only one site still fails -- and it is
// stated here so a later reader does not "tidy up" the declaration out of the match set.
function checkCallSiteParity(src) {
  const calls = [...src.matchAll(/diagnose\(\{([^}]*)\}\)/g)].map((m) => m[1]);
  if (calls.length < 2) return ['diagnose() call sites found: ' + calls.length + ' -- expected at least 2; this check just went blind, treat as FAIL not as pass'];
  const keysOf = (s) => new Set(s.split(',').map((p) => p.split(':')[0].trim()).filter(Boolean));
  const sets = calls.map(keysOf);
  const problems = [];
  for (let i = 1; i < sets.length; i++) {
    const missing = [...sets[0]].filter((k) => !sets[i].has(k));
    const extra = [...sets[i]].filter((k) => !sets[0].has(k));
    if (missing.length || extra.length) {
      problems.push(`call site #${i + 1} differs from #1 -- missing [${missing}] extra [${extra}]`);
    }
  }
  return problems;
}

if (process.argv.includes('--selftest')) {
  const cases = [
    // 2026-08-07/08 mining host at the peak of the stall.
    { name: 'runaway: tips exploded',        in: { tips: 18132, lagSeconds: 40000, isSynced: false, headerMinusBlock: 0, peerCount: 2, tipsTrend: 300 }, want: 'runaway' },
    // 2026-08-08 this node: 4h of zero progress, DAG pristine, nobody feeding it.
    { name: 'starved: behind, not fed',      in: { tips: 1, lagSeconds: 14400, isSynced: false, headerMinusBlock: 0, peerCount: 2, tipsTrend: 0 },  want: 'starved' },
    // 2026-08-09 right after a restart: equally far behind, but headers streaming in.
    { name: 'catching-up: behind, being fed',in: { tips: 1, lagSeconds: 744, isSynced: false, headerMinusBlock: 3960, peerCount: 3, tipsTrend: 0 }, want: 'catching-up' },
    // runaway must win: it is the one with a destructive remedy if missed.
    { name: 'runaway outranks starved',      in: { tips: 9000, lagSeconds: 14400, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 50 }, want: 'runaway' },
    { name: 'behind: lagging under thresh',  in: { tips: 2, lagSeconds: 60, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 0 },     want: 'behind' },
    { name: 'healthy: steady state',         in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 0 },        want: 'healthy' },
    // Bettor's 2026-08-09 misdiagnosis: frozen DAA read as "chain idle" while his own node
    // had dropped to 0 peers. With no peers this node observes nothing, so say so.
    { name: 'isolated: lagging, zero peers', in: { tips: 3, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 0, detachedSeconds: 300 },    want: 'isolated' },
    // NWT red-team: unreadable peer count must NOT fall through to a lag verdict.
    { name: 'peers-unknown: lagging, peerCount null', in: { tips: 3, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: null, detachedSeconds: 300 }, want: 'peers-unknown' },
    // --- the debounce contrast pair (2026-08-10). These two differ in ONE field, and that field
    // is the whole claim: a detachment is only reportable once it has LASTED. Measured basis:
    // 11 observed zero-peer runs, longest 21.1s, versus a real starvation of 4 hours.
    // If the debounce is deleted, the first of these turns red -- it is named for what it guards.
    { name: 'debounce: single transient zero-peer sample is NOT isolated',
      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 0, detachedSeconds: 0 },  want: 'healthy' },
    { name: 'debounce: 21s double-gap (longest ever measured) is NOT isolated',
      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 0, detachedSeconds: 21 }, want: 'healthy' },
    { name: 'debounce: sustained detachment IS isolated',
      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 0, detachedSeconds: 90 }, want: 'isolated' },
    // Unknown duration must FAIL the minimum, not satisfy it -- the inverse of how streakSeconds
    // treats null, and deliberately so: an unknown SPAN must not disarm a brake, but an unknown
    // DURATION must not arm an accusation. The asymmetry is the point, not an oversight.
    { name: 'debounce: unknown duration does not support an isolation claim',
      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 0, detachedSeconds: null }, want: 'healthy' },
    { name: 'debounce: transient unreadable count is not peers-unknown either',
      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: null, detachedSeconds: 10 }, want: 'healthy' },
    // And the debounce must NOT be able to suppress the brake: a climb still wins outright,
    // whatever the detachment duration says. This is the branch whose ordering I once broke.
    { name: 'debounce never outranks the brake: sustained detachment + climb = overproduction',
      in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 0, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 200, detachedSeconds: 9999 }, want: 'overproduction' },
    // ...but a healthy node with an unreadable peer count is still healthy: the guard must not
    // fire when there is nothing wrong, or it becomes noise and gets ignored.
    // Behaviour change (Codex #3): an unreadable peer count now speaks even when nothing else is
    // wrong, because "I cannot tell whether I am attached" is itself the finding. It is a
    // diagnosis label only -- the watchdog brakes on runaway/overproduction, never on this.
    // NWT 2026-08-09: every overproduction fixture pinned peerCount:3, so "climbing AND
    // detached" -- the combination that decides which branch wins -- had never been tested at
    // all. The regression these catch is one I shipped: the brake going silent exactly when a
    // climb coincides with peer loss, which is what tonight's real brake looked like.
    { name: 'climbing + peers=0 must still brake, not report isolated',    in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 0,    tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 200 }, want: 'overproduction' },
    { name: 'climbing + peers unreadable must still brake',                in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: null, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 200 }, want: 'overproduction' },
    { name: 'peers=0 without a climb still reports isolated',              in: { tips: 20,  lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 0,    tipsTrend: 1,  risingStreak: 1, streakStartTips: 19, streakSeconds: 200, detachedSeconds: 300 }, want: 'isolated' },
    // Codex MUST-FIX #2 -- the same rise, judged by how long it actually took.
    { name: 'rise: 4 samples spanning 20s = poll noise, not a trend', in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 20 },  want: 'starved' },
    { name: 'rise: same 4 samples spanning 200s = real trend',       in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 200 }, want: 'overproduction' },
    { name: 'rise: unknown span does not disarm the brake',          in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: null }, want: 'overproduction' },
    { name: 'peers-unknown even when not lagging',      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: null, detachedSeconds: 300 }, want: 'peers-unknown' },
    { name: 'isolated even when not lagging',           in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 0, detachedSeconds: 300 },    want: 'isolated' },
    // J2's finding: tonight's entire climb (194->499) sat under RUNAWAY_TIPS=500 while lag was
    // already past 600, so it was labelled starved -- remedy "add hashrate" -- when the truth
    // was overproduction and the remedy was the opposite.
    { name: 'overproduction: rising streak reached', in: { tips: 400, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 60, risingStreak: 4, streakStartTips: 200 }, want: 'overproduction' },
    // The blind spot this fix exists for: tonight, lag=344 (under the 600 gate) while tips ran
    // 48 -> 106. The old ordering said `healthy` through the whole actionable window.
    // Still guards "the lag gate must not silence the derivative": lag=344 is under the 600
    // gate, yet this must fire. Values raised above the floor because 48->106 is inside the
    // measured normal-refill sweep and is genuinely indistinguishable from it at that size --
    // the floor buys correctness there at the cost of acting later.
    { name: 'overproduction: climbing BEFORE lag gate opens', in: { tips: 240, lagSeconds: 344, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 12, risingStreak: 5, streakStartTips: 150 }, want: 'overproduction' },
    // The two false brakes this factor exists to stop: healthy-band jitter reached streak 4
    // (tips=30 from 26, tips=28 from 24) and braked the miner for 38 seconds each time.
    { name: 'no false brake: streak reached but growth tiny', in: { tips: 30, lagSeconds: 85, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 1, risingStreak: 4, streakStartTips: 26 }, want: 'healthy' },
    { name: 'no false brake: second live case',               in: { tips: 28, lagSeconds: 86, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 2, risingStreak: 4, streakStartTips: 24 }, want: 'healthy' },
    // scale-free: a small-but-real run still qualifies, so the factor is not a hidden cliff
    // J2, before this ran a full cycle: a relative factor is MORE sensitive near zero. 5->12 is
    // 2.4x and would have fired, yet 5-30 IS the healthy band -- the factor alone moved the
    // false-brake window into single digits rather than closing it. Hence the floor.
    { name: 'no false brake: big ratio but tiny absolute',    in: { tips: 12, lagSeconds: 700, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 2, risingStreak: 4, streakStartTips: 5 }, want: 'starved' },
    { name: 'no false brake: healthy jitter 5->8',            in: { tips: 8,  lagSeconds: 0,   isSynced: true,  headerMinusBlock: 0, peerCount: 3, tipsTrend: 1, risingStreak: 4, streakStartTips: 5 }, want: 'healthy' },
    // above the floor AND growing by the factor -> the real thing
    // Inside the measured normal-refill sweep (9 -> 191): must NOT be read as overproduction.
    { name: 'no false brake: normal refill 55->90',           in: { tips: 90,  lagSeconds: 300, isSynced: true,  headerMinusBlock: 0, peerCount: 3, tipsTrend: 8,  risingStreak: 4, streakStartTips: 55 },  want: 'healthy' },
    // Above the floor AND growing by the factor: the real thing, with room before the 248 cliff.
    { name: 'overproduction: above floor and growing',        in: { tips: 200, lagSeconds: 300, isSynced: true,  headerMinusBlock: 0, peerCount: 3, tipsTrend: 15, risingStreak: 4, streakStartTips: 120 }, want: 'overproduction' },
    // debounce must hold: a couple of rising samples is normal jitter, not a verdict
    { name: 'short rising streak stays healthy',    in: { tips: 6, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 1, risingStreak: 2, streakStartTips: 4 }, want: 'healthy' },
    { name: 'starved: lagging, tips falling',       in: { tips: 3,   lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: -5 },  want: 'starved' },
    { name: 'starved: lagging, tips flat',          in: { tips: 3,   lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 0 },   want: 'starved' },
    { name: 'trend-unknown: no prior sample',       in: { tips: 400, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: null },want: 'trend-unknown' },
    // an omitted field is unknown, not flat -- guards against a caller silently getting starved
    { name: 'trend-unknown: field omitted entirely',in: { tips: 400, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 3 },                 want: 'trend-unknown' },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = diagnose(c.in);
    const ok = got === c.want;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  want=${c.want} got=${got}`);
  }
  // --- Codex MUST-FIX 2026-08-10: adversarial STALE PRIOR STATE ---
  // Codex named the exact hole in the first round of fixtures: they only fed diagnose() directly,
  // so nothing exercised the state carried between samples. These construct `prev` explicitly and
  // then run the REAL verdict path (computeContinuity -> diagnose), which is the only way to show
  // that a gap cannot be spent as evidence.
  const T0 = 1_000_000_000_000;      // fixed epoch: Date.now() must not enter a continuity test
  const FRESH = 300;
  const contCases = [
    {
      name: 'stale: 30min gap cannot fabricate a climb (this is the branch that brakes)',
      prev: { ts: T0 - 1800_000, tips: 100, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 7200_000 },
      now: T0, tips: 200, peerCount: 3,
      // Before the fix this yielded streak=4, a 2h span and 2x growth from ONE fresh sample.
      want: (c) => c.risingStreak === null && c.priorIsStale === true,
      why: 'risingStreak must be UNKNOWN after a gap, so diagnose() cannot reach overproduction',
    },
    {
      name: 'stale: 30min gap cannot fabricate continuous detachment',
      prev: { ts: T0 - 1800_000, tips: 5, detachedSince: T0 - 1800_000 },
      now: T0, tips: 5, peerCount: 0,
      // Before the fix: detachedSeconds ~= 1800 -> immediate 'isolated' on two instants 30min apart.
      want: (c) => c.detachedSince === T0,
      why: 'the run must restart at now, giving duration 0, not inherit across an unobserved gap',
    },
    {
      name: 'fresh: a normal 30s gap DOES carry continuity (the guard must not break normal use)',
      prev: { ts: T0 - 30_000, tips: 5, detachedSince: T0 - 120_000, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 200_000 },
      now: T0, tips: 200, peerCount: 0,
      want: (c) => c.priorIsStale === false && c.risingStreak === 4 && c.detachedSince === T0 - 120_000,
      why: 'a guard that also blocks the healthy path would just be removed by the next person',
    },
    {
      name: 'stale: missing prior state is stale by definition, not treated as fresh',
      prev: null, now: T0, tips: 200, peerCount: 0,
      want: (c) => c.priorIsStale === true && c.risingStreak === null && c.detachedSince === T0,
      why: 'no prior observation means nothing to be continuous with; unknown must fail',
    },
    // NWT named this cell explicitly before re-reviewing: a state record that EXISTS but whose
    // `ts` is missing or the wrong type must fall back to UNKNOWN, never default to "fresh".
    // It is the nastier variant of the null-state case, because everything else in the record
    // looks usable -- streak, streakStartTs, detachedSince are all present and inviting.
    {
      name: 'corrupt: prior state exists but ts is missing -> stale, not fresh',
      prev: { tips: 100, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 7200_000, detachedSince: T0 - 1800_000 },
      now: T0, tips: 200, peerCount: 0,
      want: (c) => c.priorIsStale === true && c.risingStreak === null && c.detachedSince === T0,
      why: 'a record with no timestamp cannot establish that anything was continuous',
    },
    {
      name: 'corrupt: ts present but not a number -> stale, not fresh',
      prev: { ts: '2026-08-10T03:00:00Z', tips: 100, risingStreak: 3, streakStartTips: 100, detachedSince: T0 - 1800_000 },
      now: T0, tips: 200, peerCount: 0,
      // A string ts would make (now - prevTs) NaN, and NaN > freshMaxSec is FALSE -- i.e. a
      // corrupt timestamp would have been silently accepted as fresh by a naive comparison.
      // Number.isFinite is what makes unknown fail instead of pass.
      want: (c) => c.priorIsStale === true && c.risingStreak === null && c.detachedSince === T0,
      why: 'NaN comparisons are false, so a naive gap check treats a corrupt ts as fresh',
    },
    // Codex round 2: a prior observation dated in the FUTURE is not fresh, it is impossible.
    // Both ends of the window are now asserted, because round 1 checked neither and round 2
    // checked only the far end.
    {
      name: 'future: prev.ts 1ms ahead of now -> unusable, not fresh',
      prev: { ts: T0 + 1, tips: 150, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 7200_000, detachedSince: T0 - 1800_000 },
      now: T0, tips: 200, peerCount: 0,
      want: (c) => c.priorIsStale === true && c.risingStreak === null && c.detachedSince === T0,
      why: 'negative age is not "recent", and a 1ms skew must fail the same way an hour does',
    },
    {
      name: 'future: prev.ts 1h ahead -> cannot hand over a brake-supporting streak',
      prev: { ts: T0 + 3600_000, tips: 150, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 7200_000 },
      now: T0, tips: 200, peerCount: 3,
      want: (c) => c.priorIsStale === true && c.risingStreak === null,
      why: 'this is the exact counterexample Codex constructed; it feeds the overproduction string',
    },
    {
      name: 'invalid now: non-finite now makes every comparison false -> must fail closed',
      prev: { ts: T0 - 30_000, tips: 150, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 200_000 },
      now: NaN, tips: 200, peerCount: 3,
      want: (c) => c.priorIsStale === true && c.risingStreak === null,
      why: 'without this, a broken clock reads as "nothing is ever stale" and looks like normal operation',
    },
    // 🔴 These two use NaN / Infinity ON PURPOSE, and the first version of this case did not.
    // I originally wrote freshMaxSec: 0, which passes whether or not the config guard exists --
    // with age 30 and ceiling 0, the ordinary `age > ceiling` comparison already says stale. So
    // the case was named for the guard it did not exercise. Deleting `windowOk` left the suite
    // fully green, which is how I found it.
    // NaN and Infinity are the values where the ceiling comparison goes SILENTLY FALSE
    // (`30 > NaN` and `30 > Infinity` are both false) and the record would be inherited as fresh.
    // DAG_PROBE_FRESH_MAX_SEC is an env var, so `Number("abc")` -> NaN is one typo away.
    {
      name: 'invalid window: freshMaxSec=NaN would read as "never stale" without the config guard',
      prev: { ts: T0 - 30_000, tips: 150, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 200_000 },
      now: T0, tips: 200, peerCount: 3, freshMaxSec: NaN,
      want: (c) => c.priorIsStale === true && c.risingStreak === null,
      why: 'age > NaN is false, so a typo in the env var would silently disable staleness entirely',
    },
    {
      name: 'invalid window: freshMaxSec=Infinity likewise cannot mean "everything is fresh"',
      prev: { ts: T0 - 30_000, tips: 150, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 200_000 },
      now: T0, tips: 200, peerCount: 3, freshMaxSec: Infinity,
      want: (c) => c.priorIsStale === true && c.risingStreak === null,
      why: 'an unbounded window is the same failure wearing a plausible-looking number',
    },
    {
      name: 'invalid window: freshMaxSec=0 (guarded by the ceiling too, kept as a boundary case)',
      prev: { ts: T0 - 30_000, tips: 150, risingStreak: 3, streakStartTips: 100, streakStartTs: T0 - 200_000 },
      now: T0, tips: 200, peerCount: 3, freshMaxSec: 0,
      want: (c) => c.priorIsStale === true && c.risingStreak === null,
      why: 'honest label: this one passes via the ceiling as well, it does not prove the config guard',
    },
    {
      name: 'stale prior + high tips still cannot brake (end-to-end through diagnose)',
      prev: { ts: T0 - 3600_000, tips: 100, risingStreak: 9, streakStartTips: 100, streakStartTs: T0 - 7200_000 },
      now: T0, tips: 400, peerCount: 3,
      want: (c) => diagnose({
        tips: 400, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3,
        tipsTrend: c.tipsTrend, risingStreak: c.risingStreak, streakStartTips: c.streakStartTips,
        streakSeconds: null, detachedSeconds: null,
      }) !== 'overproduction',
      why: 'the whole point: stale history must not reach the watchdog brake string',
    },
  ];
  for (const c of contCases) {
    // c.freshMaxSec lets a case exercise unusable config; `??` not `||`, so 0 reaches the code
    // under test instead of being silently replaced by the default -- 0 is the value being tested.
    const got = computeContinuity(c.prev, c.now, { tips: c.tips, peerCount: c.peerCount, freshMaxSec: c.freshMaxSec ?? FRESH });
    const ok = c.want(got);
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  continuity/${c.name}  (${c.why})`);
  }

  // The wiring check runs LAST and counts into the same total, so "ALL n PASS" means both kinds
  // of claim held. Reading our own source is safe here: this file is the deployed artifact.
  // NOT `new URL(import.meta.url)`: this module declares `const URL = <rpc address>` at the top,
  // which SHADOWS the global URL constructor. It fails loudly here ("URL is not a constructor"),
  // but the same shadowing would silently mislead anyone who later reaches for URL in this file.
  const wiring = checkCallSiteParity(fsx.readFileSync(import.meta.filename, 'utf8'));
  for (const p of wiring) { bad++; console.log(`FAIL  call-site parity: ${p}`); }
  if (!wiring.length) console.log('PASS  call-site parity: every diagnose() call site passes the same arguments');
  // Count every assertion actually run (verdict fixtures + continuity fixtures + the wiring
  // check). A total that silently excludes a group reports more coverage than was exercised.
  const total = cases.length + contCases.length + 1;
  console.log(bad === 0 ? `ALL ${total} PASS` : `${bad} FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

try {
  const require = createRequire(REQUIRE_BASE);
  const { mod, via } = loadWasm(require);
  const { RpcClient, Encoding } = mod;
  const rpc = new RpcClient({ url: URL, encoding: Encoding.Borsh, networkId: NETWORK });
  const t = (ms, msg) => new Promise((_, r) => setTimeout(() => r(new Error(msg)), ms));
  await Promise.race([rpc.connect({}), t(8000, 'connect timeout')]);
  const dag = await Promise.race([rpc.getBlockDagInfo(), t(8000, 'rpc timeout')]);
  const si = await Promise.race([rpc.getServerInfo(), t(8000, 'rpc timeout')]);

  // 🔴 peerCount added 2026-08-09 because its ABSENCE caused a real misdiagnosis the same night.
  // Without it this probe reports a frozen DAA/blockCount and nothing else -- and "the network
  // stopped producing" and "I lost my peers and can no longer see new blocks" produce a
  // BYTE-IDENTICAL reading. Bettor read a frozen DAA off this probe across 6+ polls and
  // concluded "chain idle, must restart mining"; it was actually his own node down to 0-2 peers
  // while others read peers=3, synced=true, DAA advancing. His words: "before asserting the
  // network isn't moving, first confirm I'm still attached to the network."
  // A health probe that cannot tell you whether you are still connected is telling you about
  // yourself while sounding like it is telling you about the world.
  let peerCount = null;
  try {
    const pi = await Promise.race([rpc.getConnectedPeerInfo(), t(8000, 'rpc timeout')]);
    const list = pi?.peerInfo ?? pi?.infos ?? pi?.peers ?? [];
    peerCount = Array.isArray(list) ? list.length : null;
  } catch { peerCount = null; }   // null = could not read, NOT zero. Do not collapse them.

  // Lag is measured against an ABSOLUTE anchor (sink block timestamp vs wall clock), not
  // against another node's numbers -- comparing two nodes cannot tell you that BOTH are stuck,
  // which is exactly what happened on 2026-08-07 (identical readings, both dead).
  let sinkTsMs = null;
  const sinkHash = dag?.sink ?? null;
  if (sinkHash) {
    const b = await Promise.race([
      rpc.getBlock({ hash: sinkHash, includeTransactions: false }).catch(() => null),
      t(8000, 'rpc timeout'),
    ]).catch(() => null);
    sinkTsMs = Number(b?.block?.header?.timestamp ?? b?.header?.timestamp ?? 0) || null;
  }
  // 🔵 THE INSTRUMENT THAT CAN ACTUALLY DISCRIMINATE (added 2026-08-09, read-only).
  // J2 spent tonight trying to tell "miner too fast" from "node too slow" using
  // getBlockDagInfo().blockCount vs daaScore, and every sample came back EXACTLY equal
  // (7.0/7.0, 12/12, 40/40). That is not a coincidence and no amount of extra sampling
  // would have broken it -- rusty-kaspa consensus/src/consensus/mod.rs:824 defines
  //     block_count = virtual_score - retention_period_root_score
  // so blockCount IS an affine transform of the DAA score. Its derivative is the DAA
  // derivative, identically. The ruler had ZERO discriminating power BY CONSTRUCTION.
  // Live proof of how far off it is: nodeDatabaseBlocksCount=1,125,718 while the real
  // arrival counter read 3,182 at the same instant.
  // getMetrics exposes two genuinely INDEPENDENT accumulators, one per side:
  //   nodeBlocksSubmittedCount -> blocks arriving  (production side)
  //   nodeBodiesProcessedCount -> bodies validated (digestion side)
  // Cumulative since node start => callers MUST difference them; a single point says nothing.
  // networkVirtualParentHashesCount is the mergeset-width quantity -- i.e. the 248 cliff itself,
  // rather than tips, which is only a proxy for it.
  let blocksSubmitted = null, bodiesProcessed = null, chainBlocks = null, virtualParents = null;
  try {
    const mx = await Promise.race([rpc.getMetrics({
      // All six flags must be present: the wasm binding does not default the missing ones and
      // the call silently yields no consensusMetrics if any are absent. Caught only because the
      // live run came back all-null while a standalone probe with the full set returned data --
      // the selftest was green either way.
      consensusMetrics: true, processMetrics: false, connectionMetrics: false,
      bandwidthMetrics: false, storageMetrics: false, customMetrics: false,
    }), t(8000, 'rpc timeout')]);
    const cm = mx?.consensusMetrics ?? null;
    // Number(): these arrive as BigInt and would poison JSON.stringify. null stays null --
    // an unreadable counter is not a zero counter (the same conflation NWT caught in peerCount).
    const num = (v) => (v === undefined || v === null ? null : Number(v));
    if (cm) {
      blocksSubmitted = num(cm.nodeBlocksSubmittedCount);
      bodiesProcessed = num(cm.nodeBodiesProcessedCount);
      chainBlocks     = num(cm.nodeChainBlocksProcessedCount);
      virtualParents  = num(cm.networkVirtualParentHashesCount);
    }
  } catch { /* older node / method absent -> all stay null, never 0 */ }

  await rpc.disconnect();

  const tips = (dag?.tipHashes ?? []).length;
  // Previous sample, persisted between runs -- the probe is a one-shot process, so the
  // derivative needs somewhere to live. Any read/parse failure yields null (unknown), never 0.
  // 🔴 state 文件必须按【整个 URL】派生, 不是按前缀。原写法是
  //     Buffer.from(URL).toString('hex').slice(0, 12)
  // —— hex 前 12 位只等于 URL 的【前 6 个字节】= "ws://1", 于是 ws://127.0.0.1:17210 与 :17211
  // 撞进同一个文件。实测撞到: 我把远端节点的 RPC 隧道到 17211 采样, 两个节点开始共用状态 ⇒
  // 计数器差分算成 产Δ=4468758(两台累计值相减), 而 tipsTrend/risingStreak 也在互相串 ——
  // **而本机那条曲线正是 overproduction 判据在用的**, 所以这不是"远端那份不准", 是判据被污染。
  // 🔨 判据: 派生 key 时截断的是【编码后的串】而不是内容, "看起来够长"不等于"区分得开"。
  const STATE_PATH = process.env.DAG_PROBE_STATE || pathx.join(osx.tmpdir(),
    `tn12-dag-probe-state-${cryptox.createHash('sha256').update(URL).digest('hex').slice(0, 16)}.json`);
  // 🔴 FRESHNESS CEILING (Codex MUST-FIX, 2026-08-10). Read BEFORE any continuity logic, because
  // BOTH continuity claims in this file read the same persisted record and both were unsound in
  // the same way: elapsed wall-clock between two OBSERVATIONS was being treated as evidence of a
  // CONTINUOUS condition between them. It is not. If the probe does not run for 30 minutes and
  // both the before and after samples happen to show peerCount=0, the code proved "detached at two
  // instants 30 minutes apart" and reported "detached continuously for 1800s".
  // The rising trend had the identical hole and it is the worse one, because the watchdog brakes
  // on `diagnosis == 'overproduction'`: after a long gap a SINGLE fresh observation with higher
  // tips could inherit an old streak and an old streakStartTs, yielding streak>=4, a multi-hour
  // span that trivially clears RISE_MIN_SEC, and >=1.5x growth -- a fabricated "unbroken climb"
  // from one sample. That defect predates this file's wall-clock work; the time anchor did not
  // introduce it, it just made the span large enough to notice.
  // 🔨 A gap does not mean "nothing happened during it" -- it means WE DO NOT KNOW what happened,
  // and unknown must not be spent as evidence for either verdict.
  // Ceiling from MEASURED cadences, not taste: the mining-host watchdog polls every 30s
  // (TN12_POLL_SEC default), my own DAG monitor every 90s. 300s clears the slowest real caller by
  // >3x while cutting the 30-minute counterexample by two orders of magnitude.
  const FRESH_MAX_SEC = Number(process.env.DAG_PROBE_FRESH_MAX_SEC || 300);
  let prevState = null;
  try { prevState = JSON.parse(fsx.readFileSync(STATE_PATH, 'utf8')); } catch { prevState = null; }
  const { priorIsStale, tipsTrend, prevTips, risingStreak, streakStartTips, streakStartTs, detachedSince } =
    computeContinuity(prevState, Date.now(), { tips, peerCount, freshMaxSec: FRESH_MAX_SEC });

  // Per-sample deltas of the two independent counters. THIS is the real progress signal the
  // pulse duty cycle needs (Codex MUST-FIX #1): bodiesDelta > 0 means the node is actually
  // digesting right now. tips alone cannot say that -- a falling tip count and a stalled node
  // mid-reorg look the same from tips.
  let submittedDelta = null, bodiesDelta = null, sampleAgeSec = null;
  try {
    const prev2 = JSON.parse(fsx.readFileSync(STATE_PATH, 'utf8'));
    if (Number.isFinite(prev2?.ts)) sampleAgeSec = Math.max(0, Math.round((Date.now() - prev2.ts) / 1000));
    if (blocksSubmitted !== null && Number.isFinite(prev2?.blocksSubmitted)) submittedDelta = blocksSubmitted - prev2.blocksSubmitted;
    if (bodiesProcessed !== null && Number.isFinite(prev2?.bodiesProcessed)) bodiesDelta = bodiesProcessed - prev2.bodiesProcessed;
  } catch { /* stays null = unknown, which callers must treat as "do not act", not as zero */ }

  try { fsx.writeFileSync(STATE_PATH, JSON.stringify({ tips, ts: Date.now(), risingStreak: risingStreak ?? 0, streakStartTips: streakStartTips ?? tips, streakStartTs: streakStartTs ?? Date.now(), blocksSubmitted, bodiesProcessed, detachedSince })); } catch {}
  // How long the current detachment has lasted:
  //   null -> not detached at all
  //   0    -> detached, but this is the first sample of the run (no duration established yet)
  //   n    -> detached continuously for n seconds
  // Both null and 0 fail the minimum-duration test, which is the point: neither can support a
  // claim that this node has stopped observing the network.
  const detachedSeconds = detachedSince ? Math.max(0, Math.round((Date.now() - detachedSince) / 1000)) : null;
  // Wall-clock span of the current rising run. null when there is no run or no prior sample --
  // and null must NOT be read as 0, or an unknown span would satisfy a minimum-span test.
  const streakSeconds = (streakStartTs && risingStreak) ? Math.max(0, Math.round((Date.now() - streakStartTs) / 1000)) : null;
  const lagSeconds = sinkTsMs ? Math.max(0, Math.round((Date.now() - sinkTsMs) / 1000)) : null;
  const blockCount = Number(dag?.blockCount ?? 0);
  const headerCount = Number(dag?.headerCount ?? 0);
  const isSynced = !!si?.isSynced;

  // 🔴 采样留痕 (2026-08-09): 楔死/爬升相位是【瞬态】的, 而它正是 MUST-FIX #1 唯一缺的数据。
  // 我已经错过两次同一个窗口 —— 第一次手动起采样时它已在排空, 第二次我那行 one-liner 自己有语法
  // 错误、8 次采样全挂而窗口关掉了。**靠人在正确的时刻手快, 不是采集方案。**
  // 探针本来就被 watchdog 和 monitor 每几秒调一次, 让它顺手把每次读数落一行, 下一次爬升就自动留证。
  // 有界: 只保留最近 MAX_LOG 行, 免得无人看管地长成第二个 12GB。
  const LOG_PATH = process.env.DAG_PROBE_LOG || pathx.join(osx.tmpdir(), 'tn12-dag-probe-samples.jsonl');
  const MAX_LOG = Number(process.env.DAG_PROBE_LOG_MAX || 5000);
  const sample = {
    ts: new Date().toISOString(),
    diagnosis: diagnose({ tips, lagSeconds, isSynced, headerMinusBlock: headerCount - blockCount, peerCount, tipsTrend, risingStreak, streakStartTips, streakSeconds, detachedSeconds }),
    tips, virtualParents, submittedDelta, bodiesDelta, chainBlocks,
    risingStreak, streakSeconds, sampleAgeSec, lagSeconds, peerCount, detachedSeconds,
  };
  try {
    const NL = '\n';
    fsx.appendFileSync(LOG_PATH, JSON.stringify(sample) + NL);
    // 便宜的截断: 只在文件明显偏大时才读回重写, 不是每次都做。
    const st = fsx.statSync(LOG_PATH);
    if (st.size > MAX_LOG * 300) {
      const keep = fsx.readFileSync(LOG_PATH, 'utf8').trim().split(NL).slice(-MAX_LOG);
      fsx.writeFileSync(LOG_PATH, keep.join(NL) + NL);
    }
  } catch { /* 留痕失败绝不影响判词输出 —— 这是观测的观测, 不能反过来弄坏被观测的东西 */ }

  out({
    ok: true,
    // 🔴 streakSeconds was MISSING from this call while the sample-log call above had it, so the
    // two call sites of the same function could return DIFFERENT verdicts for one sample -- and
    // this is the load-bearing one: the watchdog parses THIS stdout, not the sample log.
    // Consequence, concretely: diagnose() computes `spanOk = (streakSeconds == null) || (>= 60s)`,
    // and an omitted argument is undefined, and `undefined == null` is true. So the minimum-span
    // guard added for Codex MUST-FIX #2 evaluated to "pass" every single time on the only path
    // that reaches the brake. The fix shipped; the consumer never received it.
    // 🔨 Same shape as the finding I logged on 2026-07-29: after repairing the callee, check that
    // the CALLER actually gets there. A fix verified only at its definition is not deployed.
    // Safe to enable against observed behaviour: the two brakes that have ever fired had
    // risingStreak 22 and 27 at ~20s/sample, i.e. spans far above the 60s floor.
    diagnosis: diagnose({ tips, lagSeconds, isSynced, headerMinusBlock: headerCount - blockCount, peerCount, tipsTrend, risingStreak, streakStartTips, streakSeconds, detachedSeconds }),
    tips,
    // How long detachment has persisted; exported so ISOLATED_MIN_SEC stays data-chosen.
    detachedSeconds,
    // null means UNREADABLE, not zero -- see the note above; conflating them is the bug.
    peerCount,
    tipsTrend,   // null = no prior sample; sign is what matters, not magnitude
    risingStreak, // consecutive rising samples -- exported so RISE_STREAK can be set from data
    streakSeconds, // wall-clock span of that run; the sample count alone is poll-rate dependent
    streakStartTips, // tips where the current rising run began (the factor is measured against this)
    prevTips,
    // --- real instrument (read-only; NOT consumed by diagnose() and NOT by the brake) ---
    blocksSubmitted, bodiesProcessed, chainBlocks, virtualParents,
    submittedDelta, bodiesDelta, sampleAgeSec,
    lagSeconds,
    // header > block means the node is pulling headers ahead of bodies = IBD in progress.
    // A starved node shows lag WITHOUT this gap: it is not even trying.
    headerMinusBlock: headerCount - blockCount,
    isSynced,
    virtualDaaScore: String(dag?.virtualDaaScore ?? ''),
    blockCount: String(blockCount),
    thresholds: { runawayTips: RUNAWAY_TIPS, starvedLagSec: STARVED_LAG_SEC },
    via,
    ts: new Date().toISOString(),
  });
} catch (e) {
  out({ ok: false, probeError: String(e && e.message || e), ts: new Date().toISOString() });
}
