(async () => {
  const TX = '97b1ff13431c17e4a5567023259de9ce82c36655b683ce2b66eba3ccb9de93fb';
  const probe = async (name, url, opts = {}) => { try { const t0 = Date.now(); const r = await fetch(url, { headers: { Origin: 'https://example.github.io' }, signal: AbortSignal.timeout(15000), ...opts }); const txt = await r.text(); let b = null; try { b = JSON.parse(txt); } catch {} console.log(name, '=>', r.status, 'acao=', r.headers.get('access-control-allow-origin'), (Date.now() - t0) + 'ms', 'ctype=', (r.headers.get('content-type') || '').slice(0, 30), b ? ('json keys=' + Object.keys(Array.isArray(b) ? (b[0] || {}) : b).slice(0, 12).join(',') + ' hasPayload=' + JSON.stringify(b).includes('payload')) : ('nonjson ' + txt.slice(0, 80).replace(/\s+/g, ' '))); } catch (e) { console.log(name, '=> ERR', e.cause?.code || e.message); } };
  await probe('explorer-host /txs/{id}', `https://${['explorer','kaspa','org'].join('.')}/txs/${TX}`);
  await probe('explorer-host /api/transactions/{id}', `https://${['explorer','kaspa','org'].join('.')}/api/transactions/${TX}`);
  await probe('indexer.kasia.fyi /', `https://indexer.kasia.fyi/`);
  await probe('indexer.kasia.fyi /health', `https://indexer.kasia.fyi/health`);
  await probe('api.kaspa.org POST /transactions/search', `https://api.kaspa.org/transactions/search`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://example.github.io' }, body: JSON.stringify({ transactionIds: [TX] }) });
  await probe('kas.fyi', `https://api.kas.fyi/transactions/${TX}`);
  await probe('kaspa.stream', `https://api.kaspa.stream/transactions/${TX}`);
})();
