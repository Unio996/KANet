// 真 schema (runMigrations) + 候选表 DDL; 不碰 live。跑法: cd kasia-console && node ../scratch/_j2_l2_coverage/indexer-coverage.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'cov-'));
process.env.DB_PATH = join(dir, 't.db');
let repo = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(repo, 'kasia-console', 'package.json'))) { const up = dirname(repo); if (up === repo) throw new Error('repo root not found'); repo = up; }
const { sqlite: db } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'client.js')).href);
const { runMigrations } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'migrate.js')).href);
await runMigrations();
const { COVERAGE_DDL, advanceCoverage, indexerCoverageDaa, indexerCoverage, daaAtOrAfterMs, daaAtOrBeforeMs } = await import('./indexer-coverage.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
// v199 迁移自证: 在 exec 任何本地 DDL 之前, 表/索引必须已由 runMigrations 建出 (否则测试自己的 DDL 会掩盖迁移缺失)
t('M0 v199: runMigrations 已建 kaspa_tx_log_coverage / broker_refund_intents / idx_spc_daa_ts / idx_txlog_cov_addr_end', () => {
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('kaspa_tx_log_coverage','broker_refund_intents','idx_spc_daa_ts','idx_txlog_cov_addr_end','idx_refund_intents_order','idx_refund_intents_offer')`).all().map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['broker_refund_intents', 'idx_refund_intents_offer', 'idx_refund_intents_order', 'idx_spc_daa_ts', 'idx_txlog_cov_addr_end', 'kaspa_tx_log_coverage']);
  assert.throws(() => db.prepare(`INSERT INTO kaspa_tx_log_coverage (network,address,start_daa,end_daa,indexer,updated_at) VALUES ('n','a',10,5,'x','t')`).run(), /CHECK/);   // end>=start
  assert.throws(() => db.prepare(`INSERT INTO broker_refund_intents (id,order_id,offer_id,user_addr,amount_kas,created_at,updated_at) VALUES ('i',NULL,NULL,'a',1,'t','t')`).run(), /CHECK/);   // order/offer 至少一个
});
db.exec(COVERAGE_DDL);   // 幂等 (IF NOT EXISTS), 仅证 lib 自带 DDL 与迁移一致不冲突
const NET = 'testnet-12', A = 'kaspatest:qq' + 'a'.repeat(59), B = 'kaspatest:qq' + 'b'.repeat(59);
const ADJ = 20;
const adv = (daa, addrs = [A], indexer = 'relay:r1') => advanceCoverage(db, { network: NET, addresses: addrs, daa, indexer, adj: ADJ });
const cov = (from, to, address = A) => indexerCoverageDaa(db, { network: NET, address, fromDaa: from, toDaa: to });

t('C1 空账 ⇒ 任何窗 covered=false, holes=[整窗 no_rows]', () => { const r = cov(100, 200); assert.strictEqual(r.covered, false); assert.deepStrictEqual(r.holes, [{ start_daa: 100, end_daa: 200, reason: 'no_rows' }]); });
t('C2 首次推进 ⇒ 开新行 [100,100]', () => { assert.deepStrictEqual(adv(100), { extended: 0, opened: 1, skipped: 0 }); assert.strictEqual(cov(100, 100).covered, true); });
t('C3 相邻(≤ADJ)推进 ⇒ 延伸同一行 [100,115]', () => { assert.deepStrictEqual(adv(105), { extended: 1, opened: 0, skipped: 0 }); adv(115); assert.strictEqual(cov(100, 115).covered, true); assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM kaspa_tx_log_coverage`).get().n, 1); });
t('C4 跳块(>ADJ) ⇒ 新行, 洞可见 [116,199]', () => { assert.deepStrictEqual(adv(200), { extended: 0, opened: 1, skipped: 0 }); const r = cov(100, 200); assert.strictEqual(r.covered, false); assert.deepStrictEqual(r.holes, [{ start_daa: 116, end_daa: 199 }]); });
t('C5 乱序/重复到达(daa ≤ end) ⇒ skipped, 账不回退', () => { assert.deepStrictEqual(adv(150), { extended: 0, opened: 0, skipped: 1 }); assert.strictEqual(cov(150, 150).covered, false); });
t('C6 窗完全在一段内 ⇒ covered; 跨两段但缝在窗内 ⇒ 不 covered', () => { assert.strictEqual(cov(200, 200).covered, true); assert.strictEqual(cov(110, 205).covered, false); });
t('C7 尾部未覆盖 ⇒ holes 带 tail_uncovered', () => { const r = cov(190, 260); assert.strictEqual(r.covered, false); assert.ok(r.holes.some((h) => h.reason === 'tail_uncovered' && h.start_daa === 201 && h.end_daa === 260)); });
t('C8 多 indexer 并集: relay:r1 [100,115]∪[200,200]; scout 补 [116,199] ⇒ [100,200] covered', () => { for (let d = 116; d <= 199; d += ADJ) adv(d, [A], 'kaspa-scout'); adv(199, [A], 'kaspa-scout'); const r = cov(100, 200); assert.strictEqual(r.covered, true, JSON.stringify(r.holes)); });
t('C9 地址隔离: B 无账 ⇒ B 窗不 covered', () => { assert.strictEqual(cov(100, 200, B).covered, false); });
t('C10 多地址一次推进各自独立行', () => { const r = adv(300, [A, B]); assert.deepStrictEqual(r, { extended: 0, opened: 2, skipped: 0 }); assert.strictEqual(cov(300, 300, B).covered, true); });
t('C11 bad args ⇒ throw (不静默写坏账)', () => { assert.throws(() => advanceCoverage(db, { network: NET, addresses: [A], daa: -1, indexer: 'x', adj: ADJ })); assert.throws(() => advanceCoverage(db, { network: NET, addresses: 'A', daa: 1, indexer: 'x', adj: ADJ })); assert.throws(() => advanceCoverage(db, { network: NET, addresses: [A], daa: 1, indexer: '', adj: ADJ })); });
t('C12 区间倒置 ⇒ covered=false + bad_range', () => { const r = cov(200, 100); assert.strictEqual(r.covered, false); assert.strictEqual(r.holes[0].reason, 'bad_range'); });
// 时间→DAA (spc_daa_index 真表)
const T0 = Date.parse('2026-08-29T10:00:00Z');
const ins = db.prepare(`INSERT OR IGNORE INTO spc_daa_index (daa_score, block_hash, timestamp_ms) VALUES (?, ?, ?)`);
for (const [d, ms] of [[100, T0], [105, T0 + 1000], [115, T0 + 3000], [200, T0 + 20000], [300, T0 + 40000]]) ins.run(d, 'h'.repeat(64), ms);
t('T1 daaAtOrBeforeMs / daaAtOrAfterMs 取向正确', () => { assert.strictEqual(daaAtOrBeforeMs(db, T0 + 1500), 105); assert.strictEqual(daaAtOrAfterMs(db, T0 + 1500), 115); assert.strictEqual(daaAtOrBeforeMs(db, T0 - 1), null); assert.strictEqual(daaAtOrAfterMs(db, T0 + 99999), null); });
t('T2 indexerCoverage(ISO 窗) 保守换算: 起点向前(105), 终点向后(200) ⇒ 看 [105,200] ⇒ 有缝(116-199 由 scout 补了? 是) ⇒ covered', () => { const r = indexerCoverage(db, { network: NET, address: A, fromIso: new Date(T0 + 1500).toISOString(), toIso: new Date(T0 + 19000).toISOString() }); assert.strictEqual(r.fromDaa, 105); assert.strictEqual(r.toDaa, 200); assert.strictEqual(r.covered, true, JSON.stringify(r.holes)); assert.strictEqual(r.mode, 'phase1-relay-attested'); });
t('T3 窗终点晚于最新块 ⇒ 取最近块(300) ⇒ [105,300] 有缝 201-299 ⇒ 不 covered', () => { const r = indexerCoverage(db, { network: NET, address: A, fromIso: new Date(T0 + 1500).toISOString(), toIso: new Date(T0 + 99999).toISOString() }); assert.strictEqual(r.toDaa, 300); assert.strictEqual(r.covered, false); });
t('T4 换算不可用(窗早于所有块) ⇒ covered=false(daa_conversion_unavailable)', () => { const r = indexerCoverage(db, { network: NET, address: A, fromIso: new Date(T0 - 5000).toISOString(), toIso: new Date(T0 - 4000).toISOString() }); assert.strictEqual(r.covered, false); assert.strictEqual(r.holes[0].reason, 'daa_conversion_unavailable'); });
t('T5 坏时间窗 ⇒ covered=false', () => { const r = indexerCoverage(db, { network: NET, address: A, fromIso: 'x', toIso: 'y' }); assert.strictEqual(r.covered, false); });
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`indexer-coverage: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
