import { verifyIngestRequest } from '../services/ingest-auth.js';
import { registerDiscoveredAddress, getProbeTargets, getDiscoveryStats } from '../data/discovery/discovery.js';
import { processAgentCard } from '../data/discovery/agent-cards.js';
// interaction-records.js 已废弃（v47, 2026-04-06）— 以下函数从 chain_events 直接查询
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
    // Activity profiles from chain_events (v47: interaction_records dropped)
    const profiles = sqlite.prepare(`
      SELECT addr as address,
        MIN(observed_at) as first_active, MAX(observed_at) as last_active,
        COUNT(*) as total,
        SUM(CASE WHEN t IN ('comm','comm_sent','comm_received') THEN 1 ELSE 0 END) as comm,
        SUM(CASE WHEN t='handshake' THEN 1 ELSE 0 END) as handshake,
        SUM(CASE WHEN t='self_stash' THEN 1 ELSE 0 END) as self_stash,
        SUM(CASE WHEN t='text' THEN 1 ELSE 0 END) as legacy,
        SUM(CASE WHEN t='comm_sent' THEN 1 ELSE 0 END) as bcast,
        ROUND((julianday(MAX(observed_at)) - julianday(MIN(observed_at))) * 24, 1) as hours_active
      FROM (
        SELECT from_address as addr, event_type as t, observed_at FROM chain_events WHERE from_address IS NOT NULL
        UNION ALL
        SELECT to_address as addr, event_type as t, observed_at FROM chain_events WHERE to_address IS NOT NULL AND to_address != from_address
      )
      GROUP BY addr ORDER BY total DESC LIMIT ?
    `).all(limit);

    const handshakes = sqlite.prepare(`
      SELECT from_address as from_addr, to_address as to_addr, observed_at, txid as tx_hash
      FROM chain_events WHERE event_type = 'handshake' ORDER BY observed_at
    `).all();

    const stats = sqlite.prepare(`
      SELECT COUNT(*) as total_interactions,
        (SELECT COUNT(*) FROM (
          SELECT from_address AS addr FROM chain_events WHERE from_address IS NOT NULL
          UNION
          SELECT to_address AS addr FROM chain_events WHERE to_address IS NOT NULL
        )) as unique_addresses,
        (SELECT COUNT(*) FROM (
          SELECT DISTINCT
            CASE WHEN from_address < to_address THEN from_address ELSE to_address END AS a,
            CASE WHEN from_address < to_address THEN to_address ELSE from_address END AS b
          FROM chain_events WHERE event_type = 'handshake'
        )) as unique_handshakes,
        MIN(observed_at) as earliest, MAX(observed_at) as latest
      FROM chain_events
    `).get();

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
             (SELECT COUNT(*) FROM chain_events
              WHERE (from_address = rs.peer_address OR to_address = rs.peer_address)
                AND (from_address = rs.local_address OR to_address = rs.local_address)
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
      SELECT COUNT(*) as c FROM chain_events
      WHERE ((from_address LIKE ? AND to_address LIKE ?) OR (from_address LIKE ? AND to_address LIKE ?))
      ${type ? "AND event_type = ?" : ""}
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

    // Deduplicate by txHash (v47: check chain_events instead of interaction_records)
    const dup = sqlite.prepare('SELECT 1 FROM chain_events WHERE txid = ?').get(txHash);
    if (dup) {
      return reply.send({ ok: true, duplicate: true });
    }

    // v47: interaction_records 停写，chain_events 是唯一真相源
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

    // Scout 链上观察 → relation_states（唯一写入路径）
    // accepted 只能在这里写：Scout 观察到本地 Agent 发出的握手 TX = 链上事实
    if (interactionType === 'handshake') {
      try {
        const { observeHandshake, acceptHandshake } = await import('../services/relation-state.js');
        const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
        // addressA = sender, addressB = receiver
        if (localAddrs.includes(addressB)) {
          // 外部地址发给本地 Agent → observed（有人找我）
          observeHandshake(addressB, addressA, txHash, occurredAt || new Date().toISOString());

          // 写入 pending_actions — inbound 握手等待 Relay 接受
          // Guard (2026-04-14): 已握过手 / 关系已 active 则不再入队,
          // 避免 /loop 重复花 0.2 KAS 回一次. 同 ingest-service.js:86.
          try {
            const already = sqlite.prepare(`
              SELECT 1 FROM relation_states
              WHERE local_address = ? AND peer_address = ?
                AND (handshake_observed_at IS NOT NULL
                  OR status IN ('accepted','confirmed','active'))
              LIMIT 1
            `).get(addressB, addressA);
            if (already) {
              console.log(`[discovery] skip handshake_accept enqueue: already active with ${addressA.slice(-12)}`);
            } else {
              const { randomUUID } = await import('crypto');
              const now = new Date().toISOString();
              sqlite.prepare(`
                INSERT OR IGNORE INTO pending_actions
                  (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
                VALUES (?, 'handshake_accept', 'inbound', ?, ?, 'scout', ?, 'pending', ?, ?, ?)
              `).run(
                randomUUID(), addressB, addressA,
                `handshake_accept:${addressB}:${addressA}`,
                txHash || null, now, now,
              );
            }
          } catch (paErr) {
            console.log(`[discovery] pending_actions write failed: ${paErr.message}`);
          }
        }
        if (localAddrs.includes(addressA)) {
          // 本地 Agent 发给外部地址 → accepted（我回复了，链上有 TX 为证）
          acceptHandshake(addressA, addressB);
        }
      } catch (err) {
        console.log(`[discovery] relation_states update failed: ${err.message}`);
      }
    }

    // Event-trigger Minds on significant interactions
    if (interactionType === 'handshake') {
      const { triggerProactiveAll } = await import('../services/mind-manager.js');
      triggerProactiveAll({ newHandshake: { from: addressA, to: addressB, txHash } }).catch(() => {});

      // Scout 发现 inbound 握手 → Console 主动通知 Relay 去回复（不依赖 Relay 独立扫链）
      const localAddrs = sqlite.prepare('SELECT id, address FROM relay_nodes').all();
      const receiver = localAddrs.find(r => r.address === addressB);
      if (receiver) {
        const { sendCommandAsync } = await import('../services/relay-manager.js');
        sendCommandAsync(receiver.id, { type: 'handshake', target: addressA }, 15000).catch(err => {
          console.log(`[discovery] Relay handshake IPC failed for ${addressB.slice(-12)}: ${err?.message || err}`);
        });
      }
    } else if (interactionType === 'comm') {
      // Comm is too frequent to trigger proactive (causes message storms).
      // Agents handle comm via reactive (incoming messages) and timed proactive cycles.
      // Only handshakes and cards trigger event-based proactive.
      if (false) { // disabled — kept for reference
      }
    }

    // v47 leftover: this used to return interaction_records.lastInsertRowid as `id`,
    // but that table is gone. txHash is the natural identifier in chain_events.
    return reply.send({ ok: true, id: txHash, duplicate: false });
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

  // GET /api/discovery/known-addresses — all addresses we "know" (relation_states)
  // Scout uses this to decide which TX to index in kanet_message_index.
  // "Known" = observed or accepted in relation_states (ever had handshake interaction).
  fastify.get('/api/discovery/known-addresses', async (request, reply) => {
    const rows = sqlite.prepare(
      "SELECT DISTINCT peer_address FROM relation_states WHERE status IN ('observed','accepted','confirmed','active') AND length(peer_address) >= 60"
    ).all();
    const localRows = sqlite.prepare(
      "SELECT DISTINCT local_address FROM relation_states WHERE length(local_address) >= 60"
    ).all();
    const addresses = new Set([
      ...rows.map(r => r.peer_address),
      ...localRows.map(r => r.local_address),
    ]);
    return reply.send({ addresses: [...addresses], count: addresses.size });
  });

  // POST /api/discovery/message-index — Scout 写入消息索引
  // Scout 扫链时发现认识的地址有 TX → 写入 kanet_message_index
  fastify.post('/api/discovery/message-index', async (request, reply) => {
    const { entries } = request.body || {};
    if (!Array.isArray(entries) || entries.length === 0) {
      return reply.code(400).send({ error: 'entries required' });
    }

    const insert = sqlite.prepare(`
      INSERT OR IGNORE INTO kanet_message_index
        (id, txid, for_address, from_address, payload_type, payload_hash, block_time, blue_score, indexed_by, reply_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const tx = sqlite.transaction(() => {
      for (const e of entries) {
        const id = `${e.txid}:${e.for_address}`;
        const result = insert.run(
          id, e.txid, e.for_address, e.from_address,
          e.payload_type, e.payload_hash,
          e.block_time, e.blue_score || null,
          e.indexed_by || 'local',
          e.reply_to || null
        );
        if (result.changes > 0) inserted++;
      }
    });
    tx();

    return reply.send({ inserted, total: entries.length });
  });

  // GET /api/discovery/message-index — 查询消息索引（支持过滤）
  fastify.get('/api/discovery/message-index', async (request, reply) => {
    const { type, unprocessed } = request.query;
    let sql = 'SELECT txid, for_address, from_address, payload_type, block_time, indexed_by, processed_at FROM kanet_message_index WHERE 1=1';
    const params = [];
    if (type) { sql += ' AND payload_type = ?'; params.push(type); }
    if (unprocessed === 'true') { sql += ' AND processed_at IS NULL'; }
    sql += ' ORDER BY block_time ASC LIMIT 100';
    const rows = sqlite.prepare(sql).all(...params);
    return reply.send(rows);
  });

  // POST /api/discovery/message-index/:txid/processed — 标记已处理
  fastify.post('/api/discovery/message-index/:txid/processed', async (request, reply) => {
    const now = new Date().toISOString();
    // txid 可能对应多条记录（同一 TX 为多个地址索引），全部标记
    const result = sqlite.prepare(
      'UPDATE kanet_message_index SET processed_at = ? WHERE txid = ? AND processed_at IS NULL'
    ).run(now, request.params.txid);
    return reply.send({ ok: true, updated: result.changes });
  });

  // GET /api/discovery/alias-lookup — 通过 alias 查 relation_states 找 peer 地址
  // comm 消息里的 alias 是发送方握手时携带的，存在 relation_states.their_alias
  fastify.get('/api/discovery/alias-lookup', async (request, reply) => {
    const { alias, localAddress } = request.query;
    if (!alias || !localAddress) return reply.send({ peerAddress: null });
    const row = sqlite.prepare(
      'SELECT peer_address FROM relation_states WHERE their_alias = ? AND local_address = ? LIMIT 1'
    ).get(alias, localAddress);
    return reply.send({ peerAddress: row?.peer_address || null });
  });

  // GET /api/discovery/checkpoint — Scout 读取扫描检查点
  fastify.get('/api/discovery/checkpoint', async (request, reply) => {
    const key = request.query.key || '_global_';
    const row = sqlite.prepare(
      'SELECT * FROM scout_checkpoint WHERE address = ?'
    ).get(key);
    return reply.send(row || { address: key, last_block_time: null, last_blue_score: null });
  });

  // POST /api/discovery/checkpoint — Scout 写入扫描检查点
  fastify.post('/api/discovery/checkpoint', async (request, reply) => {
    const { key = '_global_', last_block_time, last_blue_score } = request.body || {};
    if (!last_block_time) {
      return reply.code(400).send({ error: 'last_block_time required' });
    }
    const now = new Date().toISOString();
    const existing = sqlite.prepare(
      'SELECT id FROM scout_checkpoint WHERE address = ?'
    ).get(key);

    if (existing) {
      sqlite.prepare(
        'UPDATE scout_checkpoint SET last_block_time = ?, last_blue_score = ?, updated_at = ? WHERE address = ?'
      ).run(last_block_time, last_blue_score || null, now, key);
    } else {
      const { randomUUID } = await import('crypto');
      const id = randomUUID();
      sqlite.prepare(
        'INSERT INTO scout_checkpoint (id, address, last_block_time, last_blue_score, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, key, last_block_time, last_blue_score || null, now);
    }

    return reply.send({ ok: true, key, last_block_time });
  });
}
