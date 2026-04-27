// monitor-service.js — 频道事件监控服务
//
// Interval-based watcher, follows broker-intake-watcher pattern:
//   startMonitor() / stopMonitor() / getStats()
//
// Polls all channels for new messages, runs through rule engine,
// records events, triggers actions.

import { randomUUID } from 'crypto';
import { sqlite } from '../db/client.js';
import { loadRules, ensureDefaults } from './monitor-rules.js';
import { matchRules, getEffectiveAlertLevel, dedupByCooldown } from './monitor-engine.js';
import http from 'node:http';

let _pollInterval = null;
let _started = false;
let _tickCount = 0;
let _eventCount = 0;
let _alertCount = 0;

// Config — overridable via config_entries
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_LIMIT = 30;

function getConfig(key, fallback) {
  try {
    const row = sqlite.prepare(
      "SELECT config_value FROM config_entries WHERE config_key = ? AND category = ?"
    ).get(key, 'monitor');
    if (row) {
      const val = JSON.parse(row.config_value);
      return typeof val === 'number' ? val : fallback;
    }
  } catch {}
  return fallback;
}

async function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.get({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function getChannels() {
  try {
    return sqlite.prepare("SELECT channel_name FROM channels WHERE active = 1 ORDER BY channel_name").pluck().all();
  } catch {
    return [];
  }
}

function fetchNewMessages(channel, afterTs, limit) {
  try {
    let query;
    let params;
    if (afterTs) {
      query = `SELECT * FROM broadcast_messages WHERE channel_name = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?`;
      params = [channel, afterTs, limit];
    } else {
      query = `SELECT * FROM broadcast_messages WHERE channel_name = ? ORDER BY created_at DESC LIMIT ?`;
      params = [channel, limit];
      query = `SELECT * FROM (${query}) ORDER BY created_at ASC`;
    }
    return sqlite.prepare(query).all(...params);
  } catch {
    return [];
  }
}

function recordEvent(ruleId, channelName, senderAddress, messageId, alertLevel, matchedKeywords, summary, fullContent) {
  try {
    const id = randomUUID();
    sqlite.prepare(`
      INSERT INTO monitor_events (id, rule_id, channel_name, sender_address, message_id, alert_level, matched_keywords, summary, full_content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, ruleId, channelName, senderAddress, messageId, alertLevel,
      matchedKeywords?.join(',') || '', summary, fullContent?.slice(0, 5000));
    return id;
  } catch (err) {
    console.error('[monitor] Failed to record event:', err.message);
    return null;
  }
}

function notifyAction(summary, alertLevel, channelName) {
  // Write to events table for frontend visibility
  try {
    const icon = alertLevel === 'CRITICAL' ? '🔴' : alertLevel === 'ALERT' ? '🟠' : alertLevel === 'WARN' ? '🟡' : '🔵';
    sqlite.prepare(`
      INSERT INTO events (id, level, source, event_type, message, created_at)
      VALUES (?, 'info', 'monitor', 'monitor_alert', ?, datetime('now'))
    `).run(randomUUID(), `${icon} [Monitor] ${summary}`);
  } catch {}
}

function broadcastAction(summary, channelName) {
  // Broadcast to dev-coord for high-level alerts
  try {
    sqlite.prepare(`
      INSERT INTO broadcast_messages (id, channel_name, sender_address, content, status, created_at)
      VALUES (?, 'dev-coord', 'monitor:system', ? || ' (auto-generated)', 'confirmed', datetime('now'))
    `).run(randomUUID(), `🔔 [Monitor] ${summary}`);
  } catch {}
}

function processMessage(msg, rules, recentEvents, cooldownSeconds) {
  const matches = matchRules(msg, rules);
  const deduped = dedupByCooldown(recentEvents, matches, cooldownSeconds);

  for (const match of deduped) {
    const alertLevel = match.alert_level;
    const summary = `[${msg.created_at?.slice(11, 19)}] ${msg.sender_address?.slice(-8) || '??'}: ${(msg.content || '').slice(0, 120)}${msg.content?.length > 120 ? ' …' : ''}`;

    recordEvent(match.rule_id, msg.channel_name, msg.sender_address, msg.id, alertLevel, match.matched_keywords, summary, msg.content);
    _eventCount++;

    if (alertLevel === 'INFO') {
      // Silent log only
    } else if (alertLevel === 'WARN') {
      notifyAction(summary, alertLevel, msg.channel_name);
    } else if (alertLevel === 'ALERT') {
      notifyAction(summary, alertLevel, msg.channel_name);
      broadcastAction(summary, msg.channel_name);
      _alertCount++;
    } else if (alertLevel === 'CRITICAL') {
      notifyAction(summary, alertLevel, msg.channel_name);
      broadcastAction(`🚨 ${summary}`, msg.channel_name);
      _alertCount++;
    }
  }
}

function tick() {
  _tickCount++;
  const startTime = Date.now();

  let rules;
  try {
    rules = loadRules();
  } catch {
    rules = ensureDefaults();
  }
  if (!rules.length) return;

  const channels = getChannels();
  if (!channels.length) return;

  // Fetch all recent events for cooldown dedup
  let recentEvents;
  try {
    recentEvents = sqlite.prepare(`
      SELECT rule_id, created_at FROM monitor_events
      WHERE created_at > datetime('now', '-10 minutes')
      ORDER BY created_at DESC
    `).all();
  } catch {
    recentEvents = [];
  }

  const pollMs = getConfig('poll_ms', DEFAULT_POLL_MS);
  const limit = getConfig('limit', DEFAULT_LIMIT);

  for (const channel of channels) {
    const lastTs = getConfig(`last_ts_${channel}`, null);
    const messages = fetchNewMessages(channel, lastTs, limit);

    if (messages.length === 0) continue;

    // Process each message through rule engine
    for (const msg of messages) {
      // Per-message cooldown lookup (rule-specific)
      const ruleIds = [...new Set(rules.filter(r => r.enabled).map(r => r.id))];
      for (const ruleId of ruleIds) {
        const rule = rules.find(r => r.id === ruleId);
        if (!rule) continue;
        const cooldown = rule.cooldown_seconds || 0;
        const ruleMatches = matchRules(msg, [rule]);
        if (ruleMatches.length > 0) {
          const deduped = dedupByCooldown(recentEvents, ruleMatches, cooldown);
          for (const match of deduped) {
            const alertLevel = match.alert_level;
            const summary = `[${msg.created_at?.slice(11, 19)}] ${msg.sender_address?.slice(-8) || '??'}: ${(msg.content || '').slice(0, 120)}${msg.content?.length > 120 ? ' …' : ''}`;

            recordEvent(match.rule_id, msg.channel_name, msg.sender_address, msg.id, alertLevel, match.matched_keywords, summary, msg.content);
            _eventCount++;

            if (alertLevel === 'WARN') {
              notifyAction(summary, alertLevel, msg.channel_name);
            } else if (alertLevel === 'ALERT') {
              notifyAction(summary, alertLevel, msg.channel_name);
              broadcastAction(summary, msg.channel_name);
              _alertCount++;
            } else if (alertLevel === 'CRITICAL') {
              notifyAction(summary, alertLevel, msg.channel_name);
              broadcastAction(`🚨 ${summary}`, msg.channel_name);
              _alertCount++;
            }
          }
        }
      }
    }

    // Update last timestamp (NWT 19:30 emergency fix: rename to latestTs to avoid duplicate const with line 176 lastTs that broke console startup)
    const latestTs = messages[messages.length - 1]?.created_at;
    if (latestTs) {
      const existing = sqlite.prepare("SELECT id FROM config_entries WHERE config_key = ? AND category = ?").get(`last_ts_${channel}`, 'monitor');
      const now = new Date().toISOString();
      if (existing) {
        sqlite.prepare("UPDATE config_entries SET config_value = ?, updated_at = ? WHERE config_key = ? AND category = ?").run(JSON.stringify(latestTs), now, `last_ts_${channel}`, 'monitor');
      } else {
        sqlite.prepare("INSERT OR IGNORE INTO config_entries (id, config_key, config_value, category, updated_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), `last_ts_${channel}`, JSON.stringify(latestTs), 'monitor', now);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  if (elapsed > 2000) {
    console.log(`[monitor] tick #${_tickCount} took ${elapsed}ms (slow)`);
  }
}

function startMonitor() {
  if (_started) return;
  _started = true;
  _tickCount = 0;
  _eventCount = 0;
  _alertCount = 0;

  // Seed defaults on first start
  ensureDefaults();

  const pollMs = getConfig('poll_ms', DEFAULT_POLL_MS);
  console.log(`[monitor] monitor started, poll=${pollMs}ms`);

  // First tick after startup
  tick();

  _pollInterval = setInterval(tick, pollMs);
}

function stopMonitor() {
  if (!_started) return;
  _started = false;
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
  console.log(`[monitor] monitor stopped (ticks=${_tickCount}, events=${_eventCount}, alerts=${_alertCount})`);
}

function getStats() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const eventsToday = sqlite.prepare("SELECT COUNT(*) as cnt FROM monitor_events WHERE created_at LIKE ?").get(today + '%').cnt;
    const alertsToday = sqlite.prepare("SELECT COUNT(*) as cnt FROM monitor_events WHERE created_at LIKE ? AND alert_level IN ('WARN', 'ALERT', 'CRITICAL')").get(today + '%').cnt;
    const unack = sqlite.prepare("SELECT COUNT(*) as cnt FROM monitor_events WHERE acknowledged = 0 AND cleared = 0").get().cnt;

    const rules = loadRules();

    return {
      started: _started,
      ticks: _tickCount,
      events_today: eventsToday,
      alerts_today: alertsToday,
      unacknowledged: unack,
      rules_count: rules.length,
      rules: rules.map(r => ({ id: r.id, name: r.name, enabled: r.enabled, alert_level: r.alert_level })),
    };
  } catch (err) {
    return {
      started: _started,
      ticks: _tickCount,
      error: err.message,
    };
  }
}

export { startMonitor, stopMonitor, getStats, tick };
