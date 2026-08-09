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
function diagnose({ tips, lagSeconds, isSynced, headerMinusBlock, peerCount, tipsTrend, risingStreak, streakStartTips, streakSeconds }) {
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
  if (peerCount === 0) return 'isolated';
  if (peerCount == null) return 'peers-unknown';   // == catches undefined; null is not zero
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
    { name: 'isolated: lagging, zero peers', in: { tips: 3, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 0 },    want: 'isolated' },
    // NWT red-team: unreadable peer count must NOT fall through to a lag verdict.
    { name: 'peers-unknown: lagging, peerCount null', in: { tips: 3, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: null }, want: 'peers-unknown' },
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
    { name: 'peers=0 without a climb still reports isolated',              in: { tips: 20,  lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 0,    tipsTrend: 1,  risingStreak: 1, streakStartTips: 19, streakSeconds: 200 }, want: 'isolated' },
    // Codex MUST-FIX #2 -- the same rise, judged by how long it actually took.
    { name: 'rise: 4 samples spanning 20s = poll noise, not a trend', in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 20 },  want: 'starved' },
    { name: 'rise: same 4 samples spanning 200s = real trend',       in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: 200 }, want: 'overproduction' },
    { name: 'rise: unknown span does not disarm the brake',          in: { tips: 200, lagSeconds: 700, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 25, risingStreak: 4, streakStartTips: 100, streakSeconds: null }, want: 'overproduction' },
    { name: 'peers-unknown even when not lagging',      in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: null }, want: 'peers-unknown' },
    { name: 'isolated even when not lagging',           in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: 0 },    want: 'isolated' },
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
  console.log(bad === 0 ? `ALL ${cases.length} PASS` : `${bad} FAILED`);
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
  const STATE_PATH = process.env.DAG_PROBE_STATE || pathx.join(osx.tmpdir(), `tn12-dag-probe-state-${Buffer.from(URL).toString('hex').slice(0, 12)}.json`);
  let tipsTrend = null, prevTips = null, risingStreak = null, streakStartTips = null, streakStartTs = null;
  try {
    const prev = JSON.parse(fsx.readFileSync(STATE_PATH, 'utf8'));
    if (Number.isFinite(prev?.tips)) {
      prevTips = prev.tips;
      tipsTrend = tips - prev.tips;
      const prevStreak = Number.isFinite(prev?.risingStreak) ? prev.risingStreak : 0;
      risingStreak = tipsTrend > 0 ? prevStreak + 1 : 0;
      // Where the current rising run began -- reset whenever the run breaks, so the factor is
      // measured against the run's own start rather than against any fixed baseline.
      streakStartTips = tipsTrend > 0
        ? (Number.isFinite(prev?.streakStartTips) && prevStreak > 0 ? prev.streakStartTips : prevTips)
        : tips;
      // Codex MUST-FIX #2: the streak counted SAMPLES, so "4 consecutive rises" meant a
      // different amount of real time depending on how often the watchdog happened to poll.
      // Speed the poller up and four samples become twenty seconds of noise; slow it down and
      // the same four span ten minutes. A criterion about a TREND has to be anchored in time.
      streakStartTs = tipsTrend > 0
        ? (Number.isFinite(prev?.streakStartTs) && prevStreak > 0 ? prev.streakStartTs : (Number.isFinite(prev?.ts) ? prev.ts : Date.now()))
        : Date.now();
    }
  } catch { /* no prior sample -> stays null -> reported as trend-unknown, not as flat */ }

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

  try { fsx.writeFileSync(STATE_PATH, JSON.stringify({ tips, ts: Date.now(), risingStreak: risingStreak ?? 0, streakStartTips: streakStartTips ?? tips, streakStartTs: streakStartTs ?? Date.now(), blocksSubmitted, bodiesProcessed })); } catch {}
  // Wall-clock span of the current rising run. null when there is no run or no prior sample --
  // and null must NOT be read as 0, or an unknown span would satisfy a minimum-span test.
  const streakSeconds = (streakStartTs && risingStreak) ? Math.max(0, Math.round((Date.now() - streakStartTs) / 1000)) : null;
  const lagSeconds = sinkTsMs ? Math.max(0, Math.round((Date.now() - sinkTsMs) / 1000)) : null;
  const blockCount = Number(dag?.blockCount ?? 0);
  const headerCount = Number(dag?.headerCount ?? 0);
  const isSynced = !!si?.isSynced;

  out({
    ok: true,
    diagnosis: diagnose({ tips, lagSeconds, isSynced, headerMinusBlock: headerCount - blockCount, peerCount, tipsTrend, risingStreak, streakStartTips }),
    tips,
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
