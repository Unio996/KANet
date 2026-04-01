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

export async function registerSkillRoutes(fastify) {
  // --- API routes (adapter / programmatic access, requires auth) ---

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/skills')) {
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
    return reply.view('skills', { skills, relayNodes, selectedAccount, t, dir, lang, langs, VALID_TRUST, VALID_STATUS });
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
    await updateSkill(request.params.id, {
      displayName, description, actionType, actionConfigJson,
      minTrustLevel: VALID_TRUST.includes(minTrustLevel) ? minTrustLevel : undefined,
      sideEffectLevel: VALID_EFFECTS.includes(sideEffectLevel) ? sideEffectLevel : undefined,
      status: VALID_STATUS.includes(status) ? status : undefined,
    });
    return reply.redirect('/skills');
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
