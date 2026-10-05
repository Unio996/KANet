// mm_stubs.mjs — 账本1855 simnet 验收用本地桩(只绑 127.0.0.1, 仅 simnet 彩排):
//   :3399  假 gamma 源(POOL_SEED_GAMMA_URL): 4 个"真实形态"的 Polymarket 盘, 到期时刻 = argv[2](ms epoch); 未 arm 前返回 []。
//   :3401 / :3402  两个假 Polygon JSON-RPC(UMA_POLYGON_RPCS, 种子盘 outcome_market_source=polymarket 走 UMA 判定路径):
//          payoutDenominator=1; conditionId 第 i 个: i 偶 ⇒ YES(numerators [1,0]), i 奇 ⇒ NO([0,1])。
// 控制: POST http://127.0.0.1:3399/arm 之后 gamma 才开始返回盘(让 harness 先取静默快照再放种子器干活)。
import http from 'node:http';
const endMs = Number(process.argv[2]);
if (!Number.isFinite(endMs)) throw new Error('usage: node mm_stubs.mjs <endMs>');
const condBase = Number(process.argv[3] || 0);   // conditionId 偏移: 同一库里已镜像过的 cond 会被种子器去重, 复跑(neg)用新 id; 奇偶不变(base 取偶数)
const cond = (i) => '0x' + (i + condBase).toString(16).padStart(2, '0').repeat(32);
let armed = false;
const gamma = () => Array.from({ length: 4 }, (_, i) => ({
  conditionId: cond(i), question: `MM rehearsal market #${i}: will event ${i} happen?`, description: `mirror of a Polymarket market #${i} (simnet rehearsal stub)`,
  endDate: new Date(endMs).toISOString(), volume24hr: String(100000 - i * 1000), resolutionSource: '', questionID: '0x' + String(i).padStart(64, '0'), negRisk: false,
  events: [{ id: String(900 + i), title: `MM event ${i}`, slug: `mm-event-${i}` }],
}));
http.createServer((req, res) => {
  if (req.url === '/arm' && req.method === 'POST') { armed = true; res.end('armed'); return; }
  if (req.url.startsWith('/gamma')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(armed ? gamma() : [])); return; }
  res.statusCode = 404; res.end();
}).listen(3399, '127.0.0.1', () => console.log('[stub] gamma :3399 endMs', endMs, new Date(endMs).toISOString()));
const word = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const handleRpc = (m) => {
  const id = m.id; const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (m.method) {
    case 'eth_chainId': return ok('0x89');
    case 'net_version': return ok('137');
    case 'eth_blockNumber': return ok('0x10');
    case 'eth_call': {
      const data = String(m.params?.[0]?.data || '').toLowerCase();
      const sel = data.slice(0, 10);
      if (sel === '0xdd34de67') return ok(word(1));                                 // payoutDenominator(bytes32)
      if (sel === '0x0504c814') {                                                   // payoutNumerators(bytes32,uint256)
        const condHex = data.slice(10, 74); const idx = Number(BigInt('0x' + data.slice(74, 138)));
        const i = parseInt(condHex.slice(0, 2), 16); const yes = i % 2 === 0;
        return ok(word((idx === 0) === yes ? 1 : 0));
      }
      return { jsonrpc: '2.0', id, error: { code: -32000, message: 'stub: unknown selector ' + sel } };
    }
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: 'stub: method not found ' + m.method } };
  }
};
for (const port of [3401, 3402]) {
  http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      let j; try { j = JSON.parse(b); } catch { res.statusCode = 400; res.end('bad json'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(j) ? j.map(handleRpc) : handleRpc(j)));
    });
  }).listen(port, '127.0.0.1', () => console.log('[stub] polygon rpc :' + port));
}
