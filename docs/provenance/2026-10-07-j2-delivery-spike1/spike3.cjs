(async () => {
  const B = 'https://api.kaspa.org', TX = '97b1ff13431c17e4a5567023259de9ce82c36655b683ce2b66eba3ccb9de93fb';
  const get = async (u, o = {}) => { const t0 = Date.now(); const r = await fetch(u, { headers: { Origin: 'https://example.github.io' }, ...o }); const txt = await r.text(); let b = null; try { b = JSON.parse(txt); } catch {} return { status: r.status, ms: Date.now() - t0, acao: r.headers.get('access-control-allow-origin'), rl: r.headers.get('x-ratelimit-remaining') || r.headers.get('ratelimit-remaining') || r.headers.get('retry-after'), b, raw: b ? null : txt.slice(0, 120) }; };
  const a = await get(`${B}/transactions/${TX}?inputs=false&outputs=true&resolve_previous_outpoints=no`);
  console.log('A /transactions/{id}:', a.status, 'acao=', a.acao, a.ms + 'ms', 'keys=', a.b && Object.keys(a.b).join(','), 'payload?', a.b && typeof a.b.payload, a.b && a.b.payload && a.b.payload.length, 'accepted=', a.b && a.b.is_accepted, a.b && a.b.accepting_block_blue_score);
  const addr = a.b && a.b.outputs && a.b.outputs[0] && a.b.outputs[0].script_public_key_address;
  console.log('  out0 addr present:', !!addr);
  if (addr) {
    const f = await get(`${B}/addresses/${addr}/full-transactions?limit=5&offset=0&fields=payload&resolve_previous_outpoints=no`);
    console.log('B /addresses/{a}/full-transactions:', f.status, 'acao=', f.acao, f.ms + 'ms', Array.isArray(f.b) ? `n=${f.b.length} payloadKeyInFirst=${f.b[0] && 'payload' in f.b[0]} firstPayloadLen=${f.b[0] && f.b[0].payload && f.b[0].payload.length}` : f.raw);
    const u = await get(`${B}/addresses/${addr}/utxos`);
    console.log('C /addresses/{a}/utxos:', u.status, Array.isArray(u.b) ? `n=${u.b.length}` : u.raw);
  }
  const many = []; for (let i = 0; i < 12; i++) many.push((await get(`${B}/transactions/${TX}`)).status);
  console.log('D 12 sequential GETs statuses:', many.join(','));
  const bad = await get(`${B}/transactions/${'00'.repeat(32)}`); console.log('E unknown txid:', bad.status, JSON.stringify(bad.b || bad.raw).slice(0, 100));
})();
