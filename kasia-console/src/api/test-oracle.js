// test-oracle.js — Mock outcome endpoint for first real cross-node settle demo.
//
// J2-tn r352 (Bettor 6/5 钦定 unblock voter): voter deriveVote 只识特定
// outcome_market_source. testnet demo 需 deterministic mock outcome 让 voter 可裁决.
//
// 路径: GET /api/test-oracle/:condition → { outcome: 'YES'|'NO' }
// 条件: condition 末尾 '_yes' → YES, '_no' → NO, 其他 → YES (default).
//
// 5-agent 协议 grounding:
// - resolution_rule_spec JSON.stringify({ data_source_canonical: '<host>/api/test-oracle/<condition>' })
// - voter daemon LLM/rule extract → 同 URL 同 outcome → 4-of-5 共识 → 实裁决.
// - 守 G5: 报机制实, 源是 mock 不真预言.

export async function registerTestOracleRoutes(fastify) {
  fastify.get('/api/test-oracle/:condition', async (request, reply) => {
    const condition = String(request.params.condition || '').toLowerCase();
    let outcome = 'YES';
    if (condition.endsWith('_no')) outcome = 'NO';
    else if (condition.endsWith('_yes')) outcome = 'YES';
    return reply.send({
      ok: true,
      condition,
      outcome,
      timestamp: new Date().toISOString(),
      _note: 'r352 mock test-oracle for cross-node settle demo. NOT real oracle.',
    });
  });
}
