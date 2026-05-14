#!/usr/bin/env node
// Bettor Pattern-Match Phase 1 — corpus build (Owner 5/14 13:13 钦定)
// Paginate gamma /markets?closed=true, filter binary resolved (outcomePrices=["1","0"]/["0","1"]),
// insert into historical_resolutions table. Idempotent (INSERT OR IGNORE on condition_id PK).
//
// Usage: node scripts/_bettor-corpus-build.mjs [--limit-pages=N] [--dry-run]
//
// Output: corpus row count + final_yes/final_no distribution + top-15 categories (raw question prefix).

import Database from 'better-sqlite3';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'console.db');
const PAGE_SIZE = 500;
const LIMIT_PAGES = (() => {
  const a = process.argv.find(x => x.startsWith('--limit-pages='));
  return a ? parseInt(a.slice('--limit-pages='.length)) : 100;  // 50K markets default
})();
const DRY_RUN = process.argv.includes('--dry-run');

function fetchPage(off) {
  return new Promise((resolve, reject) => {
    const url = `https://gamma-api.polymarket.com/markets?closed=true&limit=${PAGE_SIZE}&offset=${off}`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`page off=${off} parse: ${e.message}, head: ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function isBinaryResolved(outcomePricesStr) {
  if (!outcomePricesStr) return null;
  try {
    const p = JSON.parse(outcomePricesStr);
    if (p[0] === '1' && p[1] === '0') return { yes: 1, no: 0 };
    if (p[0] === '0' && p[1] === '1') return { yes: 0, no: 1 };
  } catch {}
  return null;
}

async function main() {
  console.log(`[corpus] DB: ${DB_PATH}`);
  console.log(`[corpus] page size: ${PAGE_SIZE}, max pages: ${LIMIT_PAGES} (= max ${PAGE_SIZE * LIMIT_PAGES} markets)`);
  console.log(`[corpus] dry-run: ${DRY_RUN}`);

  const db = new Database(DB_PATH);

  // Sanity check table exists (auto-migrate on first use)
  const t = db.prepare("SELECT count(*) AS cnt FROM sqlite_master WHERE type='table' AND name='historical_resolutions'").get();
  if (!t.cnt) {
    console.log('[corpus] historical_resolutions 表 不存在 — 现 CREATE (v108 schema)');
    db.exec(`
      CREATE TABLE historical_resolutions (
        condition_id TEXT PRIMARY KEY,
        gamma_id TEXT,
        slug TEXT,
        question TEXT NOT NULL,
        description TEXT,
        outcomes_json TEXT,
        start_date TEXT,
        end_date TEXT,
        final_yes REAL NOT NULL,
        final_no REAL NOT NULL,
        raw_outcome_prices TEXT,
        total_volume REAL,
        liquidity_final REAL,
        one_month_change REAL,
        last_trade_price REAL,
        category TEXT,
        confidence REAL,
        ingested_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_hist_res_final ON historical_resolutions(final_yes, final_no);
      CREATE INDEX idx_hist_res_end ON historical_resolutions(end_date);
      CREATE INDEX idx_hist_res_cat ON historical_resolutions(category);
    `);
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO historical_resolutions
      (condition_id, gamma_id, slug, question, description, outcomes_json,
       start_date, end_date, final_yes, final_no, raw_outcome_prices,
       total_volume, liquidity_final, one_month_change, last_trade_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalFetched = 0;
  let binaryHit = 0;
  let inserted = 0;
  let skippedNoCondId = 0;

  for (let i = 0; i < LIMIT_PAGES; i++) {
    const off = i * PAGE_SIZE;
    let page;
    try { page = await fetchPage(off); }
    catch (e) {
      console.error(`[corpus] page off=${off} FAIL: ${e.message} — retry once after 5s`);
      await new Promise(r => setTimeout(r, 5000));
      try { page = await fetchPage(off); }
      catch (e2) { console.error(`[corpus] page off=${off} RETRY FAIL: ${e2.message} — skip`); continue; }
    }
    totalFetched += page.length;

    for (const m of page) {
      const res = isBinaryResolved(m.outcomePrices);
      if (!res) continue;
      binaryHit++;
      if (!m.conditionId) { skippedNoCondId++; continue; }
      if (DRY_RUN) { inserted++; continue; }
      const info = insert.run(
        m.conditionId,
        String(m.id || ''),
        m.slug || null,
        m.question || '(no question)',
        m.description || null,
        m.outcomes || null,
        m.startDate || null,
        m.endDate || null,
        res.yes,
        res.no,
        m.outcomePrices,
        m.volume != null ? Number(m.volume) : null,
        m.liquidity != null ? Number(m.liquidity) : null,
        m.oneMonthPriceChange != null ? Number(m.oneMonthPriceChange) : null,
        m.lastTradePrice != null ? Number(m.lastTradePrice) : null
      );
      if (info.changes > 0) inserted++;
    }

    if (i % 10 === 0 || page.length < PAGE_SIZE) {
      console.log(`[corpus] page ${i+1}/${LIMIT_PAGES} off=${off} fetched=${page.length} totalFetched=${totalFetched} binaryHit=${binaryHit} inserted=${inserted}`);
    }
    if (page.length < PAGE_SIZE) {
      console.log(`[corpus] short page reached — end of dataset`);
      break;
    }
  }

  console.log('\n=== Final Summary ===');
  console.log(`closed markets fetched: ${totalFetched}`);
  console.log(`binary resolved hits:   ${binaryHit}`);
  console.log(`new rows inserted:      ${inserted}`);
  console.log(`skipped (no condId):    ${skippedNoCondId}`);

  // Corpus distribution
  if (!DRY_RUN) {
    const stats = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN final_yes=1 THEN 1 ELSE 0 END) AS yes_count,
      SUM(CASE WHEN final_no=1 THEN 1 ELSE 0 END) AS no_count
      FROM historical_resolutions`).get();
    console.log(`\ncorpus total rows: ${stats.total}`);
    console.log(`  YES resolved: ${stats.yes_count} (${(stats.yes_count/stats.total*100).toFixed(1)}%)`);
    console.log(`  NO resolved:  ${stats.no_count} (${(stats.no_count/stats.total*100).toFixed(1)}%)`);

    // Sample 5 NO + 5 YES
    console.log('\n=== Sample 5 NO-resolved ===');
    const noSample = db.prepare(`SELECT question, end_date, total_volume FROM historical_resolutions WHERE final_no=1 ORDER BY total_volume DESC LIMIT 5`).all();
    for (const r of noSample) console.log(`  vol=${(r.total_volume||0).toFixed(0).padStart(10)} end=${r.end_date?.slice(0,10)} | ${r.question?.slice(0,80)}`);

    console.log('\n=== Sample 5 YES-resolved ===');
    const yesSample = db.prepare(`SELECT question, end_date, total_volume FROM historical_resolutions WHERE final_yes=1 ORDER BY total_volume DESC LIMIT 5`).all();
    for (const r of yesSample) console.log(`  vol=${(r.total_volume||0).toFixed(0).padStart(10)} end=${r.end_date?.slice(0,10)} | ${r.question?.slice(0,80)}`);
  }

  db.close();
}

main().catch(e => { console.error('[corpus] FATAL:', e.message, e.stack); process.exit(1); });
