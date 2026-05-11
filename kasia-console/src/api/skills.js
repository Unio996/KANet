import { verifyIngestRequest } from '../services/ingest-auth.js';
import { listSkills, getSkillById, createSkill, updateSkill, invokeSkill, deleteSkill, getSkillByName } from '../data/settings/skills.js';
import { listRelayNodes } from '../data/settings/relay-nodes.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { getAddressTrustLevel, getIdentityByAddress, upsertIdentity, annotateIdentity } from '../data/settings/identities.js';
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { nowIso } from '../lib/time.js';

const VALID_TRUST = ['owner', 'recommended', 'normal'];
const VALID_STATUS = ['active', 'disabled'];
const VALID_SOURCE = ['builtin', 'manual', 'auto'];
const VALID_EFFECTS = ['read_only', 'metadata_write', 'relationship_change', 'network_action', 'financial_action'];
const TRUST_RANK = { owner: 3, recommended: 2, normal: 1, blocked: 0 };
const KASPA_ADDR_RE = /^kaspa:[a-z0-9]{10,}$/;
const REASON_MAX_LEN = 200;

// 议 2 (Owner 17:33 钦定): broker/service relay 不允许 active 这些 category 的 skill.
// Owner 真测痛点: Trader-B (broker=1, service=1) 装了 social_outreach 等非交易 skill 导致行为不专.
// 'core' / 'perception' / 'trading' / 'info' / 'dev' / 'self' 允许; 'social' / 'contacts' / 'other' 拒.
const BROKER_BANNED_CATEGORIES = ['social', 'contacts', 'other'];

// Owner 19:18 钦定 (基于 invoke_count 真数据 + Trader-A 30 active 太杂体验): 正向白名单
// agent 标 broker/service role 那一刻 → 自动只 active 这 10 个推荐 + disable 其他, 不需要
// owner 一个个看哪些不该装. role-based defaults + auto-apply.
const TRADER_RECOMMENDED_SKILLS = new Set([
  // 核心交易 (5)
  'price_tracker', 'trade_executor', 'market_scanner', 'mm_otc', 'cross_chain_verify',
  // 情报辅助 (2)
  'address_profiler', 'kaspa_network_health',
  // 感知 (1)
  'trade_sense',
  // self/core (2)
  'self_awareness', 'system_status',
]);

function _checkBrokerSkillCompat(skill, newStatus) {
  if (newStatus !== 'active') return { ok: true };
  if (!skill || !skill.relay_node_id) return { ok: true };  // global skill, 不限
  const relay = sqlite.prepare('SELECT is_dex_broker, is_service, name FROM relay_nodes WHERE id=?').get(skill.relay_node_id);
  if (!relay) return { ok: true };
  if (!relay.is_dex_broker && !relay.is_service) return { ok: true };  // 非 broker/service, 不限
  if (BROKER_BANNED_CATEGORIES.includes(skill.category || 'other')) {
    return {
      ok: false,
      reason: 'broker_role_skill_mismatch',
      message: `'${skill.name}' (category=${skill.category||'other'}) 不允许在 broker/service relay '${relay.name}' 上 active. broker 角色仅允许: core/perception/trading/info/dev/self.`,
    };
  }
  return { ok: true };
}

// T-J2-2026-05-11 Phase 2 ζ.4 (Owner 5/11 钦定 + NWT #14 propose + NWT #15 ack J2 微调):
// 4-role skill whitelist guard。relay_nodes.role column (migrate v95) 驱动 skill bind policy。
// - broker: matcher / order-book / cex-bridge (active broker)
// - trader: matcher / order-book (alternate broker / maker / taker)
// - predictor: polymarket-trader / sports-tracker (Bettor)
// - dev: [] (通用 agent 禁交易 skill)
// - user: wallet-query (真实 Kasia user 不允 matcher 避免 stranger 抢单)
//
// ROLE_SKILL_ALLOWED 仅覆 trading 相关 skill — 其他通用 skill (greeting / chat / etc) 不限。
// guard 仅当 skill.name ∈ TRADING_SKILLS_SET 时 enforce role check。
const ROLE_SKILL_ALLOWED = {
  broker: ['matcher', 'order-book', 'cex-bridge'],
  trader: ['matcher', 'order-book'],
  user: ['wallet-query'],
  predictor: ['polymarket-trader', 'sports-tracker'],
  dev: [],
};
const TRADING_SKILLS_SET = new Set([
  'matcher', 'order-book', 'cex-bridge', 'polymarket-trader', 'sports-tracker', 'wallet-query',
]);

function _checkRoleSkillCompat(skill, newStatus) {
  if (newStatus !== 'active') return { ok: true };
  if (!skill || !skill.relay_node_id) return { ok: true };  // global skill, 不限
  if (!TRADING_SKILLS_SET.has(skill.name)) return { ok: true };  // 非交易 skill, 不 enforce role check
  const relay = sqlite.prepare('SELECT role, name FROM relay_nodes WHERE id=?').get(skill.relay_node_id);
  if (!relay || !relay.role) return { ok: true };  // role column 未 backfill (legacy 数据), 不限
  const allowed = ROLE_SKILL_ALLOWED[relay.role];
  if (!allowed) return { ok: true };  // unknown role, 不限 (forward-compat)
  if (!allowed.includes(skill.name)) {
    return {
      ok: false,
      reason: 'role_skill_mismatch',
      message: `'${skill.name}' 不允许在 role='${relay.role}' relay '${relay.name}' 上 active. role 允许: [${allowed.join(', ') || '(none)'}].`,
    };
  }
  return { ok: true };
}

export async function registerSkillRoutes(fastify) {
  // --- API routes (adapter / programmatic access, requires auth) ---

  fastify.addHook('preHandler', async (request, reply) => {
    // 议 2 (T-J2-V2): /api/skills/role-compat 是 UI 用的 read-only endpoint, 不需要 ingest auth.
    // 所有其他 /api/skills/* 路径仍然需要 (programmatic access auth).
    if (request.url.startsWith('/api/skills') && !request.url.startsWith('/api/skills/role-compat')) {
      await verifyIngestRequest(request, reply);
    }
  });

  // List skills (filterable by status, max trust level, and account)
  fastify.get('/api/skills', async (request, reply) => {
    const { status, max_trust, relay_node_id } = request.query;
    const skills = await listSkills({
      status: status || undefined,
      maxTrust: max_trust || undefined,
      relayNodeId: relay_node_id || undefined,
    });
    return reply.send({ skills });
  });

  // Increment invoke count
  fastify.post('/api/skills/:id/invoke', async (request, reply) => {
    await invokeSkill(request.params.id);
    return reply.send({ ok: true });
  });

  // Validate + execute a skill (double-validation from adapter)
  fastify.post('/api/skills/execute', async (request, reply) => {
    const { skillName, peer, network, params, correlationId } = request.body || {};
    if (!skillName) return reply.code(400).send({ error: 'skillName required' });

    // 1. Look up skill by name
    const skill = await getSkillByName(skillName);
    if (!skill) return reply.send({ allowed: false, reason: 'skill_not_found' });

    // 2. Check skill status
    if (skill.status !== 'active') return reply.send({ allowed: false, reason: 'skill_not_active' });

    // 3. Look up peer trust level
    // Peers who can send on-chain messages are at least 'normal' — treat unknown as normal
    const rawTrust = peer && network ? await getAddressTrustLevel(network, peer) : 'unknown';
    const peerTrust = rawTrust === 'unknown' ? 'normal' : rawTrust;
    const peerRank = TRUST_RANK[peerTrust] ?? 0;
    const requiredRank = TRUST_RANK[skill.min_trust_level] ?? 0;

    // 4. Compare trust
    if (peerRank < requiredRank) {
      return reply.send({ allowed: false, reason: 'insufficient_trust', peerTrust, required: skill.min_trust_level });
    }

    // Idempotency check: skip execution if this correlationId was already executed
    if (correlationId) {
      const existing = sqlite.prepare("SELECT id FROM events WHERE trace_id = ? AND event_type = 'skill_executed' LIMIT 1").get(correlationId);
      if (existing) {
        return reply.send({ allowed: true, executed: false, replayed: true, skillId: skill.id });
      }
    }

    // 5. Skill-specific pre-validation
    if (skillName === 'introduce') {
      const target = params?.target;
      if (!target) return reply.send({ allowed: false, reason: 'target_required' });
      if (!KASPA_ADDR_RE.test(target)) return reply.send({ allowed: false, reason: 'invalid_target_address' });
      if (target === peer) return reply.send({ allowed: false, reason: 'cannot_introduce_self' });
      // Prevent introducing the node's own relay addresses
      const localAddrs = listRelayNodes().map(r => r.address).filter(Boolean);
      if (localAddrs.includes(target)) return reply.send({ allowed: false, reason: 'cannot_introduce_local_node' });
      if (params?.reason && params.reason.length > REASON_MAX_LEN) {
        return reply.send({ allowed: false, reason: 'reason_too_long', maxLength: REASON_MAX_LEN });
      }
    }

    // 6. Execute built-in skill actions
    try {
      // Ensure peer identity exists
      const identityId = await upsertIdentity({ network: network || 'mainnet', address: peer, displayName: null });

      switch (skillName) {
        case 'annotate':
          await annotateIdentity(identityId, {
            tags: params?.tags,
            notes: params?.notes,
            trustLevel: params?.trust_level,
          });
          break;
        case 'block':
          await annotateIdentity(identityId, { trustLevel: 'blocked' });
          break;
        case 'unblock':
          await annotateIdentity(identityId, { trustLevel: 'normal' });
          break;
        case 'introduce': {
          const target = params.target;
          const reason = params.reason ? params.reason.slice(0, REASON_MAX_LEN) : '';
          // Upsert target identity — notes get brief summary only
          const targetId = await upsertIdentity({ network: network || 'mainnet', address: target, displayName: null });
          await annotateIdentity(targetId, {
            notes: `Introduced by ${peer.slice(-12)}`,
            tags: 'introduced',
          });
          // Full reason goes into the event payload (events = audit, notes = status)
          if (correlationId) {
            sqlite.prepare(
              `INSERT INTO events (id, trace_id, event_scope, event_type, source, level, summary, payload_json, created_at)
               VALUES (?, ?, 'skill', 'intro_registered', 'console', 'info', ?, ?, ?)`
            ).run(randomUUID(), correlationId, `Introduced: ${target.slice(-12)} by ${peer.slice(-12)}`,
              JSON.stringify({ target, peer, reason, network }), nowIso());
          }
          break;
        }
        default:
          // Non-builtin skills: no execution logic yet
          break;
      }
    } catch (e) {
      return reply.code(500).send({ allowed: true, executed: false, error: e.message });
    }

    // 7. Increment invoke count
    await invokeSkill(skill.id);

    // 8. Record skill_executed event for idempotency tracking
    if (correlationId) {
      sqlite.prepare(
        `INSERT INTO events (id, trace_id, event_scope, event_type, source, level, summary, payload_json, created_at)
         VALUES (?, ?, 'skill', 'skill_executed', 'console', 'info', ?, ?, ?)`
      ).run(randomUUID(), correlationId, `Executed: ${skillName}`, JSON.stringify({ skillName, peer, network }), nowIso());
    }

    return reply.send({ allowed: true, executed: true, skillId: skill.id });
  });

  // Auto-register a skill (for adapter / agent self-learning)
  fastify.post('/api/skills/register', async (request, reply) => {
    const { name, displayName, description, actionType, actionConfigJson, minTrustLevel, relayNodeId, sideEffectLevel } = request.body || {};
    if (!name || !displayName) return reply.code(400).send({ error: 'name and displayName required' });
    const id = await createSkill({
      relayNodeId: relayNodeId || null,
      name, displayName, description,
      actionType: actionType || 'builtin',
      actionConfigJson: actionConfigJson || null,
      minTrustLevel: minTrustLevel || 'owner',
      sideEffectLevel: VALID_EFFECTS.includes(sideEffectLevel) ? sideEffectLevel : 'metadata_write',
      status: 'disabled',  // Auto-registered skills are disabled by default
      source: 'auto',
    });
    return reply.send({ ok: true, id });
  });

  // --- UI routes (browser access, no auth) ---

  // Skills management page
  fastify.get('/skills', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const relayNodes = listRelayNodes();
    // Default to first agent (not "all") — showing 68+ skills is overwhelming for users
    const selectedAccount = request.query.account || (relayNodes.length > 0 ? relayNodes[0].id : '');
    const skills = await listSkills({
      relayNodeId: selectedAccount || undefined,
    });
    // 议 3 (T-J2-V2): 选中 relay 是否 broker/service role → UI 灰显 banned + 显示 role badge
    let roleCompat = null;
    if (selectedAccount) {
      const r = sqlite.prepare('SELECT id, name, is_dex_broker, is_service FROM relay_nodes WHERE id=?').get(selectedAccount);
      if (r) {
        const isBrokerRole = !!(r.is_dex_broker || r.is_service);
        roleCompat = {
          relay: r,
          is_broker_role: isBrokerRole,
          banned_categories: isBrokerRole ? BROKER_BANNED_CATEGORIES : [],
          allowed_categories: isBrokerRole
            ? ['core', 'perception', 'trading', 'info', 'dev', 'self']
            : null,
        };
      }
    }
    return reply.view('skills', { skills, relayNodes, selectedAccount, roleCompat, t, dir, lang, langs, VALID_TRUST, VALID_STATUS });
  });

  // 议 3 / Owner 19:18 钦定: 正向白名单 — broker/service relay 一键应用 trader 推荐模板.
  // 行为: active 推荐 10 个 (TRADER_RECOMMENDED_SKILLS) + disable 其他所有 active.
  // 不只是清 banned (反向), 是直接钦定白名单 (正向).
  function _doApplyTraderTemplate(relayNodeId) {
    const r = sqlite.prepare('SELECT id, name, is_dex_broker, is_service FROM relay_nodes WHERE id=?').get(relayNodeId);
    if (!r) return { ok: false, code: 404, error: 'relay_not_found' };
    if (!r.is_dex_broker && !r.is_service) {
      return { ok: false, code: 400, error: 'not_broker_role', message: '只有 broker/service relay 才能应用 trader 模板' };
    }
    const all = sqlite.prepare(`SELECT id, name, status FROM skills WHERE relay_node_id=?`).all(r.id);
    const now = nowIso();
    const enableStmt = sqlite.prepare(`UPDATE skills SET status='active', updated_at=? WHERE id=?`);
    const disableStmt = sqlite.prepare(`UPDATE skills SET status='disabled', updated_at=? WHERE id=?`);
    let enabled = [], disabled = [];
    for (const s of all) {
      const inTemplate = TRADER_RECOMMENDED_SKILLS.has(s.name);
      if (inTemplate && s.status !== 'active') {
        enableStmt.run(now, s.id);
        enabled.push(s.name);
      } else if (!inTemplate && s.status === 'active') {
        disableStmt.run(now, s.id);
        disabled.push(s.name);
      }
    }
    // 验最终: TRADER_RECOMMENDED_SKILLS 中 agent 没有该 skill (skill 不存在) 不报错, 只 log.
    const missing = [...TRADER_RECOMMENDED_SKILLS].filter(name =>
      !all.some(s => s.name === name)
    );
    return {
      ok: true,
      relay: r,
      enabled,
      disabled,
      missing,  // 推荐 set 中此 agent 没装的 skill (skill 表里没此 name)
      final_active_count: all.filter(s => TRADER_RECOMMENDED_SKILLS.has(s.name)).length,
    };
  }

  // 反向 (legacy 议 3): 只 disable banned category. 留作 fallback / 软清理路径.
  function _doResetRecommended(relayNodeId) {
    const r = sqlite.prepare('SELECT id, name, is_dex_broker, is_service FROM relay_nodes WHERE id=?').get(relayNodeId);
    if (!r) return { ok: false, code: 404, error: 'relay_not_found' };
    if (!r.is_dex_broker && !r.is_service) {
      return { ok: false, code: 400, error: 'not_broker_role', message: '只有 broker/service relay 才能用推荐复位' };
    }
    const banned = sqlite.prepare(`
      SELECT id, name, category FROM skills
      WHERE relay_node_id=? AND status='active'
        AND category IN (${BROKER_BANNED_CATEGORIES.map(()=>'?').join(',')})
    `).all(r.id, ...BROKER_BANNED_CATEGORIES);
    const now = nowIso();
    const stmt = sqlite.prepare(`UPDATE skills SET status='disabled', updated_at=? WHERE id=?`);
    let disabled = 0;
    for (const s of banned) { stmt.run(now, s.id); disabled++; }
    return {
      ok: true,
      relay: r,
      disabled_count: disabled,
      disabled_skills: banned.map(s => ({ name: s.name, category: s.category })),
    };
  }

  // JSON endpoint (programmatic / Alpine.js etc)
  fastify.post('/skills/reset-recommended', async (request, reply) => {
    const { relay_node_id } = request.body || {};
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const result = _doResetRecommended(relay_node_id);
    if (!result.ok) return reply.code(result.code).send(result);
    return reply.send(result);
  });

  // Form submit endpoint (Chrome 禁 JS 兼容, 议 3 UI 推荐配置按钮用)
  fastify.post('/skills/reset-recommended-form', async (request, reply) => {
    const { relay_node_id } = request.body || {};
    if (!relay_node_id) return reply.redirect('/skills');
    _doResetRecommended(relay_node_id);
    return reply.redirect('/skills?account=' + encodeURIComponent(relay_node_id));
  });

  // Owner 19:18 钦定 — 正向应用 trader 推荐模板 (active 推荐 + disable 其他)
  // JSON endpoint
  fastify.post('/skills/apply-trader-template', async (request, reply) => {
    const { relay_node_id } = request.body || {};
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const result = _doApplyTraderTemplate(relay_node_id);
    if (!result.ok) return reply.code(result.code).send(result);
    return reply.send(result);
  });
  // Form submit endpoint (Chrome 禁 JS 兼容)
  fastify.post('/skills/apply-trader-template-form', async (request, reply) => {
    const { relay_node_id } = request.body || {};
    if (!relay_node_id) return reply.redirect('/skills');
    _doApplyTraderTemplate(relay_node_id);
    return reply.redirect('/skills?account=' + encodeURIComponent(relay_node_id));
  });

  // Create skill from form
  fastify.post('/skills', async (request, reply) => {
    const { name, displayName, description, actionType, actionConfigJson, minTrustLevel, status, relayNodeId, sideEffectLevel } = request.body || {};
    if (!name || !displayName) return reply.redirect('/skills');
    await createSkill({
      relayNodeId: relayNodeId || null,
      name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      displayName: displayName.trim(),
      description: (description || '').trim(),
      actionType: actionType || 'builtin',
      actionConfigJson: actionConfigJson || null,
      minTrustLevel: VALID_TRUST.includes(minTrustLevel) ? minTrustLevel : 'owner',
      sideEffectLevel: VALID_EFFECTS.includes(sideEffectLevel) ? sideEffectLevel : 'metadata_write',
      status: VALID_STATUS.includes(status) ? status : 'disabled',
      source: 'manual',
    });
    return reply.redirect('/skills');
  });

  // Update skill from form
  fastify.post('/skills/:id', async (request, reply) => {
    const { displayName, description, actionType, actionConfigJson, minTrustLevel, status, sideEffectLevel } = request.body || {};
    // 议 2: broker/service role 拒 active 'social'/'contacts'/'other' category skill (Owner 17:33)
    // Phase 2 ζ.4 (Owner 5/11 钦定): + 4-role skill whitelist guard (broker/trader/predictor/dev/user)
    if (VALID_STATUS.includes(status)) {
      const skill = await getSkillById(request.params.id);
      const compat = _checkBrokerSkillCompat(skill, status);
      if (!compat.ok) {
        return reply.code(403).send({ error: compat.reason, message: compat.message });
      }
      const roleCompat = _checkRoleSkillCompat(skill, status);
      if (!roleCompat.ok) {
        return reply.code(403).send({ error: roleCompat.reason, message: roleCompat.message });
      }
    }
    await updateSkill(request.params.id, {
      displayName, description, actionType, actionConfigJson,
      minTrustLevel: VALID_TRUST.includes(minTrustLevel) ? minTrustLevel : undefined,
      sideEffectLevel: VALID_EFFECTS.includes(sideEffectLevel) ? sideEffectLevel : undefined,
      status: VALID_STATUS.includes(status) ? status : undefined,
    });
    return reply.redirect('/skills');
  });

  // 议 2: GET /api/skills/role-compat — UI 用此查 skill 是否允许在某 relay active
  fastify.get('/api/skills/role-compat', async (request, reply) => {
    const { relay_node_id } = request.query || {};
    if (!relay_node_id) return reply.code(400).send({ error: 'relay_node_id required' });
    const relay = sqlite.prepare('SELECT id, name, is_dex_broker, is_service FROM relay_nodes WHERE id=?').get(relay_node_id);
    if (!relay) return reply.code(404).send({ error: 'relay_not_found' });
    const isBrokerRole = !!(relay.is_dex_broker || relay.is_service);
    return reply.send({
      relay,
      is_broker_role: isBrokerRole,
      banned_categories: isBrokerRole ? BROKER_BANNED_CATEGORIES : [],
      allowed_categories: isBrokerRole
        ? ['core', 'perception', 'trading', 'info', 'dev', 'self']
        : null,  // null = 全允许
    });
  });

  // Delete skill from form
  fastify.post('/skills/:id/delete', async (request, reply) => {
    await deleteSkill(request.params.id);
    return reply.redirect('/skills');
  });

  // Rename a skill category (batch update, local UI, no auth)
  fastify.post('/skills/rename-category', async (request, reply) => {
    const { from, to } = request.body || {};
    if (!from || !to) return reply.code(400).send({ error: 'from and to required' });
    const result = sqlite.prepare('UPDATE skills SET category = ? WHERE category = ?').run(to.trim().toLowerCase(), from);
    return reply.send({ ok: true, updated: result.changes });
  });

  // Delete a category — moves all its skills to 'other' (local UI, no auth)
  fastify.post('/skills/delete-category', async (request, reply) => {
    const { category } = request.body || {};
    if (!category || category === 'other') return reply.code(400).send({ error: 'cannot delete "other"' });
    const result = sqlite.prepare("UPDATE skills SET category = 'other' WHERE category = ?").run(category);
    return reply.send({ ok: true, moved: result.changes });
  });

  // Upload a .mjs skill file → save to skills dir + register in DB
  fastify.post('/skills/upload', async (request, reply) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
    const SKILLS_DIR = `${KANET_ROOT}/agent-mind/src/skills`;

    const { fileName, fileContent, displayName, description, category } = request.body || {};
    if (!fileName || !fileContent) return reply.redirect('/skills');

    // Validate: must be .mjs, must contain extends Skill and super('name','desc')
    if (!fileName.endsWith('.mjs')) return reply.redirect('/skills');
    const match = fileContent.match(/super\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
    if (!match) return reply.redirect('/skills');

    const [, skillName] = match;

    // Save file
    const safeName = fileName.replace(/[^a-z0-9_\-.]/gi, '_');
    await fs.writeFile(path.default.join(SKILLS_DIR, safeName), fileContent, 'utf-8');

    // Register in DB via shared function (picks up the new file)
    const { registerMindSkills } = await import('../data/settings/skills.js');
    await registerMindSkills(SKILLS_DIR);

    // Update display_name, description, source, and category for all per-account copies
    const { updateSkill } = await import('../data/settings/skills.js');
    const { sqlite: db } = await import('../db/client.js');
    const rows = db.prepare(
      "SELECT id, display_name, description FROM skills WHERE name = ? AND action_type = 'mind'"
    ).all(skillName);
    for (const row of rows) {
      await updateSkill(row.id, {
        displayName: displayName || row.display_name,
        description: description || row.description,
      });
      // Mark as uploaded + set category
      db.prepare('UPDATE skills SET source = ?, category = ? WHERE id = ?')
        .run('uploaded', category || 'other', row.id);
    }

    return reply.redirect('/skills');
  });
}
