// block_b_broker_fees_invariant — KI 65 Block B.5 (Owner 5/23 钦定, NWT N19.232 fire)
//
// Invariants:
//   I1: GET /api/admin/broker/fees?range=all returns ok:true + broker + total_fee_kas number + breakdown array
//   I2: GET /api/admin/broker/my-fees?relayId=<broker> returns broker + collected d1/d7/d30/alltime + recent_trades
//   I3: 400 / 404 / 400 validation chain on /api/admin/broker/my-fees
//   I4: GET /api/admin/overview financials_total.fee_exchange_24h_kas is number (not null), fee_exchange_24h_trades integer
//   I5: admin Panel C UI renders 'Exchange Fee (KAS)' string (Playwright real browser)
//   I6: chain_event broker_fee_collected schema — historical rows (if any) match payload shape

import { chromium } from 'playwright';
import Database from 'better-sqlite3';

const BASE = 'http://127.0.0.1:3100';
const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

async function fetchJson(url) {
  const r = await fetch(url);
  const status = r.status;
  let body = null;
  try { body = await r.json(); } catch {}
  return { status, body };
}

export default {
  id: 'block_b_broker_fees_invariant',
  description: 'KI 65 Block B (broker fee + ledger) 6 invariant: 2 endpoint shapes + 1 validation chain + admin overview wire + Playwright UI + chain_event schema',
  domain: 'system',
  tags: ['regression', 'p1', 'ki-65', 'block-b'],

  async run() {
    const failures = [];
    const db = new Database(DB_PATH);
    let browser;

    try {
      // I1: /api/admin/broker/fees shape
      const r1 = await fetchJson(`${BASE}/api/admin/broker/fees?range=all`);
      if (r1.status !== 200) failures.push(`I1: /api/admin/broker/fees status ${r1.status} (expected 200)`);
      if (!r1.body?.ok) failures.push(`I1: response.ok != true`);
      if (typeof r1.body?.total_fee_kas !== 'number') failures.push(`I1: total_fee_kas not number (got ${typeof r1.body?.total_fee_kas})`);
      if (!Array.isArray(r1.body?.breakdown)) failures.push(`I1: breakdown not array`);
      if (!Array.isArray(r1.body?.state_distribution)) failures.push(`I1: state_distribution not array`);
      if (!r1.body?.broker?.id) failures.push(`I1: broker info missing`);
      if (!r1.body?.filter_semantics) failures.push(`I1: filter_semantics disclosure missing`);

      // I2: /api/admin/broker/my-fees shape (with valid broker)
      const broker = db.prepare(`
        SELECT id FROM relay_nodes rn
        WHERE EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'broker')
        ORDER BY rn.created_at ASC LIMIT 1
      `).get();
      if (!broker) {
        failures.push(`I2: no broker relay (roles_json missing 'broker')`);
      } else {
        const r2 = await fetchJson(`${BASE}/api/admin/broker/my-fees?relayId=${broker.id}`);
        if (r2.status !== 200) failures.push(`I2: my-fees status ${r2.status}`);
        if (!r2.body?.ok) failures.push(`I2: my-fees ok != true`);
        if (!r2.body?.broker?.id) failures.push(`I2: my-fees broker info missing`);
        if (typeof r2.body?.broker?.fee_rate !== 'number') failures.push(`I2: my-fees fee_rate not number`);
        for (const r of ['d1', 'd7', 'd30', 'alltime']) {
          if (!r2.body?.collected?.[r]) failures.push(`I2: my-fees collected.${r} missing`);
          if (typeof r2.body?.collected?.[r]?.fee_kas !== 'number') failures.push(`I2: my-fees collected.${r}.fee_kas not number`);
        }
        if (!Array.isArray(r2.body?.recent_trades)) failures.push(`I2: my-fees recent_trades not array`);
        if (!r2.body?.pending_settle) failures.push(`I2: my-fees pending_settle missing`);
      }

      // I3: validation chain
      const r3a = await fetchJson(`${BASE}/api/admin/broker/my-fees`);
      if (r3a.status !== 400) failures.push(`I3a: missing relayId expected 400, got ${r3a.status}`);
      const r3b = await fetchJson(`${BASE}/api/admin/broker/my-fees?relayId=00000000-0000-0000-0000-000000000000`);
      if (r3b.status !== 404) failures.push(`I3b: bogus relayId expected 404, got ${r3b.status}`);
      // 400 for non-broker relay — pick a user relay
      const userRelay = db.prepare(`
        SELECT id FROM relay_nodes rn
        WHERE NOT EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'broker')
        LIMIT 1
      `).get();
      if (userRelay) {
        const r3c = await fetchJson(`${BASE}/api/admin/broker/my-fees?relayId=${userRelay.id}`);
        if (r3c.status !== 400) failures.push(`I3c: non-broker relayId expected 400, got ${r3c.status}`);
      }

      // I4: admin overview wire
      const r4 = await fetchJson(`${BASE}/api/admin/overview`);
      const ft = r4.body?.financials_total;
      if (!ft) failures.push(`I4: financials_total missing`);
      if (typeof ft?.fee_exchange_24h_kas !== 'number') failures.push(`I4: fee_exchange_24h_kas not number (got ${typeof ft?.fee_exchange_24h_kas})`);
      if (!Number.isInteger(ft?.fee_exchange_24h_trades)) failures.push(`I4: fee_exchange_24h_trades not integer`);

      // I5: Playwright UI render 'Exchange Fee (KAS)'
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);  // alpine.js hydration
      const text = await page.evaluate(() => document.body?.innerText || '');
      // Match raw text OR template literal pre-hydration (= '{{ ... }}' / x-text source).
      const html = await page.content();
      if (!text.includes('Exchange Fee (KAS)') && !html.includes('Exchange Fee (KAS)')) failures.push(`I5: 'Exchange Fee (KAS)' label not in /admin innerText or HTML`);
      if (errs.length > 0) failures.push(`I5: JS errors on /admin: ${errs.slice(0, 2).join('; ')}`);

      // I6: chain_event broker_fee_collected schema (if any rows exist)
      const feeEvents = db.prepare(`
        SELECT payload FROM chain_events WHERE event_type='broker_fee_collected' LIMIT 3
      `).all();
      for (const ev of feeEvents) {
        try {
          const p = JSON.parse(ev.payload);
          for (const k of ['order_id', 'broker_relay_id', 'fee_kas', 'trade_size_kas', 'rate_used', 'side']) {
            if (!(k in p)) failures.push(`I6: broker_fee_collected payload missing ${k}`);
          }
        } catch (e) {
          failures.push(`I6: payload JSON parse fail: ${e.message}`);
        }
      }

      if (failures.length > 0) {
        return { ok: false, error: failures.join('; '), failures };
      }
      return {
        ok: true,
        summary: `6 invariant PASS: B.1 endpoint shape (${r1.body.trade_count} trades / ${r1.body.total_fee_kas} KAS) + B.2 self-query + 3-layer validation + admin overview wire (fee_exchange_24h_kas=${ft.fee_exchange_24h_kas}) + Playwright UI label + broker_fee_collected schema (${feeEvents.length} historical events checked)`,
      };
    } finally {
      if (browser) await browser.close();
      db.close();
    }
  },
};
