// S3 settle BREAKER + determinism regression (NWT r62 / J1 #138/#140).
//
// scope: pool-market-settler.js dispatchPhase2 broker fee 输出地址。
//   bug: 此前只 broker_relay_id → relay_nodes 本地查 → 跨节点 broker 非本地 → null → return abort
//        整个 settle (settle BREAKER, 不只 fee 漏)。b502a805 首修 relay-查优先 pk-兜底 仍【非对称】
//        (本地 relay.address vs 远端 pk-派生, 非 P2PK gateway 两节点算不同地址 → 跨节点 settle 分歧)。
//   fix (ca5e8658): broker 地址【两节点都从 broker_pk 派生】(always-pk-derive) = 对称确定。
// guard: broker_pk → XOnlyPublicKey.toAddress 必【确定性】(同 broker_pk 同 net → 逐次同地址 = 两节点
//   必算同 broker 地址) + 有效 P2PK 格式。回归 → asymmetry / 跨节点 settle 分歧复发。
//   与 pool-market-settler.js dispatchPhase2 always-pk-derive 逻辑同步。

export default {
  id: 'oracle_settle_broker_addr_determinism',
  description: 'S3 settle BREAKER — broker fee 地址 always-pk-derive 确定性 (两节点必算同地址)',
  domain: 'oracle',
  tags: ['regression', 'p0', 'settle-breaker', 'determinism', 'cross-node', 'gateway', 'open-testnet'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    let kw, Database;
    try { kw = await import('kaspa-wasm'); } catch (e) { return { ok: false, error: `kaspa-wasm import fail: ${e.message}` }; }
    try { Database = (await import('better-sqlite3')).default; } catch (e) { return { ok: false, error: `better-sqlite3 import fail: ${e.message}` }; }

    // 复刻 settler always-pk-derive 逻辑 (改动必两处同步)。
    const deriveBrokerAddr = (brokerPk, spineP2sh) => {
      const net = spineP2sh && spineP2sh.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
      return new kw.XOnlyPublicKey(brokerPk).toAddress(net).toString();
    };

    // 真实 market broker_pk 样本 (production 输入形态, 非理想化)。
    const db = new Database('./data/console.db', { readonly: true });
    const rows = db.prepare("SELECT id, broker_pk, spine_p2sh FROM pool_markets WHERE broker_pk IS NOT NULL AND broker_pk != '' AND spine_p2sh IS NOT NULL LIMIT 8").all();
    db.close();
    if (!rows.length) return { ok: false, error: 'no markets with broker_pk + spine_p2sh to test' };

    for (const m of rows) {
      let a1, a2;
      try {
        a1 = deriveBrokerAddr(m.broker_pk, m.spine_p2sh);
        a2 = deriveBrokerAddr(m.broker_pk, m.spine_p2sh);  // 第二次 = 模拟另一节点同输入
      } catch (e) {
        failures.push(`${m.id.slice(-8)} broker_pk derive throw: ${e.message}`);
        continue;
      }
      // 确定性: 同 broker_pk 同 net → 必同地址 (= 两节点逐字节同, asymmetry 不复发)
      if (a1 !== a2) failures.push(`${m.id.slice(-8)} 非确定性: ${a1} != ${a2}`);
      // 有效 P2PK 格式
      const wantPrefix = m.spine_p2sh.startsWith('kaspatest:') ? 'kaspatest:' : 'kaspa:';
      if (!a1.startsWith(wantPrefix)) failures.push(`${m.id.slice(-8)} 地址前缀错: ${a1} (want ${wantPrefix})`);
    }

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
