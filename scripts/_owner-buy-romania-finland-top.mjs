#!/usr/bin/env node
// REAL-MONEY-OK: Bettor r138 + Owner 5/16 钦定 "B" + 4-stage pipeline
// Owner-buy Romania top10 YES + Finland top3 YES per Bettor r138 spec hand-off J1 implementor.
// KI-R-BETTOR-EXECUTION-PIPELINE: 强制 4-stage Sophie → Bettor → J2 真 size, Owner explicit ack 每 stage.
//
// Usage:
//   node scripts/_owner-buy-romania-finland-top.mjs --stage=sophie [--dry-run]
//   node scripts/_owner-buy-romania-finland-top.mjs --stage=bettor
//   node scripts/_owner-buy-romania-finland-top.mjs --stage=j2
//
// Per Bettor r138 §4 spec:
// - Stage 2 Sophie: 5 shares per trade test buy → verify endpoint + tokenId + 价格
// - Stage 3 Bettor: 15 shares per trade test buy → cross-host 二次 verify
// - Stage 4 J2: 真 size $980 each → floor(sizeUsd / maxPrice) shares to avoid rounding-error balance fail
// - 每 stage abort on any unexpected status / missing field
// - max price 守 — fill price MUST ≤ maxPrice OR abort

const API_BASE = 'http://127.0.0.1:3100';

const STAGE_CONFIG = {
  sophie: { relay: 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf', shares: 5,  sizeUsd: null,  label: 'Sophie' },
  bettor: { relay: 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e', shares: 15, sizeUsd: null,  label: 'Bettor' },
  j2:     { relay: 'c9c37c37-9a8c-484c-9893-20185d97ccf9', shares: null, sizeUsd: 980, label: 'J2' },
};

const TRADES = [
  {
    name: 'Romania top10',
    tokenId: '1795798589454628045997769377347591416581500090183160623525911515209093170776',
    maxPrice: 0.85,  // 0.83 mid + 2pp slippage cap
  },
  {
    name: 'Finland top3',
    tokenId: '45511196542442605292932763601268056177077471243876621193917858574361925280514',
    maxPrice: 0.88,  // 0.855 mid + 2.5pp slippage cap
  },
];

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--stage=')) args.stage = a.slice('--stage='.length);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function placeOrder({ relayId, tokenId, side, price, size }) {
  const res = await fetch(`${API_BASE}/api/predictions/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relay_node_id: relayId, tokenId, side, price, size }),
  });
  const j = await res.json().catch(() => ({ ok: false, error: `non-json response status ${res.status}` }));
  return { httpStatus: res.status, body: j };
}

async function main() {
  const { stage, dryRun } = parseArgs();
  if (!stage || !STAGE_CONFIG[stage]) {
    console.error('Usage: --stage=sophie|bettor|j2 [--dry-run]');
    process.exit(1);
  }
  const cfg = STAGE_CONFIG[stage];
  console.log(`\n=== Stage: ${cfg.label} (relay=${cfg.relay.slice(0, 8)}, ${cfg.shares ? `shares=${cfg.shares}` : `sizeUsd=$${cfg.sizeUsd}`}) ${dryRun ? '[DRY-RUN]' : '[LIVE]'} ===\n`);

  const results = [];
  for (const trade of TRADES) {
    const sizeShares = cfg.shares ?? Math.floor(cfg.sizeUsd / trade.maxPrice);
    console.log(`--- ${trade.name} (tokenId=${trade.tokenId.slice(0, 12)}...) ---`);
    console.log(`  Plan: BUY ${sizeShares} shares @ max $${trade.maxPrice}`);
    if (dryRun) {
      console.log(`  [DRY-RUN] skipping POST. Body would be { relay_node_id: '${cfg.relay}', tokenId, side: 'BUY', price: ${trade.maxPrice}, size: ${sizeShares} }`);
      results.push({ trade: trade.name, status: 'dry-run', sizeShares });
      continue;
    }
    let r;
    try {
      r = await placeOrder({ relayId: cfg.relay, tokenId: trade.tokenId, side: 'BUY', price: trade.maxPrice, size: sizeShares });
    } catch (e) {
      console.error(`  ✗ FATAL fetch error: ${e.message}`);
      console.error('  ABORTING pipeline (Bettor r138 §4 abort-on-fail).');
      process.exit(2);
    }
    console.log(`  HTTP status: ${r.httpStatus}`);
    console.log(`  Response: ${JSON.stringify(r.body).slice(0, 400)}`);
    const body = r.body || {};
    const fillPriceRaw = body.takingAmount && body.makingAmount
      ? Number(body.takingAmount) / Number(body.makingAmount)
      : null;
    if (r.httpStatus !== 200 || body.ok === false || body.success === false) {
      console.error(`  ✗ Order failed (httpStatus=${r.httpStatus}, ok=${body.ok}, success=${body.success}, error=${body.error || 'n/a'})`);
      console.error('  ABORTING pipeline (Bettor r138 §4 abort-on-fail).');
      results.push({ trade: trade.name, status: 'fail', body });
      console.log('\n=== SUMMARY ===');
      for (const x of results) console.log(' ', x.trade, x.status);
      process.exit(3);
    }
    if (fillPriceRaw != null && fillPriceRaw > trade.maxPrice + 0.001) {
      console.error(`  ✗ Fill price $${fillPriceRaw.toFixed(4)} > maxPrice $${trade.maxPrice}`);
      console.error('  ABORTING pipeline (Bettor r138 §4 max price 守).');
      results.push({ trade: trade.name, status: 'over-price', fillPrice: fillPriceRaw, body });
      console.log('\n=== SUMMARY ===');
      for (const x of results) console.log(' ', x.trade, x.status);
      process.exit(4);
    }
    console.log(`  ✓ orderID: ${body.orderID || body.orderId || 'n/a'}`);
    console.log(`  ✓ TX hashes: ${JSON.stringify(body.transactionsHashes || body.transactionsHashes || [])}`);
    console.log(`  ✓ takingAmount (pUSD spent): ${body.takingAmount || 'n/a'}`);
    console.log(`  ✓ makingAmount (shares received): ${body.makingAmount || 'n/a'}`);
    console.log(`  ✓ fill price: ${fillPriceRaw ? '$' + fillPriceRaw.toFixed(4) : 'n/a'}`);
    results.push({ trade: trade.name, status: 'ok', body });
  }

  console.log('\n=== SUMMARY ===');
  for (const x of results) console.log(' ', x.trade, x.status);
  console.log(`\nStage ${cfg.label} complete. Broadcast result + wait Owner explicit ack before next stage.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
