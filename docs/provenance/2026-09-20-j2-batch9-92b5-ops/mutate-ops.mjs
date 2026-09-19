// 9-2b (iii-2) ops——变异对照(离线端到端单文件测试逐个跑)。用法(仓库根): node docs/provenance/2026-09-20-j2-batch9-92b5-ops/mutate-ops.mjs > mutation-raw.txt
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OPS = 'kasia-console/src/lib/proto-settlement-ops.mjs';
const run = () => { const r = spawnSync(process.execPath, ['src/lib/proto-settlement-ops.test.mjs'], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 400000, maxBuffer: 1 << 26 }); return { status: r.status, last: ((r.stdout || '') + (r.stderr || '')).match(/\d+ passed, \d+ failed/)?.[0] || '?' }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [
  ['O1', sub("out.expectedSpks = { leaf: leaf.scriptPubKeyHex, held: held.scriptPubKeyHex };", "out.expectedSpks = { leaf: held.scriptPubKeyHex, held: leaf.scriptPubKeyHex };"), 'seal 的预期 spk 角色互换(C1 应报 spk 漂移)'],
  ['O2', sub("expectedPoolValue: s.pool_value }, { db });", "expectedPoolValue: s.pool_value + 1 }, { db });"), 'close_commit 的 expectedPoolValue 与 DB 派生不符'],
  ['O3', sub("feeUtxo, pmtEvidence: ctx.pmtEvidence, chainParents: parents,", "feeUtxo, pmtEvidence: undefined, chainParents: parents,"), 'close_commit 不传 pmtEvidence(builder 回退 300 s 墙钟守卫; deadline 刚过 200 s ⇒ 拒)'],
  ['O4', sub("const feeMin = (step) => loadFeeProfileCap(FEE_PROFILE_KIND[step]);", "const feeMin = (step) => loadFeeProfileCap(FEE_PROFILE_KIND[step]) + 200_000_000n;"), 'fee 最低面值超过签名输入上限(无候选)'],
  ['O5', sub("out.targetAddress = spkAddress(kaspa, network, computeRootClaimGenesisArtifact({ marketId, state: { ...closed, claimed_bitmap: 0 } }).scriptPubKeyHex);", "out.targetAddress = spkAddress(kaspa, network, rootCloseArtifact(m, marketId, closed).scriptPubKeyHex);"), 'convert_to_claim 的 landed 目标地址写成 RootClose'],
  ['O6', sub("payout: closed.pool_value, feeUtxo, chainParents: parents,", "payout: closed.pool_value - 1, feeUtxo, chainParents: parents,"), 'claim_draw payout != pool_value'],
  ['O7', sub("out.targetAddress = spkAddress(kaspa, network, rootCloseArtifact(m, marketId, OPEN_ROOTCLOSE(s)).scriptPubKeyHex);   // seal 输出0", "out.targetAddress = spkAddress(kaspa, network, rootCloseArtifact(m, marketId, { ...s, closed: 1, winningSide: 0, payoutRoot: '00'.repeat(32) }).scriptPubKeyHex);   // seal 输出0"), 'seal 的 landed 目标地址按 closed:1 算'],
  ['O8', sub("currentState: s, feeUtxo, convertToRootcloseEntryAbi, chainParents: parents,", "currentState: s, feeUtxo, convertToRootcloseEntryAbi, chainParents,"), 'seal 的 chainParents 不含 fee 项(不是 withFeeParent 结果)'],
  ['O9', sub("winnerPkHex: lc(winner.bettor_pk), amount: closed.pool_value }).scriptPubKeyHex);   // claim_draw", "winnerPkHex: '00'.repeat(32), amount: closed.pool_value }).scriptPubKeyHex);   // claim_draw"), 'claim_draw 的 landed 目标地址用错赢家公钥'],
  ['O10', sub("newWinningSide: m.winning_side, newPayoutRootHex", "newWinningSide: 1 - m.winning_side, newPayoutRootHex"), 'close_commit 拟签的 newWinningSide 与 DB 不符'],
];
console.log('BASELINE'); const b = run(); console.log(`  exit=${b.status} ${b.last}`); if (b.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); }
let surv = 0;
for (const [id, f, why] of M) {
  const abs = path.join(ROOT, OPS); const orig = fs.readFileSync(abs, 'utf8'); let m;
  try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) :: ${why}`); surv++; continue; }
  try { fs.writeFileSync(abs, m); const r = run(); if (r.status === 0) surv++; console.log(`${id}: ${r.status !== 0 ? 'KILLED' : 'SURVIVED'} exit=${r.status} :: ${why}`); }
  finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败'); }
}
const a = run(); console.log(`RESTORED exit=${a.status} ${a.last}`); console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${a.status === 0}`); process.exitCode = surv || a.status !== 0 ? 1 : 0;
