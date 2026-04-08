import { ProtocolDetector } from '../base.mjs';
import { PROTOCOL_NAME, PROTOCOL_VERSION } from './patterns.mjs';
import { getIndexer } from '../../lib/indexer.mjs';

/**
 * KasiaDetector — discovers Kasia protocol activity via the Kasia Indexer API.
 *
 * This detector is used in INDEXER scan mode only.
 * In RPC mode, the rpc-scanner.mjs handles detection directly using
 * lib/protocol.mjs (classifyPayload) — no detector indirection needed.
 *
 * Strategy (indexer mode): seed-address graph expansion
 *   1. Start with known local addresses (from Console relay_nodes)
 *   2. Query indexer for handshakes involving those addresses
 *   3. Discover new addresses from handshake counterparties
 *   4. Add discovered addresses to seed pool for next cycle
 *   5. Record interactions for all handshakes
 *
 * Does NOT decrypt any message content — only identifies protocol activity.
 */
export class KasiaDetector extends ProtocolDetector {
  get name() { return PROTOCOL_NAME; }
  get version() { return PROTOCOL_VERSION; }

  /**
   * Scan for Kasia protocol activity using the Indexer API.
   * @param {object} context — { state, seedAddresses }
   *   state.kasia — { lastScanTime, knownAddresses: string[] }
   *   seedAddresses — initial addresses from Console config
   * @returns {Promise<{ discoveries: Array, interactions: Array }>}
   */
  async scan(context) {
    const { state, seedAddresses = [] } = context;
    const kasiaState = state.kasia || { lastScanTime: 0, knownAddresses: [] };
    const indexer = getIndexer();

    // Merge seed addresses with previously discovered addresses
    const allAddresses = new Set([...seedAddresses, ...kasiaState.knownAddresses]);
    const discoveries = [];
    const interactions = [];
    const newAddresses = new Set();

    for (const address of allAddresses) {
      try {
        // Query handshakes where this address is sender
        const sentHandshakes = await indexer.getHandshakesBySender(
          address, 50, kasiaState.lastScanTime
        );
        this._processHandshakes(sentHandshakes, address, 'sender', allAddresses, discoveries, interactions, newAddresses);

        // Query handshakes where this address is receiver
        const receivedHandshakes = await indexer.getHandshakesByReceiver(
          address, 50, kasiaState.lastScanTime
        );
        this._processHandshakes(receivedHandshakes, address, 'receiver', allAddresses, discoveries, interactions, newAddresses);
      } catch (err) {
        console.error(`[kasia] scan error for ${address.slice(0, 16)}...: ${err.message}`);
      }
    }

    // Update state: merge new addresses, advance scan time
    kasiaState.knownAddresses = [...new Set([...kasiaState.knownAddresses, ...newAddresses])];
    kasiaState.lastScanTime = Math.floor(Date.now() / 1000);
    state.kasia = kasiaState;

    if (discoveries.length > 0 || interactions.length > 0) {
      console.log(`[kasia] scan complete: ${discoveries.length} new addresses, ${interactions.length} interactions`);
    }

    return { discoveries, interactions };
  }

  /**
   * Process handshake results from indexer.
   */
  _processHandshakes(handshakes, queryAddress, role, knownAddresses, discoveries, interactions, newAddresses) {
    if (!Array.isArray(handshakes)) return;

    for (const hs of handshakes) {
      const sender = hs.sender_address || hs.sender;
      const receiver = hs.receiver_address || hs.receiver;
      const txHash = hs.transaction_id || hs.tx_hash || hs.txid;
      const timestamp = hs.block_time || hs.timestamp;

      if (!sender || !receiver || !txHash) continue;

      // Determine the counterparty
      const counterparty = role === 'sender' ? receiver : sender;

      // If counterparty is new, record as discovery
      if (!knownAddresses.has(counterparty)) {
        discoveries.push({
          address: counterparty,
          sourceProtocol: PROTOCOL_NAME,
          txHash,
          network: 'mainnet',
        });
        newAddresses.add(counterparty);
      }

      // Record the interaction
      interactions.push({
        addressA: sender,
        addressB: receiver,
        protocol: PROTOCOL_NAME,
        txHash,
        interactionType: 'handshake',
        occurredAt: timestamp ? new Date(timestamp * 1000).toISOString() : null,
      });
    }
  }
}
