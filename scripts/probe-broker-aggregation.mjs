// probe-broker-aggregation.mjs — 集成 probe 真 console.db 验证拼单逻辑
// 走真 SQL (selectBestOffers 直接读 exchange_offers 表), 不发协议消息.
// 验证 J1 路径 C 拼单 在 J1 机当前订单簿状态下的实际行为.
//
// Run: KANET_ROOT=D:/Anthropic node scripts/probe-broker-aggregation.mjs

process.chdir('D:/Anthropic/kasia-console');

const { selectBestOffers } = await import('../kasia-console/src/services/broker-buy-handler.js');
const { sqlite } = await import('../kasia-console/src/db/client.js');

// Get current real book depth (bnb, exclude broker self)
const broker = sqlite.prepare("SELECT address FROM relay_nodes WHERE id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'").get();
const bookRows = sqlite.prepare(`
  SELECT id, give_amount, want_amount, verification_meta
  FROM exchange_offers
  WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'
    AND maker != ? AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
`).all(broker?.address || '');
let bnbDepth = 0;
for (const r of bookRows) {
  try {
    const meta = JSON.parse(r.verification_meta || '{}');
    if ((meta.accepted_chains || []).some(c => String(c.chain).toLowerCase() === 'bnb')) {
      bnbDepth += parseFloat(r.give_amount);
    }
  } catch {}
}
console.log(`[real book snapshot] bnb depth = ${bnbDepth} KAS across ${bookRows.length} open offers\n`);

const SCENARIOS = [
  { qty: 5,   chain: 'bnb',     desc: 'small qty single offer (happy path)' },
  { qty: 15,  chain: 'bnb',     desc: 'mid qty single ≥ qty exists' },
  { qty: 25,  chain: 'bnb',     desc: 'mid qty needs 2 offers' },
  { qty: 50,  chain: 'bnb',     desc: '50 KAS — Owner 真测命门, needs 4 aggregation' },
  { qty: 65,  chain: 'bnb',     desc: 'exact book depth' },
  { qty: 100, chain: 'bnb',     desc: 'exceeds depth — must return ok=false + available' },
  { qty: 50,  chain: 'polygon', desc: 'cross-chain — all bnb book, must fail' },
  { qty: 50,  chain: 'sol',     desc: 'cross-chain SOL — must fail' },
];

console.log('='.repeat(80));
console.log('Broker R7-C Aggregation Probe —真 console.db SQL');
console.log('='.repeat(80));

let pass = 0, fail = 0;

for (const s of SCENARIOS) {
  const r = selectBestOffers(s.qty, s.chain);
  const status = r.ok ? '✓ ok' : `✗ insufficient (${r.available} avail)`;
  console.log(`\n[qty=${s.qty} chain=${s.chain}] ${s.desc}`);
  console.log(`  → ${status}, picks=${r.picks?.length || 0}`);
  if (r.ok) {
    console.log(`  total_kas=${r.total_kas}, total_usdt=${r.total_usdt.toFixed(6)}`);
    for (const p of r.picks) {
      console.log(`    · ${p.take_qty} KAS @ ${(p.take_usdt/p.take_qty).toFixed(6)} USDT/KAS  → ${p.maker_addr.slice(0,16)}...`);
    }
  }

  // Dynamic assertions against current bnbDepth (orderbook is volatile, snapshot at probe-start)
  if (s.chain === 'bnb') {
    if (s.qty <= bnbDepth) {
      if (r.ok) { pass++; } else { fail++; console.log(`  ❌ EXPECTED ok=true (qty ${s.qty} ≤ bnbDepth ${bnbDepth})`); }
    } else {
      if (!r.ok && r.available <= bnbDepth) { pass++; } else { fail++; console.log(`  ❌ EXPECTED ok=false avail≤${bnbDepth}`); }
    }
  } else {
    if (!r.ok) { pass++; } else { fail++; console.log(`  ❌ EXPECTED ok=false (non-bnb chain, no offers)`); }
  }
}

console.log('\n' + '='.repeat(80));
console.log(`Result: ${pass}/${pass+fail} pass`);
console.log('='.repeat(80));
process.exit(fail === 0 ? 0 : 1);
