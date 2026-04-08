/**
 * Kasia Indexer API client.
 * Mirrors the interface from kasia-relay but standalone.
 */
const DEFAULT_INDEXER_URL = 'https://indexer.kasia.fyi';
const DEFAULT_LIMIT = 50;

export class KasiaIndexer {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getHandshakesBySender(address, limit = DEFAULT_LIMIT, blockTime = 0) {
    return this._fetch('/handshakes/by-sender', { address, limit: String(limit), block_time: String(blockTime) });
  }

  async getHandshakesByReceiver(address, limit = DEFAULT_LIMIT, blockTime = 0) {
    return this._fetch('/handshakes/by-receiver', { address, limit: String(limit), block_time: String(blockTime) });
  }

  async _fetch(path, params) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Indexer ${path}: ${response.status}`);
    return response.json();
  }
}

let instance = null;

export function getIndexer() {
  if (!instance) {
    instance = new KasiaIndexer(process.env.KASIA_INDEXER_URL || DEFAULT_INDEXER_URL);
  }
  return instance;
}
