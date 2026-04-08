// HTTP client for the Kasia indexer API (https://indexer.kasia.fyi)
const DEFAULT_INDEXER_URL = 'https://indexer.kasia.fyi';
const DEFAULT_LIMIT = 50;

function hexEncodeString(str) {
  return Buffer.from(str, 'utf-8').toString('hex');
}

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

  async getMessagesBySender(address, alias, limit = DEFAULT_LIMIT, blockTime = 0) {
    return this._fetch('/contextual-messages/by-sender', {
      address,
      alias: hexEncodeString(alias),
      limit: String(limit),
      block_time: String(blockTime),
    });
  }

  async _fetch(path, params) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Indexer API error: ${response.status} ${response.statusText}`);
    return response.json();
  }
}

let indexerInstance = null;

export function getIndexer() {
  if (!indexerInstance) {
    const url = process.env.KASIA_INDEXER_URL || DEFAULT_INDEXER_URL;
    indexerInstance = new KasiaIndexer(url);
  }
  return indexerInstance;
}
