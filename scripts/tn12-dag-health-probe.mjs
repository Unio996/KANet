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
function diagnose({ tips, lagSeconds, isSynced, headerMinusBlock, peerCount, tipsTrend, risingStreak, streakStartTips }) {
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
  if (risingStreak != null && risingStreak >= RISE_STREAK
      && streakStartTips != null && tips >= streakStartTips * RISE_FACTOR) return 'overproduction';
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
  if (lagging && peerCount == null) return 'peers-unknown';   // == catches undefined too
  if (lagging && peerCount === 0) return 'isolated';
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
    { name: 'peerCount null but not lagging => healthy', in: { tips: 2, lagSeconds: 0, isSynced: true, headerMinusBlock: 0, peerCount: null }, want: 'healthy' },
    // J2's finding: tonight's entire climb (194->499) sat under RUNAWAY_TIPS=500 while lag was
    // already past 600, so it was labelled starved -- remedy "add hashrate" -- when the truth
    // was overproduction and the remedy was the opposite.
    { name: 'overproduction: rising streak reached', in: { tips: 400, lagSeconds: 5000, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 60, risingStreak: 4, streakStartTips: 200 }, want: 'overproduction' },
    // The blind spot this fix exists for: tonight, lag=344 (under the 600 gate) while tips ran
    // 48 -> 106. The old ordering said `healthy` through the whole actionable window.
    { name: 'overproduction: climbing BEFORE lag gate opens', in: { tips: 106, lagSeconds: 344, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 2, risingStreak: 5, streakStartTips: 48 }, want: 'overproduction' },
    // The two false brakes this factor exists to stop: healthy-band jitter reached streak 4
    // (tips=30 from 26, tips=28 from 24) and braked the miner for 38 seconds each time.
    { name: 'no false brake: streak reached but growth tiny', in: { tips: 30, lagSeconds: 85, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 1, risingStreak: 4, streakStartTips: 26 }, want: 'healthy' },
    { name: 'no false brake: second live case',               in: { tips: 28, lagSeconds: 86, isSynced: true, headerMinusBlock: 0, peerCount: 3, tipsTrend: 2, risingStreak: 4, streakStartTips: 24 }, want: 'healthy' },
    // scale-free: a small-but-real run still qualifies, so the factor is not a hidden cliff
    { name: 'overproduction: small scale but real growth',    in: { tips: 12, lagSeconds: 700, isSynced: false, headerMinusBlock: 0, peerCount: 3, tipsTrend: 2, risingStreak: 4, streakStartTips: 5 }, want: 'overproduction' },
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
  await rpc.disconnect();

  const tips = (dag?.tipHashes ?? []).length;
  // Previous sample, persisted between runs -- the probe is a one-shot process, so the
  // derivative needs somewhere to live. Any read/parse failure yields null (unknown), never 0.
  const STATE_PATH = process.env.DAG_PROBE_STATE || pathx.join(osx.tmpdir(), `tn12-dag-probe-state-${Buffer.from(URL).toString('hex').slice(0, 12)}.json`);
  let tipsTrend = null, prevTips = null, risingStreak = null, streakStartTips = null;
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
    }
  } catch { /* no prior sample -> stays null -> reported as trend-unknown, not as flat */ }
  try { fsx.writeFileSync(STATE_PATH, JSON.stringify({ tips, ts: Date.now(), risingStreak: risingStreak ?? 0, streakStartTips: streakStartTips ?? tips })); } catch {}
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
    streakStartTips, // tips where the current rising run began (the factor is measured against this)
    prevTips,
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
