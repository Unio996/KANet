// broker_config_resolver_invariant.test.mjs — KI 65 Block A.2 invariant test
//
// NWT N19.201/202 维度 4: invariant test 加 framework, regression 永守.
// J2 ship A.2 broker-config-resolver.js helper module 同时 fold-in test (per workflow rule 9).
//
// 真测:
//   1. getBrokerRelay() returns relay with roles_json containing 'broker'
//   2. getMarketMakerRelay() returns relay with 'marketmaker' OR fallback to broker
//   3. getAllBrokers() returns array including broker relays
//   4. getBrokerFeeRate() returns fee_rate_override OR system default 0.005
//   5. getBrokerFeeKas() fee formula Owner钦定 verify:
//      - small (1 KAS) → floor 0.05
//      - mid (100 KAS) → 0.5 (0.5%)
//      - large (5000+ KAS) → cap 10
//      - per-broker override honored

import { getBrokerRelay, getAllBrokers, getMarketMakerRelay, getBrokerFeeKas, getBrokerFeeRate } from '../../../src/services/broker-config-resolver.js';
import { sqlite } from '../../../src/db/client.js';

export default {
  id: 'broker_config_resolver_invariant',
  description: 'KI-65 Block A.2: broker-config-resolver helper module 5 invariant (broker/marketmaker/all/fee_rate/fee_kas)',
  domain: 'system',
  tags: ['ki-65', 'regression', 'fee-formula', 'production-db'],

  async run() {
    try {
      // Invariant 1: getBrokerRelay returns relay with 'broker' role
      const broker = getBrokerRelay();
      if (!broker) return { ok: false, summary: 'getBrokerRelay() returned null — no broker in DB?' };
      if (!broker.roles_json || !broker.roles_json.includes('broker')) {
        return { ok: false, summary: `broker.roles_json missing 'broker': ${broker.roles_json}` };
      }

      // Invariant 2: getMarketMakerRelay returns valid relay (broker fallback pre-A.5)
      const mm = getMarketMakerRelay();
      if (!mm) return { ok: false, summary: 'getMarketMakerRelay() returned null' };

      // Invariant 3: getAllBrokers returns array (>=1)
      const allBrokers = getAllBrokers();
      if (!Array.isArray(allBrokers) || allBrokers.length === 0) {
        return { ok: false, summary: `getAllBrokers() empty: ${JSON.stringify(allBrokers)}` };
      }

      // Invariant 4: getBrokerFeeRate returns system default (0.005) OR per-broker override
      const rate = await getBrokerFeeRate(broker.id);
      if (typeof rate !== 'number' || rate <= 0 || rate >= 1) {
        return { ok: false, summary: `fee_rate out of range: ${rate}` };
      }

      // Invariant 5: getBrokerFeeKas formula correct
      // small (1 KAS) → floor 0.05
      const fee1 = await getBrokerFeeKas(broker.id, 1);
      if (fee1 !== 0.05) return { ok: false, summary: `fee at 1 KAS expected 0.05 (floor), got ${fee1}` };
      // mid (100 KAS) → 100 × 0.005 = 0.5 (assuming default rate)
      const fee100 = await getBrokerFeeKas(broker.id, 100);
      const expectedMid = Math.max(0.05, Math.min(10, 100 * rate));
      if (Math.abs(fee100 - expectedMid) > 0.0001) {
        return { ok: false, summary: `fee at 100 KAS expected ${expectedMid}, got ${fee100} (rate=${rate})` };
      }
      // large (5000 KAS) → cap 10
      const fee5000 = await getBrokerFeeKas(broker.id, 5000);
      if (fee5000 !== 10) return { ok: false, summary: `fee at 5000 KAS expected 10 (cap), got ${fee5000}` };

      // Invariant 6: per-broker override (test by inserting + restoring)
      const beforeOverride = sqlite.prepare('SELECT fee_rate_override FROM relay_nodes WHERE id = ?').get(broker.id);
      sqlite.prepare('UPDATE relay_nodes SET fee_rate_override = 0.01 WHERE id = ?').run(broker.id);
      const overrideRate = await getBrokerFeeRate(broker.id);
      // Restore original
      sqlite.prepare('UPDATE relay_nodes SET fee_rate_override = ? WHERE id = ?').run(beforeOverride?.fee_rate_override ?? null, broker.id);
      if (overrideRate !== 0.01) {
        return { ok: false, summary: `per-broker override expected 0.01, got ${overrideRate}` };
      }

      return {
        ok: true,
        summary: `✅ A.2 helper invariant: broker=${broker.name} / mm=${mm.name} / allBrokers=${allBrokers.length} / rate=${rate} / fee(1)=${fee1} / fee(100)=${fee100} / fee(5000)=${fee5000} / override=${overrideRate}`,
        details: { broker_name: broker.name, mm_name: mm.name, all_brokers: allBrokers.length, default_rate: rate },
      };
    } catch (err) {
      return { ok: false, summary: `err: ${err.message}` };
    }
  },
};
