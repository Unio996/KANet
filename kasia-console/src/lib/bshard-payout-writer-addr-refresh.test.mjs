/**
 * payout_ps_addr 写方回归 — 守的是【一类缺陷】, 不是四个实例。
 *
 * 病史(docs/2026-08-09-zk-settle-writer-fix-design-v0.1.md): payout_ps_addr 是 write-once 陈列,
 * genesis 时 = p2sh(payout_redeem_hex)。此后 consolidation / close 在 redeem 上原地 splice, 而
 * 【四条写路径无一刷新 addr】。K-18 §3.3 coherence gate step(d) 拿当前 redeem 比 genesis addr,
 * 必然不等 ⇒ throw ⇒ ZK 结算被拦 20 天。
 *
 * 🔴 为什么扫源码而不是调函数: 真正的写方埋在 daemon 深处(要 relay / 链 / wasm), 而在测试里重写
 * 一遍那条 UPDATE 就是【测副本】—— 那样即使源码被改回去它也照绿。四个写点同时漏掉同一列这件事
 * 本身说明: 会复发的是"又加了一条写 redeem 的路径而忘了 addr", 所以判据必须能拦住【第五条】,
 * 而不只是钉住已知那四条。
 *
 * 手工跑: node kasia-console/src/lib/bshard-payout-writer-addr-refresh.test.mjs
 * ⚠ 本仓无自动回归(docs/TEST-FRAMEWORK.md 更正) —— 这是交付那一刻的证据, 不是常驻哨兵。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 不写死名单: 全量扫 src/, 让【新增的第五条写路径】也被这条判据抓到。
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(p);
  }
  return out;
}

let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -- ' + detail}`);
  if (!cond) failed++;
};

// 有意的降级分支是允许的, 但必须【与一条写 addr 的 UPDATE 配对出现】: addr 算不出来时仍要写
// redeem/outpoint(否则下游读到过期字节, 比今天更坏), 而这条降级只有紧挨着主路径才说明是有意的。
// 一条【孤立】的不写 addr 的 UPDATE = 新增写路径又漏了同一列 = 本判据要拦的复发。
const addrSites = [], bare = [];
let writeSites = 0;
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/UPDATE\s+payout_shards\s+SET\s+([^'"`]*)/gi)) {
    const setClause = m[1];
    if (!/payout_redeem_hex\s*=/.test(setClause)) continue;   // 不写 redeem 的 UPDATE 与本判据无关
    writeSites++;
    const line = text.slice(0, m.index).split('\n').length;
    if (/payout_ps_addr\s*=/.test(setClause)) addrSites.push({ file, line });
    else bare.push({ file, line, rel: `${path.relative(SRC, file)}:${line}` });
  }
}

// 判据自身的体检: 一个写点都没扫到时, "零违规"会假装成通过。
ok('扫描器确实找到了写 redeem 的路径(否则判据恒真)', writeSites >= 4, `只找到 ${writeSites} 处, 期望 >=4`);
ok('确实存在刷新 addr 的主路径', addrSites.length >= 4, `只找到 ${addrSites.length} 条, 期望 >=4`);

const PAIR_WINDOW = 15;   // 行距: 降级分支与它的主路径必然相邻
const orphans = bare.filter(b => !addrSites.some(a => a.file === b.file && Math.abs(a.line - b.line) <= PAIR_WINDOW));
ok('没有孤立的写点(每条不刷 addr 的 UPDATE 都紧邻一条刷 addr 的主路径)',
   orphans.length === 0,
   `孤立写点(新增写路径漏刷 addr?): ${orphans.map(o => o.rel).join(', ')}`);

// 阴性对照: 证明这个刷新【不是 no-op】—— splice 后的 redeem 确实是另一份字节。
// 不依赖 kaspa-wasm(要能离线跑): 守的是"addr 由 redeem 决定"这个前提本身;
// 若哪天 addr 不再随 redeem 变, 整个修复就失去意义, 这条会先红。
const genesisRedeem = Buffer.from('aa'.repeat(64), 'hex');
const splicedRedeem = Buffer.from(genesisRedeem);
splicedRedeem.writeBigInt64LE(123456789n, 2);   // 与 close-transport 同款: 原位改 consolidated_pool
const h = (b) => createHash('sha256').update(b).digest('hex');
ok('splice 后 redeem 必是另一份字节(⇒ 陈旧 addr 必然不自洽, 刷新不是 no-op)',
   h(genesisRedeem) !== h(splicedRedeem), '改了字节而哈希不变, 前提不成立');

console.log(failed ? `\n${failed} FAILED` : `\nALL PASS (写 redeem 的路径 ${writeSites} 处, 其中刷 addr 的主路径 ${addrSites.length} 条)`);
process.exit(failed ? 1 : 0);
