/**
 * Backup / Restore — Owner 主观数据的导入导出
 *
 * 只包含链上无 / 不可重建 的数据:
 *   - identities (display_name, tags, notes, trust_level)
 *   - relation_states (classification, trust_level, is_blocked)
 *   - relay_nodes mind config (social_style, social_overrides, principles_json, vision, style, focus)
 *
 * 不包含 (链上可重建 或 环境相关 或 加密敏感):
 *   - chain_events / messages / tx_records / broadcast_messages
 *   - exchange_offers / mm_orders
 *   - agent_connections / adapter_nodes (含加密凭证, 换机无效)
 *   - kanet.env / CONSOLE_ENCRYPTION_KEY (owner 单独备份)
 */
import { sqlite } from '../db/client.js';

const BACKUP_VERSION = 1;

export async function registerBackupRoutes(fastify) {
  // GET /api/backup/export — 下载 owner 主观数据 snapshot 为 JSON
  fastify.get('/api/backup/export', async (request, reply) => {
    const snapshot = buildExportSnapshot();
    const filename = `kanet-backup-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(snapshot);
  });

  // POST /api/backup/import — 导入 snapshot
  // mode: 'merge' (默认, 不覆盖非空字段) | 'replace' (覆盖所有)
  fastify.post('/api/backup/import', async (request, reply) => {
    const { snapshot, mode = 'merge' } = request.body || {};
    if (!snapshot || typeof snapshot !== 'object') {
      return reply.code(400).send({ ok: false, error: 'snapshot body required' });
    }
    if (snapshot.version !== BACKUP_VERSION) {
      return reply.code(400).send({
        ok: false,
        error: `unsupported version ${snapshot.version} (expected ${BACKUP_VERSION})`,
      });
    }
    try {
      const stats = applyImportSnapshot(snapshot, mode);
      return reply.send({ ok: true, ...stats });
    } catch (err) {
      console.error('[backup] import failed:', err);
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}

function buildExportSnapshot() {
  // 1. identities (只取有 owner-modified 字段的)
  const identities = sqlite.prepare(`
    SELECT address, network, display_name, tags, notes, trust_level
    FROM identities
    WHERE display_name IS NOT NULL
       OR tags IS NOT NULL
       OR notes IS NOT NULL
       OR (trust_level IS NOT NULL AND trust_level != 'normal')
  `).all();

  // 2. relation_states (所有行 — classification/trust_level/is_blocked 都是 owner-relevant)
  const relationStates = sqlite.prepare(`
    SELECT local_address, peer_address, classification, trust_level, is_blocked
    FROM relation_states
  `).all();

  // 3. relay_nodes mind config (social setup per agent)
  const agents = sqlite.prepare(`
    SELECT name, address, vision, principles_json, style,
           evolution_interval_hours, proactive_interval_minutes,
           social_style, social_overrides, focus
    FROM relay_nodes
    WHERE address IS NOT NULL
  `).all().map(r => ({
    name: r.name,
    address: r.address,
    vision: r.vision,
    principles: r.principles_json ? JSON.parse(r.principles_json) : [],
    style: r.style,
    evolutionIntervalHours: r.evolution_interval_hours,
    proactiveIntervalMinutes: r.proactive_interval_minutes,
    socialStyle: r.social_style,
    socialOverrides: r.social_overrides ? JSON.parse(r.social_overrides) : null,
    focus: r.focus,
  }));

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    stats: {
      identities: identities.length,
      relationStates: relationStates.length,
      agents: agents.length,
    },
    identities,
    relationStates,
    agents,
  };
}

function applyImportSnapshot(snapshot, mode) {
  const stats = { identities: 0, relationStates: 0, agents: 0, skipped: 0 };
  const replace = mode === 'replace';

  // 用事务包裹整个 import 以避免中途失败
  const tx = sqlite.transaction(() => {
    // ── identities ──
    for (const i of snapshot.identities || []) {
      if (!i.address) continue;
      const existing = sqlite.prepare('SELECT id, display_name, tags, notes, trust_level FROM identities WHERE address = ?').get(i.address);
      if (existing) {
        // Update — merge mode 不覆盖已有非空字段, replace 全覆盖
        const updates = [];
        const vals = [];
        const maybe = (col, existingVal, importVal) => {
          if (importVal == null) return;
          if (!replace && existingVal != null && existingVal !== '' && existingVal !== 'normal') return;
          updates.push(`${col} = ?`);
          vals.push(importVal);
        };
        maybe('display_name', existing.display_name, i.display_name);
        maybe('tags', existing.tags, i.tags);
        maybe('notes', existing.notes, i.notes);
        maybe('trust_level', existing.trust_level, i.trust_level);
        if (updates.length) {
          vals.push(existing.id);
          sqlite.prepare(`UPDATE identities SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...vals.slice(0, -1), new Date().toISOString(), existing.id);
          stats.identities++;
        } else {
          stats.skipped++;
        }
      } else {
        // 不创建新 identity — identities 应该由 Scout / ingest 发现, backup 只恢复 owner 改动
        stats.skipped++;
      }
    }

    // ── relation_states ──
    for (const r of snapshot.relationStates || []) {
      if (!r.local_address || !r.peer_address) continue;
      const existing = sqlite.prepare(
        'SELECT id, classification, trust_level, is_blocked FROM relation_states WHERE local_address = ? AND peer_address = ?'
      ).get(r.local_address, r.peer_address);
      if (existing) {
        const updates = [];
        const vals = [];
        const maybe = (col, existingVal, importVal) => {
          if (importVal == null) return;
          if (!replace && existingVal != null && existingVal !== '' && existingVal !== 'normal' && existingVal !== 'seen_candidate' && existingVal !== 0) return;
          updates.push(`${col} = ?`);
          vals.push(importVal);
        };
        maybe('classification', existing.classification, r.classification);
        maybe('trust_level', existing.trust_level, r.trust_level);
        maybe('is_blocked', existing.is_blocked, r.is_blocked);
        if (updates.length) {
          vals.push(existing.id);
          sqlite.prepare(`UPDATE relation_states SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...vals.slice(0, -1), new Date().toISOString(), existing.id);
          stats.relationStates++;
        } else {
          stats.skipped++;
        }
      } else {
        stats.skipped++;  // 不创建新 relation — 需要真实链上 handshake 才能创建
      }
    }

    // ── relay_nodes mind config ──
    // 按 address 匹配现有 agent (address 在新机器上应该一致 if 导入了助记词)
    for (const a of snapshot.agents || []) {
      if (!a.address) continue;
      const existing = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(a.address);
      if (!existing) { stats.skipped++; continue; }
      const updates = [];
      const vals = [];
      if (a.vision != null) { updates.push('vision = ?'); vals.push(a.vision); }
      if (a.principles != null) { updates.push('principles_json = ?'); vals.push(JSON.stringify(a.principles)); }
      if (a.style != null) { updates.push('style = ?'); vals.push(a.style); }
      if (a.evolutionIntervalHours != null) { updates.push('evolution_interval_hours = ?'); vals.push(a.evolutionIntervalHours); }
      if (a.proactiveIntervalMinutes != null) { updates.push('proactive_interval_minutes = ?'); vals.push(a.proactiveIntervalMinutes); }
      if (a.socialStyle != null) { updates.push('social_style = ?'); vals.push(a.socialStyle); }
      if (a.socialOverrides !== undefined) { updates.push('social_overrides = ?'); vals.push(a.socialOverrides ? JSON.stringify(a.socialOverrides) : null); }
      if (a.focus != null) { updates.push('focus = ?'); vals.push(a.focus); }
      if (updates.length) {
        vals.push(existing.id);
        sqlite.prepare(`UPDATE relay_nodes SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
        stats.agents++;
      } else {
        stats.skipped++;
      }
    }
  });

  tx();
  return stats;
}
