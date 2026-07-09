/**
 * Backfill Scanner — re-scan historical blocks for Kasia activity.
 *
 * Walks the DAG via getBlocks(), detects Kasia protocol prefixes,
 * supplements addresses via getBlock(verbose), logs every hit,
 * and reports to Console.
 *
 * Usage: SCAN_MODE=backfill node src/index.mjs
 * Env:   BACKFILL_START / BACKFILL_END (ISO timestamps)
 */
import * as kaspa from 'kaspa-wasm';
import { classifyPayload, MIN_PAYLOAD_HEX } from './lib/protocol.mjs';
import {
  extractAddresses,
  derivePeers,
  parseCardPayload,
  parseBcastPayload,
} from './rpc-scanner.mjs';

const { RpcClient, Encoding } = kaspa;
const Resolver = kaspa.Resolver || null;

function log(...args) {
  console.log(new Date().toISOString(), '[backfill]', ...args);
}

/**
 * Run the backfill scan.
 * @param {import('./reporter.mjs').Reporter} reporter
 * @param {{ startTime: string, endTime: string, rpcUrl?: string, network?: string }} opts
 */
export async function runBackfill(reporter, opts) {
  const {
    startTime,
    endTime,
    rpcUrl,
    network = 'mainnet',
  } = opts;

  const startTs = new Date(startTime).getTime();
  const endTs   = new Date(endTime).getTime();
  const GRACE   = 5 * 60 * 1000; // 5 min grace for DAG ordering

  log('=== BACKFILL START ===');
  log(`Range: ${new Date(startTs).toISOString()} -> ${new Date(endTs).toISOString()}`);

  // ── Connect ───────────────────────────────────────────────────────────────

  const rpcOpts = rpcUrl
    ? { url: rpcUrl, encoding: Encoding.Borsh, networkId: network }
    : Resolver
      ? { resolver: new Resolver(), encoding: Encoding.Borsh, networkId: network }
      : (() => { throw new Error('No RPC URL configured and Resolver unavailable. Set KASPA_RPC_URL env var.'); })();

  const rpc = new RpcClient(rpcOpts);
  log(`Connecting to ${rpcUrl || 'resolver'}...`);
  await rpc.connect({});

  const dagInfo = await rpc.getBlockDagInfo();
  log(`DAG: daaScore=${dagInfo.virtualDaaScore}, pruning=${dagInfo.pruningPointHash.slice(0, 20)}...`);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const stats = {
    batches: 0,
    blocksTotal: 0,
    blocksSkipped: 0,
    blocksInRange: 0,
    kasiaHits: 0,
    byType: {},
    addrOk: 0,
    addrFail: 0,
    verboseOk: 0,
    verboseFail: 0,
    cardOk: 0,
    cardFail: 0,
    bcastOk: 0,
    bcastFail: 0,
    reportOk: 0,
    reportFail: 0,
  };

  const attempted = new Set();
  let lowHash = dagInfo.pruningPointHash; // start from pruning point
  let reachedEnd = false;

  // ── Walk the DAG ──────────────────────────────────────────────────────────

  while (!reachedEnd) {
    let resp;
    try {
      resp = await rpc.getBlocks({
        lowHash,
        includeBlocks: true,
        includeTransactions: true,
      });
    } catch (err) {
      log(`getBlocks error: ${err.message}`);
      break;
    }
    stats.batches++;

    const hashes = resp.blockHashes || [];
    const blocks = resp.blocks || [];

    if (hashes.length === 0) {
      log('No more blocks from node');
      break;
    }

    let anyInRange = false;
    let pastEndCount = 0;

    for (const block of blocks) {
      stats.blocksTotal++;
      const blockTs = Number(block.header?.timestamp || 0);
      const blockHash = block?.verboseData?.hash || null;

      // Before range — skip
      if (blockTs < startTs - GRACE) {
        stats.blocksSkipped++;
        if (stats.blocksTotal % 50000 === 0) {
          log(`  skipping... ${new Date(blockTs).toISOString()} (${stats.blocksTotal} total)`);
        }
        continue;
      }

      // Past range
      if (blockTs > endTs + GRACE) {
        pastEndCount++;
        if (pastEndCount >= 100) {
          reachedEnd = true;
          break;
        }
        continue;
      }

      anyInRange = true;
      stats.blocksInRange++;

      if (stats.blocksInRange === 1) {
        log(`>> Entered range at ${new Date(blockTs).toISOString()}`);
      }

      if (stats.blocksInRange % 10000 === 0) {
        const types = Object.entries(stats.byType).map(([k, v]) => `${k}=${v}`).join(' ');
        log(`  progress: ${stats.blocksInRange} blocks, ${stats.kasiaHits} kasia [${types}]`);
      }

      // ── Scan txs for Kasia prefix ────────────────────────────────────────

      const txs = block.transactions || block.body?.transactions || [];
      const kasiaHits = [];

      for (const tx of txs) {
        const txId = tx?.verboseData?.transactionId || tx?.id;
        if (!txId || attempted.has(txId)) continue;

        const payloadHex = tx?.payload;
        if (!payloadHex || payloadHex.length < MIN_PAYLOAD_HEX) continue;

        const msgType = classifyPayload(payloadHex);
        if (!msgType) continue;

        attempted.add(txId);
        stats.kasiaHits++;
        stats.byType[msgType] = (stats.byType[msgType] || 0) + 1;
        kasiaHits.push({ tx, txId, msgType, payloadHex });
      }

      if (kasiaHits.length === 0) continue;

      // ── getBlock for verbose addresses ───────────────────────────────────

      let verboseTxMap = null;
      if (blockHash) {
        try {
          const vResp = await rpc.getBlock({ hash: blockHash, includeTransactions: true });
          const vBlock = vResp?.block;
          if (vBlock) {
            verboseTxMap = new Map();
            for (const vtx of (vBlock.transactions || [])) {
              const vid = vtx?.verboseData?.transactionId || vtx?.id;
              if (vid) verboseTxMap.set(vid, vtx);
            }
            stats.verboseOk++;
          } else {
            stats.verboseFail++;
          }
        } catch (err) {
          stats.verboseFail++;
          log(`  VERBOSE-FAIL ${blockHash.slice(0, 16)}...: ${err.message}`);
        }
      }

      // ── Process each Kasia hit ───────────────────────────────────────────

      const discoveries = [];
      const interactions = [];
      const cardReports = [];
      const bcastReports = [];
      const time = new Date(blockTs).toISOString();

      for (const { tx, txId, msgType, payloadHex } of kasiaHits) {
        const effectiveTx = verboseTxMap?.get(txId) || tx;
        const usedVerbose = verboseTxMap?.has(txId) || false;
        const { outputAddresses, inputAddresses, addrSource, failures } =
          extractAddresses(effectiveTx);
        const hasAddr = outputAddresses.length > 0 || inputAddresses.length > 0;

        // ── KANet Agent Card ──
        if (msgType === 'kanet_card') {
          const { card, error, raw } = parseCardPayload(payloadHex);
          // D-010 finding①根修(2026-07-10): sender/publisher 改用 inputAddresses[0](签名者), 见
          // docs/2026-07-10-scout-sender-attribution-input-based-design.md。fail-loud 不回退 output。
          const publisher = inputAddresses[0] || null;
          if (card && publisher) {
            stats.cardOk++;
            cardReports.push({ address: publisher, txHash: txId, cardData: card, network });
            log(`[kanet_card] ${time} tx=${txId.slice(0, 16)}... addr=${publisher} name="${card.name || '(private)'}" mode=${card.mode} skills=[${card.skills?.join(',') || ''}] (${addrSource})`);
          } else {
            stats.cardFail++;
            log(`[kanet_card] FAIL ${time} tx=${txId.slice(0, 16)}... addr=${publisher || 'NONE'} err=${error || 'no-publisher'} verbose=${usedVerbose} failures=[${failures}]${raw ? ` raw="${raw}"` : ''}`);
          }
          continue;
        }

        // ── Broadcast ──
        if (msgType === 'bcast') {
          const { bcast, error, raw } = parseBcastPayload(payloadHex);
          // D-010 finding①根修(2026-07-10): 同上 kanet_card——sender 改 inputAddresses[0], fail-loud。
          const sender = inputAddresses[0] || null;
          if (bcast && sender) {
            stats.bcastOk++;
            bcastReports.push({ channelName: bcast.channelName, senderAddress: sender, content: bcast.message, txHash: txId });
            log(`[bcast] ${time} tx=${txId.slice(0, 16)}... addr=${sender} #${bcast.channelName} "${bcast.message.slice(0, 80)}${bcast.message.length > 80 ? '...' : ''}" (${addrSource})`);
          } else {
            stats.bcastFail++;
            log(`[bcast] FAIL ${time} tx=${txId.slice(0, 16)}... addr=${sender || 'NONE'} err=${error || 'no-sender'} verbose=${usedVerbose} failures=[${failures}]${raw ? ` raw="${raw}"` : ''}`);
          }
          continue;
        }

        // ── Kasia protocol (handshake/comm/payment/self_stash/legacy) ──
        if (!hasAddr) {
          stats.addrFail++;
          log(`[${msgType}] ADDR-FAIL ${time} tx=${txId.slice(0, 16)}... verbose=${usedVerbose} failures=[${failures}] payload(${payloadHex.length})=${payloadHex.slice(0, 80)}...`);
          continue;
        }
        stats.addrOk++;

        const { sender, receiver } = derivePeers(inputAddresses, outputAddresses, msgType);

        if (receiver) {
          log(`[${msgType}] ${time} tx=${txId.slice(0, 16)}... from=${sender} to=${receiver} (${addrSource})`);
        } else {
          log(`[${msgType}] ${time} tx=${txId.slice(0, 16)}... addr=${sender} (self) (${addrSource})`);
        }

        if (sender) {
          discoveries.push({ address: sender, sourceProtocol: 'kasia', txHash: txId, network });
          interactions.push({
            addressA: sender,
            addressB: receiver || sender,
            protocol: 'kasia',
            txHash: txId,
            interactionType: msgType,
            occurredAt: time,
          });
        }
        if (receiver) {
          discoveries.push({ address: receiver, sourceProtocol: 'kasia', txHash: txId, network });
        }
      }

      // ── Report to Console ────────────────────────────────────────────────

      if (discoveries.length > 0 || interactions.length > 0) {
        try {
          const r = await reporter.report(discoveries, interactions);
          stats.reportOk++;
          log(`REPORT disc=${r.registered} interactions=${r.interactions} err=${r.errors}`);
        } catch (err) {
          stats.reportFail++;
          log(`REPORT FAIL: ${err.message}`);
        }
      }

      if (cardReports.length > 0) {
        try {
          const r = await reporter.reportCards(cardReports);
          stats.reportOk++;
          log(`REPORT cards=${r.reported} err=${r.errors}`);
        } catch (err) {
          stats.reportFail++;
          log(`REPORT cards FAIL: ${err.message}`);
        }
      }

      if (bcastReports.length > 0) {
        try {
          const r = await reporter.reportBroadcasts(bcastReports);
          stats.reportOk++;
          log(`REPORT bcast=${r.reported} err=${r.errors}`);
        } catch (err) {
          stats.reportFail++;
          log(`REPORT bcast FAIL: ${err.message}`);
        }
      }
    }

    // ── Pagination ──────────────────────────────────────────────────────────

    // If entire batch was past end, stop
    if (pastEndCount > 0 && !anyInRange) {
      log('Entire batch past end time, stopping');
      reachedEnd = true;
      break;
    }

    const nextHash = hashes[hashes.length - 1];
    if (nextHash === lowHash) {
      log('No pagination progress, stopping');
      break;
    }
    lowHash = nextHash;

    if (stats.batches % 20 === 0) {
      log(`  batch #${stats.batches}: ${stats.blocksTotal} total, ${stats.blocksInRange} in-range, ${stats.kasiaHits} kasia`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const types = Object.entries(stats.byType).map(([k, v]) => `${k}=${v}`).join(' ') || '(none)';
  log('');
  log('=== BACKFILL COMPLETE ===');
  log(`  Blocks: ${stats.blocksTotal} total, ${stats.blocksSkipped} skipped, ${stats.blocksInRange} in range`);
  log(`  Kasia:  ${stats.kasiaHits} hits [${types}]`);
  log(`  Addr:   ok=${stats.addrOk} fail=${stats.addrFail}`);
  log(`  Verbose: ok=${stats.verboseOk} fail=${stats.verboseFail}`);
  log(`  Card:   ok=${stats.cardOk} fail=${stats.cardFail}`);
  log(`  Bcast:  ok=${stats.bcastOk} fail=${stats.bcastFail}`);
  log(`  Report: ok=${stats.reportOk} fail=${stats.reportFail}`);
  log(`  Batches: ${stats.batches}`);

  await rpc.disconnect();
  log('Done');
}
