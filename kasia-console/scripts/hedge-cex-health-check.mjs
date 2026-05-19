#!/usr/bin/env node
// J2 #520 / NWT N19.12 P0b — 5 CEX 凭据 read-only health check (5/19 三方共识)
//
// 验证 5 家 CEX (Bybit/MEXC/GateIO/Bitget/KuCoin) 凭据 1+ 月没动是否仍有效.
// 用 getCexBalance (USDT) 跑只读 API call, 不下单, 不动钱.
//
// 用法: node kasia-console/scripts/hedge-cex-health-check.mjs

// 加载 kanet.env 才能 decrypt 凭据 (CONSOLE_ENCRYPTION_KEY)
import { readFileSync } from 'node:fs';
try {
  const env = readFileSync('C:/kanet/kanet.env', 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) { console.warn('[hedge-health-check] kanet.env load fail:', e.message); }

const { getCexBalance, getCexAccount } = await import('../src/services/cex-bridge.js');

const TARGETS = ['bybit', 'mexc', 'gateio', 'bitget', 'kucoin'];

console.log('\n[hedge-health-check] 5 CEX 凭据 read-only verify (USDT balance):\n');

let pass = 0, fail = 0;
for (const cex of TARGETS) {
  const acc = getCexAccount(cex);
  if (!acc) {
    console.log(`  ${cex.padEnd(8)} ✗ no exchange_account row`);
    fail++;
    continue;
  }
  try {
    const r = await getCexBalance({ cex, asset: 'USDT' });
    if (r?.ok) {
      const bal = r.balance != null ? r.balance.toFixed(4) : '?';
      console.log(`  ${cex.padEnd(8)} ✓ active — USDT balance: ${bal}`);
      pass++;
    } else {
      console.log(`  ${cex.padEnd(8)} ✗ API call returned !ok — ${r?.error || 'unknown'}`);
      fail++;
    }
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 120);
    console.log(`  ${cex.padEnd(8)} ✗ THROW — ${msg}`);
    fail++;
  }
}

console.log(`\n[hedge-health-check] result: ${pass}/${TARGETS.length} PASS, ${fail} FAIL\n`);
process.exit(fail > 0 ? 1 : 0);
