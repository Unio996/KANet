#!/usr/bin/env node
/**
 * Sophie 做市实时监控 — 独立运行，不依赖 Claude
 * 用法: cd D:/Anthropic && node scripts/watch-sophie.mjs
 * 每 60 秒刷新一次，按 Ctrl+C 退出
 */

const CONSOLE = 'http://localhost:3100';
const INTERVAL = 60_000;

async function f(url) {
  const r = await fetch(CONSOLE + url, { signal: AbortSignal.timeout(5000) });
  return r.json();
}

async function check() {
  const now = new Date().toLocaleString(undefined, { hour12: false });
  console.clear();
  console.log(`=== Sophie Market Maker Monitor === ${now}\n`);

  // 1. 5 家 CEX 余额
  try {
    const { balances } = await f('/api/trade/balances');
    console.log('CEX Balances:');
    let totalKas = 0, totalUsdt = 0;
    for (const b of balances || []) {
      const kas = b.kas ?? 0, usdt = b.usdt ?? 0;
      totalKas += kas; totalUsdt += usdt;
      console.log(`  ${b.exchange.padEnd(8)} KAS: ${Number(kas).toLocaleString().padStart(14)}  USDT: ${Number(usdt).toFixed(2).padStart(10)}${b.error ? '  ERR: ' + b.error : ''}`);
    }
    console.log(`  ${'TOTAL'.padEnd(8)} KAS: ${Number(totalKas).toLocaleString().padStart(14)}  USDT: ${Number(totalUsdt).toFixed(2).padStart(10)}`);
  } catch (e) { console.log('  Balance fetch failed:', e.message); }

  // 2. 日限额
  console.log('');
  try {
    const { total, exchanges } = await f('/api/trade/daily-usage');
    const pct = total?.pct_used || 0;
    const bar = '#'.repeat(Math.round(pct / 2)).padEnd(50, '-');
    console.log(`Daily Sell: ${total?.sold_kas ?? 0} / ${total?.limit_kas ?? 0} KAS [${bar}] ${pct}%`);
    const active = (exchanges || []).filter(e => e.sold_kas > 0);
    if (active.length) active.forEach(e => console.log(`  ${e.exchange.padEnd(8)} ${e.sold_kas} KAS`));
  } catch (e) { console.log('  Daily usage fetch failed:', e.message); }

  // 3. 最近交易日志
  console.log('');
  try {
    const { log } = await f('/api/trade/log?limit=5');
    console.log('Recent Trades:');
    if (!log?.length) console.log('  (none)');
    for (const r of log || []) {
      console.log(`  ${(r.created_at||'').slice(11,19)} ${(r.side||'?').padEnd(4)} ${r.qty} KAS @${r.price} on ${r.exchange||'?'} [${r.status}]`);
    }
  } catch {
    // fallback: 查 daily-usage 里的各所明细
    try {
      const { exchanges } = await f('/api/trade/daily-usage');
      console.log('Sell Activity:');
      (exchanges || []).forEach(e => { if (e.sold_kas > 0) console.log(`  ${e.exchange.padEnd(8)} sold ${e.sold_kas} KAS`); });
    } catch (e2) { console.log('  Trade log unavailable:', e2.message); }
  }

  // 4. /exchange open offers
  console.log('');
  try {
    const { offers } = await f('/api/exchange/offers?status=open');
    console.log(`Open Exchange Offers: ${(offers || []).length}`);
    for (const o of (offers || []).slice(0, 5)) {
      console.log(`  ${o.give_asset} ${o.give_amount} -> ${o.want_asset} ${o.want_amount} | ${o.protocol_status}`);
    }
  } catch (e) { console.log('  Offers fetch failed:', e.message); }

  // 5. 价差
  console.log('');
  try {
    const { tickers } = await f('/api/trade/spreads');
    const sorted = (tickers || []).filter(t => !t.error).sort((a, b) => b.bid - a.bid);
    console.log('KAS/USDT Prices:');
    for (const t of sorted) {
      console.log(`  ${t.exchange.padEnd(8)} bid: ${t.bid?.toFixed(6)}  ask: ${t.ask?.toFixed(6)}`);
    }
  } catch (e) { console.log('  Spreads fetch failed:', e.message); }

  console.log(`\n--- Next refresh in ${INTERVAL / 1000}s (Ctrl+C to stop) ---`);
}

check().catch(console.error);
setInterval(() => check().catch(console.error), INTERVAL);
