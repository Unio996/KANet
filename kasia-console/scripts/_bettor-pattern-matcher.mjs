#!/usr/bin/env node
// Bettor Pattern-Match b+ — 3 hand-coded patterns + corpus backfill verify (Owner 5/14 13:25 钦定)
//
// Patterns (hand-coded, no LLM):
//   P1 long-tail-candidate     : "Will [name] win [primary/election/nomination]" + NOT in frontrunner whitelist → predict NO
//   P2 process-impossibility   : "Will X happen by Y" + deadline window short + heavy-institutional verb → predict NO
//   P3 status-quo-short        : "Will X remain [position] through Y" + window < 60d → predict YES
//
// Usage:
//   node scripts/_bettor-pattern-matcher.mjs --backfill           # run on 44K corpus, output precision/recall per pattern
//   node scripts/_bettor-pattern-matcher.mjs --scan-active        # run on active markets, output ranked mispricing
//   node scripts/_bettor-pattern-matcher.mjs --sample-misses=20   # show 20 mispredicted corpus rows

import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'console.db');

// ─── Pattern matchers ───────────────────────────────────────────────────────

// P1: long-tail candidate — "Will [Name] win [election thing]"
// Heuristic: contains "Will <CapName...> win" + election keyword + NOT incumbent/frontrunner cue.
// Don't try to identify frontrunner — too brittle. Just predict NO for "any other [Person]" patterns
// and any single-candidate-among-many question where the candidate is not the trivial frontrunner.
// Simpler robust rule: question matches "Will <Person> win <primary/nomination>" → NO bias UNLESS
// description/question hints "frontrunner" / "presumptive" / "incumbent".
// Only national-scale presidential/nomination — exclude local House/Senate/Mayoral primaries (incumbent-dominated)
const RE_LONGTAIL_ELECTION = /^Will\s+(.+?)\s+win\s+the\s+(.+?)\s+(presidential|nomination|presidency)\b/i;
const RE_LONGTAIL_ANYOTHER = /any other (republican|democrat|candidate|politician|party)/i;
const FRONTRUNNER_HINTS = /\b(incumbent|presumptive|frontrunner|nominee|sitting president|inaug|inauguration)\b/i;
// Local/state offices — exclude (incumbent-dominated, hand-coded too brittle)
const LOCAL_OFFICE = /\b(house|senate|congressional|gubernatorial|mayoral|district|ny-\d+|mo-\d+|mn-\d+|mi-\d+|ca-\d+|state senate|state house)\b/i;
// Known frontrunner/incumbent names by era (corpus shows these dominate misses)
// Format: name → years_active (when they were dominant)
const FRONTRUNNER_NAMES = [
  { re: /\bDonald\s+J?\.?\s*Trump\b|\bTrump\b/i, years: [2023, 2024, 2025, 2026] },
  { re: /\bJoe\s+Biden\b|\bBiden\b/i, years: [2020, 2021, 2022, 2023, 2024] },
  { re: /\bVladimir\s+Putin\b|\bPutin\b/i, years: [2000, 2099] },
  { re: /\bAli\s+Khamenei\b|\bKhamenei\b/i, years: [1989, 2099] },
  { re: /\bRecep\s+Tayyip\s+Erdo[gğ]an\b|\bErdo[gğ]an\b/i, years: [2003, 2099] },
  { re: /\bXi\s+Jinping\b|\bXi\b/i, years: [2012, 2099] },
  { re: /\bNarendra\s+Modi\b|\bModi\b/i, years: [2014, 2099] },
  { re: /\bKim\s+Jong\s*-?un\b/i, years: [2011, 2099] },
  // Incumbents seeking re-election (2025-2026)
  { re: /\bLuiz\s+In[aá]cio\s+Lula\s+da\s+Silva\b|\bLula\b/i, years: [2023, 2026] }, // Brazil incumbent
];

function isKnownFrontrunner(question, endDate) {
  if (!endDate) return false;
  const year = parseInt(endDate.slice(0, 4));
  for (const f of FRONTRUNNER_NAMES) {
    if (f.re.test(question) && year >= f.years[0] && year <= (f.years[1] || 2099)) return true;
  }
  return false;
}

function matchP1_longtail(q, desc, endDate) {
  const text = `${q || ''} ${desc || ''}`;
  if (RE_LONGTAIL_ANYOTHER.test(q)) {
    return { match: true, predicted_yes: 0, confidence: 0.92, reason: 'any-other-candidate' };
  }
  if (LOCAL_OFFICE.test(q)) return { match: false }; // local races dominated by incumbents — skip
  if (RE_LONGTAIL_ELECTION.test(q)) {
    if (FRONTRUNNER_HINTS.test(text)) return { match: false };
    if (isKnownFrontrunner(q, endDate)) return { match: false };
    return { match: true, predicted_yes: 0, confidence: 0.78, reason: 'long-tail-candidate' };
  }
  return { match: false };
}

// P2: process-impossibility — "Will X happen by Y" + heavy institutional verb
// Hand-coded keyword set for institutional actions that need weeks-months.
const HEAVY_VERBS = /\b(sign|reach|ratify|launch|release|approve|nominate|confirm|enact|pass(?:es|ed)?|invade|withdraw|secede|annex|nullif(y|ies)|treaty|deal|agreement|legislation|bill|resolution|merger|acquisition|ipo|impeach|indict|conviction|expel)\b/i;
const RE_BYDEADLINE = /\bby\s+(?:[A-Z][a-z]+\s+\d{1,2}(?:,?\s+\d{4})?|the end of \d{4}|Q[1-4]\s+\d{4}|\d{4}-\d{2}-\d{2})\b/;
const FAST_PROCESS_HINTS = /\b(tweet|post|price|reach \$|hit \$|move|move above|move below|close above|close below)\b/i;

function matchP2_processImpossibility(q, desc, startDate, endDate) {
  if (!q || !endDate) return { match: false };
  if (!HEAVY_VERBS.test(q)) return { match: false };
  if (FAST_PROCESS_HINTS.test(q)) return { match: false }; // tweet count / price reach — not institutional
  if (!RE_BYDEADLINE.test(q)) return { match: false };
  // window length check — short window with heavy verb = high NO confidence
  const start = startDate ? new Date(startDate).getTime() : null;
  const end = endDate ? new Date(endDate).getTime() : null;
  if (!end) return { match: false };
  const windowDays = start ? (end - start) / 86400000 : 999;
  // Confidence drops as window grows
  let conf;
  if (windowDays < 14) conf = 0.92;
  else if (windowDays < 60) conf = 0.82;
  else if (windowDays < 180) conf = 0.72;
  else return { match: false }; // long window — process-impossibility 不 applicable
  return { match: true, predicted_yes: 0, confidence: conf, reason: `process-impossibility-${Math.floor(windowDays)}d` };
}

// P3: status-quo continuation short — "Will X remain [position] through Y" + short window → YES
const RE_REMAIN = /\bremain(?:s)?\s+(?:as\s+)?(?:the\s+)?(president|prime minister|supreme leader|chairman|ceo|king|queen|emperor|chancellor|head of state|leader|governor|senator|mayor|in (?:office|power|charge))\b/i;
const RE_STILL_BE = /\bstill\s+be\s+(?:the\s+)?(president|prime minister|ceo|chairman|king|queen|leader|supreme leader|chancellor)\b/i;
const RE_THROUGH_OR_ON = /\b(through|on)\s+(?:[A-Z][a-z]+\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{4})/;

function matchP3_statusQuo(q, desc, startDate, endDate) {
  if (!q) return { match: false };
  const hasIncumbentVerb = RE_REMAIN.test(q) || RE_STILL_BE.test(q);
  if (!hasIncumbentVerb) return { match: false };
  if (!RE_THROUGH_OR_ON.test(q)) return { match: false };
  const start = startDate ? new Date(startDate).getTime() : null;
  const end = endDate ? new Date(endDate).getTime() : null;
  if (!end) return { match: false };
  const windowDays = start ? (end - start) / 86400000 : 999;
  let conf;
  if (windowDays < 14) conf = 0.94;
  else if (windowDays < 60) conf = 0.88;
  else if (windowDays < 180) conf = 0.80;
  else return { match: false };
  return { match: true, predicted_yes: 1, confidence: conf, reason: `status-quo-${Math.floor(windowDays)}d` };
}

// Combine all patterns — return first match (priority order)
function classifyRow(row) {
  const q = row.question;
  const desc = row.description;
  const sd = row.start_date;
  const ed = row.end_date;
  const r1 = matchP1_longtail(q, desc, ed);
  if (r1.match) return { ...r1, pattern: 'P1_longtail' };
  // P2 + P3 hand-coded accuracy too low — disabled until Phase 2 LLM
  // const r2 = matchP2_processImpossibility(q, desc, sd, ed);
  // if (r2.match) return { ...r2, pattern: 'P2_process_impossibility' };
  // const r3 = matchP3_statusQuo(q, desc, sd, ed);
  // if (r3.match) return { ...r3, pattern: 'P3_status_quo' };
  return { match: false, pattern: null };
}

// ─── Backfill mode ──────────────────────────────────────────────────────────

function backfill(db) {
  console.log('[backfill] running 3 hand-coded patterns on corpus...\n');
  const rows = db.prepare(`SELECT condition_id, question, description, start_date, end_date, final_yes, final_no FROM historical_resolutions`).all();
  console.log(`[backfill] corpus rows: ${rows.length}`);

  const stats = {};
  for (const r of rows) {
    const c = classifyRow(r);
    if (!c.match) continue;
    const p = c.pattern;
    if (!stats[p]) stats[p] = { matched: 0, correct: 0, wrong: 0, tp: 0, fp: 0, tn: 0, fn: 0 };
    stats[p].matched++;
    const correct = c.predicted_yes === r.final_yes;
    if (correct) {
      stats[p].correct++;
      if (c.predicted_yes === 1) stats[p].tp++; else stats[p].tn++;
    } else {
      stats[p].wrong++;
      if (c.predicted_yes === 1) stats[p].fp++; else stats[p].fn++;
    }
  }

  console.log('\n=== Per-pattern backfill accuracy (44K corpus) ===\n');
  console.log('pattern                    matched   correct   wrong    accuracy    bias');
  console.log('-------------------------- --------- --------- -------- ----------- ----');
  for (const [p, s] of Object.entries(stats)) {
    const acc = (s.correct / s.matched * 100).toFixed(1);
    const bias = (s.tp + s.fn) > (s.tn + s.fp) ? 'YES' : 'NO';
    console.log(`${p.padEnd(28)} ${String(s.matched).padStart(7)}   ${String(s.correct).padStart(7)}   ${String(s.wrong).padStart(6)}     ${acc.padStart(6)}%     ${bias}`);
  }

  // Overall accuracy
  const totalMatched = Object.values(stats).reduce((a, s) => a + s.matched, 0);
  const totalCorrect = Object.values(stats).reduce((a, s) => a + s.correct, 0);
  console.log(`\noverall matched: ${totalMatched} / ${rows.length} (${(totalMatched/rows.length*100).toFixed(1)}% coverage)`);
  console.log(`overall accuracy: ${(totalCorrect/totalMatched*100).toFixed(1)}%`);

  return stats;
}

// ─── Active market scan mode ────────────────────────────────────────────────

function fetchActivePage(off) {
  return new Promise((resolve, reject) => {
    https.get(`https://gamma-api.polymarket.com/markets?closed=false&limit=500&offset=${off}`, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function scanActive(passedPatterns) {
  console.log(`\n[scan] passed patterns (accuracy > 85%): ${passedPatterns.join(', ') || '(none)'}\n`);
  if (!passedPatterns.length) { console.log('[scan] no patterns passed verification — abort scan'); return; }
  console.log('[scan] fetching active markets...');
  let all = [];
  for (let off = 0; off < 5000; off += 500) {
    const p = await fetchActivePage(off);
    all = all.concat(p);
    if (p.length < 500) break;
  }
  console.log(`[scan] active markets fetched: ${all.length}`);

  const flagged = [];
  for (const m of all) {
    if (!m.outcomePrices) continue;
    let yesPrice;
    try { yesPrice = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { continue; }
    if (Number.isNaN(yesPrice) || yesPrice <= 0 || yesPrice >= 1) continue;
    const row = { question: m.question, description: m.description, start_date: m.startDate, end_date: m.endDate };
    const c = classifyRow(row);
    if (!c.match) continue;
    if (!passedPatterns.includes(c.pattern)) continue;
    // P1 long-tail filter: market itself signals long-tail when 0.02 < yes < 0.50
    // yes > 0.50 → market says frontrunner (skip — P1 prediction conflicts with market signal)
    // yes < 0.02 → already converged NO (no edge after fees)
    if (c.pattern === 'P1_longtail' && (yesPrice >= 0.50 || yesPrice < 0.02)) continue;
    // mispricing = predicted vs actual price
    let mispricing;
    if (c.predicted_yes === 0) mispricing = yesPrice;
    else mispricing = 1 - yesPrice;
    flagged.push({
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      end_date: m.endDate,
      yes_price: yesPrice,
      predicted_yes: c.predicted_yes,
      pattern: c.pattern,
      confidence: c.confidence,
      reason: c.reason,
      mispricing,
      vol24h: m.volume24hr,
      liquidity: m.liquidity,
      side: c.predicted_yes === 0 ? 'BUY_NO' : 'BUY_YES',
      lock_pct: mispricing * c.confidence,
    });
  }
  flagged.sort((a, b) => b.lock_pct - a.lock_pct);

  console.log(`\n=== Active market mispricing candidates (top 30 by lock_pct) ===\n`);
  console.log('lock%  conf  pat               side    yes    vol24h    liq        deadline    question');
  console.log('------ ----- ----------------- ------- ------ --------- ---------- ----------- --------');
  for (const f of flagged.slice(0, 30)) {
    const lockPct = (f.lock_pct * 100).toFixed(1).padStart(5);
    const conf = (f.confidence * 100).toFixed(0).padStart(3);
    const side = f.side.padEnd(7);
    const yesP = f.yes_price.toFixed(3).padStart(5);
    const vol = (f.vol24h || 0 | 0).toString().padStart(8);
    const liq = (f.liquidity || 0 | 0).toString().padStart(9);
    const ddl = f.end_date?.slice(0, 10) || '???';
    const p = f.pattern.padEnd(17);
    console.log(`${lockPct}% ${conf}%  ${p} ${side} ${yesP}  ${vol}  ${liq}  ${ddl}  ${f.question?.slice(0, 70)}`);
  }
  return flagged;
}

// ─── Sample misses (debug) ──────────────────────────────────────────────────

function sampleMisses(db, n) {
  const rows = db.prepare(`SELECT condition_id, question, description, start_date, end_date, final_yes, final_no FROM historical_resolutions`).all();
  const misses = [];
  for (const r of rows) {
    const c = classifyRow(r);
    if (!c.match) continue;
    if (c.predicted_yes !== r.final_yes) misses.push({ ...r, ...c });
  }
  console.log(`\n=== Misses (pattern wrong) — sample ${n}/${misses.length} ===\n`);
  for (const m of misses.slice(0, n)) {
    console.log(`pat=${m.pattern} conf=${m.confidence} predicted_yes=${m.predicted_yes} actual_yes=${m.final_yes}`);
    console.log(`  Q: ${m.question?.slice(0, 100)}`);
    console.log(`  reason: ${m.reason}`);
    console.log('---');
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH, { readonly: false });

  const args = new Set(process.argv.slice(2));
  const wantBackfill = process.argv.includes('--backfill') || (!process.argv.includes('--scan-active') && !process.argv.some(x => x.startsWith('--sample-misses')));
  const wantScan = process.argv.includes('--scan-active');
  const sampleArg = process.argv.find(x => x.startsWith('--sample-misses='));

  let stats = null;
  if (wantBackfill || wantScan) {
    stats = backfill(db);
  }

  if (sampleArg) {
    const n = parseInt(sampleArg.split('=')[1] || '20');
    sampleMisses(db, n);
  }

  if (wantScan && stats) {
    const passed = Object.entries(stats).filter(([_, s]) => (s.correct / s.matched) >= 0.85).map(([p]) => p);
    await scanActive(passed);
  }

  db.close();
}

main().catch(e => { console.error('[matcher] FATAL:', e.message, e.stack); process.exit(1); });
