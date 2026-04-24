// Runs CREATE TABLE IF NOT EXISTS for all tables at startup
// Uses better-sqlite3 directly for reliability
import { sqlite } from './client.js';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'node:fs';
import { encrypt } from '../services/crypto.js';

export function runMigrations() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      display_name TEXT,
      identity_type TEXT NOT NULL DEFAULT 'remote',
      pubkey TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(network, address)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      trace_id TEXT,
      network TEXT NOT NULL,
      channel_type TEXT NOT NULL DEFAULT 'dm',
      channel_id TEXT,
      local_identity_id TEXT NOT NULL REFERENCES identities(id),
      remote_identity_id TEXT REFERENCES identities(id),
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      last_message_at TEXT,
      last_reply_at TEXT,
      last_tx_at TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      conversation_id TEXT REFERENCES conversations(id),
      source_message_id TEXT,
      source_txid TEXT,
      direction TEXT NOT NULL DEFAULT 'inbound',
      sender_identity_id TEXT REFERENCES identities(id),
      receiver_identity_id TEXT REFERENCES identities(id),
      message_type TEXT NOT NULL DEFAULT 'text',
      content_text TEXT NOT NULL DEFAULT '',
      content_json TEXT,
      raw_payload TEXT,
      received_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS replies (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      conversation_id TEXT REFERENCES conversations(id),
      message_id TEXT REFERENCES messages(id),
      reply_type TEXT NOT NULL DEFAULT 'ai',
      provider TEXT NOT NULL DEFAULT 'openclaw',
      model_name TEXT,
      prompt_version TEXT,
      reply_text TEXT NOT NULL DEFAULT '',
      reply_json TEXT,
      intent_captured_json TEXT,
      intent_status TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sent_txid TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tx_records (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      conversation_id TEXT REFERENCES conversations(id),
      message_id TEXT REFERENCES messages(id),
      reply_id TEXT REFERENCES replies(id),
      direction TEXT NOT NULL DEFAULT 'outbound',
      network TEXT NOT NULL,
      txid TEXT NOT NULL UNIQUE,
      amount TEXT,
      fee TEXT,
      confirmations INTEGER,
      status TEXT NOT NULL DEFAULT 'broadcasted',
      raw_tx_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      trace_id TEXT,
      event_scope TEXT NOT NULL DEFAULT 'system',
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      conversation_id TEXT REFERENCES conversations(id),
      message_id TEXT REFERENCES messages(id),
      reply_id TEXT REFERENCES replies(id),
      tx_record_id TEXT REFERENCES tx_records(id),
      summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'general',
      value_encrypted TEXT,
      value_plain_hint TEXT,
      is_sensitive INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      trace_id TEXT,
      conversation_id TEXT REFERENCES conversations(id),
      reply_id TEXT REFERENCES replies(id),
      contract_name TEXT NOT NULL DEFAULT '',
      source_sil TEXT NOT NULL DEFAULT '',
      compiled_output_json TEXT,
      network TEXT NOT NULL DEFAULT 'mainnet',
      status TEXT NOT NULL DEFAULT 'draft',
      txid TEXT,
      error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_trace ON messages(trace_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_replies_trace ON replies(trace_id);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);
    CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
    CREATE INDEX IF NOT EXISTS idx_tx_records_txid ON tx_records(txid);

    CREATE TABLE IF NOT EXISTS adapter_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gateway_ws_url TEXT NOT NULL DEFAULT 'ws://127.0.0.1:18789',
      token_encrypted TEXT,
      token_hint TEXT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      session_key TEXT NOT NULL DEFAULT 'agent:main:main',
      http_port INTEGER NOT NULL DEFAULT 3002,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relay_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mnemonic_encrypted TEXT,
      mnemonic_hint TEXT,
      address TEXT,
      network TEXT NOT NULL DEFAULT 'mainnet',
      adapter_node_id TEXT REFERENCES adapter_nodes(id),
      poll_ms INTEGER NOT NULL DEFAULT 2000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- context query hot path indexes
    CREATE INDEX IF NOT EXISTS idx_conversations_remote_status ON conversations(remote_identity_id, status, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conv_dir_at ON messages(conversation_id, direction, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_replies_conv_status_at ON replies(conversation_id, status, created_at DESC);
  `);

  // v4: skills table
  const hasSkilsTable = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='skills'"
  ).get().cnt > 0;

  if (!hasSkilsTable) {
    sqlite.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL DEFAULT 'builtin',
        action_config_json TEXT,
        min_trust_level TEXT NOT NULL DEFAULT 'owner',
        status TEXT NOT NULL DEFAULT 'disabled',
        source TEXT NOT NULL DEFAULT 'manual',
        invoke_count INTEGER NOT NULL DEFAULT 0,
        last_invoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Seed builtin skills
    const now = new Date().toISOString();
    const seed = sqlite.prepare(`
      INSERT INTO skills (id, name, display_name, description, action_type, min_trust_level, status, source, invoke_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'builtin', ?, 'active', 'builtin', 0, ?, ?)
    `);
    seed.run(randomUUID(), 'annotate', 'Annotate Peer',
      'Add tags, notes, or change trust level for a peer identity.',
      'normal', now, now);
    seed.run(randomUUID(), 'block', 'Block Peer',
      'Block a peer — sets trust level to blocked and stops all interaction.',
      'recommended', now, now);
    seed.run(randomUUID(), 'unblock', 'Unblock Peer',
      'Unblock a previously blocked peer — restores trust level to normal.',
      'owner', now, now);
    console.log('[migrate] Skills table created with 3 builtin skills.');
  }

  // v2: address book columns on identities
  const cols = sqlite.pragma('table_info(identities)').map(c => c.name);
  if (!cols.includes('notes')) {
    sqlite.exec(`ALTER TABLE identities ADD COLUMN notes TEXT DEFAULT ''`);
  }
  if (!cols.includes('is_blocked')) {
    sqlite.exec(`ALTER TABLE identities ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('tags')) {
    sqlite.exec(`ALTER TABLE identities ADD COLUMN tags TEXT DEFAULT ''`);
  }

  // v3: trust_level on identities (owner/recommended/normal/blocked)
  if (!cols.includes('trust_level')) {
    sqlite.exec(`ALTER TABLE identities ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'normal'`);
    // Migrate is_blocked → trust_level
    sqlite.exec(`UPDATE identities SET trust_level = 'blocked' WHERE is_blocked = 1`);
  }
  // v5: skills belong to relay_node (account), not global
  const skillCols = sqlite.pragma('table_info(skills)').map(c => c.name);
  if (!skillCols.includes('relay_node_id')) {
    sqlite.exec(`ALTER TABLE skills ADD COLUMN relay_node_id TEXT REFERENCES relay_nodes(id)`);
    // Recreate table to replace UNIQUE(name) with UNIQUE(relay_node_id, name)
    // SQLite can't drop constraints, so we rebuild
    sqlite.exec(`
      CREATE TABLE skills_new (
        id TEXT PRIMARY KEY,
        relay_node_id TEXT REFERENCES relay_nodes(id),
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL DEFAULT 'builtin',
        action_config_json TEXT,
        min_trust_level TEXT NOT NULL DEFAULT 'owner',
        status TEXT NOT NULL DEFAULT 'disabled',
        source TEXT NOT NULL DEFAULT 'manual',
        invoke_count INTEGER NOT NULL DEFAULT 0,
        last_invoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(relay_node_id, name)
      );
      INSERT INTO skills_new SELECT id, relay_node_id, name, display_name, description,
        action_type, action_config_json, min_trust_level, status, source,
        invoke_count, last_invoked_at, created_at, updated_at FROM skills;
      DROP TABLE skills;
      ALTER TABLE skills_new RENAME TO skills;
    `);
    console.log('[migrate] Skills table upgraded: relay_node_id added, unique(relay_node_id, name).');
  }

  // v6: side_effect_level on skills
  const skillCols6 = sqlite.pragma('table_info(skills)').map(c => c.name);
  if (!skillCols6.includes('side_effect_level')) {
    sqlite.exec(`ALTER TABLE skills ADD COLUMN side_effect_level TEXT NOT NULL DEFAULT 'metadata_write'`);
    sqlite.exec(`UPDATE skills SET side_effect_level = 'metadata_write' WHERE name = 'annotate'`);
    sqlite.exec(`UPDATE skills SET side_effect_level = 'relationship_change' WHERE name = 'block'`);
    sqlite.exec(`UPDATE skills SET side_effect_level = 'relationship_change' WHERE name = 'unblock'`);
    console.log('[migrate] v6: side_effect_level added to skills.');
  }

  // v7: introduce skill
  const hasIntroduce = sqlite.prepare("SELECT count(*) as cnt FROM skills WHERE name = 'introduce'").get().cnt > 0;
  if (!hasIntroduce) {
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO skills (id, name, display_name, description, action_type, min_trust_level, status, source, side_effect_level, invoke_count, created_at, updated_at)
      VALUES (?, 'introduce', 'Introduce Peer', 'Register a target address into KANet identity graph with a referral reason, for discovery and collaboration.', 'builtin', 'recommended', 'active', 'builtin', 'relationship_change', 0, ?, ?)
    `).run(randomUUID(), now, now);
    console.log('[migrate] v7: introduce skill seeded.');
  }

  // v8: rename trust level 'trusted' → 'recommended'
  const hasTrusted = sqlite.prepare("SELECT count(*) as cnt FROM identities WHERE trust_level = 'trusted'").get().cnt;
  const hasTrustedSkills = sqlite.prepare("SELECT count(*) as cnt FROM skills WHERE min_trust_level = 'trusted'").get().cnt;
  if (hasTrusted > 0 || hasTrustedSkills > 0) {
    sqlite.exec(`UPDATE identities SET trust_level = 'recommended' WHERE trust_level = 'trusted'`);
    sqlite.exec(`UPDATE skills SET min_trust_level = 'recommended' WHERE min_trust_level = 'trusted'`);
    console.log(`[migrate] v8: renamed trust level trusted → recommended (${hasTrusted} identities, ${hasTrustedSkills} skills).`);
  }

  // v9: discovery engine — extend identities + new tables
  const idCols = sqlite.pragma('table_info(identities)').map(c => c.name);
  if (!idCols.includes('discovery_status')) {
    // Extend identities with discovery fields
    sqlite.exec(`ALTER TABLE identities ADD COLUMN discovery_status TEXT NOT NULL DEFAULT 'connected'`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN discovered_at TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN last_seen_at TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN last_probed_at TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN last_replied_at TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN interaction_count INTEGER NOT NULL DEFAULT 0`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN probe_attempt_count INTEGER NOT NULL DEFAULT 0`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN successful_contact_count INTEGER NOT NULL DEFAULT 0`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN source_protocol TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN first_seen_tx TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN last_seen_tx TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN confidence_score REAL NOT NULL DEFAULT 0`);

    // Migrate identity_type: 'remote' → 'unknown' for discovery semantics
    // Existing contacts with conversations keep 'human' as best guess
    sqlite.exec(`UPDATE identities SET identity_type = 'human' WHERE identity_type = 'remote'`);
    // Local stays local, already-existing have discovery_status='connected'

    console.log('[migrate] v9: identities extended with discovery fields.');
  }

  // interaction_records — on-chain interaction tracking
  const hasInteractions = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='interaction_records'"
  ).get().cnt > 0;
  if (!hasInteractions) {
    sqlite.exec(`
      CREATE TABLE interaction_records (
        id TEXT PRIMARY KEY,
        address_a TEXT NOT NULL,
        address_b TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'kasia',
        tx_hash TEXT NOT NULL,
        interaction_type TEXT NOT NULL DEFAULT 'message',
        occurred_at TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_interactions_a ON interaction_records(address_a);
      CREATE INDEX idx_interactions_b ON interaction_records(address_b);
      CREATE INDEX idx_interactions_tx ON interaction_records(tx_hash);
    `);
    console.log('[migrate] v9: interaction_records table created.');
  }

  // probe_logs — probe attempt tracking
  const hasProbes = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='probe_logs'"
  ).get().cnt > 0;
  if (!hasProbes) {
    sqlite.exec(`
      CREATE TABLE probe_logs (
        id TEXT PRIMARY KEY,
        target_address TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        probe_type TEXT NOT NULL DEFAULT 'generic_probe',
        message_template TEXT,
        response_received INTEGER NOT NULL DEFAULT 0,
        response_at TEXT,
        response_classification TEXT,
        result TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_probes_target ON probe_logs(target_address);
      CREATE INDEX idx_probes_result ON probe_logs(result);
    `);
    console.log('[migrate] v9: probe_logs table created.');
  }

  // v10: account_relations — per-account relationship tracking
  const hasAccountRelations = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='account_relations'"
  ).get().cnt > 0;

  if (!hasAccountRelations) {
    sqlite.exec(`
      CREATE TABLE account_relations (
        id                    TEXT PRIMARY KEY,
        relay_node_id         TEXT NOT NULL REFERENCES relay_nodes(id),
        local_identity_id     TEXT NOT NULL REFERENCES identities(id),
        remote_identity_id    TEXT NOT NULL REFERENCES identities(id),
        status                TEXT NOT NULL DEFAULT 'discovered',
        trust_level           TEXT NOT NULL DEFAULT 'normal',
        is_blocked            INTEGER NOT NULL DEFAULT 0,
        source                TEXT NOT NULL DEFAULT 'scout',
        first_seen_at         TEXT,
        last_seen_at          TEXT,
        last_interaction_at   TEXT,
        interaction_count     INTEGER NOT NULL DEFAULT 0,
        notes                 TEXT DEFAULT '',
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        UNIQUE(relay_node_id, remote_identity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ar_account ON account_relations(relay_node_id);
      CREATE INDEX IF NOT EXISTS idx_ar_remote ON account_relations(remote_identity_id);
      CREATE INDEX IF NOT EXISTS idx_ar_status ON account_relations(relay_node_id, status);
    `);

    // Migrate existing data from conversations → account_relations
    const now = new Date().toISOString();
    const convos = sqlite.prepare(`
      SELECT c.id as conv_id, c.local_identity_id, c.remote_identity_id,
        li.address as local_address,
        ri.trust_level as remote_trust_level, ri.is_blocked as remote_is_blocked, ri.notes as remote_notes,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count
      FROM conversations c
      JOIN identities li ON li.id = c.local_identity_id
      JOIN identities ri ON ri.id = c.remote_identity_id
      WHERE c.remote_identity_id IS NOT NULL
    `).all();

    const insertAR = sqlite.prepare(`
      INSERT OR IGNORE INTO account_relations
        (id, relay_node_id, local_identity_id, remote_identity_id, status, trust_level, is_blocked,
         source, first_seen_at, last_seen_at, interaction_count, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'conversation', ?, ?, ?, ?, ?, ?)
    `);

    let migratedConv = 0;
    for (const c of convos) {
      // Find relay_node via local_identity address
      const rn = sqlite.prepare(
        'SELECT id FROM relay_nodes WHERE address = ?'
      ).get(c.local_address);
      if (!rn) continue;

      const status = c.msg_count > 0 ? 'active' : 'handshake_done';
      insertAR.run(
        randomUUID(), rn.id, c.local_identity_id, c.remote_identity_id,
        status, c.remote_trust_level || 'normal', c.remote_is_blocked || 0,
        now, now, c.msg_count, c.remote_notes || '', now, now
      );
      migratedConv++;
    }

    // Migrate Scout-discovered identities without conversations
    const firstRelay = sqlite.prepare('SELECT id FROM relay_nodes LIMIT 1').get();
    if (firstRelay) {
      const discovered = sqlite.prepare(`
        SELECT i.id, i.trust_level, i.is_blocked, i.notes, i.discovered_at, i.last_seen_at
        FROM identities i
        WHERE i.identity_type != 'local'
          AND i.discovery_status IN ('discovered', 'probing', 'identified', 'inactive')
          AND i.id NOT IN (SELECT remote_identity_id FROM account_relations)
      `).all();

      // Find a local identity for this relay node
      const localId = sqlite.prepare(
        "SELECT i.id FROM identities i JOIN relay_nodes rn ON rn.address = i.address WHERE rn.id = ? AND i.identity_type = 'local' LIMIT 1"
      ).get(firstRelay.id);

      if (localId) {
        for (const d of discovered) {
          insertAR.run(
            randomUUID(), firstRelay.id, localId.id, d.id,
            'discovered', d.trust_level || 'normal', d.is_blocked || 0,
            d.discovered_at || now, d.last_seen_at || now, 0, d.notes || '', now, now
          );
        }
        if (discovered.length > 0) {
          console.log(`[migrate] v10: migrated ${discovered.length} scout-discovered identities to account_relations.`);
        }
      }
    }

    console.log(`[migrate] v10: account_relations table created, migrated ${migratedConv} conversations.`);
  }

  // v11: adapter_nodes — AI provider abstraction
  const hasProviderCol = sqlite.prepare(`PRAGMA table_info(adapter_nodes)`).all().some(c => c.name === 'ai_provider');
  if (!hasProviderCol) {
    sqlite.exec(`ALTER TABLE adapter_nodes ADD COLUMN ai_provider TEXT NOT NULL DEFAULT 'openclaw'`);
    sqlite.exec(`ALTER TABLE adapter_nodes ADD COLUMN ai_provider_url TEXT`);
    sqlite.exec(`ALTER TABLE adapter_nodes ADD COLUMN ai_provider_key_encrypted TEXT`);
    sqlite.exec(`ALTER TABLE adapter_nodes ADD COLUMN ai_provider_key_hint TEXT`);
    sqlite.exec(`ALTER TABLE adapter_nodes ADD COLUMN ai_model TEXT`);
    console.log('[migrate] v11: adapter_nodes provider columns added.');
  }

  // v12: broadcast_messages table
  const hasBcastTable = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='broadcast_messages'"
  ).get().cnt > 0;
  if (!hasBcastTable) {
    sqlite.exec(`
      CREATE TABLE broadcast_messages (
        id TEXT PRIMARY KEY,
        channel_name TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        content TEXT NOT NULL,
        tx_hash TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_bcast_channel ON broadcast_messages(channel_name, created_at DESC);
      CREATE INDEX idx_bcast_tx ON broadcast_messages(tx_hash);
    `);
    console.log('[migrate] v12: broadcast_messages table created.');
  }

  // v12b: Agent Card fields on identities
  const idCols12 = sqlite.pragma('table_info(identities)').map(c => c.name);
  if (!idCols12.includes('card_version')) {
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_version INTEGER`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_mode TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_root_tx TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_parent_tx TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_latest_tx TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_entity_type TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_skills_json TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_summary TEXT`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_timestamp INTEGER`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_has_ext INTEGER NOT NULL DEFAULT 0`);
    sqlite.exec(`ALTER TABLE identities ADD COLUMN card_raw_json TEXT`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_identities_card_root ON identities(card_root_tx)`);
    console.log('[migrate] v12: Agent Card columns added to identities.');
  }

  // v13: account_relations status simplification — three-state handshake model
  // Old statuses: discovered, handshake_sent, handshake_done, active, connected
  // New statuses: incoming, outgoing, connected
  const arSampleStatus = sqlite.prepare(
    "SELECT status FROM account_relations WHERE status IN ('discovered', 'handshake_sent', 'handshake_done', 'active') LIMIT 1"
  ).get();

  if (arSampleStatus) {
    // 'active' and 'handshake_done' had real interaction → treat as connected
    sqlite.prepare(
      "UPDATE account_relations SET status = 'connected' WHERE status IN ('active', 'handshake_done', 'connected')"
    ).run();
    // 'handshake_sent' → outgoing (we sent, they didn't reply)
    sqlite.prepare(
      "UPDATE account_relations SET status = 'outgoing' WHERE status = 'handshake_sent'"
    ).run();
    // 'discovered' → remove (Scout discoveries no longer belong in account_relations)
    sqlite.prepare(
      "DELETE FROM account_relations WHERE status = 'discovered'"
    ).run();
    console.log('[migrate] v13: account_relations status migrated to three-state model (connected/incoming/outgoing).');
  }

  // ── v14: Mind config columns on relay_nodes ──
  const relayCols14 = sqlite.pragma('table_info(relay_nodes)').map(c => c.name);
  if (!relayCols14.includes('vision')) {
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN vision TEXT");
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN principles_json TEXT");
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN style TEXT");
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN evolution_interval_hours INTEGER DEFAULT 24");
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN proactive_interval_minutes INTEGER DEFAULT 60");

    // Seed from existing config.json files
    const relays14 = sqlite.prepare('SELECT id, name FROM relay_nodes').all();
    for (const r of relays14) {
      const agentName = (r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
      const configPath = `${KANET_ROOT}/agent-mind/minds/${agentName}/config.json`;
      try {
        if (existsSync(configPath)) {
          const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
          sqlite.prepare(`
            UPDATE relay_nodes SET vision=?, principles_json=?, style=?,
              evolution_interval_hours=?, proactive_interval_minutes=?
            WHERE id = ?
          `).run(
            cfg.vision || null,
            cfg.principles ? JSON.stringify(cfg.principles) : null,
            cfg.style || null,
            cfg.evolutionIntervalHours || 24,
            cfg.proactiveIntervalMinutes || 60,
            r.id
          );
          console.log(`[migrate] v14: Seeded ${r.name} config from file`);
        }
      } catch (e) {
        console.log(`[migrate] v14: Could not seed ${r.name}: ${e.message}`);
      }
    }
    console.log('[migrate] v14: Mind config columns on relay_nodes + seeded from files.');
  }

  // ── v15: Trading config on relay_nodes ──
  const relayCols15 = sqlite.pragma('table_info(relay_nodes)').map(c => c.name);
  if (!relayCols15.includes('trading_config_json')) {
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN trading_config_json TEXT");
    console.log('[migrate] v15: trading_config_json column added to relay_nodes.');
  }

  // ── v16: chain_snapshots — Kaspa blockchain fundamentals ──
  const hasChainSnapshots = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='chain_snapshots'"
  ).get().cnt > 0;
  if (!hasChainSnapshots) {
    sqlite.exec(`
      CREATE TABLE chain_snapshots (
        id TEXT PRIMARY KEY,
        block_count INTEGER,
        difficulty REAL,
        daa_score INTEGER,
        tips_count INTEGER,
        virtual_daa_score INTEGER,
        past_median_time INTEGER,
        hashrate REAL,
        circulating_supply REAL,
        max_supply REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_chain_snapshots_time ON chain_snapshots(created_at DESC);
    `);
    console.log('[migrate] v16: chain_snapshots table created.');
  }

  // ── v17: address_balances — whale + exchange balance tracking ──
  const hasAddrBalances = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='address_balances'"
  ).get().cnt > 0;
  if (!hasAddrBalances) {
    sqlite.exec(`
      CREATE TABLE address_balances (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        balance_sompi INTEGER NOT NULL,
        balance_kas REAL NOT NULL,
        address_tag TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_addr_bal_address ON address_balances(address, created_at DESC);
      CREATE INDEX idx_addr_bal_time ON address_balances(created_at DESC);
      CREATE INDEX idx_addr_bal_tag ON address_balances(address_tag);
    `);
    console.log('[migrate] v17: address_balances table created (whale + exchange tracking).');
  }

  // ── v17b: whale_watchlist — configurable address tracking list ──
  const hasWatchlist = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='whale_watchlist'"
  ).get().cnt > 0;
  if (!hasWatchlist) {
    sqlite.exec(`
      CREATE TABLE whale_watchlist (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        tag TEXT NOT NULL DEFAULT 'whale',
        label TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);

    // Seed: add our own agent addresses as tracked (for testing)
    const now = new Date().toISOString();
    const agents = sqlite.prepare('SELECT address, name FROM relay_nodes WHERE address IS NOT NULL').all();
    const insert = sqlite.prepare('INSERT OR IGNORE INTO whale_watchlist (id, address, tag, label, source, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of agents) {
      insert.run(randomUUID(), a.address, 'agent', a.name, 'auto', now);
    }

    console.log(`[migrate] v17b: whale_watchlist table created, seeded ${agents.length} agent addresses.`);
  }

  // ── v18: exchange_accounts — multi-exchange API key management ──
  const hasExchangeAccounts = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='exchange_accounts'"
  ).get().cnt > 0;

  if (!hasExchangeAccounts) {
    sqlite.exec(`
      CREATE TABLE exchange_accounts (
        id TEXT PRIMARY KEY,
        exchange TEXT NOT NULL,
        label TEXT,
        api_key_encrypted TEXT,
        api_key_hint TEXT,
        api_secret_encrypted TEXT,
        api_secret_hint TEXT,
        extra_encrypted TEXT,
        extra_hint TEXT,
        base_url TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    // Auto-migrate from env vars (one-time)
    const envKey = process.env.TRADE_API_KEY;
    const envSecret = process.env.TRADE_API_SECRET;
    if (envKey && envSecret) {
      try {
        const exchange = (process.env.TRADE_EXCHANGE || 'mexc').toLowerCase();
        const now = new Date().toISOString();
        const keyHint = envKey.length <= 8 ? '****' : envKey.slice(0, 4) + '****' + envKey.slice(-4);
        const secretHint = envSecret.length <= 8 ? '****' : envSecret.slice(0, 4) + '****' + envSecret.slice(-4);
        sqlite.prepare(`
          INSERT INTO exchange_accounts (id, exchange, label, api_key_encrypted, api_key_hint, api_secret_encrypted, api_secret_hint, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(randomUUID(), exchange, 'Migrated from env', encrypt(envKey), keyHint, encrypt(envSecret), secretHint, now, now);
        console.log(`[migrate] v18: migrated TRADE_API_KEY (${exchange}) from env to DB.`);
      } catch (e) {
        console.log(`[migrate] v18: env migration skipped: ${e.message}`);
      }
    }

    console.log('[migrate] v18: exchange_accounts table created.');
  }

  // ── v19: trade_executions — order execution log (survives page refresh) ──
  const hasTradeExec = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='trade_executions'"
  ).get().cnt > 0;

  if (!hasTradeExec) {
    sqlite.exec(`
      CREATE TABLE trade_executions (
        id TEXT PRIMARY KEY,
        side TEXT NOT NULL,
        symbol TEXT NOT NULL DEFAULT 'KASUSDT',
        total_qty REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        mode TEXT NOT NULL DEFAULT 'DRY-RUN',
        params_json TEXT,
        plan_json TEXT,
        results_json TEXT,
        summary_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );
      CREATE INDEX idx_trade_exec_status ON trade_executions(status);
      CREATE INDEX idx_trade_exec_time ON trade_executions(started_at DESC);
    `);
    console.log('[migrate] v19: trade_executions table created.');
  }

  // ── v20: trade_log — every single order, attributed to agent ──
  const hasTradeLog = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='trade_log'"
  ).get().cnt > 0;

  if (!hasTradeLog) {
    sqlite.exec(`
      CREATE TABLE trade_log (
        id TEXT PRIMARY KEY,
        relay_node_id TEXT,
        agent_name TEXT,
        source TEXT NOT NULL DEFAULT 'owner',
        side TEXT NOT NULL,
        symbol TEXT NOT NULL DEFAULT 'KASUSDT',
        qty REAL NOT NULL,
        price REAL NOT NULL,
        cost_usdt REAL NOT NULL,
        order_id TEXT,
        status TEXT NOT NULL DEFAULT 'placed',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_trade_log_agent ON trade_log(relay_node_id, created_at DESC);
      CREATE INDEX idx_trade_log_day ON trade_log(created_at DESC);
      CREATE INDEX idx_trade_log_source ON trade_log(source);
    `);
    console.log('[migrate] v20: trade_log table created.');
  }

  // ── v21: trade_baselines — KAS equivalent baseline tracking ──
  const hasBaselines = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='trade_baselines'"
  ).get().cnt > 0;

  if (!hasBaselines) {
    sqlite.exec(`
      CREATE TABLE trade_baselines (
        id TEXT PRIMARY KEY,
        relay_node_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        initial_kas REAL NOT NULL DEFAULT 0,
        initial_usdt REAL NOT NULL DEFAULT 0,
        initial_kas_price REAL NOT NULL,
        equivalent_kas REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        loss_limit_pct REAL NOT NULL DEFAULT 10,
        hard_stop_pct REAL NOT NULL DEFAULT 20,
        created_at TEXT NOT NULL,
        settled_at TEXT,
        settled_equivalent REAL,
        settled_pnl_kas REAL,
        note TEXT
      );
      CREATE INDEX idx_baselines_agent ON trade_baselines(relay_node_id, status);
    `);
    console.log('[migrate] v21: trade_baselines table created.');
  }

  // ── v22: mm_orders + mm_quotes — KAS Market Maker OTC tracking ──
  const hasMmOrders = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='mm_orders'"
  ).get().cnt > 0;

  if (!hasMmOrders) {
    sqlite.exec(`
      CREATE TABLE mm_orders (
        id TEXT PRIMARY KEY,
        relay_node_id TEXT NOT NULL,
        side TEXT NOT NULL,
        kas_amount REAL NOT NULL,
        usdt_amount REAL NOT NULL,
        price REAL NOT NULL,
        chain TEXT NOT NULL,
        customer_address TEXT,
        customer_pay_address TEXT,
        mm_receive_address TEXT,
        status TEXT NOT NULL DEFAULT 'quoted',
        payment_txhash TEXT,
        kas_txhash TEXT,
        batch_index INTEGER,
        batch_total INTEGER,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX idx_mm_orders_status ON mm_orders(status);
      CREATE INDEX idx_mm_orders_relay ON mm_orders(relay_node_id, created_at DESC);
      CREATE INDEX idx_mm_orders_time ON mm_orders(created_at DESC);
    `);
    console.log('[migrate] v22: mm_orders table created.');
  }

  const hasMmQuotes = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='mm_quotes'"
  ).get().cnt > 0;

  if (!hasMmQuotes) {
    sqlite.exec(`
      CREATE TABLE mm_quotes (
        id TEXT PRIMARY KEY,
        relay_node_id TEXT NOT NULL,
        buy_price REAL,
        sell_price REAL,
        kas_stock REAL,
        usdt_stock REAL,
        mexc_price REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_mm_quotes_relay ON mm_quotes(relay_node_id, created_at DESC);
      CREATE INDEX idx_mm_quotes_time ON mm_quotes(created_at DESC);
    `);
    console.log('[migrate] v22: mm_quotes table created.');
  }

  // ── v23: agent_wallets — multi-chain wallet management ──
  const hasAgentWallets = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='agent_wallets'"
  ).get().cnt > 0;

  if (!hasAgentWallets) {
    sqlite.exec(`
      CREATE TABLE agent_wallets (
        id TEXT PRIMARY KEY,
        relay_node_id TEXT NOT NULL REFERENCES relay_nodes(id),
        chain TEXT NOT NULL,
        address TEXT NOT NULL,
        label TEXT DEFAULT '',
        privkey_encrypted TEXT,
        privkey_hint TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_wallets_relay ON agent_wallets(relay_node_id, chain);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_wallets_addr ON agent_wallets(chain, address);
    `);

    // Migrate existing wallets from config_entries to agent_wallets
    const now = new Date().toISOString();
    const oldWallets = sqlite.prepare(
      "SELECT key, value_encrypted, value_plain_hint FROM config_entries WHERE category = 'mm_wallet' AND key LIKE '%_address_%'"
    ).all();

    let migratedWallets = 0;
    for (const w of oldWallets) {
      // Parse: key format is '{chain}_address_{relayId}'
      const parts = w.key.match(/^(\w+)_address_(.+)$/);
      if (!parts) continue;
      const [, chain, relayId] = parts;
      const address = w.value_plain_hint || w.value_encrypted; // address is non-sensitive, stored in value_encrypted

      // Get corresponding private key
      const privkeyRow = sqlite.prepare(
        "SELECT value_encrypted, value_plain_hint FROM config_entries WHERE key = ? AND category = 'mm_wallet'"
      ).get(`${chain}_privkey_${relayId}`);

      // Check if already migrated
      const exists = sqlite.prepare('SELECT id FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND address = ?').get(relayId, chain, address);
      if (exists) continue;

      sqlite.prepare(`
        INSERT INTO agent_wallets (id, relay_node_id, chain, address, label, privkey_encrypted, privkey_hint, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(randomUUID(), relayId, chain, address, '', privkeyRow?.value_encrypted || null, privkeyRow?.value_plain_hint || null, now, now);
      migratedWallets++;
    }

    console.log(`[migrate] v23: agent_wallets table created, migrated ${migratedWallets} wallets from config_entries.`);
  }

  // ── v24: events.agent_address — anchor every event to a Kaspa address ──
  const eventCols = sqlite.pragma('table_info(events)').map(c => c.name);
  if (!eventCols.includes('agent_address')) {
    sqlite.exec(`ALTER TABLE events ADD COLUMN agent_address TEXT`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_events_agent_addr ON events(agent_address, created_at DESC)`);

    // Backfill: resolve agent_address from relay_nodes for existing mind events
    const relays = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all();
    for (const r of relays) {
      const agentName = (r.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      // Mind events use agent name as `source`
      const updated = sqlite.prepare(
        `UPDATE events SET agent_address = ? WHERE event_scope = 'mind' AND LOWER(source) = ? AND agent_address IS NULL`
      ).run(r.address, agentName);
      if (updated.changes > 0) {
        console.log(`[migrate] v24: backfilled ${updated.changes} events for ${r.name} → ${r.address.slice(-12)}`);
      }
    }

    console.log('[migrate] v24: events.agent_address column added + backfilled.');
  }

  // ── v25: skills.category — group skills by purpose ──
  const skillCols25 = sqlite.pragma('table_info(skills)').map(c => c.name);
  if (!skillCols25.includes('category')) {
    sqlite.exec(`ALTER TABLE skills ADD COLUMN category TEXT NOT NULL DEFAULT 'other'`);

    // Backfill categories for known skills
    const categoryMap = {
      // Perception — what the Agent sees
      chain_sense: 'perception', whale_tracker: 'perception',
      price_tracker: 'perception', multi_market: 'perception',
      // Social — how the Agent builds relationships
      social_outreach: 'social', address_profiler: 'social',
      // Trading — how the Agent does business
      trade_sense: 'trading', trade_executor: 'trading',
      trade_advisor: 'trading', mm_otc: 'trading',
      cross_chain_verify: 'trading',
      // Information — external data sources
      web_search: 'info', news_digest: 'info',
      btc_halving_countdown: 'info', flight_tracker: 'info',
      // Development — system tools
      code_sense: 'dev', code_review: 'dev', test_run: 'dev',
      system_status: 'dev', mcp_bridge: 'dev',
      // Self — self-awareness
      self_awareness: 'self',
      // Contacts — address book operations
      annotate: 'contacts', introduce: 'contacts',
      block: 'contacts', unblock: 'contacts',
    };

    const update = sqlite.prepare('UPDATE skills SET category = ? WHERE name = ?');
    for (const [name, cat] of Object.entries(categoryMap)) {
      update.run(cat, name);
    }

    console.log('[migrate] v25: skills.category column added + backfilled.');
  }

  // ── v26: remove 'frozen' status — only active/disabled ──
  const hasFrozen = sqlite.prepare("SELECT COUNT(*) as n FROM skills WHERE status = 'frozen'").get().n;
  if (hasFrozen > 0) {
    sqlite.prepare("UPDATE skills SET status = 'disabled' WHERE status = 'frozen'").run();
    console.log(`[migrate] v26: ${hasFrozen} frozen skills → disabled.`);
  }

  // ── v27: mm_orders upgrade — free market state machine ──
  const orderCols = sqlite.pragma('table_info(mm_orders)').map(c => c.name);
  if (!orderCols.includes('counterparty_order_id')) {
    // Dual-order linking: buyer order ↔ seller order
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN counterparty_order_id TEXT`);
    // Agent address (anchor to chain identity)
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN agent_address TEXT`);
    // Peer address (the other party's Kaspa address)
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN peer_address TEXT`);
    // Operation mode for this order
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN mode TEXT NOT NULL DEFAULT 'manual'`);
    // Broadcast TX that originated this order (link to chain truth)
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN broadcast_txid TEXT`);
    // Timestamps for each state transition
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN accepted_at TEXT`);
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN paid_at TEXT`);
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN verified_at TEXT`);
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN delivered_at TEXT`);
    // Failure/cancel reason
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN cancel_reason TEXT`);
    // Timeout config (minutes, 0=no timeout)
    sqlite.exec(`ALTER TABLE mm_orders ADD COLUMN timeout_minutes INTEGER NOT NULL DEFAULT 30`);

    // Backfill agent_address from relay_nodes
    const relays = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE address IS NOT NULL').all();
    for (const r of relays) {
      sqlite.prepare('UPDATE mm_orders SET agent_address = ? WHERE relay_node_id = ? AND agent_address IS NULL')
        .run(r.address, r.id);
    }

    // Index for counterparty lookup
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_mm_orders_counter ON mm_orders(counterparty_order_id)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_mm_orders_agent_addr ON mm_orders(agent_address)`);

    console.log('[migrate] v27: mm_orders upgraded — counterparty linking, agent_address, mode, timestamps.');
  }

  // ══════════════════════════════════════════════════════════════════
  //  v28: PROTOCOL STATE LAYER — 协议收口
  //  三张状态表：relation_states / chain_events / execution_states
  //  所有 UI、Mind、catch-up 只读这些表
  // ══════════════════════════════════════════════════════════════════

  // ── relation_states：统一关系状态 ──
  const hasRelationStates = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='relation_states'"
  ).get().cnt > 0;

  if (!hasRelationStates) {
    sqlite.exec(`
      CREATE TABLE relation_states (
        id TEXT PRIMARY KEY,
        local_address TEXT NOT NULL,
        peer_address TEXT NOT NULL,
        first_seen_tx TEXT,
        handshake_observed_at TEXT,
        handshake_accepted_at TEXT,
        session_confirmed_at TEXT,
        status TEXT NOT NULL DEFAULT 'observed',
        updated_at TEXT NOT NULL,
        UNIQUE(local_address, peer_address)
      );
      CREATE INDEX idx_rel_state_local ON relation_states(local_address, status);
      CREATE INDEX idx_rel_state_peer ON relation_states(peer_address);
      CREATE INDEX idx_rel_state_status ON relation_states(status);
    `);

    // Backfill from interaction_records + account_relations
    const relays = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE address IS NOT NULL').all();
    let backfilled = 0;

    for (const relay of relays) {
      // 1. From interaction_records (Scout data — observed)
      const interactions = sqlite.prepare(`
        SELECT DISTINCT
          CASE WHEN address_a = ? THEN address_b ELSE address_a END as peer,
          MIN(occurred_at) as first_seen,
          MIN(tx_hash) as first_tx
        FROM interaction_records
        WHERE (address_a = ? OR address_b = ?) AND interaction_type = 'handshake'
        GROUP BY peer
      `).all(relay.address, relay.address, relay.address);

      for (const ir of interactions) {
        // 2. Check account_relations for higher status (Relay data)
        const ar = sqlite.prepare(`
          SELECT ar.status, ar.created_at
          FROM account_relations ar
          JOIN identities ri ON ar.remote_identity_id = ri.id
          WHERE ar.relay_node_id = ? AND ri.address = ?
        `).get(relay.id, ir.peer);

        // Determine status: account_relations is the higher truth
        let status = 'observed';
        let acceptedAt = null;
        let confirmedAt = null;

        if (ar) {
          if (ar.status === 'connected') {
            status = 'active';
            acceptedAt = ar.created_at;
            confirmedAt = ar.created_at;
          } else if (ar.status === 'outgoing' || ar.status === 'incoming') {
            status = 'accepted';
            acceptedAt = ar.created_at;
          }
        }

        const now = new Date().toISOString();
        sqlite.prepare(`
          INSERT OR IGNORE INTO relation_states
            (id, local_address, peer_address, first_seen_tx, handshake_observed_at, handshake_accepted_at, session_confirmed_at, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), relay.address, ir.peer,
          ir.first_tx, ir.first_seen, acceptedAt, confirmedAt,
          status, now
        );
        backfilled++;
      }
    }

    console.log(`[migrate] v28: relation_states created, backfilled ${backfilled} relations.`);
  }

  // ── chain_events：链上事实（Scout/Relay 只写这里）──
  const hasChainEvents = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='chain_events'"
  ).get().cnt > 0;

  if (!hasChainEvents) {
    sqlite.exec(`
      CREATE TABLE chain_events (
        id TEXT PRIMARY KEY,
        txid TEXT NOT NULL,
        from_address TEXT,
        to_address TEXT,
        event_type TEXT NOT NULL,
        payload TEXT,
        observed_by TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        UNIQUE(txid, event_type)
      );
      CREATE INDEX idx_chain_events_type ON chain_events(event_type, observed_at DESC);
      CREATE INDEX idx_chain_events_from ON chain_events(from_address);
      CREATE INDEX idx_chain_events_to ON chain_events(to_address);
      CREATE INDEX idx_chain_events_txid ON chain_events(txid);
    `);
    console.log('[migrate] v28: chain_events created.');
  }

  // ── execution_states：执行追踪（权限 + 结果）──
  const hasExecStates = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='execution_states'"
  ).get().cnt > 0;

  if (!hasExecStates) {
    sqlite.exec(`
      CREATE TABLE execution_states (
        id TEXT PRIMARY KEY,
        intent_id TEXT,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        agent_address TEXT,
        permission_level TEXT NOT NULL DEFAULT 'owner',
        status TEXT NOT NULL DEFAULT 'pending',
        input_txid TEXT,
        output_txid TEXT,
        error_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_exec_state_agent ON execution_states(agent_address, created_at DESC);
      CREATE INDEX idx_exec_state_status ON execution_states(status);
      CREATE INDEX idx_exec_state_type ON execution_states(type);
    `);
    console.log('[migrate] v28: execution_states created.');
  }

  // ═══ v29: Phase 0 — 损失可控基础设施 ═══

  // ── 29a: 旧状态清理 ──
  const legacyOrders = sqlite.prepare(
    "SELECT COUNT(*) as c FROM mm_orders WHERE status IN ('quoted','awaiting_payment','payment_verified','failed')"
  ).get().c;
  if (legacyOrders > 0) {
    sqlite.prepare("UPDATE mm_orders SET status = 'published' WHERE status = 'quoted'").run();
    sqlite.prepare("UPDATE mm_orders SET status = 'paid' WHERE status = 'awaiting_payment'").run();
    sqlite.prepare("UPDATE mm_orders SET status = 'verified' WHERE status = 'payment_verified'").run();
    sqlite.prepare("UPDATE mm_orders SET status = 'cancelled' WHERE status = 'failed'").run();
    console.log(`[migrate] v29a: migrated ${legacyOrders} legacy order statuses.`);
  }

  // ── 29b: fund_locks 表 ──
  const hasFundLocks = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='fund_locks'"
  ).get().cnt > 0;

  if (!hasFundLocks) {
    sqlite.exec(`
      CREATE TABLE fund_locks (
        id            TEXT PRIMARY KEY,
        agent_address TEXT NOT NULL,
        order_id      TEXT NOT NULL,
        asset         TEXT NOT NULL,
        amount        REAL NOT NULL,
        status        TEXT NOT NULL DEFAULT 'locked',
        created_at    TEXT NOT NULL,
        released_at   TEXT,
        UNIQUE(order_id, asset)
      );
      CREATE INDEX idx_fund_locks_agent ON fund_locks(agent_address, status);
      CREATE INDEX idx_fund_locks_order ON fund_locks(order_id);
    `);
    console.log('[migrate] v29b: fund_locks table created.');
  }

  // ── 29c: execution_states 新字段 ──
  const esColumns = sqlite.prepare("PRAGMA table_info('execution_states')").all().map(c => c.name);
  if (!esColumns.includes('order_id')) {
    sqlite.exec(`
      ALTER TABLE execution_states ADD COLUMN order_id TEXT;
      ALTER TABLE execution_states ADD COLUMN amount REAL;
      ALTER TABLE execution_states ADD COLUMN asset TEXT;
      ALTER TABLE execution_states ADD COLUMN approval_timeout INTEGER DEFAULT 15;
    `);
    console.log('[migrate] v29c: execution_states new columns added.');
  }

  // ── 29d: 限额配置 + 确认数配置 ──
  const tradeConfigs = [
    ['per_order_max_kas', 'trade_limits', '1000'],
    ['per_order_max_usdt', 'trade_limits', '100'],
    ['daily_total_max_kas', 'trade_limits', '5000'],
    ['daily_total_max_usdt', 'trade_limits', '500'],
    ['auto_mode_max_kas', 'trade_limits', '200'],
    ['auto_mode_max_usdt', 'trade_limits', '20'],
    ['pre_payment_timeout_minutes', 'trade_limits', '15'],
    ['post_payment_timeout_minutes', 'trade_limits', '60'],
    ['verify_confirmations_bnb', 'trade_verify', '15'],
    ['verify_confirmations_eth', 'trade_verify', '12'],
    ['verify_confirmations_tron', 'trade_verify', '19'],
  ];
  const insertConfig = sqlite.prepare(`
    INSERT OR IGNORE INTO config_entries (id, key, category, value_encrypted, is_sensitive, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `);
  let configInserted = 0;
  const now29 = new Date().toISOString();
  for (const [key, category, value] of tradeConfigs) {
    const result = insertConfig.run(randomUUID(), key, category, value, now29, now29);
    if (result.changes > 0) configInserted++;
  }
  if (configInserted > 0) {
    console.log(`[migrate] v29d: ${configInserted} trade configs inserted.`);
  }

  // ═══ v30: Phase 2 — 权限闸门 ═══

  // ── 30a: execution_states 审批字段 ──
  if (!esColumns.includes('display_summary')) {
    sqlite.exec(`
      ALTER TABLE execution_states ADD COLUMN display_summary TEXT;
      ALTER TABLE execution_states ADD COLUMN action_details TEXT;
      ALTER TABLE execution_states ADD COLUMN approval_deadline TEXT;
    `);
    console.log('[migrate] v30a: execution_states approval fields added.');
  }

  // ── 30b: 启动恢复 — executing 状态的记录在崩溃后标记 failed ──
  const stuckExecuting = sqlite.prepare(
    "SELECT id, type, order_id FROM execution_states WHERE status = 'executing'"
  ).all();
  if (stuckExecuting.length > 0) {
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(
      "UPDATE execution_states SET status = 'failed', error_text = 'process_restart: was executing when process stopped', updated_at = ? WHERE id = ?"
    );
    for (const row of stuckExecuting) {
      stmt.run(now, row.id);
      console.log(`[migrate] v30b: execution ${row.id.slice(0, 8)} (${row.type}) was stuck in executing → failed (process_restart)`);
    }
    // fund_locks 保持 locked — 不自动释放，等人工确认
  }

  // ═══ v31: relation_states 加 trust_level + is_blocked（从 account_relations 迁移）═══
  const hasRsTrust = sqlite.prepare("PRAGMA table_info(relation_states)").all().some(c => c.name === 'trust_level');
  if (!hasRsTrust) {
    sqlite.prepare("ALTER TABLE relation_states ADD COLUMN trust_level TEXT DEFAULT 'normal'").run();
    sqlite.prepare("ALTER TABLE relation_states ADD COLUMN is_blocked INTEGER DEFAULT 0").run();

    // 从 account_relations 迁移已有的 trust/blocked 配置
    const arRows = sqlite.prepare(`
      SELECT ar.trust_level, ar.is_blocked, ar.relay_node_id, i.address as peer_address
      FROM account_relations ar
      JOIN identities i ON i.id = ar.remote_identity_id
      WHERE ar.trust_level IS NOT NULL OR ar.is_blocked = 1
    `).all();

    let migrated = 0;
    for (const ar of arRows) {
      const relayAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(ar.relay_node_id)?.address;
      if (!relayAddr || !ar.peer_address) continue;
      const result = sqlite.prepare(`
        UPDATE relation_states SET trust_level = ?, is_blocked = ?
        WHERE local_address = ? AND peer_address = ?
      `).run(ar.trust_level || 'normal', ar.is_blocked || 0, relayAddr, ar.peer_address);
      if (result.changes > 0) migrated++;
    }
    console.log(`[migrate] v31: relation_states trust_level + is_blocked added, migrated ${migrated} from account_relations.`);
  }

  // ── v32: onboard_market mind skill ──
  const hasOnboardMarket = sqlite.prepare("SELECT count(*) as cnt FROM skills WHERE name = 'onboard_market'").get().cnt > 0;
  if (!hasOnboardMarket) {
    const now = new Date().toISOString();
    const relays = sqlite.prepare('SELECT id FROM relay_nodes').all();
    const stmt = sqlite.prepare(`
      INSERT INTO skills (id, relay_node_id, name, display_name, description, action_type, min_trust_level, status, source, side_effect_level, invoke_count, created_at, updated_at)
      VALUES (?, ?, 'onboard_market', 'Exchange Onboarding', 'Guide owner to connect external exchanges — chat or form mode', 'mind', 'owner', 'active', 'builtin', 'metadata_write', 0, ?, ?)
    `);
    for (const r of relays) {
      stmt.run(randomUUID(), r.id, now, now);
    }
    console.log(`[migrate] v32: onboard_market skill registered for ${relays.length} agents.`);
  }

  // ── v33: stock_watchlist — 用户自选股 ──
  const hasStockWatchlist = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='stock_watchlist'"
  ).get().cnt;
  if (!hasStockWatchlist) {
    sqlite.exec(`
      CREATE TABLE stock_watchlist (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT,
        market TEXT DEFAULT 'us',
        sector TEXT,
        added_by TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    // 默认种子：两个主要指数
    const now = new Date().toISOString();
    const seed = sqlite.prepare('INSERT INTO stock_watchlist (id, symbol, name, market, sector, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    seed.run(randomUUID(), 'SPY', 'S&P 500 ETF', 'us', 'Index', now);
    seed.run(randomUUID(), 'QQQ', 'NASDAQ 100 ETF', 'us', 'Index', now);
    console.log('[migrate] v33: stock_watchlist table created with 2 seed indices.');
  }

  // ── v34: social_style + social_overrides on relay_nodes ──
  const hasSocialStyle = sqlite.prepare(
    "SELECT count(*) as cnt FROM pragma_table_info('relay_nodes') WHERE name='social_style'"
  ).get().cnt;
  if (!hasSocialStyle) {
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN social_style TEXT DEFAULT 'balanced'");
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN social_overrides TEXT DEFAULT NULL");
    console.log('[migrate] v34: social_style + social_overrides on relay_nodes.');
  }

  // ── v35: onboard_broker + onboard_polymarket skills ──
  const hasOnboardBroker = sqlite.prepare("SELECT count(*) as cnt FROM skills WHERE name = 'onboard_broker'").get().cnt > 0;
  if (!hasOnboardBroker) {
    const now = new Date().toISOString();
    const relays = sqlite.prepare('SELECT id FROM relay_nodes').all();
    const stmt = sqlite.prepare(`
      INSERT INTO skills (id, relay_node_id, name, display_name, description, action_type, min_trust_level, status, source, side_effect_level, invoke_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'mind', 'owner', 'active', 'builtin', 'metadata_write', 0, ?, ?)
    `);
    for (const r of relays) {
      stmt.run(randomUUID(), r.id, 'onboard_broker', 'Broker Onboarding', 'Guide owner to connect stock brokers like Interactive Brokers', now, now);
      stmt.run(randomUUID(), r.id, 'onboard_polymarket', 'Polymarket Onboarding', 'Guide owner to set up Polymarket prediction market trading', now, now);
    }
    console.log(`[migrate] v35: onboard_broker + onboard_polymarket skills registered for ${relays.length} agents.`);
  }

  // ── v36: broker_accounts ──
  const hasBrokerAccounts = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='broker_accounts'"
  ).get().cnt;
  if (!hasBrokerAccounts) {
    sqlite.exec(`
      CREATE TABLE broker_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        broker_type TEXT NOT NULL DEFAULT 'ibkr',
        account_id TEXT,
        gateway_url_encrypted TEXT,
        credentials_encrypted TEXT,
        paper_trading INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        last_sync_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log('[migrate] v35: broker_accounts table created.');
  }

  // ── v37: agent_connections — dynamic credential management ──
  const hasAgentConnections = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='agent_connections'"
  ).get().cnt;
  if (!hasAgentConnections) {
    sqlite.exec(`
      CREATE TABLE agent_connections (
        id                     TEXT PRIMARY KEY,
        adapter_node_id        TEXT NOT NULL REFERENCES adapter_nodes(id),
        provider               TEXT NOT NULL,
        auth_mode              TEXT NOT NULL DEFAULT 'api_key',
        status                 TEXT NOT NULL DEFAULT 'connected',
        base_url               TEXT,
        model                  TEXT,
        api_key_enc            TEXT,
        access_token_enc       TEXT,
        refresh_token_enc      TEXT,
        gateway_token_enc      TEXT,
        expires_at             TEXT,
        refresh_after          TEXT,
        last_refresh_at        TEXT,
        last_refresh_error     TEXT,
        credential_version     INTEGER NOT NULL DEFAULT 1,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      )
    `);
    // Migrate existing adapter_nodes into agent_connections
    const adapters = sqlite.prepare('SELECT * FROM adapter_nodes').all();
    const now = new Date().toISOString();
    const ins = sqlite.prepare(`
      INSERT INTO agent_connections (id, adapter_node_id, provider, auth_mode, status, base_url, model,
        api_key_enc, gateway_token_enc, credential_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const a of adapters) {
      const provider = a.ai_provider || 'openclaw';
      const authMode = (provider === 'openclaw') ? 'gateway' : 'api_key';
      const baseUrl = (provider === 'openclaw')
        ? (a.gateway_ws_url || 'ws://127.0.0.1:18789')
        : (a.ai_provider_url || null);
      ins.run(
        randomUUID(), a.id, provider, authMode, baseUrl, a.ai_model || null,
        a.ai_provider_key_encrypted || null,
        a.token_encrypted || null,
        now, now
      );
    }
    console.log(`[migrate] v37: agent_connections table created, ${adapters.length} connections migrated.`);
  }

  // v38: exchange_offers — 协议级自由市场索引表
  // 设计文档: kanet-free-market.md + 自由市场设计决策文档 v1.1
  const hasExchangeOffers = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='exchange_offers'"
  ).get();
  if (!hasExchangeOffers) {
    sqlite.exec(`
      CREATE TABLE exchange_offers (
        id                  TEXT PRIMARY KEY,
        broadcast_tx_id     TEXT NOT NULL,
        message_index       INTEGER NOT NULL DEFAULT 0,

        give_asset          TEXT NOT NULL,
        give_amount         TEXT NOT NULL,
        give_chain          TEXT,

        want_asset          TEXT NOT NULL,
        want_amount         TEXT NOT NULL,
        want_chain          TEXT,

        maker               TEXT NOT NULL,
        broadcast_block     INTEGER,
        broadcast_at        TEXT,
        expires_at          TEXT,

        verification        TEXT NOT NULL DEFAULT 'manual',
        verification_meta   TEXT DEFAULT '{}',

        protocol_status     TEXT NOT NULL DEFAULT 'open',
        is_fully_observed   INTEGER NOT NULL DEFAULT 0,

        market_key          TEXT NOT NULL,
        observed_by_node    TEXT,

        taker               TEXT,
        taker_tx_id         TEXT,
        completed_at        TEXT,

        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

        UNIQUE(broadcast_tx_id, message_index)
      );

      CREATE INDEX idx_exchange_offers_market_key ON exchange_offers(market_key);
      CREATE INDEX idx_exchange_offers_status ON exchange_offers(protocol_status);
      CREATE INDEX idx_exchange_offers_maker ON exchange_offers(maker);
      CREATE INDEX idx_exchange_offers_broadcast_at ON exchange_offers(broadcast_at);
    `);
    console.log('[migrate] v38: exchange_offers table created (protocol-level free market).');
  }

  // v39: exchange_offers — state machine columns (matched_at, verifying, disputed, etc.)
  const hasMatchedAt = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('exchange_offers') WHERE name = 'matched_at'"
  ).get();
  if (!hasMatchedAt) {
    sqlite.exec(`
      ALTER TABLE exchange_offers ADD COLUMN accept_commitment TEXT;
      ALTER TABLE exchange_offers ADD COLUMN matched_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN verifying_started_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN disputed_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN timed_out_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN cancelled_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN maker_confirmed_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN taker_confirmed_at TEXT;
    `);
    console.log('[migrate] v39: exchange_offers state machine columns added.');
  }

  // v40: UNIQUE index on mm_orders.payment_txhash — prevent race condition double-binding
  // The existing anti-replay SELECT in trading.js is TOCTOU-vulnerable.
  // This UNIQUE partial index (WHERE NOT NULL) makes the DB enforce it atomically.
  const hasPaymentTxhashIdx = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_mm_orders_payment_txhash_unique'"
  ).get();
  if (!hasPaymentTxhashIdx) {
    // Check for existing duplicates first — clean them before adding UNIQUE
    const dupes = sqlite.prepare(`
      SELECT payment_txhash, COUNT(*) as cnt FROM mm_orders
      WHERE payment_txhash IS NOT NULL
      GROUP BY payment_txhash HAVING cnt > 1
    `).all();
    for (const d of dupes) {
      // Keep the earliest order, null out the rest
      const rows = sqlite.prepare(
        'SELECT id FROM mm_orders WHERE payment_txhash = ? ORDER BY created_at ASC'
      ).all(d.payment_txhash);
      for (let i = 1; i < rows.length; i++) {
        sqlite.prepare('UPDATE mm_orders SET payment_txhash = NULL WHERE id = ?').run(rows[i].id);
        console.log(`[migrate] v40: cleared duplicate payment_txhash on order ${rows[i].id.slice(0, 8)}`);
      }
    }
    sqlite.exec(`CREATE UNIQUE INDEX idx_mm_orders_payment_txhash_unique ON mm_orders(payment_txhash) WHERE payment_txhash IS NOT NULL`);
    console.log('[migrate] v40: UNIQUE index on mm_orders.payment_txhash (anti-replay hardening).');
  }

  // v41: kanet_message_index — 协作消息索引
  // 节点在线时为认识的地址（relation_states）记录链上消息索引。
  // 用途：节点重启后补全停机期间遗漏的消息，未来节点间协作查询。
  // 设计文档：docs/kanet-cooperative-index.md
  const hasMessageIndex = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='kanet_message_index'"
  ).get();
  if (!hasMessageIndex) {
    sqlite.exec(`
      CREATE TABLE kanet_message_index (
        id              TEXT PRIMARY KEY,
        txid            TEXT NOT NULL,
        for_address     TEXT NOT NULL,
        from_address    TEXT NOT NULL,
        payload_type    TEXT NOT NULL,
        payload_hash    TEXT,
        block_time      TEXT NOT NULL,
        blue_score      INTEGER,
        indexed_by      TEXT NOT NULL,
        created_at      TEXT DEFAULT (datetime('now')),
        UNIQUE(txid, for_address)
      );
      CREATE INDEX idx_kanet_msg_for_address ON kanet_message_index(for_address, block_time);
      CREATE INDEX idx_kanet_msg_from_address ON kanet_message_index(from_address, block_time);
      CREATE INDEX idx_kanet_msg_txid ON kanet_message_index(txid);
    `);
    console.log('[migrate] v41: kanet_message_index table created (cooperative message index).');
  }

  // v41b: scout_checkpoint — Scout 扫描进度持久化
  // 记录每个 Agent 地址最后处理的链上时间，重启时从检查点补扫。
  const hasScoutCheckpoint = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='scout_checkpoint'"
  ).get();
  if (!hasScoutCheckpoint) {
    sqlite.exec(`
      CREATE TABLE scout_checkpoint (
        id              TEXT PRIMARY KEY,
        address         TEXT NOT NULL UNIQUE,
        last_block_time TEXT NOT NULL,
        last_blue_score INTEGER,
        updated_at      TEXT DEFAULT (datetime('now'))
      );
    `);
    console.log('[migrate] v41b: scout_checkpoint table created (scan progress persistence).');
  }

  // v42: kanet_message_index 加 processed_at 字段
  // Relay catch-up 处理历史 comm 后标记，防重复处理
  const hasProcessedAt = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('kanet_message_index') WHERE name = 'processed_at'"
  ).get();
  if (!hasProcessedAt) {
    sqlite.exec(`ALTER TABLE kanet_message_index ADD COLUMN processed_at TEXT DEFAULT NULL`);
    console.log('[migrate] v42: kanet_message_index.processed_at column added.');
  }

  // v43: relation_states 加 their_alias 字段
  // 握手时对方携带的 alias，用于 comm 消息发送方识别（跨钱包兼容）
  const hasTheirAlias = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('relation_states') WHERE name = 'their_alias'"
  ).get();
  if (!hasTheirAlias) {
    sqlite.exec(`ALTER TABLE relation_states ADD COLUMN their_alias TEXT DEFAULT NULL`);
    console.log('[migrate] v43: relation_states.their_alias column added.');
  }

  // v44: pending_actions — 意图队列（与事实层 relation_states 分离）
  // catch-up 从此表消费待执行动作，不再用 relation_states.status 推断行为
  const hasPendingActions = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='pending_actions'"
  ).get().cnt > 0;
  if (!hasPendingActions) {
    sqlite.exec(`
      CREATE TABLE pending_actions (
        id              TEXT PRIMARY KEY,
        action_type     TEXT NOT NULL,
        direction       TEXT NOT NULL,
        local_address   TEXT NOT NULL,
        target_address  TEXT NOT NULL,
        source          TEXT NOT NULL,
        idempotent_key  TEXT NOT NULL UNIQUE,
        status          TEXT NOT NULL DEFAULT 'pending',
        retry_count     INTEGER NOT NULL DEFAULT 0,
        max_retries     INTEGER NOT NULL DEFAULT 3,
        trigger_txid    TEXT,
        result_txid     TEXT,
        error           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_pa_status ON pending_actions(status, action_type);
      CREATE INDEX idx_pa_local ON pending_actions(local_address, status);
    `);
    console.log('[migrate] v44: pending_actions table created.');
  }

  // v45: tx_records 加 local_address — 花费归属到 Agent
  const txCols = sqlite.prepare("SELECT 1 FROM pragma_table_info('tx_records') WHERE name = 'local_address'").get();
  if (!txCols) {
    sqlite.exec(`ALTER TABLE tx_records ADD COLUMN local_address TEXT`);

    // 补填历史握手记录：chain_events.from_address 匹配，只保留本地 Agent 地址
    const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all().map(r => r.address);
    const bf = sqlite.prepare(`
      UPDATE tx_records
      SET local_address = (
        SELECT ce.from_address FROM chain_events ce
        WHERE ce.txid = tx_records.txid AND ce.event_type = 'handshake'
          AND ce.from_address IN (${localAddrs.map(() => '?').join(',')})
        LIMIT 1
      )
      WHERE local_address IS NULL
        AND (trace_id LIKE 'handshake:%' OR trace_id LIKE 'handshake-init:%' OR trace_id LIKE 'catchup:%')
    `).run(...localAddrs);

    console.log(`[migrate] v45: tx_records.local_address added. Backfilled ${bf.changes} handshake records.`);
  }

  // v46: DROP account_relations — 已由 relation_states 完全替代（v28+v31 迁移完成）
  // account-relations.js 文件同步删除，0 调用方确认
  const arExists = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='account_relations'"
  ).get().cnt > 0;
  if (arExists) {
    sqlite.exec('DROP TABLE account_relations');
    console.log('[migrate] v46: account_relations dropped.');
  }

  // v47: interaction_records 停写 + DROP TABLE
  // P1 迁移完成（2026-04-06）：所有读取已迁移到 chain_events
  // 写入方 discovery.js:recordInteraction() 同步停写
  const irExists = sqlite.prepare(
    "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='interaction_records'"
  ).get().cnt > 0;
  if (irExists) {
    sqlite.exec('DROP TABLE interaction_records');
    console.log('[migrate] v47: interaction_records dropped.');
  }

  // v48: relation_states 加 classification 字段
  // 记录对方 Agent 的身份质量（和 status 正交）
  // 取值：seen_candidate / declared_candidate / responsive_agent / verified_agent / inactive_agent
  // 只升级不降级（seen → declared → responsive → verified），inactive 由定时任务标记
  const hasClassification = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('relation_states') WHERE name='classification'"
  ).get();
  if (!hasClassification) {
    sqlite.exec("ALTER TABLE relation_states ADD COLUMN classification TEXT DEFAULT 'seen_candidate'");
    console.log('[migrate] v48: relation_states.classification added');
  }

  // v49: kanet_message_index 加 reply_to 字段
  // 存储 kanet:v1:msg: 格式消息的引用关系，支持 /story 线程展示
  const hasReplyTo = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('kanet_message_index') WHERE name='reply_to'"
  ).get();
  if (!hasReplyTo) {
    sqlite.exec("ALTER TABLE kanet_message_index ADD COLUMN reply_to TEXT");
    console.log('[migrate] v49: kanet_message_index.reply_to added');
  }

  // v50: adapter_nodes 加 is_enabled — 记住用户手动停止状态，重启后不自动拉起
  const hasIsEnabled = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('adapter_nodes') WHERE name='is_enabled'"
  ).get();
  if (!hasIsEnabled) {
    sqlite.exec("ALTER TABLE adapter_nodes ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1");
    console.log('[migrate] v50: adapter_nodes.is_enabled added');
  }

  // v51: trade_log 加 exchange 列 — 日限额按交易所统计
  const hasTradeLogExchange = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('trade_log') WHERE name='exchange'"
  ).get();
  if (!hasTradeLogExchange) {
    sqlite.exec("ALTER TABLE trade_log ADD COLUMN exchange TEXT");
    console.log('[migrate] v51: trade_log.exchange added');
  }

  // v52: relay_nodes.focus — Agent 专注模式（balanced/market_maker/social）
  const hasFocus = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('relay_nodes') WHERE name='focus'"
  ).get();
  if (!hasFocus) {
    sqlite.exec("ALTER TABLE relay_nodes ADD COLUMN focus TEXT DEFAULT 'balanced'");
    console.log('[migrate] v52: relay_nodes.focus added');
  }

  // v53a: exchange_offers.metadata — 通用来源标记（seeder/arb/manual）
  const hasMetadata = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('exchange_offers') WHERE name='metadata'"
  ).get();
  if (!hasMetadata) {
    sqlite.exec("ALTER TABLE exchange_offers ADD COLUMN metadata TEXT DEFAULT '{}'");
    console.log('[migrate] v53a: exchange_offers.metadata added');
  }

  // v53b: market_seeder_config — 做市播种器配置
  const hasSeederConfig = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='market_seeder_config'"
  ).get();
  if (!hasSeederConfig) {
    sqlite.exec(`
      CREATE TABLE market_seeder_config (
        id              TEXT PRIMARY KEY DEFAULT 'default',
        enabled         INTEGER NOT NULL DEFAULT 0,
        sell_spread_pct REAL    NOT NULL DEFAULT 1.0,
        buy_spread_pct  REAL    NOT NULL DEFAULT 1.0,
        amount_kas      INTEGER NOT NULL DEFAULT 100,
        expires_minutes INTEGER NOT NULL DEFAULT 30,
        sell_agent_id   TEXT,
        buy_agent_id    TEXT,
        updated_at      TEXT    NOT NULL
      )
    `);
    sqlite.prepare(`
      INSERT INTO market_seeder_config
      (id, enabled, sell_spread_pct, buy_spread_pct, amount_kas, expires_minutes, updated_at)
      VALUES ('default', 0, 1.0, 1.0, 100, 30, ?)
    `).run(new Date().toISOString());
    console.log('[migrate] v53b: market_seeder_config table created with defaults');
  }

  // v54: exchange_offers 加 taker_chain + taker_payment_address — 买家选链后锁定收款链路
  const hasTakerChain = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('exchange_offers') WHERE name='taker_chain'"
  ).get();
  if (!hasTakerChain) {
    sqlite.exec(`
      ALTER TABLE exchange_offers ADD COLUMN taker_chain TEXT;
      ALTER TABLE exchange_offers ADD COLUMN taker_payment_address TEXT;
    `);
    console.log('[migrate] v54: exchange_offers taker_chain + taker_payment_address added');
  }

  // v55: exchange_offers.delivering_at + payment_tx — delivering 状态时间戳 + 付款 TX 记录
  const hasDeliveringAt = sqlite.prepare(
    "SELECT 1 FROM pragma_table_info('exchange_offers') WHERE name='delivering_at'"
  ).get();
  if (!hasDeliveringAt) {
    sqlite.exec(`
      ALTER TABLE exchange_offers ADD COLUMN delivering_at TEXT;
      ALTER TABLE exchange_offers ADD COLUMN payment_tx TEXT;
    `);
    console.log('[migrate] v55: exchange_offers delivering_at + payment_tx added');
  }

  // v56: Backfill classification — peers with completed handshakes should be responsive_agent
  //       peers with completed exchange trades should be verified_agent
  {
    const backfillResponsive = sqlite.prepare(`
      UPDATE relation_states SET classification = 'responsive_agent'
      WHERE classification = 'seen_candidate'
        AND handshake_accepted_at IS NOT NULL
    `).run();
    if (backfillResponsive.changes > 0) {
      console.log(`[migrate] v56: backfill ${backfillResponsive.changes} peers → responsive_agent (had handshake_accepted_at)`);
    }

    // Peers involved in completed exchange trades → verified_agent
    const backfillVerified = sqlite.prepare(`
      UPDATE relation_states SET classification = 'verified_agent'
      WHERE classification IN ('seen_candidate', 'declared_candidate', 'responsive_agent')
        AND peer_address IN (
          SELECT maker FROM exchange_offers WHERE protocol_status = 'completed'
          UNION
          SELECT taker FROM exchange_offers WHERE protocol_status = 'completed' AND taker IS NOT NULL
        )
    `).run();
    if (backfillVerified.changes > 0) {
      console.log(`[migrate] v56: backfill ${backfillVerified.changes} peers → verified_agent (completed trades)`);
    }
  }

  // v57: exchange_offers 加 delivery_tx — 每笔交易的所有 TX 都可从 offer 记录追溯
  {
    const cols = sqlite.prepare('PRAGMA table_info(exchange_offers)').all().map(c => c.name);
    if (!cols.includes('delivery_tx')) {
      sqlite.exec('ALTER TABLE exchange_offers ADD COLUMN delivery_tx TEXT');
      console.log('[migrate] v57: exchange_offers.delivery_tx added');
    }
  }

  // v58: agent_connections 加 signing_key_enc — 为 EIP-712 订单签名保存 EVM 私钥
  // aevo-client.js 从 day one 就引用了这个字段但 schema 里从没创建过，
  // loadCredentials() 一调就报错 "no such column"，因此 createOrder() 实际从没跑过。
  {
    const cols = sqlite.prepare('PRAGMA table_info(agent_connections)').all().map(c => c.name);
    if (!cols.includes('signing_key_enc')) {
      sqlite.exec('ALTER TABLE agent_connections ADD COLUMN signing_key_enc TEXT');
      console.log('[migrate] v58: agent_connections.signing_key_enc added (unblocks Aevo credential storage)');
    }
  }

  // v59: backfill stuck fund_locks on completed offers
  // Phase 1 stress test S9 discovered that handleExchangeDelivered used a direct SQL UPDATE
  // bypassing transition(), which skipped the spendFunds call. Historical completed offers
  // therefore have fund_locks permanently stuck at status='locked', accumulating 'phantom lock'
  // that consumes the maker's available balance.
  // This migration marks those as 'spent' retroactively.
  {
    const stuck = sqlite.prepare(`
      SELECT fl.id, fl.order_id, fl.amount, fl.asset
      FROM fund_locks fl
      JOIN exchange_offers o ON o.id = fl.order_id
      WHERE fl.status = 'locked' AND o.protocol_status = 'completed'
    `).all();
    if (stuck.length > 0) {
      const now = new Date().toISOString();
      const upd = sqlite.prepare("UPDATE fund_locks SET status = 'spent', released_at = ? WHERE id = ?");
      let fixed = 0;
      for (const row of stuck) {
        upd.run(now, row.id);
        fixed++;
      }
      console.log(`[migrate] v59: backfilled ${fixed} stuck fund_locks (completed + locked → spent)`);
    }
  }

  // v60: kaspa_tx_log — 内嵌 Kaspa TX indexer
  // Phase 1 stress test S10B 暴露: Kaspa RPC 无 getTransaction，UTXO 查询在 output 被 spend 后
  // 立即失效，导致真实 TX 验证失败 (f8e70ae1 案例: "TX output not found in recipient UTXOs")。
  // 方案: Relay 订阅 block-added 事件 → 提取 TX → 对 watched addresses 过滤 → 写入本表。
  // 验证器改为查本表而不是轮询 RPC UTXO。
  {
    const hasTable = sqlite.prepare(
      "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='kaspa_tx_log'"
    ).get().cnt;
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE kaspa_tx_log (
          tx_id         TEXT PRIMARY KEY,
          block_hash    TEXT,
          block_time    INTEGER,          -- unix timestamp seconds
          from_address  TEXT,             -- best-guess sender (first input address if known)
          to_address    TEXT,             -- recipient of matched output
          amount        REAL,             -- KAS amount to recipient (sompi / 1e8)
          outputs_json  TEXT,             -- raw outputs array for audit / re-verification
          observed_at   TEXT NOT NULL,    -- when Relay reported this TX to Console
          network       TEXT              -- mainnet / testnet
        );
        CREATE INDEX idx_kaspa_tx_log_to_address ON kaspa_tx_log(to_address);
        CREATE INDEX idx_kaspa_tx_log_from_address ON kaspa_tx_log(from_address);
        CREATE INDEX idx_kaspa_tx_log_block_time ON kaspa_tx_log(block_time);
      `);
      console.log('[migrate] v60: kaspa_tx_log table created (embedded TX indexer)');
    }
  }

  // v61: UNIQUE index on exchange_offers.payment_tx — prevent TX reuse attack
  // (2026-04-14 audit): 一个 payment_tx 只能绑定到一个 offer, 防止攻击者用同一笔付款
  // 骗取多个 offer 的交割. 先清理历史 duplicate (实测 0 条), 然后加 partial unique index.
  {
    const hasIdx = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_exchange_offers_payment_tx_unique'"
    ).get();
    if (!hasIdx) {
      // Check for duplicates first (safety - if any found, clear all but oldest)
      const dupes = sqlite.prepare(`
        SELECT payment_tx, COUNT(*) as cnt FROM exchange_offers
        WHERE payment_tx IS NOT NULL
        GROUP BY payment_tx HAVING cnt > 1
      `).all();
      for (const d of dupes) {
        const rows = sqlite.prepare(
          'SELECT id FROM exchange_offers WHERE payment_tx = ? ORDER BY created_at ASC'
        ).all(d.payment_tx);
        // Keep first (oldest), clear others
        for (let i = 1; i < rows.length; i++) {
          sqlite.prepare('UPDATE exchange_offers SET payment_tx = NULL WHERE id = ?').run(rows[i].id);
          console.log(`[migrate] v61: cleared duplicate payment_tx on offer ${rows[i].id.slice(0, 8)}`);
        }
      }
      sqlite.exec(
        `CREATE UNIQUE INDEX idx_exchange_offers_payment_tx_unique ON exchange_offers(payment_tx) WHERE payment_tx IS NOT NULL`
      );
      console.log('[migrate] v61: UNIQUE index on exchange_offers.payment_tx (anti-reuse hardening).');
    }
  }

  // v62: pending_exchange_accepts — Q5 audit fix, orphan buffer for out-of-order accepts
  // 场景: Scout 批量扫链时可能先拉到 accept 再拉到 publish (同一 block 内 TX order 不保证).
  // 旧逻辑 processAccept 直接 silently drop unknown offer 的 accept, 导致 taker 已广播上链
  // 的 accept 被丢弃, offer 卡在 open. 新表暂存 orphan accepts, publish 到时 replay.
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_exchange_accepts'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE pending_exchange_accepts (
          id TEXT PRIMARY KEY,
          offer_id TEXT NOT NULL,
          msg_json TEXT NOT NULL,
          received_at TEXT NOT NULL
        );
        CREATE INDEX idx_pending_exchange_accepts_offer ON pending_exchange_accepts(offer_id);
      `);
      console.log('[migrate] v62: pending_exchange_accepts table created (orphan buffer).');
    }
  }

  // v63: channels — 频道是一等公民，channels 表作为频道的唯一真相源
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='channels'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS channels (
          name        TEXT PRIMARY KEY,
          description TEXT,
          created_by  TEXT,
          created_at  TEXT
        );
        INSERT OR IGNORE INTO channels (name, description, created_by, created_at) VALUES
          ('kanet-arch',     'Architect 任务拆解和分发', 'system', datetime('now')),
          ('kanet-frontend', '前端 Builder 产出和进度', 'system', datetime('now')),
          ('kanet-backend',  '后端 Builder 产出和进度', 'system', datetime('now')),
          ('kanet-review',   '代码审查请求和结果', 'system', datetime('now')),
          ('kanet-test',     '测试任务和测试报告', 'system', datetime('now')),
          ('kanet-alert',    '异常、阻塞、安全问题', 'system', datetime('now')),
          ('kanet-status',   '全员进度汇报', 'system', datetime('now'));
      `);
      // Backfill: 把 broadcast_messages 里已有消息的频道录入 channels 表
      const existing = sqlite.prepare(`
        SELECT DISTINCT channel_name FROM broadcast_messages
        WHERE status != 'local'
          AND sender_address IS NOT NULL AND sender_address != ''
          AND channel_name NOT LIKE '%_local'
          AND channel_name NOT GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-*'
      `).all();
      const backfill = sqlite.prepare(
        "INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES (?, 'backfill', datetime('now'))"
      );
      let backfilled = 0;
      for (const r of existing) {
        const result = backfill.run(r.channel_name);
        if (result.changes > 0) backfilled++;
      }
      console.log(`[migrate] v63: channels table created + 7 preset channels + ${backfilled} backfilled.`);
    }
  }


  // v64: social_spend_log — 社交 KAS 开销预算记账
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_spend_log'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS social_spend_log (
          id TEXT PRIMARY KEY,
          agent_address TEXT NOT NULL,
          category TEXT NOT NULL,
          amount_kas REAL NOT NULL,
          tx_hash TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_social_spend_agent_time
          ON social_spend_log(agent_address, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_social_spend_tx
          ON social_spend_log(tx_hash) WHERE tx_hash IS NOT NULL;
      `);
      console.log('[migrate] v64: social_spend_log table created (KAS budget tracking).');
    }
  }

  // v65: polymarket_rules — AI 解析 Polymarket 市场规则 cache (Phase 1)
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='polymarket_rules'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS polymarket_rules (
          condition_id TEXT PRIMARY KEY,
          question TEXT NOT NULL,
          rules_digest TEXT,
          risks TEXT,
          decision_inputs TEXT,
          source_hash TEXT,
          parsed_by TEXT,
          parsed_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_polymarket_rules_expires ON polymarket_rules(expires_at);
      `);
      console.log('[migrate] v65: polymarket_rules table created.');
    }
  }

  // v66: Opus relay — Owner-authorized independent identity for Opus AI sessions
  // mnemonic 留空给 Owner 手动设置 (避免 script 生成私钥)
  {
    const existing = sqlite.prepare("SELECT id FROM relay_nodes WHERE name = 'Opus'").get();
    if (!existing) {
      const now = new Date().toISOString();
      sqlite.prepare(`
        INSERT INTO relay_nodes (id, name, address, mnemonic_encrypted, network, created_at, updated_at)
        VALUES (?, 'Opus', NULL, NULL, 'mainnet', ?, ?)
      `).run('0f0f0f0f-0000-0000-0000-0000000000ff', now, now);
      console.log('[migrate] v66: Opus relay inserted (mnemonic null, Owner sets manually).');
    }
  }

  // v67: relay_nodes.is_bot_autoreply column — tag Mind-auto-reply sources for future identity separation
  {
    const hasCol = sqlite.prepare("PRAGMA table_info(relay_nodes)").all()
      .some(c => c.name === 'is_bot_autoreply');
    if (!hasCol) {
      sqlite.exec(`ALTER TABLE relay_nodes ADD COLUMN is_bot_autoreply INTEGER DEFAULT 0`);
      console.log('[migrate] v67: relay_nodes.is_bot_autoreply column added.');
    }
  }

  // v68: retail_dex_orders — retail DEX order ledger for retail-proxy skill
  {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS retail_dex_orders (
        id TEXT PRIMARY KEY,
        user_kasia_address TEXT NOT NULL,
        side TEXT NOT NULL CHECK(side IN ('buy_kas','sell_kas')),
        order_type TEXT NOT NULL CHECK(order_type IN ('market','limit')),
        qty TEXT NOT NULL,
        price TEXT,
        pay_chain TEXT,
        pay_address TEXT,
        receive_address TEXT,
        quoted_usdt TEXT,
        state TEXT NOT NULL DEFAULT 'aligning' CHECK(state IN ('aligning','confirming','awaiting_payment','paid','executing','completed','refunding','refunded','failed','expired')),
        pay_tx_hash TEXT,
        exchange_offer_id TEXT,
        deliver_tx_hash TEXT,
        refund_tx_hash TEXT,
        error_reason TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_retail_dex_user ON retail_dex_orders(user_kasia_address, state);
      CREATE INDEX IF NOT EXISTS idx_retail_dex_state ON retail_dex_orders(state, updated_at);
    `);
    console.log('[migrate] v68: retail_dex_orders table created.');

    const hasCol = sqlite.prepare("PRAGMA table_info(relay_nodes)").all()
      .some(c => c.name === 'is_dex_broker');
    if (!hasCol) {
      sqlite.exec(`ALTER TABLE relay_nodes ADD COLUMN is_dex_broker INTEGER DEFAULT 0`);
      console.log('[migrate] v68: relay_nodes.is_dex_broker column added.');
    }
  }

  // v69: retail_dex_orders.agent_pay_addr + agent_deliver_addr (T6)
  // agent 的 USDT 收款地址 (买场景) 或 KAS 交付来源 (卖场景)
  {
    const hasCol = sqlite.prepare("PRAGMA table_info(retail_dex_orders)").all()
      .some(c => c.name === 'agent_pay_addr');
    if (!hasCol) {
      sqlite.exec(`ALTER TABLE retail_dex_orders ADD COLUMN agent_pay_addr TEXT`);
      console.log('[migrate] v69: retail_dex_orders.agent_pay_addr column added.');
    }
    const hasCol2 = sqlite.prepare("PRAGMA table_info(retail_dex_orders)").all()
      .some(c => c.name === 'mid_price_at_quote');
    if (!hasCol2) {
      sqlite.exec(`ALTER TABLE retail_dex_orders ADD COLUMN mid_price_at_quote TEXT`);
      console.log('[migrate] v69: retail_dex_orders.mid_price_at_quote column added.');
    }
  }

  // v70 (2026-04-23): 回填 handshake orphan — status='observed' 但链上已有本地发出的 outbound handshake
  //
  // Bug 历史: 2026-04-14 在 3 处加的 pending_action guard 用错字段 (handshake_observed_at 而非
  // handshake_accepted_at), 导致 inbound 握手 → pending_action 不入队. 同时 ingest-service.js
  // 的 outbound handshake 分支只 update pending_actions 不调 acceptHandshake, 依赖 scout/discovery.js
  // 的 relation_states 推进, 但 discovery.js:289 按 chain_events.txid 整段 dedup,
  // relay 先写 chain_events → scout 来晚被跳过 → acceptHandshake 永远不调 →
  // relation_states 永远停在 observed, 即使链上双向握手都已完成.
  //
  // 本 migrate 一次性回填所有符合"链上已握手成功但状态卡 observed"的行:
  //   1. status='observed' 且 handshake_accepted_at 为空
  //   2. chain_events 有 event_type='handshake' from=local_address to=peer_address (本地 Agent 发出过)
  // 推进为 accepted + 填 handshake_accepted_at (取 outbound chain_events 的 observed_at) +
  // 升级 classification (seen_candidate/declared_candidate → responsive_agent)
  {
    const now = new Date().toISOString();
    const backfill = sqlite.prepare(`
      UPDATE relation_states
      SET status = 'accepted',
          handshake_accepted_at = (
            SELECT ce.observed_at FROM chain_events ce
            WHERE ce.event_type = 'handshake'
              AND ce.from_address = relation_states.local_address
              AND ce.to_address = relation_states.peer_address
            ORDER BY ce.observed_at LIMIT 1
          ),
          classification = CASE
            WHEN classification IN ('seen_candidate', 'declared_candidate') THEN 'responsive_agent'
            ELSE classification
          END,
          updated_at = ?
      WHERE status = 'observed'
        AND handshake_accepted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM chain_events ce
          WHERE ce.event_type = 'handshake'
            AND ce.from_address = relation_states.local_address
            AND ce.to_address = relation_states.peer_address
        )
    `).run(now);
    if (backfill.changes > 0) {
      console.log(`[migrate] v70: backfilled ${backfill.changes} orphan relation_states → accepted (had outbound handshake but stuck observed, bug #4)`);
    } else {
      console.log('[migrate] v70: no orphan relation_states to backfill');
    }
  }

  // v71 (2026-04-23): retail_dex_broker_config — DEX broker 撮合费配置
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='retail_dex_broker_config'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS retail_dex_broker_config (
          broker_relay_id TEXT PRIMARY KEY,
          fee_kas_per_order TEXT NOT NULL DEFAULT '0.1',
          fee_display_name TEXT DEFAULT '撮合服务费',
          public_disclosure INTEGER DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      console.log('[migrate] v71: retail_dex_broker_config table created.');
    }
  }

  // v72 (2026-04-23): retail_dex_orders add 4 fields (group_id/broker_fee_kas/net_delivery_kas/expires_user_set)
  {
    const existing = sqlite.prepare('PRAGMA table_info(retail_dex_orders)').all();
    const existingCols = new Set(existing.map(c => c.name));

    const fields = [
      { name: 'group_id', type: 'TEXT' },
      { name: 'broker_fee_kas', type: 'TEXT' },
      { name: 'net_delivery_kas', type: 'TEXT' },
      { name: 'expires_user_set', type: 'TEXT' },
    ];

    const altered = [];
    for (const f of fields) {
      if (!existingCols.has(f.name)) {
        sqlite.exec(`ALTER TABLE retail_dex_orders ADD COLUMN ${f.name} ${f.type}`);
        altered.push(f.name);
      }
    }
    if (altered.length > 0) {
      console.log(`[migrate] v72: added columns to retail_dex_orders: ${altered.join(', ')}`);
    }
  }

  // v73 (2026-04-23): retail_dex_user_memory — 用户偏好记忆蒸馏
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='retail_dex_user_memory'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS retail_dex_user_memory (
          user_kasia_address TEXT PRIMARY KEY,
          distilled_summary TEXT,
          preferred_chain TEXT,
          preferred_pay_address TEXT,
          tone_preference TEXT,
          notable_preferences TEXT,
          last_distilled_at TEXT,
          message_count_at_distill INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      console.log('[migrate] v73: retail_dex_user_memory table created.');
    }
  }

  // v74 (2026-04-23): retail_dex_buy_publications — Seeder 代用户挂 BUY offer
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='retail_dex_buy_publications'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS retail_dex_buy_publications (
          id TEXT PRIMARY KEY,
          user_kasia_address TEXT NOT NULL,
          broker_relay_id TEXT NOT NULL,
          seeder_relay_id TEXT NOT NULL,
          side TEXT NOT NULL CHECK(side = 'buy_kas'),
          qty TEXT NOT NULL,
          limit_price TEXT NOT NULL,
          total_usdt TEXT NOT NULL,
          pay_chain TEXT NOT NULL,
          user_usdt_deposit_tx TEXT,
          seeder_publish_offer_id TEXT,
          state TEXT NOT NULL CHECK(state IN (
            'awaiting_deposit',
            'deposited',
            'published',
            'filled',
            'completed',
            'refunding',
            'refunded',
            'failed'
          )),
          expires_at TEXT NOT NULL,
          filled_at TEXT,
          kas_delivery_tx TEXT,
          usdt_refund_tx TEXT,
          error_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_buy_pub_user
          ON retail_dex_buy_publications(user_kasia_address, state);
        CREATE INDEX IF NOT EXISTS idx_buy_pub_state
          ON retail_dex_buy_publications(state, expires_at);
      `);
      console.log('[migrate] v74: retail_dex_buy_publications table created.');
    }
  }

  // v75: polymarket_market_results — cache on-chain winner so panel doesn't re-hit RPC
  {
    const hasTable = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='polymarket_market_results'"
    ).get();
    if (!hasTable) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS polymarket_market_results (
          condition_id TEXT PRIMARY KEY,
          winner_outcome TEXT,
          payout_numerators TEXT,
          payout_denominator TEXT,
          resolved_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      console.log('[migrate] v75: polymarket_market_results table created (winner cache).');
    }
  }

  console.log('[migrate] DB migrations complete.');
}
