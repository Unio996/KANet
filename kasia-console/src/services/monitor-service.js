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
  // R-NWT-2026-04-28 hotfix: schema 是 config_entries(key, value_plain_hint), 不是 config_key/config_value.
  // 之前 497bd4643 ship 写错列名, console 起飞撞 SQLITE_ERROR. monitor-service 静默 try-catch 吞了, 但
  // tick() L218 同错没 try-catch → console crash. 全文修过来.
  try {
    const row = sqlite.prepare(
      "SELECT value_plain_hint FROM config_entries WHERE key = ? AND category = ?"
    ).get(`monitor_${key}`, 'monitor');
    if (row) {
      const val = JSON.parse(row.value_plain_hint);
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
    return sqlite.prepare("SELECT name AS channel_name FROM channels ORDER BY name").pluck().all();
  } catch {
    return [];
  }
}

function fetchNewMessages(channel, afterTs, limit) {
  try {
    // R-NWT-2026-04-28 hotfix: 排除 monitor:system 自己的 broadcast 防 echo loop.
    // J2 d4776743 实证: monitor broadcast back 进 dev-coord, next tick 又 match 自己, infinite amplification.
    let query;
    let params;
    if (afterTs) {
      query = `SELECT * FROM broadcast_messages WHERE channel_name = ? AND created_at > ? AND sender_address != 'monitor:system' ORDER BY created_at ASC LIMIT ?`;
      params = [channel, afterTs, limit];
    } else {
      query = `SELECT * FROM broadcast_messages WHERE channel_name = ? AND sender_address != 'monitor:system' ORDER BY created_at DESC LIMIT ?`;
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

function broadcastAction(_summary, _channelName) {
  // T-J2-2026-04-29 disable monitor → dev-coord auto-broadcast (Owner 23:50 真"不断产生垃圾").
  // monitor service originally INSERTs back into broadcast_messages with 'monitor:system'
  // sender → channel pollution + amplification (each match re-broadcasts old events as
  // auto-generated). Owner 真测 看到 dev-coord 全是 [Monitor] 🔔 spam.
  // Fix: no-op. notifyAction (events table) still fires for frontend visibility,
  // monitor record events仍 INSERT 进 monitor_events. 仅 disable channel broadcast leak.
  // Future: 真 alert escalation use direct DM to Owner OR explicit rule-driven action,
  // 不 dump 到 dev-coord.
  return;
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

    // Update last timestamp (NWT 22:43 hotfix: schema column 是 key/value_plain_hint, 不是 config_key/config_value).
    const latestTs = messages[messages.length - 1]?.created_at;
    if (latestTs) {
      try {
        const existing = sqlite.prepare("SELECT id FROM config_entries WHERE key = ? AND category = ?").get(`last_ts_${channel}`, 'monitor');
        const now = new Date().toISOString();
        if (existing) {
          sqlite.prepare("UPDATE config_entries SET value_plain_hint = ?, updated_at = ? WHERE key = ? AND category = ?").run(JSON.stringify(latestTs), now, `last_ts_${channel}`, 'monitor');
        } else {
          sqlite.prepare("INSERT OR IGNORE INTO config_entries (id, key, value_plain_hint, category, is_sensitive, updated_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)").run(randomUUID(), `last_ts_${channel}`, JSON.stringify(latestTs), 'monitor', now, now);
        }
      } catch (e) {
        console.warn(`[monitor] last_ts persist failed: ${e.message}`);
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
