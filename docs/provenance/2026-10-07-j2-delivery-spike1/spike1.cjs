(async () => {
  const B = 'https://api.kaspa.org';
  const j = async (p) => { const r = await fetch(B + p, { headers: { Origin: 'https://example.github.io' } }); return { status: r.status, acao: r.headers.get('access-control-allow-origin'), body: await r.json().catch(() => null) }; };
  const dag = (await j('/info/blockdag')).body;
  let found = null, scanned = 0;
  for (const h of dag.tipHashes.slice(0, 3)) {
    const blk = (await j(`/blocks/${h}?includeTransactions=true`)).body;
    const parents = [h, ...(blk?.verboseData?.mergeSetBluesHashes || []).slice(0, 8)];
    for (const ph of parents) {
      const b = ph === h ? blk : (await j(`/blocks/${ph}?includeTransactions=true`)).body;
      for (const tx of (b?.transactions || [])) { scanned++; if (tx.payload && tx.payload.length > 20 && !found) found = { txid: tx.verboseData?.transactionId, payloadHexLen: tx.payload.length, head: tx.payload.slice(0, 60), block: ph }; }
      if (found) break;
    }
    if (found) break;
  }
  console.log(JSON.stringify({ scanned, found }, null, 1));
})();
