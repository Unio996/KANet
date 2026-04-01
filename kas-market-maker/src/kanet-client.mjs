/**
 * kanet-client.mjs — KANet API wrapper
 * Publish quotes, listen for orders, send KAS, check balance.
 */

export class KanetClient {
  constructor(config) {
    this.consoleUrl = config.consoleUrl;
    this.agentAddress = config.agentAddress || '';
    this.relayNodeId = config.relayNodeId || '';
    this.ingestSecret = config.ingestSecret || '';
    this._lastMessageTime = '';
  }

  /** Resolve agent address → relayNodeId on startup */
  async init() {
    if (this.relayNodeId) return;
    if (!this.agentAddress) throw new Error('config.kanet.agentAddress is required');
    const agents = await this._fetch('/api/agent/profile');
    const match = (Array.isArray(agents) ? agents : []).find(a => a.address === this.agentAddress);
    if (!match) throw new Error(`Agent not found for address ${this.agentAddress.slice(-12)}`);
    this.relayNodeId = match.id;
    console.log(`[kanet] Resolved ${this.agentAddress.slice(-12)} → ${match.name} (${match.id.slice(0, 8)})`);
  }

  async _fetch(path, options = {}) {
    const url = `${this.consoleUrl}${path}`;
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`KANet API ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  /** Publish quote to a channel */
  async publishQuote(quoteText, channel = 'kas-market') {
    return this._fetch('/api/chat/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: this.relayNodeId, channel, message: quoteText }),
    });
  }

  /** Get new messages from a channel since last check */
  async pollMessages(channel = 'kas-market', limit = 20) {
    const params = new URLSearchParams({ channel, limit: String(limit) });
    if (this._lastMessageTime) params.set('since', this._lastMessageTime);
    const data = await this._fetch(`/api/chat/messages?${params}`);
    const msgs = data.messages || [];
    if (msgs.length > 0) {
      this._lastMessageTime = msgs[msgs.length - 1].created_at;
    }
    return msgs;
  }

  /** Send KAS to an address via Relay */
  async sendKas(toAddress, amount) {
    return this._fetch(`/api/relay/${this.relayNodeId}/send-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'transfer', target: toAddress, amount: String(amount) }),
    });
  }

  /** Reply to a customer in their channel */
  async replyToCustomer(channel, message) {
    return this._fetch('/api/chat/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: this.relayNodeId, channel, message }),
    });
  }

  /** Get KAS balance */
  async getBalance() {
    const data = await this._fetch(`/api/relay/${this.relayNodeId}/balance`);
    return data.balance || 0;
  }

  /** Get market intelligence from Agent */
  async askAgent(question) {
    return this._fetch('/api/trade/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: this.relayNodeId, question }),
    });
  }
}
