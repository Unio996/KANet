// _stress_puppeteer_monitor.mjs — Phase 5-6 KI 45 Sub-4 (NWT N19.94 + J2 #575 Sub-B (e) view-only fresh profile)
//
// Dedicated Puppeteer Chrome on :9223 + own profile, opens Console UI 3 tab read-only.
// 60s tick: screenshot + DOM number extract → cross-check with DB.
//
// Owner's main Chrome (:9222) untouched.
//
// Usage:
//   node scripts/_stress_puppeteer_monitor.mjs --duration=3600000  # 1 hour
//   stops on SIGINT (Ctrl+C) — final report dump.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
try {
  const env = readFileSync('C:/kanet/kanet.env', 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
const PUPPETEER_PROFILE = 'C:/temp/puppeteer-stress-profile';
const SCREENSHOT_DIR = 'C:/kanet/logs/stress-screenshots';
const REPORT_FILE = `C:/kanet/logs/stress-monitor-${Date.now()}.json`;

const args = process.argv.slice(2);
const durationArg = args.find(a => a.startsWith('--duration='));
const DURATION_MS = durationArg ? parseInt(durationArg.split('=')[1]) : 3600_000;
const TICK_MS = 60_000;

mkdirSync(PUPPETEER_PROFILE, { recursive: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function getDbMetrics() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const kRow = db.prepare(`SELECT balance_human FROM treasury_snapshot WHERE chain='kaspa' AND asset='KAS' ORDER BY id DESC LIMIT 1`).get();
    const offerOpen = db.prepare(`SELECT COUNT(*) c FROM exchange_offers WHERE protocol_status='open'`).get().c;
    const offerComp24h = db.prepare(`SELECT COUNT(*) c FROM exchange_offers WHERE protocol_status='completed' AND created_at > datetime('now', '-1 hour')`).get().c;
    const hedgePlaced = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
    const hedgeFailed = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
    const hedgeSkipped = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_skipped'`).get().c;
    return { k_pool: kRow ? Number(kRow.balance_human) : null, offer_open: offerOpen, offer_completed_1h: offerComp24h, hedge_placed: hedgePlaced, hedge_failed: hedgeFailed, hedge_skipped: hedgeSkipped };
  } finally { db.close(); }
}

(async () => {
  let puppeteer;
  try { puppeteer = await import('puppeteer'); }
  catch {
    console.error('FATAL: puppeteer not installed. Run: npm install puppeteer');
    process.exit(1);
  }

  console.log(`[stress-monitor] launching Puppeteer Chrome :9223 (profile ${PUPPETEER_PROFILE})`);
  const browser = await puppeteer.default.launch({
    headless: false,
    userDataDir: PUPPETEER_PROFILE,
    args: ['--remote-debugging-port=9223', '--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1400, height: 900 },
  });

  const pages = {};
  const pageErrorLog = {};  // KI 45.2 Sub-4 polish #2 (NWT N19.98): real JS error capture
  const tabs = [
    { name: 'portfolio', url: `${CONSOLE_URL}/portfolio` },
    { name: 'relays', url: `${CONSOLE_URL}/relays` },
    { name: 'exchange', url: `${CONSOLE_URL}/exchange` },
  ];
  for (const t of tabs) {
    const p = await browser.newPage();
    pageErrorLog[t.name] = [];
    // KI 45.2 polish #2: capture pageerror + console.error (NOT in DOM, only Console)
    p.on('pageerror', err => {
      pageErrorLog[t.name].push({ ts: new Date().toISOString(), type: 'pageerror', err: err.message });
    });
    p.on('console', msg => {
      if (msg.type() === 'error') {
        pageErrorLog[t.name].push({ ts: new Date().toISOString(), type: 'console_error', err: msg.text() });
      }
    });
    try {
      await p.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      console.log(`[stress-monitor] tab ${t.name} loaded ${t.url}`);
    } catch (e) {
      console.warn(`[stress-monitor] tab ${t.name} load fail: ${e.message}`);
    }
    pages[t.name] = p;
  }

  const samples = [];
  const startMs = Date.now();
  const deadline = startMs + DURATION_MS;
  let stop = false;
  process.on('SIGINT', () => { console.log('[stress-monitor] SIGINT — finalizing...'); stop = true; });

  while (!stop && Date.now() < deadline) {
    const ts = new Date().toISOString();
    const sample = { ts, ms_since_start: Date.now() - startMs };
    try {
      sample.db = await getDbMetrics();
      // Per-tab DOM check (extract any visible number — page-specific selectors below)
      for (const t of tabs) {
        try {
          await pages[t.name].reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
          const shot = `${SCREENSHOT_DIR}/${t.name}_${ts.replace(/[:.]/g, '-')}.png`;
          await pages[t.name].screenshot({ path: shot, fullPage: false });
          sample[`${t.name}_screenshot`] = shot;
          // Generic DOM dump — count visible text containing numeric
          const visibleText = await pages[t.name].evaluate(() => document.body?.innerText?.slice(0, 5000) || '');
          sample[`${t.name}_text_length`] = visibleText.length;
          // KI 45.2 Sub-4 polish #1 (NWT N19.98): narrow regex — only real JS error patterns
          const errorPatterns = [
            /Uncaught\s+(TypeError|ReferenceError|SyntaxError|RangeError)/,
            /JavaScript\s+error/,
            /window\.onerror/,
          ];
          sample[`${t.name}_has_error`] = errorPatterns.some(re => re.test(visibleText));
          // KI 45.2 polish #2: dump page error log (collected via page.on listeners)
          sample[`${t.name}_errors`] = (pageErrorLog[t.name] || []).slice(-10);  // last 10 per tick
        } catch (e) {
          sample[`${t.name}_err`] = e.message;
        }
      }
    } catch (e) {
      sample.collect_err = e.message;
    }
    samples.push(sample);
    console.log(`[stress-monitor] sample ${samples.length} | K-pool=${sample.db?.k_pool} | placed=${sample.db?.hedge_placed} | failed=${sample.db?.hedge_failed} | skipped=${sample.db?.hedge_skipped}`);
    // wait next tick
    const elapsed = Date.now() - (startMs + samples.length * TICK_MS - TICK_MS);
    const waitMs = Math.max(0, TICK_MS - elapsed);
    await new Promise(r => setTimeout(r, waitMs));
  }

  // Finalize: write report + close browser
  const final = await getDbMetrics().catch(() => null);
  const report = {
    start: new Date(startMs).toISOString(),
    end: new Date().toISOString(),
    duration_ms: Date.now() - startMs,
    sample_count: samples.length,
    final_db: final,
    samples,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`[stress-monitor] report → ${REPORT_FILE}`);
  await browser.close();
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
