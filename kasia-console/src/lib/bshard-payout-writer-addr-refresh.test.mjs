/**
 * payout_ps_addr 写方回归 — 守的是【一类缺陷】, 不是四个实例。
 *
 * 病史(docs/2026-08-09-zk-settle-writer-fix-design-v0.1.md): payout_ps_addr 是 write-once 陈列,
 * genesis 时 = p2sh(payout_redeem_hex)。此后 consolidation / close 在 redeem 上原地 splice, 而
 * 【四条写路径无一刷新 addr】。K-18 §3.3 coherence gate step(d) 拿当前 redeem 比 genesis addr,
 * 必然不等 ⇒ throw ⇒ ZK 结算被拦 20 天。
 *
 * 🔴 为什么扫源码而不是调函数: 真正的写方埋在 daemon 深处(要 relay / 链 / wasm), 而在测试里重写
 * 一遍那条 UPDATE 就是【测副本】—— 那样即使源码被改回去它也照绿。
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

// 🔴 判据从【物理邻近】换成【结构配对】(Codex MUST-FIX, 2026-08-09)。
// 第一版写的是"不刷 addr 的 UPDATE 只要 15 行内挨着一条刷 addr 的 UPDATE 就算配对"。
// **那证的是【邻近】不是【配对】**: 未来第五个漏刷 addr 的写点, 只要恰好落在某个无关但合规的写点
// 15 行内, 就会被错配成一对而放行(false-green)。@NWT 的缺陷重注入证的是"当前 4 个抓得住",
// Codex 指的是"未来第 5 个抓不住" —— 两个 scope 都成立, 而后者只能靠结构解决, 不能靠距离。
// ⇒ 写入已收进唯一入口, 判据变成: 生产代码里【除该入口外】不得出现裸的 redeem-UPDATE。
//   第五条写路径要么走入口(构造上就正确), 要么在这里被抓住。距离不再参与判定。
const ENTRY = 'payout-shard-persist.mjs';
const violations = [];
let entrySites = 0, entryWritesAddr = false;
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const isEntry = path.basename(file) === ENTRY;
  for (const m of text.matchAll(/UPDATE\s+payout_shards\s+SET\s+([^'"`]*)/gi)) {
    const setClause = m[1];
    if (!/payout_redeem_hex\s*=/.test(setClause)) continue;   // 不写 redeem 的 UPDATE 与本判据无关
    const line = text.slice(0, m.index).split('\n').length;
    if (isEntry) {
      entrySites++;
      if (/payout_ps_addr\s*=/.test(setClause)) entryWritesAddr = true;
    } else {
      violations.push(`${path.relative(SRC, file)}:${line}`);
    }
  }
}

// 判据自身的体检: 入口一处都没扫到时, "零违规"会假装成通过。
// 钉死【恰好 2 处】而不是 >=2: 上一条规则整体豁免了入口文件, 于是一条加在入口内部、紧挨合规
// 那条的裸 UPDATE 仍然能逃掉 —— 那正是 Codex 指出的病在入口里的翻版。入口是个小的单一用途
// 模块(主路径 + 降级路径), 写点数量本就该是常数; 钉死它, 任何第三条写入都必须先来改这个测试。
ok('唯一入口里【恰好】2 处写点(主路径 + 降级路径), 多一条都要先过这个判据', entrySites === 2,
   `找到 ${entrySites} 处, 期望恰好 2`);
ok('唯一入口确实会刷新 payout_ps_addr', entryWritesAddr, '入口里没有任何一条 UPDATE 写 payout_ps_addr');
ok(`生产代码里没有绕过 ${ENTRY} 的裸 redeem-UPDATE`, violations.length === 0,
   `绕过唯一入口的写点: ${violations.join(', ')}`);

// 阴性对照: 证明这个刷新【不是 no-op】—— splice 后的 redeem 确实是另一份字节。
// 不依赖 kaspa-wasm(要能离线跑, 且今晚 wasm 刚 trap 过 33.7 小时): 守的是"addr 由 redeem 决定"
// 这个前提本身; 若哪天 addr 不再随 redeem 变, 整个修复就失去意义, 这条会先红。
const genesisRedeem = Buffer.from('aa'.repeat(64), 'hex');
const splicedRedeem = Buffer.from(genesisRedeem);
splicedRedeem.writeBigInt64LE(123456789n, 2);   // 与 close-transport 同款: 原位改 consolidated_pool
const h = (b) => createHash('sha256').update(b).digest('hex');
ok('splice 后 redeem 必是另一份字节(⇒ 陈旧 addr 必然不自洽, 刷新不是 no-op)',
   h(genesisRedeem) !== h(splicedRedeem), '改了字节而哈希不变, 前提不成立');

console.log(failed ? `\n${failed} FAILED` : `\nALL PASS (唯一入口写点 ${entrySites} 处, 绕过入口者 0)`);
process.exit(failed ? 1 : 0);
