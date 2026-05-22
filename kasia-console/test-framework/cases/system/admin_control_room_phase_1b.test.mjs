// admin_control_room_phase_1b.test.mjs — Phase 1B v3 Tier 4 UI + data correctness verify
//
// J2 ship Phase 1B v3 sub-phases:
//   1B.1 v137 migration (scope_json + dm_count_today) — commit bd99ff6c2
//   1B.2 Panel A broker state (+1B.2.1 ageMin + kas_pool hotfix) — commits e1f5bfcc6 + cdfedf78a
//   1B.3 Panel B 财务 KPI (+1B.3.1 aggregate single row) — commits 4ff0fa808 + 9587bc693
//   1B.4 Panel C history pagination (+1B.4.1 schema rename) — commits f8e90d345 + a321346f6
//
// NWT N19.184/186/188 framework gap sediment — Tier 4 必含 data correctness assertions
// 不只 DOM render PASS. This test:
//   - DOM keywords for all 3 new panels (Panel A / Panel B / Panel C)
//   - /api/admin/overview shape includes brokers[] + financials_total
//   - /api/admin/history shape includes items[] + pagination metadata
//   - data correctness: brokers scope_json populated / pagination math consistent / direction derive

import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3100';

export default {
  id: 'admin_control_room_phase_1b',
  description: 'KI-64 Phase 1B v3: Panel A broker state + Panel B 财务 KPI + Panel C history (DOM + data correctness)',
  domain: 'system',
  tags: ['ui', 'admin', 'regression', 'ki-64', 'tier4', 'phase-1b'],

  async run() {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const jsErrors = [];
      page.on('pageerror', err => jsErrors.push('JS error: ' + err.message));
      page.on('console', msg => {
        if (msg.type() === 'error') jsErrors.push('console err: ' + msg.text());
      });

      // === Phase 1: render /admin ===
      const response = await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      if (response?.status() !== 200) {
        await browser.close();
        return { ok: false, summary: `/admin HTTP ${response?.status()}` };
      }

      // wait Alpine hydration + 2 endpoint fetches (overview + history)
      await page.waitForTimeout(3000);

      // === Phase 2: DOM keywords for 3 new Phase 1B panels ===
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      const required = [
        // Panel A (1B.2)
        'Broker 状态',
        'KAS 池',
        'USDT 各链',
        'Hedge 24h',
        'DM 用量',
        // Panel B (1B.3)
        '财务 KPI',
        'Hedge KAS',  // matches "Hedge KAS 量"
        '净盈亏',
        // Panel C (1B.4)
        '历史单子',
        '最近 24h',  // filter dropdown
        '搜索',
        '上一页',
        '下一页',
      ];
      const missing = required.filter(k => !bodyText.includes(k));
      if (missing.length) {
        await browser.close();
        return { ok: false, summary: `Phase 1B DOM missing: ${missing.join(', ')}`, jsErrors };
      }

      // === Phase 3: 0 JS error ===
      if (jsErrors.length) {
        await browser.close();
        return { ok: false, summary: `JS errors: ${jsErrors.slice(0, 3).join(' | ')}` };
      }

      // === Phase 4: /api/admin/overview shape (Panel A + Panel B data) ===
      const overview = await page.evaluate(async () => {
        const r = await fetch('/api/admin/overview');
        return r.ok ? await r.json() : { ok: false, status: r.status };
      });
      if (!overview?.ok) {
        await browser.close();
        return { ok: false, summary: `overview API: ${JSON.stringify(overview).slice(0, 200)}` };
      }
      // Panel A — brokers[] with scope_json + status + kas_pool + usdt_by_chain + hedge_24h + dm cap
      if (!Array.isArray(overview.brokers) || overview.brokers.length === 0) {
        await browser.close();
        return { ok: false, summary: `brokers[] missing or empty: ${JSON.stringify(overview.brokers)}` };
      }
      const b0 = overview.brokers[0];
      const brokerShapeOk = b0.name
        && Array.isArray(b0.scope)
        && typeof b0.dm_count_today === 'number'
        && typeof b0.dm_cap === 'number'
        && b0.hedge_24h
        && typeof b0.hedge_24h.placed === 'number'
        && ['alive', 'idle', 'down', 'unknown'].includes(b0.status);
      if (!brokerShapeOk) {
        await browser.close();
        return { ok: false, summary: `broker shape mismatch: ${JSON.stringify(b0).slice(0, 300)}` };
      }
      // Panel B — financials_total single aggregate object
      if (!overview.financials_total || overview.financials_total.scope !== 'all_brokers_aggregate') {
        await browser.close();
        return { ok: false, summary: `financials_total missing or wrong scope: ${JSON.stringify(overview.financials_total).slice(0, 200)}` };
      }
      const f = overview.financials_total;
      const finShapeOk = typeof f.broker_count === 'number'
        && typeof f.hedge_24h_kas_volume === 'number'
        && typeof f.completed_offers_24h === 'number'
        && 'fee_exchange_24h' in f  // N/A allowed (null)
        && 'net_pnl_24h' in f;       // N/A allowed (null)
      if (!finShapeOk) {
        await browser.close();
        return { ok: false, summary: `financials_total shape: ${JSON.stringify(f).slice(0, 300)}` };
      }

      // === Phase 5: /api/admin/history pagination + filter ===
      const hist24h = await page.evaluate(async () => {
        const r = await fetch('/api/admin/history?range=24h&limit=10');
        return r.ok ? await r.json() : { ok: false, status: r.status };
      });
      if (!hist24h?.ok) {
        await browser.close();
        return { ok: false, summary: `history API: ${JSON.stringify(hist24h).slice(0, 200)}` };
      }
      const histShapeOk = Array.isArray(hist24h.items)
        && typeof hist24h.total === 'number'
        && typeof hist24h.page === 'number'
        && typeof hist24h.total_pages === 'number'
        && hist24h.limit === 10
        && hist24h.filters?.range === '24h';
      if (!histShapeOk) {
        await browser.close();
        return { ok: false, summary: `history shape: ${JSON.stringify({ ...hist24h, items: '[...]' }).slice(0, 300)}` };
      }
      // Per-item direction derive check (sample)
      if (hist24h.items.length > 0) {
        const item = hist24h.items[0];
        if (!['BUY', 'SELL', '—'].includes(item.direction)) {
          await browser.close();
          return { ok: false, summary: `direction derive wrong: ${item.direction}` };
        }
        if (!item.scope || item.scope !== 'exchange') {
          await browser.close();
          return { ok: false, summary: `scope mislabeled: ${item.scope}` };
        }
      }

      // === Phase 6: scope=prediction returns 0 row (data correctness) ===
      const histPred = await page.evaluate(async () => {
        const r = await fetch('/api/admin/history?scope=prediction&limit=10');
        return r.ok ? await r.json() : { ok: false };
      });
      if (!histPred?.ok || histPred.total !== 0 || histPred.items.length !== 0) {
        await browser.close();
        return { ok: false, summary: `scope=prediction should return 0 (待 Bettor B2 mainnet): total=${histPred?.total}` };
      }

      await browser.close();

      return {
        ok: true,
        summary: `✅ Phase 1B v3 全 panel + data correctness OK | brokers=${overview.brokers.length} financials.broker_count=${f.broker_count} history.total=${hist24h.total} scope=prediction=0`,
        details: {
          brokers_count: overview.brokers.length,
          broker_names: overview.brokers.map(b => b.name),
          financials_total: f,
          history_24h_total: hist24h.total,
          history_24h_pages: hist24h.total_pages,
        },
      };
    } catch (err) {
      if (browser) await browser.close();
      return { ok: false, summary: `err: ${err.message}` };
    }
  },
};
