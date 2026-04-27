// monitor-rules.js — 规则管理（从 config_entries 加载/保存）

import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlite } from '../db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RULES_FILE = path.join(__dirname, 'default-monitor-rules.json');
const CONFIG_KEY = 'monitor_rules';
const CONFIG_CATEGORY = 'monitor';

const VALID_LEVELS = ['INFO', 'WARN', 'ALERT', 'CRITICAL'];
const VALID_ACTIONS = ['log', 'notify', 'broadcast', 'dm'];

function validateRule(rule) {
  const errors = [];

  if (!rule.id || rule.id.trim().length < 3) errors.push('rule.id: 需要非空 id (至少 3 字符)');
  if (!rule.name || rule.name.trim().length === 0) errors.push('rule.name: 需要非空名称');
  if (!rule.conditions) errors.push('rule.conditions: 必须有 conditions 对象');
  if (rule.conditions?.keyword === undefined && rule.conditions?.keywords === undefined &&
      rule.conditions?.sender === undefined && rule.conditions?.channel_match === undefined &&
      rule.conditions?.content_length === undefined && rule.conditions?.combined === undefined) {
    errors.push('rule.conditions: 至少需要一个条件（keyword/sender/channel_match/content_length/combined）');
  }
  if (rule.conditions?.content_length !== undefined && rule.conditions.content_length < 0) {
    errors.push('rule.conditions.content_length: 必须 >= 0');
  }
  if (rule.conditions?.min_content_len !== undefined && rule.conditions.min_content_len < 0) {
    errors.push('rule.conditions.min_content_len: 必须 >= 0');
  }
  if (rule.alert_level && !VALID_LEVELS.includes(rule.alert_level)) {
    errors.push(`rule.alert_level: 必须是 ${VALID_LEVELS.join(', ')} 之一`);
  }
  if (rule.action && !VALID_ACTIONS.includes(rule.action)) {
    errors.push(`rule.action: 必须是 ${VALID_ACTIONS.join(', ')} 之一`);
  }
  if (rule.cooldown_seconds !== undefined && rule.cooldown_seconds < 0) {
    errors.push('rule.cooldown_seconds: 必须 >= 0');
  }

  // Validate time_window
  if (rule.conditions?.time_window?.enabled) {
    const hours = rule.conditions.time_window.hours;
    if (!hours || !Array.isArray(hours) || hours.length === 0) {
      errors.push('rule.conditions.time_window.hours: enabled=true 时必须提供小时列表');
    } else {
      for (const h of hours) {
        if (h < 0 || h > 23) {
          errors.push(`rule.conditions.time_window.hours: ${h} 无效，必须是 0-23`);
        }
      }
    }
  }

  return errors;
}

function ensureDefaults() {
  const row = sqlite.prepare('SELECT id FROM monitor_rules WHERE id = ?').get('defaults');
  if (!row) {
    try {
      const defaults = JSON.parse(readFileSync(DEFAULT_RULES_FILE, 'utf8'));
      const rulesJson = JSON.stringify(defaults);
      sqlite.prepare('INSERT OR IGNORE INTO monitor_rules (id, name, enabled, rules_json, updated_at) VALUES (?, ?, 1, ?, datetime(\'now\'))').run('defaults', 'Default rules', rulesJson);
      console.log('[monitor-rules] Default rules seeded from default-monitor-rules.json.');
      return defaults;
    } catch (err) {
      console.error('[monitor-rules] Failed to seed defaults:', err.message);
      return [];
    }
  }
  // Return stored rules if already exists
  return loadRules();
}

function loadRules() {
  const row = sqlite.prepare("SELECT rules_json FROM monitor_rules WHERE id = 'defaults'").get();
  if (!row || !row.rules_json) return ensureDefaults();

  try {
    const rules = JSON.parse(row.rules_json);
    console.log(`[monitor-rules] Loaded ${rules.length} rules.`);
    return rules;
  } catch (err) {
    console.error('[monitor-rules] Failed to parse stored rules:', err.message);
    return ensureDefaults();
  }
}

function saveRules(rules) {
  const errors = [];
  const validRules = [];

  for (const rule of rules) {
    const ruleErrors = validateRule(rule);
    if (ruleErrors.length > 0) {
      errors.push({ id: rule.id, name: rule.name, errors: ruleErrors });
    } else {
      validRules.push(rule);
    }
  }

  if (errors.length > 0) {
    console.warn('[monitor-rules] Validation errors:', errors);
    // Still save valid ones
    if (validRules.length === 0) return { success: false, errors };
  }

  // Save validated rules
  const rulesJson = JSON.stringify(validRules);
  const now = new Date().toISOString();
  sqlite.prepare('INSERT OR REPLACE INTO monitor_rules (id, name, enabled, rules_json, updated_at) VALUES (?, ?, 1, ?, ?)').run('defaults', 'Default rules', rulesJson, now);

  // Also update config_entries for API access
  const existing = sqlite.prepare("SELECT id FROM config_entries WHERE config_key = ? AND category = ?").get(CONFIG_KEY, CONFIG_CATEGORY);
  if (existing) {
    sqlite.prepare("UPDATE config_entries SET config_value = ?, updated_at = ? WHERE config_key = ? AND category = ?").run(rulesJson, now, CONFIG_KEY, CONFIG_CATEGORY);
  } else {
    sqlite.prepare("INSERT OR IGNORE INTO config_entries (id, config_key, config_value, category, updated_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), CONFIG_KEY, rulesJson, CONFIG_CATEGORY, now);
  }

  console.log(`[monitor-rules] Saved ${validRules.length} rules.`);
  return { success: true, errors, saved: validRules.length };
}

function toggleRule(ruleId) {
  const rules = loadRules();
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return { success: false, error: 'rule not found' };
  rule.enabled = !rule.enabled;
  return saveRules(rules);
}

function deleteRule(ruleId) {
  const rules = loadRules().filter(r => r.id !== ruleId);
  return saveRules(rules);
}

function addRule(rule) {
  const rules = loadRules();
  const errors = validateRule(rule);
  if (errors.length > 0) return { success: false, errors: [{ id: rule.id, name: rule.name, errors }] };

  rules.push(rule);
  return saveRules(rules);
}

export { loadRules, saveRules, toggleRule, deleteRule, addRule, validateRule, ensureDefaults };
