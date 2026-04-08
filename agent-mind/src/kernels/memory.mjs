/**
 * Memory Kernel — "What have I experienced?"
 *
 * Maintains short-term events, long-term summaries,
 * and per-peer relationship memory.
 * Refreshes from Console /api/discovery/activity API.
 */

import path from 'node:path';
import { fetchJson, readJsonFile, writeJsonFile } from '../utils.mjs';

const MAX_SHORT_TERM = 50;
const MAX_RELATIONSHIP_NOTES = 20;

export class MemoryKernel {
  constructor(config, mindsDir) {
    this.config = config;
    this.shortTermEvents = [];
    this.relationships = {};   // address -> { firstSeen, lastSeen, interactionCount, notes[] }
    this.summaries = [];
    this.memoryFile = path.join(mindsDir, config.name.toLowerCase(), 'memory.json');
  }

  async init() {
    const saved = await readJsonFile(this.memoryFile);
    if (saved) {
      this.relationships = saved.relationships || {};
      this.summaries = saved.summaries || [];
      this.shortTermEvents = saved.shortTermEvents || [];
      console.log(`[agent-mind:memory] Loaded ${Object.keys(this.relationships).length} relationships, ${this.summaries.length} summaries, ${this.shortTermEvents.length} events`);
    }
  }

  async save() {
    await writeJsonFile(this.memoryFile, {
      relationships: this.relationships,
      summaries: this.summaries,
      shortTermEvents: this.shortTermEvents.slice(-50),
      savedAt: new Date().toISOString(),
    });
  }

  /**
   * Refresh relationship data from Console activity API.
   */
  async refreshFromConsole() {
    try {
      const data = await fetchJson(`${this.config.consoleUrl}/api/discovery/activity?limit=100`);
      if (!data || !Array.isArray(data.profiles)) return;

      const myAddr = this.config.address;

      // Build/update relationships from profiles
      for (const p of data.profiles) {
        if (p.address === myAddr) continue;
        if (!this.relationships[p.address]) {
          this.relationships[p.address] = {
            firstSeen: p.first_active,
            lastSeen: p.last_active,
            interactionCount: p.total,
            notes: [],
          };
        } else {
          this.relationships[p.address].lastSeen = p.last_active;
          this.relationships[p.address].interactionCount = p.total;
        }
      }

      console.log(`[agent-mind:memory] Refreshed ${Object.keys(this.relationships).length} relationships`);
    } catch (err) {
      console.log(`[agent-mind:memory] Console refresh failed: ${err.message}`);
    }
  }

  recordEvent(event) {
    this.shortTermEvents.push({
      id: event.id || `evt-${Date.now()}`,
      type: event.type,
      from: event.from,
      to: event.to,
      timestamp: event.timestamp || new Date().toISOString(),
      summary: event.summary || event.type,
    });
    if (this.shortTermEvents.length > MAX_SHORT_TERM) {
      this.shortTermEvents = this.shortTermEvents.slice(-MAX_SHORT_TERM);
    }
  }

  addRelationshipNote(peerAddress, note) {
    if (!this.relationships[peerAddress]) {
      this.relationships[peerAddress] = {
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        interactionCount: 0,
        notes: [],
      };
    }
    this.relationships[peerAddress].notes.push({
      text: note,
      addedAt: new Date().toISOString(),
    });
    if (this.relationships[peerAddress].notes.length > MAX_RELATIONSHIP_NOTES) {
      this.relationships[peerAddress].notes = this.relationships[peerAddress].notes.slice(-MAX_RELATIONSHIP_NOTES);
    }
  }

  /** Get all known peer addresses. Used by skills. */
  getKnownPeerAddresses() {
    return Object.keys(this.relationships);
  }

  /** Get relationship data for a specific peer. Used by skills. */
  getRelationship(peerAddress) {
    return this.relationships[peerAddress] || null;
  }

  /**
   * Fetch conversation history + peer profile from Console.
   * Returns { peer, chatHistory, recentBroadcasts } or null.
   */
  async fetchPeerContext(peerAddress) {
    if (!peerAddress) return null;
    try {
      const myAddr = encodeURIComponent(this.config.address);
      const peer = encodeURIComponent(peerAddress);
      const data = await fetchJson(
        `${this.config.consoleUrl}/api/agent/peer-context?my_address=${myAddr}&peer_address=${peer}&limit=20`
      );
      return data || null;
    } catch {
      return null;
    }
  }

  async buildMemoryContext(peerAddress) {
    await this.refreshFromConsole();

    // Fetch real conversation history with this peer
    const peerContext = await this.fetchPeerContext(peerAddress);

    const ctx = {
      recentEvents: this.shortTermEvents.slice(-20),
      totalEventsInMemory: this.shortTermEvents.length,
      summaries: this.summaries.slice(-5),
      knownPeers: Object.keys(this.relationships).length,
    };

    if (peerAddress && this.relationships[peerAddress]) {
      ctx.focusedRelationship = {
        address: peerAddress,
        ...this.relationships[peerAddress],
      };
    }

    // Attach conversation history and peer profile
    if (peerContext) {
      ctx.peerProfile = peerContext.peer || null;
      ctx.conversationHistory = peerContext.chatHistory || [];
      ctx.recentBroadcasts = peerContext.recentBroadcasts || [];

      // Interaction stats — derived from chat history
      const history = ctx.conversationHistory;
      const sentCount = history.filter(h => h.dir === 'out').length;
      const receivedCount = history.filter(h => h.dir === 'in').length;
      const lastOut = history.filter(h => h.dir === 'out').pop();

      ctx.peerInteractionStats = {
        sentCount,
        receivedCount,
        handshakeStatus: peerContext.peer?.connectionStatus || peerContext.peer?.trustLevel || 'unknown',
        lastContactTime: lastOut?.ts || null,
      };
    }

    // All relationship notes (for proactive/reflection context)
    const peerNotes = {};
    for (const [addr, rel] of Object.entries(this.relationships)) {
      if (rel.notes?.length > 0) {
        peerNotes[addr] = rel.notes.slice(-3); // last 3 notes per peer
      }
    }
    ctx.peerNotes = peerNotes;

    // Agent balance + economic awareness (parallel fetch)
    try {
      const relayId = encodeURIComponent(this.config.relayNodeId);
      const [balRes, spendingRes, quotaRes] = await Promise.all([
        fetchJson(`${this.config.consoleUrl}/api/relay/${relayId}/balance`).catch(() => null),
        fetchJson(`${this.config.consoleUrl}/api/agent/spending?relay_node_id=${relayId}&days=1`).catch(() => null),
        fetchJson(`${this.config.consoleUrl}/api/trade/quota/${relayId}`).catch(() => null),
      ]);
      ctx.agentBalance = balRes?.balance ?? null;
      ctx.spendingSummary = spendingRes || null;
      ctx.tradingQuota = quotaRes || null;
    } catch {
      ctx.agentBalance = null;
      ctx.spendingSummary = null;
      ctx.tradingQuota = null;
    }

    return ctx;
  }
}
