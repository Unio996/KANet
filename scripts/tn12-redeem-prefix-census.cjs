#!/usr/bin/env node
/**
 * 真实 redeem 制品的**首字节普查**（只读）。
 *
 * 🔴 存在的理由: 2026-08-12 我(J2)把「多-entry PoolRoot」的识别谓词写成 `首字节 == 0x51`,
 *    那是**我从注释推出来的**, 而真实制品一律是 `0x6b` ⇒ 那个 fail-closed 谓词会把**所有退款挡死**。
 *    我的用例没抓到, 因为**夹具也是我编的**(`'51' + …`)——用例与实现共享同一个发明, 于是彼此同意。
 *    ⇒ **谈"模板身份"之前, 先跑这个, 看生产里到底长什么样。**
 *    详见 docs/2026-08-12-j2-fix-predicate-was-keyed-on-an-invented-byte.md
 *
 * 跑: node scripts/tn12-redeem-prefix-census.cjs
 */
const path = require('path');
const fs = require('fs');
const ROOT = process.env.KANET_ROOT || path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'kasia-console', 'data', 'console.db');
const D = require(path.join(ROOT, 'kasia-console', 'node_modules', 'better-sqlite3'));

if (!fs.existsSync(DB)) { console.error(`本机没有 ${DB}（非本机跑属正常）`); process.exit(0); }
const db = new D(DB, { readonly: true });

const census = (table, col) => {
  try {
    const rows = db.prepare(
      `SELECT substr(${col},1,2) p, COUNT(*) n FROM ${table}
       WHERE ${col} IS NOT NULL AND TRIM(${col})<>'' GROUP BY p ORDER BY n DESC`,
    ).all();
    const total = rows.reduce((a, r) => a + r.n, 0);
    console.log(`\n${table}.${col}  (共 ${total} 份)`);
    if (!rows.length) { console.log('  (无数据)'); return; }
    rows.forEach((r) => console.log(`  0x${r.p}  ×${r.n}${rows.length === 1 ? '   ← 唯一形态' : ''}`));
    if (rows.length > 1) console.log('  ⚠ 存在多种首字节 ⇒ 身份判别不能只看这一字节');
  } catch (e) { console.log(`\n${table}.${col}: ${e.message.slice(0, 80)}`); }
};

console.log('真实 redeem 首字节普查（只读；用于回答"模板身份长什么样"，不要靠注释推断）');
census('market_shards', 'shard_redeem_hex');
census('payout_shards', 'payout_redeem_hex');
console.log('\n🔨 判据: 识别谓词必须键在【普查得到的实际形态】上；夹具也必须取自生产制品——');
console.log('   夹具由自己编时, 用例证明的是"实现符合我的想象", 不是"实现符合生产"。');
db.close();
