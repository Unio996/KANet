// market-spec-sanitizer — clean resolution_rule_spec text for safe display (bot/web).
// KANet-UI 2026-06-03 Bettor 派 (止血 Phase 2 + 固化 C).
//
// Strips: URL (http/https/www), HTML tags, img refs, curly quotes (normalize),
// multi-newline (collapse to single), trailing whitespace.
//
// Idempotent + safe-by-default: empty input → ''.

// URL: complete (https?://X) OR truncated incomplete (e.g. trailing 'https:' after seeder slice 2000).
const URL_RE = /https?:(?:\/\/\S*|\s*$)|\bwww\.[^\s)]+/gi;
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;
const IMG_BB_RE = /\[img[^\]]*\]/gi;
const ZWSP_RE = /[​-‍﻿]/g;
const MULTI_NL_RE = /\n{3,}/g;

/**
 * Sanitize raw resolution_rule_spec text for display.
 *
 * If input parses as JSON, sanitize the .title + .resolution_criteria fields in-place
 * + re-serialize. Otherwise treat as plain text.
 *
 * @param {string} raw - resolution_rule_spec column value
 * @returns {string} cleaned spec
 */
export function sanitizeMarketSpec(raw) {
  if (raw == null) return '';
  const s = String(raw);
  if (!s.trim()) return '';

  // Try JSON path first (= clean spec format).
  if (s.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(s);
      const out = { ...obj };
      if (typeof out.title === 'string') out.title = sanitizeText(out.title);
      if (typeof out.resolution_criteria === 'string') out.resolution_criteria = sanitizeText(out.resolution_criteria);
      if (typeof out.description === 'string') out.description = sanitizeText(out.description);
      return JSON.stringify(out);
    } catch {
      // fall through to plain-text path
    }
  }

  return sanitizeText(s);
}

/**
 * Plain text sanitize: strip URL + HTML + img refs + curly quotes + collapse newlines.
 */
export function sanitizeText(raw) {
  if (raw == null) return '';
  let s = String(raw);
  // Strip ZWSP + similar invisibles.
  s = s.replace(ZWSP_RE, '');
  // Strip URLs entirely (= preview-image source + visual noise).
  s = s.replace(URL_RE, '');
  // Strip HTML tags + img refs.
  s = s.replace(HTML_TAG_RE, '');
  s = s.replace(IMG_BB_RE, '');
  // Normalize curly quotes to straight (= Polymarket source uses smart quotes that render odd).
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Collapse 3+ newlines to double (preserves paragraph but kills excess).
  s = s.replace(MULTI_NL_RE, '\n\n');
  // Trim trailing whitespace per line + overall.
  s = s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').trim();
  return s;
}
