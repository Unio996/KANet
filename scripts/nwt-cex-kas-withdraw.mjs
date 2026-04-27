// NWT cex-kas-withdraw-CHECK — Owner 02:25: "你负责查, 哪个交易所开放 api 提款权限"
// 只查不发. 报告: ccxt 支持 + KAS 上架 + 当前 API key 是否有 withdraw 权限.

import Database from 'file:///C:/kanet/kasia-console/node_modules/better-sqlite3/lib/index.js';
import { createDecipheriv } from 'crypto';
import * as ccxtMod from 'file:///C:/kanet/agent-mind/node_modules/ccxt/js/ccxt.js';
const ccxt = ccxtMod.default || ccxtMod;

const ASSET = 'KAS';

function decrypt(envelope) {
  const hex = process.env.CONSOLE_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('CONSOLE_ENCRYPTION_KEY missing');
  const key = Buffer.from(hex, 'hex');
  const { iv, tag, ciphertext } = JSON.parse(envelope);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(ciphertext, 'base64')) + decipher.final('utf8');
}

async function check(acct) {
  const out = { exchange: acct.exchange, label: acct.label };
  let extra = null;
  if (acct.extra_encrypted) { try { extra = JSON.parse(decrypt(acct.extra_encrypted)); } catch {} }

  const ExClass = ccxt[acct.exchange];
  if (!ExClass) { out.ccxt_supported = false; return out; }
  out.ccxt_supported = true;

  const apiKey = decrypt(acct.api_key_encrypted);
  const apiSecret = decrypt(acct.api_secret_encrypted);
  const ex = new ExClass({
    apiKey, secret: apiSecret,
    password: extra?.password || extra?.passphrase,
    enableRateLimit: true,
  });

  out.has_withdraw_api = !!ex.has?.withdraw;

  // KAS 上架 / 网络支持
  try {
    const cur = (await ex.fetchCurrencies())?.[ASSET];
    out.kas_listed = !!cur;
    out.kas_active = cur?.active;
    out.kas_withdraw_open = cur?.withdraw;
    if (cur?.networks) {
      out.kas_networks = Object.entries(cur.networks).map(([name, n]) => ({
        name, withdraw: n.withdraw, fee: n.fee, min: n.limits?.withdraw?.min,
      }));
    }
  } catch (e) {
    out.fetchCurrencies_err = e.message.slice(0,120);
  }

  // 当前 API key 是否有 withdraw 权限 (probe: 试个 invalid amount=0 withdraw, 看是否报权限错 vs 参数错)
  try {
    await ex.fetchBalance();  // 先验 read 权限
    out.read_ok = true;
  } catch (e) { out.read_err = e.message.slice(0,120); }

  // 真实测 API key withdraw 权限: 我们假装提 0 KAS 到 dummy 地址, 看错误类型
  // 0 amount + 假地址 → 如果有 withdraw 权限会报 invalid amount/address; 没权限会报 PermissionDenied
  try {
    await ex.withdraw(ASSET, 0.001, 'kaspa:dummy_test_addr_to_probe_perm', undefined, { network: 'KAS' });
    out.withdraw_perm = 'unknown_no_error';  // 不应到这, 0.001 KAS 也算成立调用
  } catch (e) {
    const msg = e.message.toLowerCase();
    if (msg.includes('permission') || msg.includes('权限') || msg.includes('not authorized') || msg.includes('forbidden') || e.constructor.name === 'PermissionDenied') {
      out.withdraw_perm = 'NO_PERMISSION';
    } else if (msg.includes('address') || msg.includes('amount') || msg.includes('invalid') || msg.includes('insufficient') || msg.includes('not whitelist') || msg.includes('whitelist')) {
      out.withdraw_perm = 'YES_PERMISSION (rejected on params: ' + e.message.slice(0,100) + ')';
    } else {
      out.withdraw_perm = 'UNKNOWN: ' + e.message.slice(0,120);
    }
  }

  return out;
}

const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
const accts = db.prepare('SELECT id, exchange, label, api_key_encrypted, api_secret_encrypted, extra_encrypted FROM exchange_accounts ORDER BY is_default DESC').all();

console.log(`Checking ${accts.length} CEX for KAS withdraw API capability...\n`);
const results = [];
for (const a of accts) {
  console.log(`-- ${a.exchange} (${a.label}) --`);
  const r = await check(a);
  results.push(r);
  console.log(JSON.stringify(r, null, 2));
  console.log();
}

console.log('=== SUMMARY ===');
console.log(JSON.stringify(results, null, 2));
