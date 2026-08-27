// (21) v0.9 · wcap-window 离线确定性测试(无节点)。跑: node docs/provenance/2026-08-27-kmax/wcap-window.test.mjs [--write-expected]
// 向量 vectors-wcap.json(合成 DAG 生成参数), 期望 expected-output-wcap.json; 任一不等 ⇒ 退出码 1。生成器只在测试里(assignBits 按同一规则回填 bits)。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wCapWindow, rebuildWindows, paramsFrom, calcWork, childWindow, makeHeap, enumerateBounded, N_SMALL, consensusMergesetOrder } from './wcap-window.mjs';
import { targetFromBits, compactTargetBits } from './kmax-cost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors-wcap.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(HERE, 'expected-output-wcap.json'), 'utf8'));
const WRITE = process.argv.includes('--write-expected');
const SMALL = vectors.small;

// 合成 DAG 生成器: 链 + 侧块(sides: {hash, parent, at, red, ts, bwDelta}); redPairs: 每块并 2 个 red 侧块(daa +3/块, bs +1/块); squeezeFrom: 该块起戳同值; bitsOverride: {hash:{div}}; cut: {keepFrom, drop[]}
function genChain(g, P) {
  const sides = [...(g.sides || [])];
  if (g.redPairsFrom) for (let i = g.redPairsFrom; i <= g.redPairsTo; i++) { sides.push({ hash: 's' + i + 'a', parent: 'b' + (i - 2), at: i, red: true, ts: (i - 2) * 1000 + 300, bwDelta: 50 }); sides.push({ hash: 's' + i + 'b', parent: 'b' + (i - 2), at: i, red: true, ts: (i - 2) * 1000 + 600, bwDelta: 60 }); }
  const gBlock = { hash: 'g', parents: [], selectedParentHash: null, daaScore: 0, blueScore: 0, blueWork: 0n, timestamp: 0, bits: P.genesisBits, mergeSetBluesHashes: [], mergeSetRedsHashes: [] };
  const blocks = [gBlock]; const byHash = new Map([[gBlock.hash, gBlock]]); let prev = gBlock; const sideAt = new Map(); for (const s of sides) { if (!sideAt.has(s.at)) sideAt.set(s.at, []); sideAt.get(s.at).push(s); }
  const mkSide = (s) => { const p = byHash.get(s.parent); const b = { hash: s.hash, parents: [p.hash], selectedParentHash: p.hash, daaScore: p.daaScore + 1, blueScore: p.blueScore + 1, blueWork: p.blueWork + BigInt(s.bwDelta ?? 100), timestamp: s.ts ?? p.timestamp + 500, bits: 0, mergeSetBluesHashes: [p.hash], mergeSetRedsHashes: [] }; blocks.push(b); byHash.set(b.hash, b); return b; };
  for (let i = 1; i <= g.n; i++) {
    const merges = (sideAt.get(i) || []).map(s => byHash.get(s.hash) || mkSide(s));
    const isRed = (m) => !!sides.find(x => x.hash === m.hash)?.red; const blues = merges.filter(m => !isRed(m)), reds = merges.filter(isRed);
    const ts = g.squeezeFrom && i >= g.squeezeFrom ? (g.squeezeFrom - 1) * (g.dtMs || 1000) : i * (g.dtMs || 1000);
    const b = { hash: 'b' + i, parents: [prev.hash, ...merges.map(m => m.hash)], selectedParentHash: prev.hash, daaScore: prev.daaScore + 1 + merges.length, blueScore: prev.blueScore + 1 + blues.length, blueWork: prev.blueWork + 1000n, timestamp: ts, bits: 0, mergeSetBluesHashes: [prev.hash, ...blues.map(m => m.hash)], mergeSetRedsHashes: reds.map(m => m.hash) };
    blocks.push(b); byHash.set(b.hash, b); prev = b;
  }
  for (const s of sides) if (!byHash.has(s.hash)) mkSide(s);
  if (g.bitsOverride) { // 先按规则得基准 bits, 再按 div 改难度(target/div ⇒ work×div)
    const base = genChain({ ...g, bitsOverride: null }, P); for (const [h, o] of Object.entries(g.bitsOverride)) { const bb = base.find(x => x.hash === h); byHash.get(h).bits = compactTargetBits(targetFromBits(bb.bits) / BigInt(o.div)); }
  }
  rebuildWindows(blocks, P, { assignBits: true });
  if (g.cut) { const k = g.cut.keepFrom, inRange = (h) => h !== 'g' && Number(h.replace(/^[bs]/, '')) >= k, dropped = new Set(g.cut.drop || []); /* drop 只删块不删引用 ⇒ 引用悬空 = 成员缺失(模拟未收) */ return blocks.filter(b => inRange(b.hash) && !dropped.has(b.hash)).map(b => ({ ...b, parents: b.parents.filter(inRange), mergeSetBluesHashes: b.mergeSetBluesHashes.filter(inRange) })); }
  return blocks;
}
const summarize = (r) => ({ w_cap: r.w_cap_window, reason: r.reason, S: r.S_size, inexact: r.inexact_sps.length, af: r.assertion_failures.map(f => f.hash), mismatch: r.bits_mismatch_on_exact_windows.length, cand: r.candidate_check ? r.candidate_check.candidates : null, cand_fail: r.candidate_check ? r.candidate_check.failures.length : null, nonDaaSeen: r.candidate_check ? r.candidate_check.nonDaaSeen : null, maxAdmitted: r.candidate_check ? r.candidate_check.maxAdmitted : null, smoke_tried: r.smoke_check ? r.smoke_check.tried : null, smoke_fail: r.smoke_check ? r.smoke_check.failures.length : null, argmax: r.argmax_sp, m_lb_argmax: r.per_sp.find(x => x.sp === r.argmax_sp)?.m_lb_ms ?? null });

const results = {};
for (const v of vectors.cases) {
  const params = { ...SMALL, ...(v.params || {}) }; const P = paramsFrom(params);
  try {
    if (v.type === 'chain') {
      const blocks = genChain(v.gen, P); const anchor = v.anchor ? blocks.find(b => b.hash === v.anchor) : null; const r = wCapWindow(blocks, params, { ...(v.options || {}), anchor }); const got = summarize(r); got.cert = r.certificate; got.wCapWindow_num_matches = r.w_cap_window == null ? null : Number(r.w_cap_window) === r.wCapWindow;
      if (v.gen.squeezeFrom) { const a = wCapWindow(genChain({ ...v.gen, squeezeFrom: null }, P), params); got.w_cap_steady = a.w_cap_window; got.increased = BigInt(r.w_cap_window) > BigInt(a.w_cap_window); got.m_lb_steady = a.per_sp.find(x => x.sp === a.argmax_sp)?.m_lb_ms; }
      if (v.gen.redPairsFrom) { const top = blocks.find(b => b.hash === 'b' + v.gen.n); got.daa_top = top.daaScore; got.bs_top = top.blueScore; }
      if (v.probeWindow) got.probe_window_has = r.windows.get(v.probeWindow.block).win.items.some(x => x.hash === v.probeWindow.has);
      if (v.probeMissing) { got.probe_missing = r.windows.get(v.probeMissing).missing; got.top_exact = r.windows.get('b' + v.gen.n).exact; }
      if (v.compareFull) { const full = wCapWindow(genChain({ ...v.gen, cut: null }, P), params); got.w_cap_full = full.w_cap_window; got.equals_full = r.w_cap_window === full.w_cap_window; got.first_exact = [...r.windows.entries()].find(([, w]) => w.exact)?.[0] ?? null; got.top_exact = r.windows.get('b' + v.gen.n).exact; }
      if (v.expectGenesisWork) got.equals_genesis_work = r.w_cap_window === calcWork(params.genesisBits).toString();
      results[v.id] = got;
    } else if (v.type === 'admission') {
      const PT = paramsFrom({}); const others = Array.from({ length: 247 }, (_, i) => ({ hash: 'm' + i, daaScore: 32, blueScore: 100000, blueWork: 10n ** 20n - BigInt(i + 1), timestamp: i, bits: 504155340, parents: [] }));
      const admitted = v.daaSp.map(d => childWindow(makeHeap(661), { hash: 'sp', daaScore: d, blueScore: 100000, blueWork: 10n ** 20n, timestamp: 0, bits: 504155340, parents: [] }, others, 100001, PT).admitted);
      results[v.id] = { admitted, evictMax: PT.evictMax, ok: JSON.stringify(admitted) === JSON.stringify(v.expectAdmitted) && PT.evictMax === 7 };
    } else if (v.type === 'oracle-tiebreak') {   // v0.9.1 独立 oracle: 固定 hex 常量, 期望手算(不经生成器/镜像)
      const PT = paramsFrom(v.params); const mk = (hash, bwHex, bs) => ({ hash, daaScore: v.daaSp, blueScore: bs, blueWork: BigInt(bwHex), timestamp: 0, bits: v.bits, parents: [] });
      const sp = mk(v.sp.hash, v.sp.blueWork, v.sp.blueScore); const others = v.others.map(o => mk(o.hash, o.blueWork, o.blueScore));
      const pick = (list, cmpVariant) => { // cmpVariant: 'consensus' | 'no-tiebreak'(等 blue_work 回落输入顺序 = 旧 bug)
        const ordered = cmpVariant === 'consensus' ? consensusMergesetOrder(list) : list.slice().sort((x, y) => (y.blueWork > x.blueWork ? 1 : y.blueWork < x.blueWork ? -1 : 0));
        let index = 1; const sampled = []; for (const x of ordered) { index++; if ((sp.daaScore + index) % PT.sampleRate === 0) sampled.push(x.hash); } return sampled; };   // index 从 SP=1 起, 这里 SP 自身不采(由 daaSp 设计保证)
      const fwd = pick(others, 'consensus'), rev = pick(others.slice().reverse(), 'consensus');
      const bugFwd = pick(others, 'no-tiebreak'), bugRev = pick(others.slice().reverse(), 'no-tiebreak');
      const heapFwd = childWindow(makeHeap(PT.windowSize), sp, others, v.bsC, PT).heap.items.map(x => x.hash).sort(), heapRev = childWindow(makeHeap(PT.windowSize), sp, others.slice().reverse(), v.bsC, PT).heap.items.map(x => x.hash).sort();
      results[v.id] = { oracle_expected_sampled: v.expectedSampled, mirror_sampled_fwd: fwd, mirror_sampled_rev: rev, mirror_matches_oracle: JSON.stringify(fwd) === JSON.stringify(v.expectedSampled) && JSON.stringify(rev) === JSON.stringify(v.expectedSampled), heap_fwd_eq_rev: JSON.stringify(heapFwd) === JSON.stringify(heapRev), heap_members: heapFwd, no_tiebreak_fwd: bugFwd, no_tiebreak_rev: bugRev, no_tiebreak_order_dependent: JSON.stringify(bugFwd) !== JSON.stringify(bugRev), no_tiebreak_differs_from_oracle: JSON.stringify(bugFwd) !== JSON.stringify(v.expectedSampled) || JSON.stringify(bugRev) !== JSON.stringify(v.expectedSampled) };
    } else if (v.type === 'nsmall') {
      const blocks = genChain(v.gen, P); const { windows } = rebuildWindows(blocks, P); const sp = blocks.find(b => b.hash === 'b30');
      let t1 = null, t2 = null; try { enumerateBounded(sp, blocks, windows, P, { maxSubset: v.maxSubset }); } catch (e) { t1 = String(e.message).slice(0, 24); } try { wCapWindow(blocks, params, { verifyCandidates: true, maxSubset: N_SMALL + 1 }); } catch (e) { t2 = String(e.message).slice(0, 22); }
      results[v.id] = { N_SMALL, enumerate_throws: t1, wcap_throws: t2 };
    }
  } catch (e) { results[v.id] = { thrown: String(e.message).slice(0, 120) }; }
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) { const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]); const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`); }
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
