/**
 * Reporter — sends discoveries and interactions to Console Discovery API.
 * Enforces HTTP-only access (never direct DB), supports retry.
 */

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export class Reporter {
  constructor(consoleUrl, ingestSecret) {
    this.consoleUrl = consoleUrl.replace(/\/$/, '');
    this.ingestSecret = ingestSecret;
  }

  /**
   * Report a batch of discoveries and interactions.
   * @param {Array} discoveries — [{ address, sourceProtocol, txHash, network }]
   * @param {Array} interactions — [{ addressA, addressB, protocol, txHash, interactionType, occurredAt }]
   * @returns {{ registered: number, interactions: number, errors: number }}
   */
  async report(discoveries, interactions) {
    let registered = 0, recorded = 0, errors = 0;

    // Deduplicate discoveries by address within this batch
    const seen = new Set();
    const uniqueDiscoveries = discoveries.filter(d => {
      if (seen.has(d.address)) return false;
      seen.add(d.address);
      return true;
    });

    // Report discoveries
    for (const d of uniqueDiscoveries) {
      try {
        await this._post('/api/discovery/register', d);
        registered++;
      } catch (err) {
        console.error(`[reporter] register ${d.address.slice(0, 16)}...: ${err.message}`);
        errors++;
      }
    }

    // Report interactions
    for (const i of interactions) {
      try {
        const result = await this._post('/api/discovery/interaction', i);
        if (!result.duplicate) recorded++;
      } catch (err) {
        console.error(`[reporter] interaction ${i.txHash?.slice(0, 12)}...: ${err.message}`);
        errors++;
      }
    }

    if (registered > 0 || recorded > 0) {
      console.log(`[reporter] registered: ${registered}, interactions: ${recorded}, errors: ${errors}`);
    }

    return { registered, interactions: recorded, errors };
  }

  /**
   * Report detected Agent Cards to Console.
   * @param {Array} cards — [{ address, txHash, cardData, network, relayNodeId }]
   * @returns {{ reported: number, errors: number }}
   */
  async reportCards(cards) {
    let reported = 0, errors = 0;
    for (const card of cards) {
      try {
        await this._post('/api/discovery/card', card);
        reported++;
      } catch (err) {
        console.error(`[reporter] card ${card.address?.slice(0, 16)}...: ${err.message}`);
        errors++;
      }
    }
    return { reported, errors };
  }

  /**
   * Report detected broadcast messages to Console.
   * @param {Array} broadcasts — [{ channelName, senderAddress, content, txHash }]
   * @returns {{ reported: number, errors: number }}
   */
  async reportBroadcasts(broadcasts) {
    let reported = 0, errors = 0;
    for (const b of broadcasts) {
      try {
        await this._post('/api/chat/ingest', b);
        reported++;
      } catch (err) {
        console.error(`[reporter] bcast #${b.channelName} tx=${b.txHash?.slice(0, 16)}...: ${err.message}`);
        errors++;
      }
    }
    return { reported, errors };
  }

  /**
   * Report Kasia protocol messages (handshake/comm) destined for local addresses.
   * Console deduplicates by traceId — safe to report the same TX multiple times.
   * @param {Array} messages — [{ traceId, network, direction, localAddress, remoteAddress, txid, messageType }]
   * @returns {{ reported: number, duplicates: number, errors: number }}
   */
  async reportMessages(messages) {
    let reported = 0, duplicates = 0, errors = 0;
    for (const m of messages) {
      try {
        const result = await this._post('/ingest/message', m);
        if (result.duplicate) duplicates++;
        else reported++;
      } catch (err) {
        console.error(`[reporter] message ${m.txid?.slice(0, 16)}...: ${err.message}`);
        errors++;
      }
    }
    return { reported, duplicates, errors };
  }

  /**
   * Fetch discovery stats from Console.
   */
  async getStats() {
    return this._get('/api/discovery/stats');
  }

  async _post(path, body) {
    return this._request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': this.ingestSecret,
      },
      body: JSON.stringify(body),
    });
  }

  async _get(path) {
    return this._request(path, {
      method: 'GET',
      headers: { 'x-ingest-secret': this.ingestSecret },
    });
  }

  async _request(path, options, attempt = 1) {
    const url = `${this.consoleUrl}${path}`;
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
      }
      return res.json();
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._request(path, options, attempt + 1);
      }
      throw err;
    }
  }
}
