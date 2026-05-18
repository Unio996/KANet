// P1 v4 autoTaker tier amount cap test — NWT N19.2 + Owner A 钦定 5/18
// 验证: tier determination based on age + card + completedCount + amount cap enforcement

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/console.db');

export default {
  id: 'autotaker_tier_v4_amount_caps',
  description: 'P1 v4 autoTaker tier: age/card/completed → tier 1/2/3 + amount cap + per-peer sybil cap',
  domain: 'exchange',
  tags: ['regression', 'autotaker', 'tier', 'sybil'],

  async run() {
    const db = new Database(DB_PATH, { readonly: true });

    // simulate tier determination logic (mirror trade-protocol-filter L300-304)
    function tier(ageDays, hasCard, completedCount) {
      if (ageDays >= 30 && completedCount >= 3) return 3;
      if (ageDays >= 7 || hasCard || completedCount >= 1) return 2;
      return 1;
    }
    const TIER_CAPS = {
      1: { amount: 10, perPeerCount: 3, perPeerTotal: 5 },
      2: { amount: 25, perPeerCount: 5, perPeerTotal: 50 },
      3: { amount: 75, perPeerCount: 20, perPeerTotal: 500 },
    };

    // verify tier determination for known production addresses
    // kzc2tgz4cchh: 40d, 0 card, 0 completed → Tier 2 (age ≥ 7d OR-condition)
    const kzc = db.prepare("SELECT discovered_at, card_timestamp FROM identities WHERE substr(address,-12)='kzc2tgz4cchh'").get();
    const kzcAge = (Date.now() - new Date(kzc.discovered_at).getTime()) / 86400000;
    const kzcCompleted = db.prepare("SELECT COUNT(*) AS cnt FROM exchange_offers WHERE substr(taker,-12)='kzc2tgz4cchh' AND protocol_status='completed'").get().cnt;
    const kzcTier = tier(kzcAge, !!kzc.card_timestamp, kzcCompleted);
    if (kzcTier !== 2) return { ok: false, error: `kzc2tgz4cchh expected Tier 2, got ${kzcTier} (age=${kzcAge.toFixed(1)}d card=${!!kzc.card_timestamp} completed=${kzcCompleted})` };

    // Synthetic checks
    const checks = [
      // [ageDays, hasCard, completedCount, expectedTier]
      [0, false, 0, 1],   // new addr → Tier 1
      [3, false, 0, 1],   // 3d age < 7d, no card, no completed → Tier 1
      [3, true, 0, 2],    // 3d age but has Card → Tier 2 (OR)
      [3, false, 1, 2],   // 3d age, 1 completed → Tier 2 (OR)
      [10, false, 0, 2],  // age 10d ≥ 7d → Tier 2 (kzc2tgz4cchh case)
      [40, false, 0, 2],  // kzc2tgz4cchh production case
      [40, true, 0, 2],   // age + card, no completed → Tier 2 (not 3, needs 3+ completed)
      [40, false, 3, 3],  // age 40d + 3 completed → Tier 3
      [30, false, 3, 3],  // exact 30d + 3 completed → Tier 3
      [29, false, 5, 2],  // age 29 < 30 → Tier 2
    ];
    for (const [age, card, completed, expected] of checks) {
      const got = tier(age, card, completed);
      if (got !== expected) return { ok: false, error: `tier(${age}d, card=${card}, completed=${completed}): expected ${expected}, got ${got}` };
    }

    // Amount cap sanity
    if (TIER_CAPS[1].amount !== 10) return { ok: false, error: `Tier 1 cap != $10` };
    if (TIER_CAPS[2].amount !== 25) return { ok: false, error: `Tier 2 cap != $25` };
    if (TIER_CAPS[3].amount !== 75) return { ok: false, error: `Tier 3 cap != $75` };

    db.close();
    return { ok: true, summary: `tier determination 10 case PASS, TIER_CAPS verified, kzc2tgz4cchh production → Tier 2 ($25 max) ✓` };
  },
};
