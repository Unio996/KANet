(async () => {
  const B = 'https://api.kaspa.org';
  // 空地址(从未收过款): 随机 P2PK 主网地址 — 用 kaspa-wasm 派生
  const kaspa = require('D:/kanet-tn12/kasia-relay/node_modules/kaspa-wasm');
  const addr = new kaspa.PrivateKey('07'.repeat(32)).toPublicKey().toAddress('mainnet').toString();
  const r = await fetch(`${B}/addresses/${addr}/full-transactions?limit=5&resolve_previous_outpoints=no`, { headers: { Origin: 'https://example.github.io' } });
  console.log('empty-address history:', r.status, (await r.text()).slice(0, 80));
  const r2 = await fetch(`${B}/addresses/${addr}/utxos`); console.log('empty-address utxos:', r2.status, (await r2.text()).slice(0, 60));
  // 突发: 30 个并发 GET 同一 tx, 看 429
  const TX = '97b1ff13431c17e4a5567023259de9ce82c36655b683ce2b66eba3ccb9de93fb';
  const rs = await Promise.all(Array.from({ length: 30 }, () => fetch(`${B}/transactions/${TX}`).then((x) => x.status).catch((e) => 'ERR')));
  const cnt = rs.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {}); console.log('30 parallel:', JSON.stringify(cnt));
  // 大 payload 抽样: 取前几笔 full-transactions 的 payload 长度分布(同一发件地址)
  const tx = await (await fetch(`${B}/transactions/${TX}?inputs=false&outputs=true&resolve_previous_outpoints=no`)).json();
  const a0 = tx.outputs[0].script_public_key_address;
  const ft = await (await fetch(`${B}/addresses/${a0}/full-transactions?limit=20&resolve_previous_outpoints=no`)).json();
  console.log('payload lengths (hex chars) of 20 txs at that address:', ft.map((t) => (t.payload || '').length).join(','));
  console.log('has tx we looked up in address history:', ft.some((t) => t.transaction_id === TX));
  console.log('accepted flags:', ft.slice(0, 5).map((t) => t.is_accepted).join(','));
})();
