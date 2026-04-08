/**
 * Chain Fundamentals Collector
 *
 * Periodically queries the local Kaspa RPC node for blockchain fundamentals
 * and reports them to Console via POST /api/chain/snapshot.
 *
 * Data collected:
 *   - getBlockDagInfo → block count, difficulty, DAA score, tips
 *   - getCoinSupply → circulating supply, max supply
 *   - Derived: hashrate from difficulty
 *
 * Runs independently from the protocol scanner on its own timer.
 * Designed to be started alongside the main scanner in index.mjs.
 */

import * as kaspa from 'kaspa-wasm';

const { RpcClient, Resolver } = kaspa;

const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';
const COLLECT_INTERVAL_MS = parseInt(process.env.CHAIN_COLLECT_INTERVAL_MS || '300000'); // 5 min default

// Kaspa block rate: ~1 block/second target
// Hashrate estimation: difficulty * 2 (simplified — Kaspa uses blue-work based difficulty)
const HASHRATE_MULTIPLIER = 2;

let _rpc = null;
let _timer = null;
let _reporter = null;
let _running = false;
let _consecutiveErrors = 0;

/**
 * Start the chain fundamentals collector.
 * @param {object} reporter — Reporter instance with consoleUrl and ingestSecret
 */
export async function startChainFundamentals(reporter) {
  _reporter = reporter;

  // Connect to local RPC node
  try {
    _rpc = new RpcClient({
      resolver: new Resolver(),
      networkId: KASPA_NETWORK,
    });
    await _rpc.connect();
    console.log(`[chain-fundamentals] connected to Kaspa ${KASPA_NETWORK} node`);
  } catch (err) {
    console.error(`[chain-fundamentals] RPC connect failed: ${err.message}`);
    console.log('[chain-fundamentals] will retry on next cycle');
    _rpc = null;
  }

  // Run first collection immediately
  await _collectAndReport();

  // Schedule periodic collection
  _timer = setInterval(() => _collectAndReport(), COLLECT_INTERVAL_MS);
  console.log(`[chain-fundamentals] collecting every ${COLLECT_INTERVAL_MS / 1000}s`);
}

/**
 * Stop the collector.
 */
export function stopChainFundamentals() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_rpc) {
    _rpc.disconnect().catch(() => {});
    _rpc = null;
  }
  console.log('[chain-fundamentals] stopped');
}

/**
 * Single collection cycle: query RPC → report to Console.
 */
async function _collectAndReport() {
  if (_running) return;
  _running = true;

  try {
    // Reconnect if needed
    if (!_rpc) {
      _rpc = new RpcClient({
        resolver: new Resolver(),
        networkId: KASPA_NETWORK,
      });
      await _rpc.connect();
      console.log('[chain-fundamentals] reconnected to RPC');
    }

    // Parallel RPC calls
    const [dagInfo, coinSupply] = await Promise.all([
      _rpc.getBlockDagInfo().catch(e => { console.log(`[chain-fundamentals] getBlockDagInfo: ${e.message}`); return null; }),
      _rpc.getCoinSupply().catch(e => { console.log(`[chain-fundamentals] getCoinSupply: ${e.message}`); return null; }),
    ]);

    if (!dagInfo && !coinSupply) {
      _consecutiveErrors++;
      if (_consecutiveErrors >= 3) {
        console.log('[chain-fundamentals] 3 consecutive failures, reconnecting RPC...');
        _rpc.disconnect().catch(() => {});
        _rpc = null;
        _consecutiveErrors = 0;
      }
      _running = false;
      return;
    }
    _consecutiveErrors = 0;

    // Extract values
    const blockCount = dagInfo?.blockCount ? Number(dagInfo.blockCount) : null;
    const difficulty = dagInfo?.difficulty ? Number(dagInfo.difficulty) : null;
    const daaScore = dagInfo?.virtualDaaScore ? Number(dagInfo.virtualDaaScore) : null;
    const tipsCount = dagInfo?.tipHashes?.length || null;
    const virtualDaaScore = dagInfo?.virtualDaaScore ? Number(dagInfo.virtualDaaScore) : null;
    const pastMedianTime = dagInfo?.pastMedianTime ? Number(dagInfo.pastMedianTime) : null;

    // Derive hashrate from difficulty (simplified estimation)
    const hashrate = difficulty ? difficulty * HASHRATE_MULTIPLIER : null;

    // Coin supply (values in sompi, convert to KAS)
    const SOMPI_PER_KAS = 100_000_000;
    const circulatingSupply = coinSupply?.circulatingSompi
      ? Number(coinSupply.circulatingSompi) / SOMPI_PER_KAS
      : null;
    const maxSupply = coinSupply?.maxSompi
      ? Number(coinSupply.maxSompi) / SOMPI_PER_KAS
      : null;

    // Report to Console
    const snapshot = {
      blockCount,
      difficulty,
      daaScore,
      tipsCount,
      virtualDaaScore,
      pastMedianTime,
      hashrate,
      circulatingSupply,
      maxSupply,
    };

    await _reporter._post('/api/chain/snapshot', snapshot);

    console.log(
      `[chain-fundamentals] snapshot: blocks=${blockCount} diff=${difficulty?.toExponential(2)} ` +
      `hashrate=${hashrate?.toExponential(2)} supply=${circulatingSupply ? (circulatingSupply / 1e9).toFixed(2) + 'B' : '?'} ` +
      `tips=${tipsCount} daa=${daaScore}`
    );

  } catch (err) {
    console.error(`[chain-fundamentals] cycle error: ${err.message}`);
    _consecutiveErrors++;
  }

  _running = false;
}
