/**
 * backfill-payout-ps-addr 回归 —— 重点在【阴性对照】: 证明回填没被用作"消音"。
 *
 * 设计 §3.2 的核心担忧: 回填若盲信 payout_redeem_hex, 万一某盘 redeem 本身是坏的(不对应链上任何
 * 资金), 把 addr 改成"和坏 redeem 自洽" = 用改数据把 gate 的真报警消音。所以链上未确认 ⇒ 必须不写。
 *
 * 🔴 覆盖边界(先说不覆盖的, 免得这份绿被读成"全验过"):
 *   ✅ 枚举正确性(divergent / 已自洽 / 无法判定 三分)
 *   ✅ 互斥守卫(跳过探链 与 真实写入 不能同时成立)
 *   ✅ 阴性对照 C —— 用【真链查询】跑: divergent 且链上无 UTXO ⇒ 必须 SKIP 且【一个字节都没写】
 *   🔴 **未覆盖: 阳性写入路径**(chain_confirmed ⇒ 真回填 ⇒ gate 转绿)。
 *      它需要一个【链上真有钱】的 divergent 盘, 本机 payout_shards 为 0 行, 造不出来。
 *      而这【不是】疏漏可以补的: 安全守卫刻意让"跳过探链"与"写入"互斥, 于是写入路径在离线环境下
 *      结构上就不可达。⇒ 阳性验收必须在有数据的机器上做(设计 §3.1), 由那一步补。
 *
 * 跑: node scripts/backfill-payout-ps-addr.test.mjs
 * ⚠ 本仓无自动回归 —— 这是交付那一刻的证据, 不是常驻哨兵。
 */
import fsx from 'node:fs';
import osx from 'node:os';
import pathx from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);   // 只用于 require kaspa-wasm(CJS)
const HERE = pathx.dirname(fileURLToPath(import.meta.url));
const SCRIPT = pathx.join(HERE, 'backfill-payout-ps-addr.mjs');

let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -- ' + detail}`);
  if (!cond) failed++;
};

// --- 造一个隔离的临时库(绝不碰任何真库) ---
const DB = pathx.join(fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'psaddr-')), 'console.db');
const db = new DatabaseSync(DB);
db.exec(`CREATE TABLE payout_shards (
  logical_market_id TEXT PRIMARY KEY, covenant_family TEXT, payout_redeem_hex TEXT,
  payout_ps_addr TEXT, payout_ps_outpoint TEXT);
CREATE TABLE events (id TEXT PRIMARY KEY, trace_id TEXT, event_scope TEXT, event_type TEXT,
  source TEXT, level TEXT, summary TEXT, payload_json TEXT, created_at TEXT);`);

// p2sh 用与脚本同款实现, 好让"自洽行"真的自洽 —— 不能靠手写一个假地址, 那样测的是别的东西。
const CANDS = ['D:/kanet/kanet/shared/vendor/kaspa-wasm', 'D:/kanet-tn12/shared/vendor/kaspa-wasm', 'kaspa-wasm'];
let _k = null;
for (const c of CANDS) { try { const m = require(c); if (m && m.ScriptBuilder) { _k = m; break; } } catch { /* 下一个 */ } }
if (!_k) { console.log('SKIP-ALL  kaspa-wasm 未解析到 — 本测试要它算真地址'); process.exit(0); }
const p2sh = (hex) => _k.addressFromScriptPublicKey(
  _k.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(hex, 'hex'))).createPayToScriptHashScript(), 'testnet-12').toString();

const redeemA = 'aa'.repeat(60);
const redeemB = 'bb'.repeat(60);
db.prepare('INSERT INTO payout_shards VALUES (?,?,?,?,?)')
  .run('mkt-coherent-0001', 'v2_zk', redeemA, p2sh(redeemA), '00'.repeat(32) + ':0');   // 已自洽
db.prepare('INSERT INTO payout_shards VALUES (?,?,?,?,?)')
  .run('mkt-divergent-002', 'v2_zk', redeemB, 'kaspatest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', '11'.repeat(32) + ':0');
db.prepare('INSERT INTO payout_shards VALUES (?,?,?,?,?)')
  .run('mkt-unreadable-03', 'v2_zk', null, 'kaspatest:whatever', '22'.repeat(32) + ':0');   // redeem 为空
db.close();

const run = (env, expectExit = 0) => {
  try {
    return { out: execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, PS_ADDR_BACKFILL_DB: DB, ...env } }), code: 0 };
  } catch (e) { return { out: String(e.stdout || '') + String(e.stderr || ''), code: e.status }; }
};

// ---- 1. 枚举三分 ----
const dry = run({ PS_ADDR_BACKFILL_NO_CHAIN: '1' });
ok('dry-run 枚举: 3 行里恰好 1 行 divergent, 1 行无法判定',
   /全表 3 行 · divergent 1 行 · 无法判定 1 行/.test(dry.out), dry.out.slice(0, 300));
ok('已自洽的行不进 divergent(回填不会去动它)', !dry.out.includes('mkt-coherent-0001'.slice(-8)), dry.out.slice(0, 200));
// 无法判定的必须被喊出来 —— 沉默会让人把它读成"没问题"
ok('无法判定的行被单独喊出来, 而不是静默归入已好', /⚠ 无法判定 .*payout_redeem_hex 为空/.test(dry.out), dry.out.slice(0, 300));
ok('dry-run 明说自己一行都没写', /【一行都没写】/.test(dry.out), dry.out.slice(-200));

// ---- 2. 互斥守卫 ----
const both = run({ PS_ADDR_BACKFILL_NO_CHAIN: '1', PS_ADDR_BACKFILL_CONFIRMED: '1' });
ok('跳过探链 + 真实写入 = 拒绝执行(退出码 2)', both.code === 2, `code=${both.code} out=${both.out.slice(0, 200)}`);
ok('拒绝理由说明链上确认不是可选项', /安全核心, 不是可选项/.test(both.out), both.out.slice(0, 200));

// ---- 3. 🔴 阴性对照 C: 真链查询, divergent 但链上无 UTXO ⇒ 必须 SKIP 且零写入 ----
const before = new DatabaseSync(DB, { readOnly: true }).prepare('SELECT payout_ps_addr a FROM payout_shards WHERE logical_market_id = ?').get('mkt-divergent-002').a;
const real = run({ PS_ADDR_BACKFILL_CONFIRMED: '1' });   // 走真链: 这个 redeem 派生的地址上不会有钱
const after = new DatabaseSync(DB, { readOnly: true }).prepare('SELECT payout_ps_addr a FROM payout_shards WHERE logical_market_id = ?').get('mkt-divergent-002').a;
const chainReachable = /chain=(确认|未命中)/.test(real.out);
if (!chainReachable) {
  console.log('SKIP      阴性对照 C: 本机节点 RPC 不可达, 这一臂需要真链 —— 不伪装成通过');
} else {
  ok('阴性对照 C: 链上未确认 ⇒ 打 SKIP 而不是回填', /⏭ SKIP .*chain_unconfirmed/.test(real.out), real.out.slice(0, 400));
  ok('阴性对照 C: 链上未确认 ⇒ 那一行的 addr 【一个字节都没变】', after === before, `before=${before} after=${after}`);
  ok('阴性对照 C: 全局重枚举仍报非空(没有假装修完)', /剩余 divergent = 1/.test(real.out), real.out.slice(-300));
  const ev = new DatabaseSync(DB, { readOnly: true }).prepare("SELECT COUNT(*) c FROM events WHERE event_type='payout_ps_addr_backfill_skipped'").get().c;
  ok('阴性对照 C: skip 留下了可查的证据行', ev >= 1, `events 行数=${ev}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
