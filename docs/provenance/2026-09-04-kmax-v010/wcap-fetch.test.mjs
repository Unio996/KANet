// (24)/(21) v0.10 · wcap-fetch 离线 replay 测试(无节点)。跑: node .../wcap-fetch.test.mjs [--write-expected]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCover, arrivalCounter, runCycle } from './wcap-fetch.mjs';
import { hVisUbFromEvidence } from './kmax-cost.mjs';
import { genChain, makeReplayRpc } from './wcap-synth.testonly.mjs';
import { paramsFrom, setHashPolicy } from './wcap-window.mjs';
setHashPolicy({ allowSynthetic: true });   // 测试/合成向量: 短名 hash 放行(生产默认严格 64 位 hex)
import { hVisUb } from './kmax-cost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors-fetch.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(HERE, 'expected-output-fetch.json'), 'utf8'));
const WRITE = process.argv.includes('--write-expected');
const SMALL = vectors.small;

const FO = { sleepFn: async () => {} };   // 测试: 退避零等待
function makeRpc(blocks, rpcOpts) {   // hideBlocks: 模拟节点缺块(getBlocks 不返回、getBlock 抛)
  const hidden = new Set(rpcOpts.hideBlocks || []); const visible = blocks.filter(b => !hidden.has(b.hash));
  return makeReplayRpc(visible, rpcOpts);
}
const mkClock = () => { let t = 1_700_000_000_000; const c = () => (t += 1000); c.advance = (ms) => { t += ms; }; return c; };   // 每次 +1 s, 确定性; advance(ms) 模拟两次轮询之间的等待

const results = {};
for (const v of vectors.cases) {
  const P = paramsFrom(SMALL); const blocks = genChain(v.gen, P); const rpc = makeRpc(blocks, v.rpc || {}); const clock = mkClock();
  try {
    if (v.type === 'arrival') {   // 两次轮询之间合成器"出块": grown = genChain(v.grow) ⇒ rpc.advance; waitFn 推进时钟 v.waitMs
      const grown = genChain(v.grow, P); const hiddenAfter = new Set((v.rpc || {}).hideBlocksAfter || []); const grownVisible = grown.filter(b => !hiddenAfter.has(b.hash));
      let dropped = false; const waitFn = async () => { rpc.advance(grownVisible); clock.advance(v.waitMs || 0); if (v.dropSecondFetch) { const orig = rpc.getBlocks.bind(rpc); rpc.getBlocks = async (q) => { if (!dropped) { dropped = true; return { blockHashes: [], blocks: [] }; } return orig(q); }; } };
      if (v.cycle) { const r = await runCycle(rpc, { params: SMALL, clock, waitFn, depth0: vectors.depth0, daaFloor: 0, fetchOpts: FO }); const ev = { wCapWindow: r.wCapWindow, certificate: r.certificate, arrivalWindow: r.arrivalWindow, n_arrivals: r.n_arrivals, evidence: r.evidence }; const h = hVisUbFromEvidence(ev); results[v.id] = { n: r.n_arrivals, sum_work: r.sum_work, same_window_object: r.same_window_object, cert_kind: r.certificate.kind, sampled_at_in_window: r.certificate.sampled_at_ms >= r.arrivalWindow.t0Ms && r.certificate.sampled_at_ms <= r.arrivalWindow.t1Ms, W_s: (r.arrivalWindow.t1Ms - r.arrivalWindow.t0Ms) / 1000, wCapWindow: r.wCapWindow, hvis: { H_vis_ub: h.H_vis_ub, reason: h.reason, provisional: h.provisional, gates: h.evidence_gates, time_ok: h.gate?.time_ok ?? null, cert_ok: h.gate?.cert_ok ?? null }, G5: r.evidence?.G5_bits_selfcheck ? { pass: r.evidence.G5_bits_selfcheck.pass, exact: r.evidence.G5_bits_selfcheck.exact_windows, mismatch: r.evidence.G5_bits_selfcheck.mismatch, skipped_inexact: r.evidence.G5_bits_selfcheck.skipped_inexact } : null, G4_pass: r.evidence?.G4_same_arrival_window?.pass ?? null, vantage: r.evidence?.vantage ?? null, retries: r.evidence?.retries_total ?? null }; continue; }
      const a = await arrivalCounter(rpc, { lowHash: v.low, clock, waitFn, fetchOpts: FO });
      const ev = { wCapWindow: v.wCapForHvis ?? null, certificate: { kind: 'TRUNCATION', missing: 0, sampled_at_ms: a.t1Ms }, arrivalWindow: a.arrivalWindow, n_arrivals: a.n_arrivals };
      const h = v.wCapForHvis ? hVisUbFromEvidence(ev) : null;
      results[v.id] = { n: a.n_arrivals, sum_work: a.sum_work, reason: a.reason, reachable0: a.reachable0, reachable1: a.reachable1, complete: [a.complete0, a.complete1], n_by_stamp_diag: a.n_by_stamp_window_diag ?? null, old_stamp_arrivals: a.old_stamp_arrivals ?? null, new_head: a.new_hashes_head ?? null, W_s: (a.t1Ms - a.t0Ms) / 1000, hvis: h ? { H_vis_ub: h.H_vis_ub, reason: h.reason } : null };
      continue;
    }
    const r = await fetchCover(rpc, { params: SMALL, clock, depth0: vectors.depth0, syncGate: true, daaFloor: 0, fetchOpts: FO });
    const got = { wCapWindow: r.wCapWindow, w_cap_window: r.w_cap_window ?? null, cert_kind: r.certificate.kind, cert_missing: r.certificate.missing ?? null, reason: r.reason ?? null, anchor: r.anchor ?? null, attempts: r.attempts.map(a => ({ k: a.k, depth: a.depth, anchor: a.anchor, anchor_bs: a.anchor_bs, steps: a.backtrack_steps, genesis: a.reachedGenesis, pages: a.pages, blocks: a.blocks, complete: a.fetch_complete, closure_missing: a.closure_missing, kind: a.certificate.kind, bwR_lt_heapMin: a.online.bwR_lt_heapMin })), rpc_calls: r.rpc_calls };
    if (r.evidence && r.evidence.G1_pagination_complete_deterministic !== undefined) { const e = r.evidence; got.G1 = e.G1_pagination_complete_deterministic ? { pass: e.G1_pagination_complete_deterministic.pass, eq: e.G1_pagination_complete_deterministic.two_fetch_hashset_equal, n1: e.G1_pagination_complete_deterministic.n1, pages1: e.G1_pagination_complete_deterministic.pages1 } : null; got.G2 = { pass: e.G2_closure.pass, missing: e.G2_closure.n_blocks_with_missing, refs: e.G2_closure.unreturned_refs.slice(0, 3) }; got.G3 = e.G3_missing_or_truncated_is_inexact; got.G5 = e.G5_bits_selfcheck ? { pass: e.G5_bits_selfcheck.pass, exact: e.G5_bits_selfcheck.exact_windows, checked: e.G5_bits_selfcheck.checked, mismatch: e.G5_bits_selfcheck.mismatch, skipped_inexact: e.G5_bits_selfcheck.skipped_inexact, skipped_no_bits: e.G5_bits_selfcheck.skipped_no_bits } : null; got.G4_span_s = (e.G4_same_arrival_window.arrivalWindow.t1Ms - e.G4_same_arrival_window.arrivalWindow.t0Ms) / 1000; got.G4_pass = e.G4_same_arrival_window.pass; got.vantage = e.vantage; got.retries = e.retries_total; got.resumed = e.resumed_from.length; got.transient_fails = rpc.calls.transientFails || 0; got.page_notes = e.pages.filter(p => p.note).map(p => p.page + ':' + p.note); }
    if (v.hvis && r.wCapWindow != null) { const aw = r.arrivalWindow; const h = hVisUb({ n: v.hvis.n, wCapWindow: r.wCapWindow, t0Ms: aw.t0Ms, t1Ms: aw.t0Ms + v.hvis.spanS * 1000 }); got.hvis = { H_vis_ub: h.H_vis_ub, reason: h.reason, same_object_t0: h.W_s === v.hvis.spanS }; }
    if (v.compareTo && results[v.compareTo]) { const o = results[v.compareTo]; got.same_as_ref = o.wCapWindow === got.wCapWindow && o.cert_kind === got.cert_kind && o.anchor === got.anchor; got.pages_first_attempt = got.attempts[0]?.pages; }
    results[v.id] = got;
  } catch (e) { results[v.id] = { thrown: String(e.message).slice(0, 140) }; }
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) { const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]); const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc.slice(0, 90)}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`); }
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
