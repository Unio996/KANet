import { verifyIngestRequest } from '../services/ingest-auth.js';
import { registerDiscoveredAddress, getProbeTargets, getDiscoveryStats } from '../data/discovery/discovery.js';
import { processAgentCard } from '../data/discovery/agent-cards.js';
import { recordInteraction, hasInteraction, getActivityProfiles, getHandshakeGraph, getNetworkStats } from '../data/discovery/interaction-records.js';
import { getFunnelMetrics } from '../data/discovery/probe-logs.js';
import { startScanner, stopScanner, getScannerStatus } from '../services/scanner.js';
import { sqlite } from '../db/client.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';

let _commTriggerRecent;

export async function registerDiscoveryRoutes(fastify) {

  // --- UI routes (no auth, local only) ---

  // GET /discovered — Discovered Addresses page
  fastify.get('/discovered', async (request, reply) => {
    const accountId = request.query.account;
    if (!accountId) return reply.redirect('/identities');

    // Look up account name
    const account = sqlite.prepare('SELECT name FROM relay_nodes WHERE id = ?').get(accountId);

    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;

    return reply.view('discovered', {
      accountId,
      accountName: account?.name || '...',
      title: 'Discovered Addresses',
      t, lang, dir, langs
    });
  });

  // GET /explore — unified explore page (new design system)
  fastify.get('/explore', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    return reply.viewAsync('explore', { title: 'Explore', t, lang, dir, langs, _page: 'explore' });
  });

  // GET /network — Kasia Network Activity page
  fastify.get('/network', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    return reply.view('network', { title: 'Kasia Network', t, lang, dir, langs });
  });

  // GET /api/discovery/activity — global Kasia activity profiles (no auth)
  fastify.get('/api/discovery/activity', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 100, 500);
    const profiles = getActivityProfiles(limit);
    const handshakes = getHandshakeGraph();
    const stats = getNetworkStats();

    // Enrich with display names from identities
    const addresses = profiles.map(p => p.address);
    const nameMap = {};
    if (addresses.length > 0) {
      const placeholders = addresses.map(() => '?').join(',');
      const rows = sqlite.prepare(
        `SELECT address, display_name, identity_type, card_mode, card_entity_type, card_skills_json, card_summary, tags
         FROM identities WHERE address IN (${placeholders})`
      ).all(...addresses);
      for (const r of rows) nameMap[r.address] = r;
    }

    const enriched = profiles.map(p => ({
      ...p,
      display_name: nameMap[p.address]?.display_name || null,
      identity_type: nameMap[p.address]?.identity_type || 'unknown',
      card_mode: nameMap[p.address]?.card_mode || null,
      card_entity_type: nameMap[p.address]?.card_entity_type || null,
      card_skills_json: nameMap[p.address]?.card_skills_json || null,
      card_summary: nameMap[p.address]?.card_summary || null,
      tags: nameMap[p.address]?.tags || null,
      freq_per_hour: p.hours_active > 0 ? Math.round(p.total / p.hours_active * 10) / 10 : null,
    }));

    return { profiles: enriched, handshakes, stats };
  });

  // GET /api/discovery/list — discovered addresses for UI (no auth)
  fastify.get('/api/discovery/list', async (request, reply) => {
    const { accountId, status, limit: rawLimit } = request.query;
    if (!accountId) return reply.code(400).send({ error: 'accountId is required' });

    const limit = Math.min(parseInt(rawLimit) || 50, 200);

    // 读 relation_states（v28 统一协议状态层）
    const relayAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(accountId)?.address;
    if (!relayAddr) return reply.code(404).send({ error: 'Account not found' });

    const params = [relayAddr];
    let sql = `
      SELECT rs.status, rs.handshake_observed_at as first_seen_at, rs.updated_at as last_seen_at,
             rs.first_seen_tx,
             (SELECT COUNT(*) FROM interaction_records
              WHERE (address_a = rs.peer_address OR address_b = rs.peer_address)
                AND (address_a = rs.local_address OR address_b = rs.local_address)
             ) as interaction_count,
             i.address, i.identity_type, i.display_name,
             i.card_mode, i.card_entity_type, i.card_skills_json, i.card_summary,
             i.card_timestamp, i.card_has_ext, i.tags,
             /* ── 时间维度（Agent 社交决策核心数据）── */
             conv.last_message_at,
             conv.last_reply_at,
             (SELECT COUNT(*) FROM messages m2
              WHERE m2.conversation_id = conv.id AND m2.direction = 'outbound' AND m2.message_type = 'text'
             ) as my_messages_sent,
             (SELECT COUNT(*) FROM messages m3
              WHERE m3.conversation_id = conv.id AND m3.direction = 'inbound' AND m3.message_type = 'text'
             ) as peer_messages_received,
             (SELECT MAX(m4.created_at) FROM messages m4
              WHERE m4.conversation_id = conv.id AND m4.direction = 'outbound' AND m4.message_type = 'text'
             ) as my_last_sent_at,
             (SELECT MAX(m5.created_at) FROM messages m5
              WHERE m5.conversation_id = conv.id AND m5.direction = 'inbound' AND m5.message_type = 'text'
             ) as peer_last_sent_at
      FROM relation_states rs
      JOIN identities i ON i.address = rs.peer_address
      LEFT JOIN identities i_local ON i_local.address = rs.local_address
      LEFT JOIN conversations conv
        ON conv.local_identity_id = i_local.id
       AND conv.remote_identity_id = i.id
      WHERE rs.local_address = ?
    `;

    if (status) {
      sql += ' AND rs.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY rs.updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = sqlite.prepare(sql).all(...params);
    return reply.send(rows);
  });

  // /api/discovery/* routes require x-ingest-secret (external scout)
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/discovery') && !request.url.startsWith('/api/discovery/scanner') && !request.url.startsWith('/api/discovery/list') && !request.url.startsWith('/api/discovery/activity') && request.method !== 'GET') {
      await verifyIngestRequest(request, reply);
    }
  });

  // --- Scanner control (UI, no auth needed — local only) ---

  // POST /api/discovery/scanner/start — system-level, no account needed
  fastify.post('/api/discovery/scanner/start', async (request, reply) => {
    const result = await startScanner();
    return reply.send(result);
  });

  // POST /api/discovery/scanner/stop
  fastify.post('/api/discovery/scanner/stop', async (request, reply) => {
    const result = await stopScanner();
    return reply.send(result);
  });

  // GET /api/discovery/scanner/status
  fastify.get('/api/discovery/scanner/status', async (request, reply) => {
    const status = getScannerStatus();
    return reply.send({ scanner: status });
  });

  // POST /api/discovery/card — scout reports a detected Agent Card
  fastify.post('/api/discovery/card', async (request, reply) => {
    const { address, txHash, cardData, network, relayNodeId } = request.body || {};
    if (!address || !txHash || !cardData) {
      return reply.code(400).send({ error: 'address, txHash, cardData are required' });
    }

    try {
      const result = processAgentCard({
        network: network || 'mainnet',
        address,
        txHash,
        cardData,
        relayNodeId: relayNodeId || null,
      });

      // New Agent Card → trigger all Minds (event-driven, not polling)
      if (result.isNew || result.updated) {
        const { triggerProactiveAll } = await import('../services/mind-manager.js');
        triggerProactiveAll({ discoveredCard: address, cardData }).catch(() => {});
      }

      return reply.send({ ok: true, ...result });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/discovery/register — scout reports a discovered address
  // Discovery is a shared KANet resource — relayNodeId accepted but ignored.
  fastify.post('/api/discovery/register', async (request, reply) => {
    const { network, address, sourceProtocol, txHash } = request.body || {};
    if (!address) return reply.code(400).send({ error: 'address is required' });

    const result = registerDiscoveredAddress({
      network: network || 'mainnet',
      address,
      sourceProtocol: sourceProtocol || 'kasia',
      txHash: txHash || null,
    });

    // New address discovered → notify all Minds, let them decide
    if (result.isNew) {
      const { triggerProactiveAll } = await import('../services/mind-manager.js');
      triggerProactiveAll({ discoveredAddress: address }).catch(() => {});
    }

    return reply.send({ ok: true, ...result });
  });

  // GET /api/discovery/interaction — check if two addresses have interacted
  fastify.get('/api/discovery/interaction', async (request, reply) => {
    const { addressA, addressB, type } = request.query;
    if (!addressA || !addressB) return reply.code(400).send({ error: 'addressA and addressB required' });

    const row = sqlite.prepare(`
      SELECT COUNT(*) as c FROM interaction_records
      WHERE ((address_a LIKE ? AND address_b LIKE ?) OR (address_a LIKE ? AND address_b LIKE ?))
      ${type ? "AND interaction_type = ?" : ""}
      LIMIT 1
    `).get(
      '%' + addressA.slice(-12), '%' + addressB.slice(-12),
      '%' + addressB.slice(-12), '%' + addressA.slice(-12),
      ...(type ? [type] : [])
    );

    return reply.send({ exists: (row?.c || 0) > 0, count: row?.c || 0 });
  });

  // POST /api/discovery/interaction — scout reports an on-chain interaction
  fastify.post('/api/discovery/interaction', async (request, reply) => {
    const { addressA, addressB, protocol, txHash, interactionType, occurredAt, weight } = request.body || {};
    if (!addressA || !addressB || !txHash) {
      return reply.code(400).send({ error: 'addressA, addressB, txHash are required' });
    }

    // Deduplicate by txHash
    if (hasInteraction(txHash)) {
      return reply.send({ ok: true, duplicate: true });
    }

    const id = recordInteraction({
      addressA,
      addressB,
      protocol: protocol || 'kasia',
      txHash,
      interactionType: interactionType || 'message',
      occurredAt: occurredAt || null,
      weight: weight || 1.0,
    });

    // 链上事实归档（Scout 观测的所有交互）
    if (txHash) {
      try {
        const { recordChainEvent } = await import('../services/chain-event.js');
        recordChainEvent({
          txid: txHash, eventType: interactionType || 'interaction',
          fromAddress: addressA, toAddress: addressB,
          observedBy: 'scout', observedAt: occurredAt || new Date().toISOString(),
        });
      } catch (err) {
        console.log(`[discovery] chain_events write failed: ${err.message}`);
      }
    }

    // 双写：Scout 发现的握手 → relation_states（仅涉及本地 Agent 的）
    if (interactionType === 'handshake') {
      try {
        const { observeHandshake } = await import('../services/relation-state.js');
        const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
        // addressA = sender, addressB = receiver
        if (localAddrs.includes(addressB)) {
          observeHandshake(addressB, addressA, txHash, occurredAt || new Date().toISOString());
        }
        if (localAddrs.includes(addressA)) {
          observeHandshake(addressA, addressB, txHash, occurredAt || new Date().toISOString());
        }
      } catch (err) {
        console.log(`[discovery] relation_states update failed: ${err.message}`);
      }
    }

    // Event-trigger Minds on significant interactions
    if (interactionType === 'handshake') {
      const { triggerProactiveAll } = await import('../services/mind-manager.js');
      triggerProactiveAll({ newHandshake: { from: addressA, to: addressB, txHash } }).catch(() => {});
    } else if (interactionType === 'comm') {
      // Comm is too frequent to trigger proactive (causes message storms).
      // Agents handle comm via reactive (incoming messages) and timed proactive cycles.
      // Only handshakes and cards trigger event-based proactive.
      if (false) { // disabled — kept for reference
      }
    }

    return reply.send({ ok: true, id, duplicate: false });
  });

  // GET /api/discovery/stats — discovery funnel metrics
  fastify.get('/api/discovery/stats', async (request, reply) => {
    const discovery = getDiscoveryStats();
    const probes = getFunnelMetrics();
    return reply.send({ discovery, probes });
  });

  // GET /api/discovery/targets — addresses ready for probing (future use)
  fastify.get('/api/discovery/targets', async (request, reply) => {
    const network = request.query.network || 'mainnet';
    const limit = Math.min(parseInt(request.query.limit) || 20, 100);
    const targets = getProbeTargets({ limit, network });
    return reply.send({ targets, count: targets.length });
  });

  // GET /api/discovery/local-addresses — our own addresses (seed for scout graph expansion)
  fastify.get('/api/discovery/local-addresses', async (request, reply) => {
    const rows = sqlite.prepare(
      "SELECT DISTINCT address FROM identities WHERE identity_type = 'local' AND length(address) >= 60"
    ).all();
    return reply.send({ addresses: rows.map(r => r.address) });
  });
}
