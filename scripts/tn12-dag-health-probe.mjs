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

function diagnose({ tips, lagSeconds, isSynced }) {
  if (tips >= RUNAWAY_TIPS) return 'runaway';           // checked first: it is the dangerous one
  if (lagSeconds !== null && lagSeconds >= STARVED_LAG_SEC) return 'starved';
  if (!isSynced) return 'behind';                        // lagging but under threshold; watch it
  return 'healthy';
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
  const lagSeconds = sinkTsMs ? Math.max(0, Math.round((Date.now() - sinkTsMs) / 1000)) : null;
  const blockCount = Number(dag?.blockCount ?? 0);
  const headerCount = Number(dag?.headerCount ?? 0);
  const isSynced = !!si?.isSynced;

  out({
    ok: true,
    diagnosis: diagnose({ tips, lagSeconds, isSynced }),
    tips,
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
