// 跑: cd kasia-console && node src/lib/broker-buy-inflow.test.mjs (真 schema)
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'bbi-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const { recordBuyInflow, findBuyInflowSender, BUY_INFLOW_MARKER } = await import('./broker-buy-inflow.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const here = dirname(fileURLToPath(import.meta.url));
t('I1 record: 写 marker (id=buy_inflow_<tx16>, from 小写), 重复 tx INSERT OR IGNORE 幂等; 缺 from ⇒ 不写', () => {
  const r = recordBuyInflow(db, { txHash: '0xAB'.padEnd(66, '1'), from: '0xAbCdEF0000000000000000000000000000000001', amountUsdt: 12.5, orderId: 'o1', userKasia: 'kaspa:u1' });
  assert.strictEqual(r.inserted, true); assert.strictEqual(recordBuyInflow(db, { txHash: '0xAB'.padEnd(66, '1'), from: '0xabc', amountUsdt: 12.5, orderId: 'o1', userKasia: 'kaspa:u1' }).inserted, false);
  assert.strictEqual(recordBuyInflow(db, { txHash: '0xcc', from: null }).ok, false);
  const row = db.prepare(`SELECT payload FROM broker_workflow_markers WHERE event_type = ? AND src_event_id = ?`).get(BUY_INFLOW_MARKER, '0xAB'.padEnd(66, '1')); assert.strictEqual(JSON.parse(row.payload).from, '0xabcdef0000000000000000000000000000000001');
});
t('I2 find: 按 user_kasia + 金额 ±2% 命中最新; 金额差太多 ⇒ null; 无 marker 用户 ⇒ null', () => {
  const f = findBuyInflowSender(db, { userKasia: 'kaspa:u1', amountUsdt: 12.6 }); assert.ok(f && f.from === '0xabcdef0000000000000000000000000000000001' && f.chain === 'bnb');
  assert.strictEqual(findBuyInflowSender(db, { userKasia: 'kaspa:u1', amountUsdt: 20 }), null);
  assert.strictEqual(findBuyInflowSender(db, { userKasia: 'kaspa:nobody', amountUsdt: 1 }), null);
  assert.ok(findBuyInflowSender(db, { userKasia: 'kaspa:u1' }), '不给金额 ⇒ 取最新');
});
t('I3 源级: broker-bsc-intake-watcher 在 _publishBrokerBuyOffer 之前 recordBuyInflow; broker-intake-watcher BUY 永久失败 payload 带 refund_candidate_from 且仍 manual_refund_pending:true (本批只捕获不自动退)', () => {
  const W = readFileSync(join(here, '..', 'services', 'broker-bsc-intake-watcher.js'), 'utf8');
  const iR = W.indexOf('recordBuyInflow('), iP = W.indexOf('await _publishBrokerBuyOffer('); assert.ok(iR > 0 && iP > iR, `record@${iR} publish@${iP}`);
  const I = readFileSync(join(here, '..', 'services', 'broker-intake-watcher.js'), 'utf8');
  const seg = I.slice(I.indexOf('export async function _scanUntakenBuyOffersFallback'), I.indexOf('export async function _scanUntakenBuyOffersFallback') + 12000);
  assert.ok(/findBuyInflowSender\(/.test(seg) && /refund_candidate_from/.test(seg) && /manual_refund_pending: true/.test(seg), '永久失败分支须查 sender 并写 refund_candidate_from, 仍 manual');
  assert.ok(!/transferUsdt\(/.test(seg.replace(/\/\/[^\n]*/g, '')), '本批不自动退: BUY fallback 代码行不得调 transferUsdt');
});
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`broker-buy-inflow: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
