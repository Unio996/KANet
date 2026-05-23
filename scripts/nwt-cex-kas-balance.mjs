// NWT cex-kas-balance — 查各 CEX 真实 KAS 余额, 给 Owner 决策余额平衡

import Database from 'file:///C:/kanet/kasia-console/node_modules/better-sqlite3/lib/index.js';
import { createDecipheriv } from 'crypto';
import * as ccxtMod from 'file:///C:/kanet/agent-mind/node_modules/ccxt/js/ccxt.js';
const ccxt = ccxtMod.default || ccxtMod;

function decrypt(envelope) {
  const hex = process.env.CONSOLE_ENCRYPTION_KEY;
  const key = Buffer.from(hex, 'hex');
  const { iv, tag, ciphertext } = JSON.parse(envelope);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(ciphertext, 'base64')) + decipher.final('utf8');
}

async function balCheck(acct) {
  let extra = null;
  if (acct.extra_encrypted) { try { extra = JSON.parse(decrypt(acct.extra_encrypted)); } catch {} }
  const ExClass = ccxt[acct.exchange];
  const ex = new ExClass({
    apiKey: decrypt(acct.api_key_encrypted),
    secret: decrypt(acct.api_secret_encrypted),
    password: extra?.password || extra?.passphrase,
    enableRateLimit: true,
  });

  const out = { exchange: acct.exchange };
  try {
    const bal = await ex.fetchBalance();
    out.kas_free = bal.free?.KAS || 0;
    out.kas_total = bal.total?.KAS || 0;
    out.kas_used = bal.used?.KAS || 0;
    // 顺便 USDT
    out.usdt_free = bal.free?.USDT || 0;
    out.usdt_total = bal.total?.USDT || 0;
  } catch (e) {
    out.err = e.message.slice(0,150);
  }
  return out;
}

const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
const accts = db.prepare('SELECT id, exchange, label, api_key_encrypted, api_secret_encrypted, extra_encrypted FROM exchange_accounts ORDER BY is_default DESC').all();

console.log('CEX KAS / USDT 余额查询:\n');
const results = [];
for (const a of accts) {
  const r = await balCheck(a);
  results.push(r);
  if (r.err) {
    console.log(`${r.exchange.padEnd(8)}: ERR ${r.err}`);
  } else {
    console.log(`${r.exchange.padEnd(8)}: KAS free=${r.kas_free.toFixed(2).padStart(12)} total=${r.kas_total.toFixed(2).padStart(12)}    USDT free=${r.usdt_free.toFixed(2)}`);
  }
}

console.log('\n=== 提款备选 (按 KAS 余额排) ===');
const sorted = results.filter(r => !r.err && r.kas_free > 0).sort((a,b) => b.kas_free - a.kas_free);
for (const r of sorted) {
  console.log(`  ${r.exchange.padEnd(8)} 可提 ${r.kas_free.toFixed(2)} KAS`);
}
