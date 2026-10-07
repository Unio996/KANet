(async () => {
  const B = 'https://api.kaspa.org';
  const j = async (p) => { const r = await fetch(B + p); return r.ok ? r.json() : null; };
  const dag = await j('/info/blockdag');
  let h = dag.tipHashes[0]; const out = []; let seen = 0;
  for (let i = 0; i < 40 && out.length < 3; i++) {
    const b = await j(`/blocks/${h}?includeTransactions=true`);
    if (!b) break;
    (b.transactions || []).forEach((tx, idx) => { seen++; if (idx > 0 && tx.payload && tx.payload.length > 0) out.push({ txid: tx.verboseData?.transactionId, plen: tx.payload.length, head: Buffer.from(tx.payload.slice(0, 40), 'hex').toString('latin1').replace(/[^\x20-\x7e]/g, '.') }); });
    h = b.header?.parentsByLevel?.[0]?.[0] || b.verboseData?.selectedParentHash; if (!h) break;
  }
  console.log(JSON.stringify({ seenTx: seen, nonCoinbaseWithPayload: out }, null, 1));
})();
