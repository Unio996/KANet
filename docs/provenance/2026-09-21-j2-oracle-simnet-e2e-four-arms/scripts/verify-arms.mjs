// verify-arms.mjs — simnet e2e 方案 §5 验收判据的【只读检查器】(本地演练 DB 与真 simnet DB 共用)。
// 用法(在 kasia-console 目录或任意目录; ⚠ 对真 simnet 库只在【拷贝】上跑, 不读写打开证据原件):
//   DB_PATH=<db 拷贝> node verify-arms.mjs --arms arms.json [--pmt-now <ms>] [--scenario <场景文件>] [--chain] [--json out.json]
// arms.json: { "H": "<market id>", "D": ..., "A": ..., "T": ..., "F": ..., "P": ..., "L": ..., "S": ... }(缺的臂跳过)
// --pmt-now: 观察时刻的 pmt(毫秒)。F / D / A / P / L 臂的"close_commit 意图=0"只有在 pmt 已越过 deadline+30s+余量之后才有信息量(否则空转)——不满足则该项标 VACUOUS 而非 PASS。
// --rpc <ws url> --network simnet: F 臂节点侧核对(只读 get*; 先断言 getServerInfo.networkId == --network, 不符即拒): resolve 意图涉及的 close txid 在节点上有无痕迹(mempool / 未花输出 / 已被别的已知意图字节花掉)。
// --chain: 还要求 H / T 臂的链上部分(resolve / convert_to_claim / claim_draw 意图 landed + proto_claims 行 + 市场 resolved)。
// --scenario: 用场景文件复算 uma 行的 evidence_ref 哈希(场景在跑的中途被热切换过则该项可能对不上, 属预期, 以日志为准)。
// 退出码: 有任一 FAIL ⇒ 1; VACUOUS 不算失败但会在汇总里单列(NWT 不得把 VACUOUS 当证据)。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; }; const flag = (k) => args.includes(k);
const KC = process.env.E2E_REPO_KC || 'D:/kanet-tn12/scratch/_j2_wt_pointers_shape/kasia-console';
if (!process.env.DB_PATH) { console.error('DB_PATH 未设(应指向库的【拷贝】)'); process.exit(2); }
const armsFile = opt('--arms'); if (!armsFile) { console.error('缺 --arms'); process.exit(2); }
const arms = JSON.parse(fs.readFileSync(armsFile, 'utf8'));
const pmtNow = opt('--pmt-now') !== undefined ? Number(opt('--pmt-now')) : null;
const scenario = opt('--scenario') ? JSON.parse(fs.readFileSync(opt('--scenario'), 'utf8')) : null;
const chain = flag('--chain');
const rpcUrl = opt('--rpc'); const rpcNetwork = opt('--network');
const { sqlite } = await import(pathToFileURL(path.join(KC, 'src/db/client.js')).href);

const rows = [];  // {arm, check, status: PASS|FAIL|VACUOUS, detail}
const rec = (arm, check, status, detail = '') => rows.push({ arm, check, status, detail });
const ck = (arm, check, cond, detail = '') => rec(arm, check, cond ? 'PASS' : 'FAIL', cond ? '' : detail);
const M = (id) => sqlite.prepare('SELECT * FROM proto_markets WHERE id = ?').get(id);
const Vs = (id) => sqlite.prepare('SELECT id, source_kind, outcome, pmt_at, evidence_ref FROM proto_market_verdicts WHERE market_id = ? ORDER BY id').all(id);
const intents = (id, step) => sqlite.prepare("SELECT status FROM proto_settlement_intents WHERE subject_type = 'market' AND subject_id = ? AND step = ?").all(id, step);
const SETTLE_MARGIN_MS = 30_000 + 5 * 20_000;   // close_commit 可提交(pmt > D+30s) + ≥5 个 driver tick(20s)才算"观察够了"
const noResolveIntent = (arm, m) => {
  const n = intents(m.id, 'resolve').length;
  if (pmtNow === null || !(pmtNow > m.deadline_ms + SETTLE_MARGIN_MS)) rec(arm, 'close_commit 意图=0', 'VACUOUS', `pmt-now ${pmtNow} 未越过 deadline+30s+5tick(${m.deadline_ms + SETTLE_MARGIN_MS}) ⇒ 此项无信息量(不得当证据)`);
  else ck(arm, `close_commit 意图=0(pmt-now 已越过 deadline+30s+5tick)`, n === 0, `resolve 意图 ${n} 条`);
};
// F 臂判据(2026-09-21 更正, Bettor 1616 采 NWT ③): 旧判据 "close_commit 意图=0" 在自然竞态下会字面 FAIL——driver 在冻结前 1s 内已自然建过一条 pending resolve 行(无字节、从未 prepared/submitted), 那不是缺陷。
//   新判据 = 缺陷的实质: 冻结市场上的 close 【没有被广播/落地】。判红看两条: ① 无 submitted/landed/ambiguous 的 resolve 意图(pending 不算; prepared 本身也不判红——F1 修复后 HOLD 态恰是 prepared);
//   ② 节点侧无该 close txid 的痕迹(mempool / 其输出仍未花 / 其输出已被别的已知意图字节花掉)。② 需要 --rpc; 有 prepared/submitted/landed 行却没给 --rpc ⇒ 该项 VACUOUS(不得当证据)。没有任何带 txid 的 resolve 行 ⇒ 无 txid 可查 ⇒ PASS(未曾备字节)。
const frozenNoClose = async (arm, m) => {
  const rows2 = sqlite.prepare("SELECT status, prepared_txid, submitted_txid, prepared_tx_json FROM proto_settlement_intents WHERE subject_type = 'market' AND subject_id = ? AND step = 'resolve'").all(m.id);
  const badStatus = rows2.filter((r) => ['submitted', 'landed', 'ambiguous'].includes(r.status));
  if (pmtNow === null || !(pmtNow > m.deadline_ms + SETTLE_MARGIN_MS)) { rec(arm, '冻结市场无 close 被广播/落地(意图侧)', 'VACUOUS', `pmt-now ${pmtNow} 未越过 deadline+30s+5tick ⇒ 无信息量(不得当证据)`); return; }
  ck(arm, '冻结市场无 close 被广播/落地(意图侧: 无 submitted/landed/ambiguous 的 resolve 意图; pending/prepared 不判红)', badStatus.length === 0, `resolve 意图状态=${JSON.stringify(rows2.map((r) => r.status))}`);
  const withTx = rows2.filter((r) => r.prepared_txid || r.submitted_txid);
  if (withTx.length === 0) { rec(arm, '冻结市场 close 节点侧无痕迹', 'PASS', '无带 txid 的 resolve 意图(未曾备字节), 无 txid 可查'); return; }
  if (!rpcUrl) { rec(arm, '冻结市场 close 节点侧无痕迹', 'VACUOUS', '有带 txid 的 resolve 行但未给 --rpc ⇒ 节点侧未核(不得当证据)'); return; }
  const kaspa = createRequire(path.join(KC, '..', 'kasia-relay') + path.sep)('kaspa-wasm'); const { RpcClient, Encoding, Address } = kaspa;
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: rpcNetwork || 'simnet' }); await rpc.connect({});
  try {
    const si = await rpc.getServerInfo(); if (!rpcNetwork || si.networkId !== rpcNetwork) { rec(arm, '冻结市场 close 节点侧无痕迹', 'FAIL', `networkId=${si.networkId} 与 --network=${rpcNetwork} 不符(或未给 --network), 拒绝查询`); return; }
    const allTx = sqlite.prepare('SELECT prepared_tx_json FROM proto_settlement_intents WHERE prepared_tx_json IS NOT NULL').all().flatMap((r) => { try { return JSON.parse(r.prepared_tx_json).map((j) => kaspa.Transaction.deserializeFromSafeJSON(j)); } catch { return []; } });
    for (const r of withTx) {
      const txid = String(r.submitted_txid || r.prepared_txid); const traces = [];
      if (await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false }).then(() => true).catch(() => false)) traces.push('mempool');
      let tx = null; try { tx = kaspa.Transaction.deserializeFromSafeJSON(JSON.parse(r.prepared_tx_json)[0]); } catch {}
      if (tx) for (let i = 0; i < tx.outputs.length; i++) { const o = tx.outputs[i]; const addr = kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, String(o.scriptPublicKey.script ?? o.scriptPublicKey).toLowerCase()), rpcNetwork).toString(); const es = (await rpc.getUtxosByAddresses([new Address(addr)])).entries || []; if (es.some((e) => String(e.outpoint.transactionId) === txid && Number(e.outpoint.index) === i)) traces.push(`unspent_out${i}`); }
      for (const t2 of allTx) if (t2.inputs.some((inp) => String(inp.previousOutpoint.transactionId) === txid)) { traces.push('spent_by_known_tx'); break; }
      ck(arm, `冻结市场 close ${txid.slice(0, 12)}… 节点侧无痕迹`, traces.length === 0, `节点侧痕迹=${JSON.stringify(traces)}(=该 close 已被广播并被节点接受)`);
    }
  } finally { await rpc.disconnect().catch(() => {}); }
};
const frozenWith = (arm, m, re) => { ck(arm, '已冻结', m.settlement_frozen_at != null, 'settlement_frozen_at 为空'); ck(arm, `frozen_reason ~ ${re}`, re.test(String(m.frozen_reason)), `frozen_reason=${m.frozen_reason}`); };
const sha = (s) => createHash('sha256').update(s).digest('hex');

for (const [arm, id] of Object.entries(arms)) {
  const m = M(id); if (!m) { rec(arm, '市场存在', 'FAIL', `找不到 ${id}`); continue; }
  const vs = Vs(id); const ext = vs.filter((v) => v.source_kind === 'extractor'), uma = vs.filter((v) => v.source_kind === 'uma');
  ck(arm, '是判定题市场(判定题列非空)', m.resolution_rule_spec != null && m.outcome_market_source === 'polymarket' && m.outcome_end_ms != null, '判定题列缺');
  if (arm === 'H' || arm === 'T') {
    ck(arm, 'winning_side ∈ {0,1}', m.winning_side === 0 || m.winning_side === 1, `winning_side=${m.winning_side}`);
    ck(arm, 'winning_side_source=extractor', m.winning_side_source === 'extractor', `source=${m.winning_side_source}`);
    ck(arm, 'winning_side_set_at 有值', !!m.winning_side_set_at);
    const ref = vs.find((v) => v.id === m.winning_side_verdict_id);
    ck(arm, 'verdict_id 指向本市场 extractor 行且 outcome=winning_side ∧ pmt_at≥oe', !!ref && ref.source_kind === 'extractor' && ref.outcome === m.winning_side && ref.pmt_at >= m.outcome_end_ms, `ref=${JSON.stringify(ref)}`);
    ck(arm, '恰 1 条 extractor + 1 条 uma 且都与 winning_side 一致 ∧ pmt_at≥oe', ext.length === 1 && uma.length === 1 && [...ext, ...uma].every((v) => v.outcome === m.winning_side && v.pmt_at >= m.outcome_end_ms), `verdicts=${JSON.stringify(vs.map((v) => [v.source_kind, v.outcome, v.pmt_at]))}`);
    ck(arm, '未冻结', m.settlement_frozen_at == null, `frozen=${m.frozen_reason}`);
    if (arm === 'T' && ext[0] && uma[0]) ck(arm, 'T: extractor 晚于 uma 写入(暂态期 uma 先成票, 热切 final 后 extractor 才写)', ext[0].pmt_at > uma[0].pmt_at, `ext=${ext[0].pmt_at} uma=${uma[0].pmt_at}`);
    if (chain) {
      const okI = (step) => intents(id, step).some((i) => i.status === 'landed');
      ck(arm, '[链] seal 意图 landed', okI('seal')); ck(arm, '[链] close_commit(step=resolve)意图 landed', okI('resolve')); ck(arm, '[链] 市场 resolved', m.status === 'resolved', `status=${m.status}`);
      const claim = sqlite.prepare('SELECT * FROM proto_claims WHERE market_id = ?').all(id); ck(arm, '[链] proto_claims 有 win 行且 claim_txid 非空', claim.some((c) => c.side === 'win' && c.claim_txid), `claims=${JSON.stringify(claim.map((c) => [c.side, !!c.claim_txid]))}`);
      const cl = claim.find((c) => c.side === 'win'); if (cl) { const ci = sqlite.prepare("SELECT status FROM proto_settlement_intents WHERE subject_type = 'claim' AND subject_id = ?").all(cl.id); ck(arm, '[链] convert_to_claim / claim_draw 意图 landed', ['convert_to_claim', 'claim_draw'].every((st) => sqlite.prepare("SELECT 1 FROM proto_settlement_intents WHERE subject_type = 'claim' AND subject_id = ? AND step = ? AND status = 'landed'").get(cl.id, st)), `intents=${JSON.stringify(ci)}`); }
    }
  } else if (arm === 'D' || arm === 'P') {
    frozenWith(arm, m, /^inconsistent_verdicts\|clock=(pmt|wall)$/); ck(arm, 'winning_side 为空', m.winning_side == null);
    ck(arm, 'extractor 与 uma 各一条且 outcome 相反', ext.length === 1 && uma.length === 1 && ext[0].outcome !== uma[0].outcome && [0, 1].includes(ext[0].outcome) && [0, 1].includes(uma[0].outcome), `verdicts=${JSON.stringify(vs.map((v) => [v.source_kind, v.outcome]))}`);
    if (arm === 'P') ck(arm, 'P: 两条异议行 pmt_at=NULL(pmt 失效期写入, B4)', vs.length === 2 && vs.every((v) => v.pmt_at == null), `pmt_at=${JSON.stringify(vs.map((v) => v.pmt_at))}`);
    noResolveIntent(arm, m);
  } else if (arm === 'A') {
    frozenWith(arm, m, /^abstain_or_dispute\|clock=(pmt|wall)$/); ck(arm, 'winning_side 为空', m.winning_side == null);
    ck(arm, 'extractor 行 outcome=NULL(实质 ABSTAIN)', ext.length === 1 && ext[0].outcome === null, `ext=${JSON.stringify(ext)}`);
    noResolveIntent(arm, m);
  } else if (arm === 'F') {
    ck(arm, 'winning_side 已写(promote 成功)', m.winning_side === 0 || m.winning_side === 1); frozenWith(arm, m, /^[a-z0-9_]+\|clock=(pmt|wall)$/);
    await frozenNoClose(arm, m);
  } else if (arm === 'L') {
    frozenWith(arm, m, /^late_seal\|clock=(pmt|wall)$/); ck(arm, 'winning_side 为空', m.winning_side == null); ck(arm, 'verdict 行 0(冻结后不再是候选)', vs.length === 0, `verdicts=${vs.length}`);
    noResolveIntent(arm, m);
  } else if (arm === 'S') {
    ck(arm, 'S: 从未被 adapter 处理(verdict 0 ∧ 未冻结 ∧ 未判)', vs.length === 0 && m.settlement_frozen_at == null && m.winning_side == null, `verdicts=${vs.length} frozen=${m.frozen_reason} ws=${m.winning_side}`);
    ck(arm, 'S: outcome_end 尚未到期(仍是未到期哨兵)', pmtNow === null || m.outcome_end_ms > pmtNow, `oe=${m.outcome_end_ms} pmt-now=${pmtNow}`);
  } else rec(arm, '未知臂', 'FAIL', arm);
  // uma 行 evidence_ref 哈希复算(若给了场景且该 condition 在场景里)
  if (scenario && uma[0]) { const g = (scenario.polymarket || {})[String(m.outcome_condition_id).toLowerCase()]; if (g) { const raw = JSON.stringify({ outcomePrices: JSON.stringify(g.prices || []), closed: true, closedTime: g.closedTime || '2020-01-01T00:00:00.000Z' }); const got = uma[0].evidence_ref.split('#sha256:')[1]; if (got === sha(raw)) rec(arm, 'uma evidence_ref 哈希 = sha256(场景原文)', 'PASS'); else rec(arm, 'uma evidence_ref 哈希 = sha256(场景原文)', 'FAIL', `行=${got} 场景复算=${sha(raw)}(场景中途被热切换过则以拦截日志为准)`); } }
}
// ── 全局不变量(不依赖 arms 映射, 扫全库) ──
const bad1 = sqlite.prepare(`SELECT v.market_id, v.id FROM proto_market_verdicts v JOIN proto_markets m ON m.id = v.market_id WHERE m.winning_side IS NOT NULL AND v.source_kind IN ('extractor','uma') AND v.outcome IS NOT NULL AND (v.pmt_at IS NULL OR v.pmt_at < m.outcome_end_ms) AND v.id = m.winning_side_verdict_id`).all();
ck('*', '被 winning_side 引用的 verdict 都有 pmt_at≥oe', bad1.length === 0, JSON.stringify(bad1));
const dup = sqlite.prepare('SELECT market_id, source_kind, evidence_ref, count(*) n FROM proto_market_verdicts GROUP BY 1,2,3 HAVING n > 1').all(); ck('*', '无重复 (market, source_kind, evidence_ref)', dup.length === 0, JSON.stringify(dup));
const badRef = sqlite.prepare("SELECT id FROM proto_market_verdicts WHERE evidence_ref IS NULL OR trim(evidence_ref) = '' OR evidence_ref NOT LIKE '%#sha256:%'").all(); ck('*', '所有 verdict 的 evidence_ref 非空且带 #sha256:', badRef.length === 0, JSON.stringify(badRef));
const badFr = sqlite.prepare("SELECT id, frozen_reason FROM proto_markets WHERE settlement_frozen_at IS NOT NULL AND (frozen_reason IS NULL OR frozen_reason NOT GLOB '*|clock=*')").all(); ck('*', '所有冻结行 frozen_reason 带 |clock=', badFr.length === 0, JSON.stringify(badFr));
const fails = rows.filter((r) => r.status === 'FAIL'), vac = rows.filter((r) => r.status === 'VACUOUS');
for (const r of rows) console.log(`${r.status.padEnd(7)} [${r.arm}] ${r.check}${r.detail ? '  ← ' + r.detail : ''}`);
console.log(`\nVERIFY: checks=${rows.length} pass=${rows.filter((r) => r.status === 'PASS').length} fail=${fails.length} vacuous=${vac.length}`);
if (vac.length) console.log('VACUOUS(不得当证据): ' + vac.map((r) => `[${r.arm}] ${r.check}`).join('; '));
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ rows, pmtNow, chain }, null, 1));
process.exit(fails.length ? 1 : 0);
