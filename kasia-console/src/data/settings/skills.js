import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';
import { listRelayNodes } from './relay-nodes.js';

// Trust hierarchy: owner can access everything, recommended is a reputation signal, normal only basics
const TRUST_RANK = { owner: 3, recommended: 2, normal: 1 };

/**
 * List skills, optionally filtered.
 * @param {object} opts
 * @param {string} [opts.status] - 'active' | 'frozen' | 'disabled'
 * @param {string} [opts.maxTrust] - max trust level to include (filters by hierarchy)
 * @param {string} [opts.relayNodeId] - filter by account; also includes global skills (relay_node_id IS NULL)
 */
export async function listSkills({ status, maxTrust, relayNodeId } = {}) {
  let rows = sqlite.prepare('SELECT * FROM skills ORDER BY relay_node_id ASC, source ASC, name ASC').all();
  if (status) rows = rows.filter(r => r.status === status);
  if (maxTrust && TRUST_RANK[maxTrust] !== undefined) {
    const rank = TRUST_RANK[maxTrust];
    rows = rows.filter(r => (TRUST_RANK[r.min_trust_level] || 0) <= rank);
  }
  if (relayNodeId) {
    // Include skills for this specific account + global skills (null)
    rows = rows.filter(r => r.relay_node_id === relayNodeId || r.relay_node_id === null);
  }
  return rows;
}

export async function getSkillById(id) {
  return sqlite.prepare('SELECT * FROM skills WHERE id=?').get(id);
}

export async function getSkillByName(name, relayNodeId) {
  if (relayNodeId) {
    return sqlite.prepare('SELECT * FROM skills WHERE name=? AND relay_node_id=?').get(name, relayNodeId);
  }
  // Fallback: prefer global (builtin) skills
  return sqlite.prepare('SELECT * FROM skills WHERE name=? AND relay_node_id IS NULL').get(name)
    || sqlite.prepare('SELECT * FROM skills WHERE name=? LIMIT 1').get(name);
}

export async function createSkill({ relayNodeId = null, name, displayName, description = '', actionType = 'builtin', actionConfigJson = null, minTrustLevel = 'owner', sideEffectLevel = 'metadata_write', status = 'disabled', source = 'manual' }) {
  const now = nowIso();
  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO skills (id, relay_node_id, name, display_name, description, action_type, action_config_json, min_trust_level, side_effect_level, status, source, invoke_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, relayNodeId, name, displayName, description, actionType, actionConfigJson, minTrustLevel, sideEffectLevel, status, source, now, now);
  return id;
}

export async function updateSkill(id, { displayName, description, actionType, actionConfigJson, minTrustLevel, sideEffectLevel, status }) {
  const now = nowIso();
  const fields = [];
  const vals = [];
  if (displayName !== undefined) { fields.push('display_name=?'); vals.push(displayName); }
  if (description !== undefined) { fields.push('description=?'); vals.push(description); }
  if (actionType !== undefined) { fields.push('action_type=?'); vals.push(actionType); }
  if (actionConfigJson !== undefined) { fields.push('action_config_json=?'); vals.push(actionConfigJson); }
  if (minTrustLevel !== undefined) { fields.push('min_trust_level=?'); vals.push(minTrustLevel); }
  if (sideEffectLevel !== undefined) { fields.push('side_effect_level=?'); vals.push(sideEffectLevel); }
  if (status !== undefined) { fields.push('status=?'); vals.push(status); }
  if (fields.length === 0) return;
  fields.push('updated_at=?');
  vals.push(now, id);
  sqlite.prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id=?`).run(...vals);
}

export async function invokeSkill(id) {
  const now = nowIso();
  sqlite.prepare('UPDATE skills SET invoke_count = invoke_count + 1, last_invoked_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
}

export async function deleteSkill(id) {
  // Protect only builtins from deletion; mind skills can be uninstalled
  const row = sqlite.prepare("SELECT name, source, action_type FROM skills WHERE id=?").get(id);
  if (!row) return false;
  if (row.source === 'builtin') return false;

  // Delete the DB row first
  sqlite.prepare('DELETE FROM skills WHERE id=?').run(id);

  // If mind skill, only remove .mjs file when no other account still has it
  if (row.action_type === 'mind') {
    const othersExist = sqlite.prepare(
      "SELECT id FROM skills WHERE name = ? AND action_type = 'mind' LIMIT 1"
    ).get(row.name);
    if (!othersExist) {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
        const SKILLS_DIR = `${KANET_ROOT}/agent-mind/src/skills`;
        const files = await fs.readdir(SKILLS_DIR);
        for (const f of files) {
          if (!f.endsWith('.mjs')) continue;
          const content = await fs.readFile(path.default.join(SKILLS_DIR, f), 'utf-8');
          const m = content.match(/super\(\s*'([^']+)'/);
          if (m && m[1] === row.name) {
            await fs.unlink(path.default.join(SKILLS_DIR, f));
            console.log(`[skills] Removed skill file: ${f} (no accounts remain)`);
            break;
          }
        }
      } catch (err) {
        console.log(`[skills] Could not remove skill file: ${err.message}`);
      }
    } else {
      console.log(`[skills] Kept skill file for ${row.name} (other accounts still use it)`);
    }
  }

  return true;
}

/**
 * Auto-register Mind skills by scanning the agent-mind skills directory.
 * Creates one skill row per relay_node (account), so each account can
 * independently enable/disable/customize its skills.
 * Existing per-account skills are left untouched (user may have changed status).
 */
export async function registerMindSkills(skillsDir) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const SKIP = new Set(['base.mjs', 'registry.mjs']);
  let files;
  try {
    files = await fs.readdir(skillsDir);
  } catch {
    console.log('[skills] Mind skills directory not found:', skillsDir);
    return 0;
  }

  const skillFiles = files.filter(f => f.endsWith('.mjs') && !SKIP.has(f));
  const relayNodes = listRelayNodes();

  if (relayNodes.length === 0) {
    console.log('[skills] No relay nodes found, skipping mind skill registration');
    return 0;
  }

  // Migrate: copy global mind skills (relay_node_id IS NULL) to per-account rows
  const globalMindSkills = sqlite.prepare(
    "SELECT * FROM skills WHERE action_type = 'mind' AND relay_node_id IS NULL"
  ).all();
  if (globalMindSkills.length > 0) {
    console.log(`[skills] Migrating ${globalMindSkills.length} global mind skill(s) to per-account...`);
    for (const gs of globalMindSkills) {
      for (const rn of relayNodes) {
        const exists = sqlite.prepare(
          "SELECT id FROM skills WHERE name = ? AND action_type = 'mind' AND relay_node_id = ?"
        ).get(gs.name, rn.id);
        if (exists) continue;
        const now = nowIso();
        sqlite.prepare(`
          INSERT INTO skills (id, relay_node_id, name, display_name, description,
            action_type, action_config_json, min_trust_level, side_effect_level,
            status, source, invoke_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'mind', ?, ?, ?, ?, 'mind', 0, ?, ?)
        `).run(randomUUID(), rn.id, gs.name, gs.display_name, gs.description,
          gs.action_config_json, gs.min_trust_level, gs.side_effect_level,
          gs.status, now, now);
        console.log(`[skills] Migrated ${gs.name} → account ${rn.name}`);
      }
      // Remove the global row after all accounts have their copy
      sqlite.prepare("DELETE FROM skills WHERE id = ?").run(gs.id);
    }
  }

  // Backfill: inherit category for skills stuck in 'other' when sibling agents have a proper category
  const miscategorized = sqlite.prepare(
    "SELECT DISTINCT s.name FROM skills s WHERE s.action_type = 'mind' AND s.category = 'other' AND EXISTS (SELECT 1 FROM skills s2 WHERE s2.name = s.name AND s2.action_type = 'mind' AND s2.category != 'other')"
  ).all();
  for (const { name } of miscategorized) {
    const sibling = sqlite.prepare(
      "SELECT category FROM skills WHERE name = ? AND action_type = 'mind' AND category != 'other' LIMIT 1"
    ).get(name);
    if (sibling?.category) {
      const updated = sqlite.prepare(
        "UPDATE skills SET category = ? WHERE name = ? AND action_type = 'mind' AND category = 'other'"
      ).run(sibling.category, name);
      if (updated.changes) console.log(`[skills] Backfilled category '${sibling.category}' for ${name} (${updated.changes} rows)`);
    }
  }

  // Register new skill files for each account
  let registered = 0;

  for (const file of skillFiles) {
    try {
      const fullPath = path.default.join(skillsDir, file);
      const content = await fs.readFile(fullPath, 'utf-8');
      // Extract name and description from: super('name', 'description') — supports multiline
      const match = content.match(/super\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/s);
      if (!match) continue;

      const [, name, description] = match;

      // Inherit category from existing same-name skill (if another agent already has it classified)
      const sibling = sqlite.prepare(
        "SELECT category, min_trust_level, side_effect_level FROM skills WHERE name = ? AND action_type = 'mind' AND category != 'other' LIMIT 1"
      ).get(name);

      for (const rn of relayNodes) {
        const existing = sqlite.prepare(
          "SELECT id FROM skills WHERE name = ? AND action_type = 'mind' AND relay_node_id = ?"
        ).get(name, rn.id);
        if (existing) continue;

        const now = nowIso();
        sqlite.prepare(`
          INSERT INTO skills (id, relay_node_id, name, display_name, description,
            action_type, min_trust_level, side_effect_level, status, source, category,
            invoke_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'mind', ?, ?, 'active', 'mind', ?, 0, ?, ?)
        `).run(randomUUID(), rn.id, name, name, description,
          sibling?.min_trust_level || 'normal',
          sibling?.side_effect_level || 'read_only',
          sibling?.category || 'other',
          now, now);
        registered++;
        console.log(`[skills] Mind skill registered: ${name} → account ${rn.name}${sibling?.category ? ' (cat: ' + sibling.category + ')' : ''}`);
      }
    } catch (err) {
      console.log(`[skills] Failed to register ${file}: ${err.message}`);
    }
  }

  // ── Package skills: scan subdirectories with skill.json (same path as .mjs) ──
  const subdirs = files.filter(f => !f.includes('.'));
  for (const dir of subdirs) {
    try {
      const skillJsonPath = path.default.join(skillsDir, dir, 'skill.json');
      const meta = JSON.parse(await fs.readFile(skillJsonPath, 'utf-8'));
      if (!meta.id) continue;
      const name = meta.id;
      const desc = meta.description || meta.name || dir;
      // Clean up underscore variants (legacy bug: hyphens were converted to underscores)
      const underscoreName = name.replace(/-/g, '_');
      if (underscoreName !== name) {
        const cleaned = sqlite.prepare(
          "DELETE FROM skills WHERE name = ? AND action_type = 'mind'"
        ).run(underscoreName);
        if (cleaned.changes) console.log(`[skills] Cleaned ${cleaned.changes} legacy underscore variant(s): ${underscoreName}`);
      }
      const sibling = sqlite.prepare(
        "SELECT category, min_trust_level, side_effect_level FROM skills WHERE name = ? AND action_type = 'mind' AND category != 'other' LIMIT 1"
      ).get(name);
      for (const rn of relayNodes) {
        const existing = sqlite.prepare(
          "SELECT id FROM skills WHERE name = ? AND action_type = 'mind' AND relay_node_id = ?"
        ).get(name, rn.id);
        if (existing) continue;
        const now = nowIso();
        sqlite.prepare(`
          INSERT INTO skills (id, relay_node_id, name, display_name, description,
            action_type, min_trust_level, side_effect_level, status, source, category,
            invoke_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'mind', ?, ?, 'active', 'mind', ?, 0, ?, ?)
        `).run(randomUUID(), rn.id, name, meta.name || dir, desc,
          sibling?.min_trust_level || 'owner',
          sibling?.side_effect_level || 'system_write',
          sibling?.category || null,
          now, now);
        registered++;
        console.log(`[skills] Package skill registered: ${name} → account ${rn.name}${sibling?.category ? ' (cat: ' + sibling.category + ')' : ''}`);
      }
    } catch {}
  }

  if (registered > 0) console.log(`[skills] ${registered} new mind skill row(s) registered`);
  return registered;
}
