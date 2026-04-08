/**
 * Skill Registry
 *
 * Auto-discovers skills from the skills/ directory.
 * Queries Console DB for which skills are enabled (status='active').
 * Only loads .mjs files whose skill name is active in Console.
 *
 * Installing a new skill = drop a .mjs file into skills/ → restart Console + Mind.
 * Enabling/disabling = toggle in Console /skills UI.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Skill } from './base.mjs';
import { registerIntents, getIntentCount } from '../intent-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKIP_FILES = new Set(['base.mjs', 'registry.mjs']);

export class SkillRegistry {
  constructor(consoleUrl, relayNodeId) {
    this.skills = [];
    this.allDiscovered = [];
    this.consoleUrl = consoleUrl;
    this.relayNodeId = relayNodeId;
  }

  /**
   * Scan skills/ directory and register skills that are active in Console DB.
   */
  async autoDiscover() {
    // Query Console for active mind skills
    let activeNames = new Set();
    try {
      const qs = this.relayNodeId ? `?relay_node_id=${this.relayNodeId}` : '';
      const res = await fetch(`${this.consoleUrl}/api/agent/mind-skills${qs}`);
      const rows = await res.json();
      activeNames = new Set(rows.map(r => r.name));
      console.log(`[skills] Console reports ${activeNames.size} active mind skills: [${[...activeNames].join(', ')}]`);
    } catch (err) {
      console.log(`[skills] Console unreachable, enabling all discovered skills: ${err.message}`);
      activeNames = null; // null = fallback to all
    }

    // Scan local files
    const files = await fs.readdir(__dirname);
    const skillFiles = files.filter(f => f.endsWith('.mjs') && !SKIP_FILES.has(f));

    for (const file of skillFiles) {
      try {
        const mod = await import(`./${file}`);
        for (const key of Object.keys(mod)) {
          const Cls = mod[key];
          if (typeof Cls === 'function' && Cls.prototype instanceof Skill) {
            const instance = new Cls();
            this.allDiscovered.push(instance);

            // null = Console unreachable, load all; otherwise check active set
            const enabled = activeNames === null || activeNames.has(instance.name);
            if (enabled) {
              this.skills.push(instance);
              console.log(`[skills] Loaded: ${instance.name} — ${instance.description}`);
            } else {
              console.log(`[skills] Skipped (disabled in Console): ${instance.name}`);
            }
            break;
          }
        }
      } catch (err) {
        console.log(`[skills] Failed to load ${file}: ${err.message}`);
      }
    }

    console.log(`[skills] ${this.skills.length}/${this.allDiscovered.length} skills enabled`);

    // ── Package skills: scan subdirectories with skill.json ──
    const dirEntries = await fs.readdir(__dirname, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      const skillJsonPath = path.join(__dirname, entry.name, 'skill.json');
      try {
        await fs.access(skillJsonPath);
      } catch { continue; }

      try {
        const meta = JSON.parse(await fs.readFile(skillJsonPath, 'utf-8'));
        if (!meta.id) {
          console.warn(`[skills] Package missing id, skipped: ${entry.name}`);
          continue;
        }

        const isActive = activeNames === null || activeNames.has(meta.id);
        if (!isActive) {
          console.log(`[skills] Skipped package (disabled in Console): ${meta.id}`);
          continue;
        }

        // Intent-based packages (conversational-ops pattern)
        if (meta.intents) {
          const intentsPath = path.resolve(__dirname, entry.name, meta.intents);
          const intents = JSON.parse(await fs.readFile(intentsPath, 'utf-8'));

          let executor = null;
          if (meta.executor) {
            const execPath = path.resolve(__dirname, entry.name, meta.executor);
            executor = await import('file:///' + execPath.replace(/\\/g, '/'));
          }

          registerIntents(intents, meta.id, executor);
          console.log(`[skills] Loaded package: ${meta.id} v${meta.version || '?'} (${Object.keys(intents).length} intents)`);
        }
        // Tool-based packages (code-ops pattern) — loaded by Mind directly via import
        else if (meta.tools) {
          console.log(`[skills] Loaded tool package: ${meta.id} v${meta.version || '?'}`);
        }
        else {
          console.warn(`[skills] Package has no intents or tools, skipped: ${entry.name}`);
          continue;
        }

      } catch (err) {
        console.warn(`[skills] Package load failed, skipped: ${entry.name} — ${err.message}`);
      }
    }

    if (getIntentCount() > 0) {
      console.log(`[skills] Intent parser: ${getIntentCount()} intents registered`);
    }
  }

  getActiveSkills(taskType, context) {
    return this.skills.filter(s => s.canActivate(taskType, context));
  }

  async gatherAll(activeSkills, kernels, config) {
    const SKILL_TIMEOUT_MS = 10000;
    const withTimeout = (promise, ms, name) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)),
    ]);

    const invoked = []; // track successfully invoked skill names

    const results = await Promise.all(
      activeSkills.map(async (skill) => {
        try {
          const gathered = await withTimeout(
            skill.gatherContext(kernels, config),
            SKILL_TIMEOUT_MS,
            skill.name,
          );
          invoked.push(skill.name);
          return skill.formatForBrain(gathered);
        } catch (err) {
          console.log(`[skills] ${skill.name} gather failed: ${err.message}`);
          return null;
        }
      })
    );

    // Update invoke_count in Console DB (fire-and-forget, non-blocking)
    if (invoked.length > 0 && this.consoleUrl) {
      this._bumpInvokeCounts(invoked).catch(() => {});
    }

    return results.filter(Boolean);
  }

  /**
   * Bump invoke_count for skills that were successfully called.
   * Batched into a single request to minimize overhead.
   */
  async _bumpInvokeCounts(skillNames) {
    try {
      await fetch(`${this.consoleUrl}/api/agent/skill-invoked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: skillNames, relayNodeId: this.relayNodeId }),
      });
    } catch {} // silent — this is telemetry, not critical
  }

  list() {
    return this.skills.map(s => ({ name: s.name, description: s.description }));
  }

  listAll() {
    return this.allDiscovered.map(s => ({
      name: s.name,
      description: s.description,
      enabled: this.skills.some(r => r.name === s.name),
    }));
  }
}
