// a5_close_simplified_consolidation — KI 65 Block A.5 简化 close (Owner 5/22 13:54 钦定)
//
// Owner abandon broker-v4, Trader-A/B 兼 broker+marketmaker.
// Invariants (post-v140 migration):
//   I1: Trader-A + Trader-B 都 roles_json=["broker","marketmaker"]
//   I2: getBrokerRelay() returns Trader-B (4/21, first created)
//   I3: getMarketMakerRelay() returns Trader-B (= 兼)
//   I4: All exchange_accounts.relay_node_id = Trader-B id
//   I5: MarketMaker-A relay still exists (= future N-node template, 不删)
//   I6: cex-bridge / hedge-router / broker-treasury-monitor runtime filter resolves to Trader-B

import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

export default {
  id: 'a5_close_simplified_consolidation',
  description: 'KI 65 A.5 简化 close: Trader-A/B 兼 broker+marketmaker + CEX → Trader-B + MarketMaker-A 保留 template',
  domain: 'system',
  tags: ['regression', 'p1', 'ki-65', 'a5-close'],

  async run() {
    const failures = [];
    const db = new Database(DB_PATH);
    try {
      const traderB = db.prepare("SELECT id, roles_json FROM relay_nodes WHERE name = 'Trader-B'").get();
      const traderA = db.prepare("SELECT id, roles_json FROM relay_nodes WHERE name = 'Trader-A'").get();
      const mmA = db.prepare("SELECT id, roles_json FROM relay_nodes WHERE name = 'MarketMaker-A'").get();
      if (!traderB) return { ok: false, error: 'Trader-B relay missing' };

      // I1: Trader-A + Trader-B 兼 roles
      const expected = '["broker","marketmaker"]';
      if (traderB.roles_json !== expected) failures.push(`I1: Trader-B roles_json = ${traderB.roles_json}, expected ${expected}`);
      if (traderA && traderA.roles_json !== expected) failures.push(`I1: Trader-A roles_json = ${traderA.roles_json}, expected ${expected}`);

      // I2 + I3: helper resolution
      const { getBrokerRelay, getMarketMakerRelay } = await import('../../../src/services/broker-config-resolver.js');
      const brokerRow = getBrokerRelay();
      const mmRow = getMarketMakerRelay();
      if (!brokerRow || brokerRow.id !== traderB.id) failures.push(`I2: getBrokerRelay returned ${brokerRow?.name || 'null'}, expected Trader-B`);
      if (!mmRow || mmRow.id !== traderB.id) failures.push(`I3: getMarketMakerRelay returned ${mmRow?.name || 'null'}, expected Trader-B (兼)`);

      // I4: exchange_accounts → Trader-B
      const wrong = db.prepare(`SELECT COUNT(*) c FROM exchange_accounts WHERE relay_node_id != ? OR relay_node_id IS NULL`).get(traderB.id).c;
      if (wrong > 0) failures.push(`I4: ${wrong} exchange_accounts row(s) not attributed to Trader-B`);

      // I5: MarketMaker-A relay still exists
      if (!mmA) failures.push(`I5: MarketMaker-A relay missing (should be retained as future N-node template)`);

      // I6: cex-bridge runtime filter resolves to Trader-B (= finds CEX rows)
      const { getCexAccount } = await import('../../../src/services/cex-bridge.js');
      const bybitAccount = getCexAccount('bybit');
      if (!bybitAccount) failures.push(`I6: getCexAccount('bybit') returned null — runtime filter broken`);

      if (failures.length > 0) {
        return { ok: false, error: failures.join('; '), failures };
      }
      return { ok: true, summary: `6 invariant PASS: Trader-A/B 兼 roles, helper resolves Trader-B, ${db.prepare('SELECT COUNT(*) c FROM exchange_accounts').get().c} CEX → Trader-B, MarketMaker-A template retained, cex-bridge runtime OK` };
    } finally {
      db.close();
    }
  },
};
