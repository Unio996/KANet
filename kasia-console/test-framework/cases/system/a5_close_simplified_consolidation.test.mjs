// a5_close_simplified_consolidation — KI 65 Block A.5 + r249 evolution
//
// 5/22 Block A.5 (Owner 13:54 钦定): Trader-A/B 兼 broker+marketmaker (abandon broker-v4).
// 5/23 r249 (NWT N19.270 / Owner 'MarketMaker-A plug-in'): strip marketmaker from Trader-A/B,
//   MarketMaker-A 成 unique marketmaker. Broker hedge services swap getMarketMaker→getBroker.
//
// Invariants (post-v143 migration + Sub 1.4 resolver swap):
//   I1: Trader-A + Trader-B roles_json=["broker"] (= marketmaker stripped, broker only)
//   I2: getBrokerRelay() returns Trader-B (4/21, oldest broker)
//   I3: getMarketMakerRelay() returns MarketMaker-A (= unique marketmaker post-strip)
//   I4: All exchange_accounts.relay_node_id = Trader-B id (broker hedge unchanged)
//   I5: MarketMaker-A relay exists (= now active marketmaker, not just template)
//   I6: cex-bridge runtime filter resolves to Trader-B (broker) via getBrokerRelayIdOrThrow

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

      // I1 (post-r249 v143): Trader-A/B roles_json = ["broker"], marketmaker stripped.
      const expected = '["broker"]';
      if (traderB.roles_json !== expected) failures.push(`I1: Trader-B roles_json = ${traderB.roles_json}, expected ${expected}`);
      if (traderA && traderA.roles_json !== expected) failures.push(`I1: Trader-A roles_json = ${traderA.roles_json}, expected ${expected}`);

      // I2 + I3: helper resolution (post-r249: marketmaker resolves MarketMaker-A unique)
      const { getBrokerRelay, getMarketMakerRelay } = await import('../../../src/services/broker-config-resolver.js');
      const brokerRow = getBrokerRelay();
      const mmRow = getMarketMakerRelay();
      if (!brokerRow || brokerRow.id !== traderB.id) failures.push(`I2: getBrokerRelay returned ${brokerRow?.name || 'null'}, expected Trader-B`);
      if (!mmRow || !mmA || mmRow.id !== mmA.id) failures.push(`I3: getMarketMakerRelay returned ${mmRow?.name || 'null'}, expected MarketMaker-A (= post-r249 unique marketmaker)`);

      // I4: exchange_accounts → Trader-B
      const wrong = db.prepare(`SELECT COUNT(*) c FROM exchange_accounts WHERE relay_node_id != ? OR relay_node_id IS NULL`).get(traderB.id).c;
      if (wrong > 0) failures.push(`I4: ${wrong} exchange_accounts row(s) not attributed to Trader-B`);

      // I5: MarketMaker-A relay still exists
      if (!mmA) failures.push(`I5: MarketMaker-A relay missing (should be retained as future N-node template)`);

      // I6: cex-bridge runtime filter resolves to Trader-B (= finds CEX rows)
      const { getCexAccount } = await import('../../../src/services/cex-bridge.js');
      const bybitAccount = getCexAccount('bybit');
      if (!bybitAccount) failures.push(`I6: getCexAccount('bybit') returned null — runtime filter broken`);

      // I7 (KI 65 N19.238 → N19.250 update): MarketMaker-A surfaces in admin overview brokers list.
      // Originally template (adapter=NULL); NWT N19.250 linked adapter 47045123 for Phase 1B fix
      // (= "Relay not running" UI alert resolution by attaching shared adapter).
      // Post-N19.250: MarketMaker-A is_template can be false (= adapter linked, no longer template).
      // Invariant relaxed: assert MarketMaker-A surfaces in brokers list (= visible in Panel A).
      const ovRes = await fetch('http://127.0.0.1:3100/api/admin/overview');
      const ovBody = await ovRes.json().catch(() => ({}));
      const mmaInList = (ovBody.brokers || []).find(b => b.name === 'MarketMaker-A');
      if (!mmaInList) failures.push(`I7: MarketMaker-A not in /api/admin/overview brokers list`);

      if (failures.length > 0) {
        return { ok: false, error: failures.join('; '), failures };
      }
      return { ok: true, summary: `7 invariant PASS: Trader-A/B broker only (post-r249 strip), broker→Trader-B, marketmaker→MarketMaker-A, ${db.prepare('SELECT COUNT(*) c FROM exchange_accounts').get().c} CEX→Trader-B (broker hedge unchanged), cex-bridge runtime OK` };
    } finally {
      db.close();
    }
  },
};
