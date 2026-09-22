// R-a 突变验证: 逐条对生产代码做一个最小突变 → 跑对应测试 → 必须红(exit≠0)→ 还原并核字节一致。scratch 工具, 输出落 provenance。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const ROOT = 'D:/kanet-tn12/scratch/_j2_wt_ra/kasia-console/';
const T = { store: 'src/lib/proto-refund-flip-store.test.mjs', probe: 'src/lib/proto-refund-flip-probe.test.mjs', core: 'src/lib/proto-settlement-driver-core.test.mjs', builder: 'src/lib/proto-tx-assembly-settlement.test.mjs', v214: 'src/db/proto-settlement-intents-v214.test.mjs' };
const M = [
  { id: 'M1a-listWork-drop-frozen-predicate', file: 'src/lib/proto-settlement-store.mjs', from: "WHERE m.status = 'sealed' AND m.settlement_frozen_at IS NOT NULL\n        AND EXISTS", to: "WHERE m.status = 'sealed'\n        AND EXISTS", test: 'store', why: '去掉"已冻结"触发谓词 ⇒ 未冻结市场被翻' },
  { id: 'M1b-listWork-status-in-cancelled', file: 'src/lib/proto-settlement-store.mjs', from: "WHERE m.status = 'sealed' AND m.settlement_frozen_at IS NOT NULL\n        AND EXISTS", to: "WHERE m.status IN ('sealed', 'cancelled') AND m.settlement_frozen_at IS NOT NULL\n        AND EXISTS", test: 'store', why: '触发放宽到 cancelled(主网手置遗留形状被选中)' },
  { id: 'M1c-markLanded-drop-sealed-guard', file: 'src/lib/proto-settlement-store.mjs', from: "if (m.status === 'sealed') {   // M1", to: "if (true) {   // M1", test: 'store', why: '去掉前态 sealed 谓词 ⇒ 遗留 cancelled 市场被建 claim' },
  { id: 'M3-claim-id-random', file: 'src/lib/proto-settlement-store.mjs', from: "return createHash('sha256').update(`${marketId}${ticketTxid.toLowerCase()}${ticketVout}refund`).digest('hex');", to: "return randomBytes(32).toString('hex');", test: 'store', why: '退款 claim id 改随机 ⇒ 重跑重复建行 / id 不可复算' },
  { id: 'M5a-probe-drop-covenantId', file: 'src/lib/proto-settlement-ops.mjs', from: "u.covenantId === covId && u.scriptPublicKey.version === 0", to: "u.scriptPublicKey.version === 0", test: 'probe', why: '探针不核 covenantId(地址级)⇒ dust 可伪造"已翻"' },
  { id: 'M5b-probe-drop-old-outpoint', file: 'src/lib/proto-settlement-ops.mjs', from: "if (oldRes.found.length > 0 || oldRes.missing.length !== 1) return", to: "if (false) return", test: 'probe', why: '探针不核旧 outpoint 已花' },
  { id: 'M5c-observed-no-freeze', file: 'src/lib/proto-settlement-store.mjs', from: "const f = freezeMarket({ db, marketId, reason: 'refund_flip_observed', pmt: null, wallMs: Date.now(), log });\n      return { recorded, frozenNow: f.changes === 1 };", to: "return { recorded, frozenNow: false };", test: 'store', why: '观察到别人翻牌不自动冻结' },
  { id: 'GATE-a-core-uses-close-timing', file: 'src/lib/proto-settlement-driver-core.mjs', from: "deadlineMs: prep.deadlineMs, evaluate: evaluateRefundFlipTiming });", to: "deadlineMs: prep.deadlineMs, evaluate: evaluateCloseCommitTiming });", test: 'core', why: 'refund_flip 复用 close 的 30s 闸 ⇒ deadline+60s 就放行' },
  { id: 'GATE-b-core-frozen-gate-off', file: 'src/lib/proto-settlement-driver-core.mjs', from: "if (frozen !== true) { const e = new Error(`refund_flip_market_not_frozen", to: "if (false) { const e = new Error(`refund_flip_market_not_frozen", test: 'core', why: '去掉"只翻冻结市场"闸' },
  { id: 'BUILD-a-evidence-optional', file: 'src/lib/proto-tx-assembly-settlement.mjs', from: "if (!trusted) throw new Error(`${who}: fail-closed — 缺可信的 pmtEvidence", to: "if (false) throw new Error(`${who}: fail-closed — 缺可信的 pmtEvidence", test: 'builder', why: 'builder 不要求可信 pmtEvidence' },
  { id: 'BUILD-b-locktime-wrong', file: 'src/lib/proto-tx-assembly-settlement.mjs', from: "const lockTime = BigInt(tm.lockTimeMs);", to: "const lockTime = BigInt(deadlineMs);", test: 'builder', why: 'lockTime 用 deadline(close 的)而非 deadline+2h' },
  { id: 'V214-a-no-drop-triggers', file: 'src/db/migrate.js', from: "for (const t of trigs) sqlite.exec(`DROP TRIGGER IF EXISTS \"${t.name}\"`);", to: "/* mutant: 不 DROP 引用触发器(朴素配方) */", test: 'v214', why: '迁移不先 DROP 引用触发器 ⇒ RENAME 失败(NWT 实测)' },
];
const out = [];
for (const m of M) {
  const p = ROOT + m.file; const orig = fs.readFileSync(p, 'utf8');
  if (!orig.includes(m.from)) { out.push({ id: m.id, result: 'PATTERN-MISSING' }); console.log(m.id, 'PATTERN-MISSING'); continue; }
  fs.writeFileSync(p, orig.replace(m.from, () => m.to));
  let r; try { r = spawnSync(process.execPath, [T[m.test]], { cwd: ROOT, encoding: 'utf8', timeout: 280000, env: { ...process.env } }); } finally { fs.writeFileSync(p, orig); }
  const text = (r.stdout || '') + (r.stderr || '');
  const red = (text.match(/❌|\[FAIL\]/g) || []).length;
  const restored = fs.readFileSync(p, 'utf8') === orig;
  out.push({ id: m.id, why: m.why, test: T[m.test], exit: r.status, redMarkers: red, restored, result: (r.status !== 0 || red > 0) ? 'RED(检出)' : 'GREEN(!!漏网)' });
  console.log(m.id, r.status, red, restored ? 'restored' : 'NOT-RESTORED!!');
}
fs.writeFileSync('D:/kanet-tn12/scratch/_j2_ra_mutation_results.json', JSON.stringify(out, null, 1));
