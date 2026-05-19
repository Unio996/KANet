// P0 hedge SQL bug regression (J2 #520 / NWT N19.12 三方共识 5/19, KI 第 16 次 silent skip 修)
// 真因: trade-protocol-filter.js:638 SELECT meta typo → 30 天 0 hedge fire.
// 验证: SELECT metadata 不 throw + escrow path hedge_enabled=true + executeHedge 包 try/catch emit hedge_failed.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');
const FILTER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/trade-protocol-filter.js');
const ROUTER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/broker-v3/router.js');

export default {
  id: 'hedge_silent_skip_ki16_regression',
  description: 'KI 第 16 次 hedge silent skip regression — SQL meta typo + escrow false + guard wrapper',
  domain: 'exchange',
  tags: ['regression', 'p0', 'hedge', 'ki-silent-skip'],

  async run() {
    // Layer 1: 验证 exchange_offers.metadata 字段存在, SELECT meta 字段应 throw
    const db = new Database(DB_PATH, { readonly: true });
    try {
      db.prepare('SELECT metadata FROM exchange_offers WHERE 1=0').get();
    } catch (e) {
      db.close();
      return { ok: false, error: `metadata field missing: ${e.message}` };
    }
    let metaThrows = false;
    try {
      db.prepare('SELECT meta FROM exchange_offers WHERE 1=0').get();
    } catch { metaThrows = true; }
    db.close();
    if (!metaThrows) return { ok: false, error: 'SELECT meta should throw (column should not exist)' };

    // Layer 2: 验证 trade-protocol-filter.js SQL 已修
    const filterSrc = readFileSync(FILTER_PATH, 'utf8');
    if (filterSrc.includes('SELECT meta FROM exchange_offers')) {
      return { ok: false, error: 'trade-protocol-filter.js still has SELECT meta typo (KI 第 16 次)' };
    }
    if (!filterSrc.includes('SELECT metadata FROM exchange_offers')) {
      return { ok: false, error: 'trade-protocol-filter.js missing SELECT metadata (修复未应用)' };
    }
    if (filterSrc.includes('_hedgeGateOffer.meta ')  || filterSrc.match(/_hedgeGateOffer\.meta[^d]/)) {
      return { ok: false, error: 'trade-protocol-filter.js still references _hedgeGateOffer.meta (应 .metadata)' };
    }

    // Layer 3: 验证 _executeHedgeGuarded wrapper + hedge_failed emit
    if (!filterSrc.includes('_executeHedgeGuarded')) {
      return { ok: false, error: 'executeHedge guard wrapper missing — silent skip 仍可能复发' };
    }
    if (!filterSrc.includes("eventType: 'hedge_failed'")) {
      return { ok: false, error: 'hedge_failed chain_event emit 路径未加 — invariant 缺' };
    }

    // Layer 4: 验证 broker-v3/router.js escrow path hedge_enabled=true
    const routerSrc = readFileSync(ROUTER_PATH, 'utf8');
    const escrowFalseMatches = routerSrc.match(/'broker-v3-escrow'.*hedge_enabled: false/g);
    if (escrowFalseMatches?.length) {
      return { ok: false, error: `broker-v3-escrow path 仍有 ${escrowFalseMatches.length} 处 hedge_enabled=false (应 true)` };
    }
    const escrowTrueMatches = routerSrc.match(/'broker-v3-escrow'.*hedge_enabled: true/g);
    if (!escrowTrueMatches || escrowTrueMatches.length < 2) {
      return { ok: false, error: 'broker-v3-escrow path hedge_enabled=true 不足 2 处 (BUY + SELL)' };
    }

    return { ok: true, summary: 'KI 第 16 次 hedge silent skip 4 layer 全 verify PASS (SQL fix + escrow open + guard + invariant)' };
  },
};
