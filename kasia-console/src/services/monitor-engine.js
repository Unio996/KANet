// monitor-engine.js — 规则匹配引擎（纯函数，可测试）
// matchRules(message, rules) → MatchResult[]

/**
 * MatchResult:
 * {
 *   rule_id, rule_name, alert_level, matched_keywords, reason
 * }
 */

const ALERT_LEVELS = ['INFO', 'WARN', 'ALERT', 'CRITICAL'];
const ALERT_ORDER = { INFO: 0, WARN: 1, ALERT: 2, CRITICAL: 3 };

function matchRules(message, rules) {
  if (!message?.content || !rules?.length) return [];

  const content = message.content;
  const results = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const match = matchRule(message, rule);
    if (match) results.push(match);
  }

  // Sort by alert level descending (CRITICAL first)
  results.sort((a, b) => ALERT_ORDER[b.alert_level] - ALERT_ORDER[a.alert_level]);
  return results;
}

function matchRule(message, rule) {
  const conditions = rule.conditions || {};
  const matches = [];
  const reasons = [];
  const matchedKws = [];

  // 1. keyword / keywords check
  const kw = conditions.keyword || conditions.keywords || '';
  if (kw) {
    const patterns = Array.isArray(kw) ? kw : [kw];
    let kwMatch = false;
    for (const p of patterns) {
      try {
        const regex = new RegExp(p, 'i');
        if (regex.test(message.content)) {
          kwMatch = true;
          matchedKws.push(p);
        }
      } catch {
        // Not a valid regex, treat as plain text
        if (message.content.toLowerCase().includes(p.toLowerCase())) {
          kwMatch = true;
          matchedKws.push(p);
        }
      }
    }
    if (kwMatch) matches.push('keyword');
  }

  // 2. sender check
  if (conditions.sender !== undefined && conditions.sender !== null) {
    const senders = Array.isArray(conditions.sender) ? conditions.sender : [conditions.sender];
    const msgAddr = message.sender_address || '';
    if (senders.some(s => msgAddr.includes(s))) {
      matches.push('sender');
    }
  }

  // 3. channel_match check
  if (conditions.channel_match) {
    try {
      const regex = new RegExp(conditions.channel_match);
      if (regex.test(message.channel_name)) {
        matches.push('channel_match');
      }
    } catch {}
  }

  // 4. content_length check
  if (conditions.content_length) {
    if (message.content.length >= conditions.content_length) {
      matches.push('content_length');
    }
  }

  // 5. min_content_len check
  if (conditions.min_content_len) {
    if (message.content.length >= conditions.min_content_len) {
      matches.push('min_content_len');
    }
  }

  // 6. exclude_keywords — if any present in content, reject
  if (conditions.exclude_keywords) {
    const excludes = Array.isArray(conditions.exclude_keywords)
      ? conditions.exclude_keywords
      : [conditions.exclude_keywords];
    const hasExclude = excludes.some(e =>
      message.content.toLowerCase().includes(e.toLowerCase())
    );
    if (hasExclude) return null; // rejected by exclusion
  }

  // 7. combined AND check
  if (conditions.combined) {
    let allMatch = true;
    for (const [field, expected] of Object.entries(conditions.combined)) {
      if (field === 'keyword' || field === 'keywords') continue; // handled above
      if (field === 'channel_name' && message.channel_name !== expected) allMatch = false;
    }
    if (allMatch && Object.keys(conditions.combined).length > 0) {
      matches.push('combined');
    }
  }

  // Must match at least one positive condition
  if (matches.length === 0) return null;

  // time_window filter
  if (conditions.time_window?.enabled) {
    const now = new Date();
    const hour = now.getHours();
    const hours = conditions.time_window.hours || [];
    if (!hours.includes(hour)) return null; // outside allowed hours
  }

  return {
    rule_id: rule.id,
    rule_name: rule.name,
    alert_level: rule.alert_level || 'INFO',
    matched_keywords: matchedKws,
    reason: `${matches.length} conditions matched: ${matches.join(', ')}`,
  };
}

function getEffectiveAlertLevel(matches) {
  // Return the highest alert level among all matches for a message
  if (!matches.length) return 'INFO';
  let highest = 'INFO';
  for (const m of matches) {
    if (ALERT_ORDER[m.alert_level] > ALERT_ORDER[highest]) {
      highest = m.alert_level;
    }
  }
  return highest;
}

function dedupByCooldown(events, matches, cooldownSeconds) {
  if (!cooldownSeconds) return matches;
  const now = Date.now();
  return matches.filter(match => {
    // Check if same rule_id fired within cooldown
    return !events.some(e =>
      e.rule_id === match.rule_id &&
      e.created_at &&
      (now - new Date(e.created_at).getTime()) < cooldownSeconds * 1000
    );
  });
}

export { matchRules, matchRule, getEffectiveAlertLevel, dedupByCooldown, ALERT_LEVELS, ALERT_ORDER };
