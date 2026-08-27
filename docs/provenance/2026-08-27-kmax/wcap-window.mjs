// (21) v0.9 · w_cap_window 层1 重建器(durable) —— (23) v0.15 2f632c91 §3.5(b) 支配定理 L1–L5 + 精确证书 + 验收 (A)–(E)。只读、纯函数; 镜像 7b1e18cc:
//   window(B) = window(SP) ∪ sampled({SP} ∪ mergeset(B))      consensus/src/processes/window.rs:138-235 build_block_window / :265-282 try_init_from_cache(继承样本【不再重过阈值】)
//   采样: once(SP) 再按蓝功降序遍历 mergeset(去 SP); blue_score < lowest_daa_blue_score(B) ⇒ NonDaa 不计 index; 否则 index++, (daa(SP)+index) % sample_rate == 0 ⇒ 样本   window.rs:299-322
//   lowest_daa_blue_score(B) = max(bs(B), full) − full【蓝分域, 原生】, full = window_size × sample_rate = 26,440    difficulty.rs:185-197
//   堆: BoundedSizeBlockHeap 按蓝功留最高 window_size 个(满时 pop 蓝功最低)   window.rs:458-468
//   blue_work(B) = blue_work(SP) + Σ work(蓝 mergeset); SP = 父中蓝功最大 ⇒ blue_work 沿祖先单调不减   ghostdag/protocol.rs:99-102, :155-163
//   bits(B): 样本 < min_window ⇒ bits(SP); 否则去 min_ts 样本, avg_target, measured=max(max_ts−min_ts,1), expected=target_time×rate×len, new_target=avg×measured/expected, min(max_target)   difficulty.rs:216-246
// v2 覆盖集【无域搬运】: W_C = window(SP)【精确重建】∪ N_C, N_C ⊆ {SP} ∪ mergeset(C) 且 bs ≥ lowest_daa_blue_score(C) ≥ bs(SP)+1−full【采样器原生阈值】, |N_C| ≤ evict_max
//   ⇒ T_lb(SP) = min target over window(SP) ∪ Ncand(SP), Ncand(SP) = {已收 b: bs(b) ≥ bs(SP)+1−full} ∪ {SP};  m_lb(SP) = max(1, span_ts(window(SP) 去蓝功最低 evict_max 个))
//   结构性闸: window(SP) 须【精确】(exact 证书)否则 WINDOW_INEXACT ⇒ 不出 cap(fail-closed); exact 证书 = 全史链接到真 genesis, 或 [堆满 ∧ min_blue_work(堆) > blue_work(截断根 R) ∧ R 之后所有 mergeset 成员已收] (pre-R 样本 ∈ past(R) ⇒ 蓝功 ≤ blue_work(R) < 堆内最小 ⇒ 真堆里也已被淘汰)
import { targetFromBits, compactTargetBits, workPerBlock } from './kmax-cost.mjs';

export const TN12 = { windowSize: 661, sampleRate: 40, minWindow: 150, mergesetLimit: 248, targetTimeMs: 100, mergeDepth: 36000, maxTarget: (1n << 255n) - 1n, genesisBits: 504155340 };
export const paramsFrom = (p = {}) => { const q = { ...TN12, ...p }; q.full = q.windowSize * q.sampleRate; q.evictMax = Math.floor(q.mergesetLimit / q.sampleRate) + 1; q.expectedFull = BigInt(q.targetTimeMs * q.sampleRate * (q.windowSize - 1)); return q; };
const bw = (b) => typeof b.blueWork === 'bigint' ? b.blueWork : BigInt(String(b.blueWork).startsWith('0x') ? b.blueWork : '0x' + b.blueWork);
export const calcWork = (bits) => workPerBlock(targetFromBits(bits));

export function fromRpcBlock(b) {   // wRPC(kaspa-wasm) camelCase → 扁平; header.parents 取 level 0; blueWork hex → BigInt
  const h = b.header, v = b.verboseData || {};
  const parents = (h.parents?.[0]?.parentHashes) || (h.parentsByLevel?.[0]) || [];
  return { hash: h.hash, daaScore: Number(h.daaScore), blueScore: Number(v.blueScore ?? h.blueScore), blueWork: bw({ blueWork: h.blueWork }), timestamp: Number(h.timestamp), bits: Number(h.bits), parents, selectedParentHash: v.selectedParentHash ?? null, mergeSetBluesHashes: v.mergeSetBluesHashes || [], mergeSetRedsHashes: v.mergeSetRedsHashes || [] };
}

// 序 = SortableBlock Ord (ghostdag/ordering.rs:38-42): blue_work 然后 hash; 数组升序, items[0] = 最小
const cmpSortable = (a, b) => { const x = bw(a), y = bw(b); if (x !== y) return x < y ? -1 : 1; return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0; };
class Heap { constructor(bound, items = []) { this.bound = bound; this.items = items.slice(); } size() { return this.items.length; } full() { return this.items.length === this.bound; } minBw() { return this.items.length ? bw(this.items[0]) : null; }
  tryPush(b) { if (this.items.length < this.bound) { this._ins(b); return true; } if (cmpSortable(b, this.items[0]) <= 0) return false; this.items.shift(); this._ins(b); return true; }   // window.rs:458-468: 满且新块 > 最小才 pop 最小
  _ins(b) { let i = 0; while (i < this.items.length && cmpSortable(this.items[i], b) < 0) i++; this.items.splice(i, 0, b); }
  clone() { return new Heap(this.bound, this.items); } }

export const makeHeap = (bound) => new Heap(bound);
export function topoOrder(blocks) {
  const byHash = new Map(blocks.map(b => [b.hash, b])); const indeg = new Map(), kids = new Map();
  for (const b of blocks) { indeg.set(b.hash, 0); kids.set(b.hash, []); }
  for (const b of blocks) for (const p of (b.parents || [])) if (byHash.has(p)) { indeg.set(b.hash, indeg.get(b.hash) + 1); kids.get(p).push(b.hash); }
  const q = blocks.filter(b => indeg.get(b.hash) === 0).map(b => b.hash), out = [];
  while (q.length) { const h = q.shift(); out.push(byHash.get(h)); for (const k of kids.get(h)) { indeg.set(k, indeg.get(k) - 1); if (indeg.get(k) === 0) q.push(k); } }
  if (out.length !== blocks.length) throw new Error('topoOrder: cycle or dangling');
  return out;
}
export const isTrueGenesis = (b) => (!b.parents || b.parents.length === 0) && b.daaScore === 0 && b.blueScore === 0;   // genesis.rs:187 daa_score 0

// 对给定 (window(SP) 堆, SP, mergeset 成员, bs(C)) 生成 window(C)  —— window.rs:299-322 原生采样
export function childWindow(spHeap, sp, mergesetOthers, bsC, P) {
  const heap = spHeap.clone(); const threshold = Math.max(bsC, P.full) - P.full; let index = 0; let admitted = 0, nonDaa = 0;
  const ordered = [sp, ...mergesetOthers.slice().sort((x, y) => (bw(y) > bw(x) ? 1 : bw(y) < bw(x) ? -1 : 0))];
  for (const x of ordered) { if (x.blueScore < threshold) { nonDaa++; continue; } index++; if ((sp.daaScore + index) % P.sampleRate === 0) { heap.tryPush(x); admitted++; } }
  return { heap, admitted, nonDaa, threshold };
}
export function calculateDifficultyBits(win, sp, P) {   // difficulty.rs:216-246
  if (win.size() < P.minWindow) return sp == null || sp.isGenesis ? P.genesisBits : sp.bits;
  const items = win.items; let minI = 0, maxTs = -Infinity;
  items.forEach((b, i) => { if (b.timestamp < items[minI].timestamp) minI = i; if (b.timestamp > maxTs) maxTs = b.timestamp; });
  const minTs = items[minI].timestamp; const rest = items.filter((_, i) => i !== minI);
  const avg = rest.reduce((a, b) => a + targetFromBits(b.bits), 0n) / BigInt(rest.length);
  const measured = BigInt(Math.max(maxTs - minTs, 1)); const expected = BigInt(P.targetTimeMs * P.sampleRate * rest.length);
  let t = avg * measured / expected; if (t > P.maxTarget) t = P.maxTarget; return compactTargetBits(t);
}

// 重建全部窗 + exact 证书
export function rebuildWindows(blocks, P, opts = {}) {   // opts.assignBits: 合成向量生成用(生产禁用); opts.anchor = {hash, blueWork}: 取数锚 R(getBlocks lowHash) —— 调用方声明"antipast(R)∩past(sink) 已全取"时, 每条截断链的未取样本 ⊆ past(R) ⇒ rootBw 可取 min(own, bw(R))(更紧仍安全); 无 anchor ⇒ 每条截断链用自己根的蓝功(恒安全)
  const anchorBw = opts.anchor ? bw(opts.anchor) : null;
  const byHash = new Map(blocks.map(b => [b.hash, b])); const windows = new Map();
  for (const b of topoOrder(blocks)) {
    if (isTrueGenesis(b)) { b.isGenesis = true; windows.set(b.hash, { win: new Heap(P.windowSize), exact: true, root: null, missing: 0, bitsCalc: null }); continue; }
    const sp = byHash.get(b.selectedParentHash);
    if (!sp) { const own = bw(b); windows.set(b.hash, { win: new Heap(P.windowSize), exact: false, root: b.hash, rootBw: anchorBw != null && anchorBw < own ? anchorBw : own, missing: 0, bitsCalc: null, truncatedRoot: true }); continue; }   // 截断根: 窗未知
    const spw = windows.get(sp.hash);
    if (sp.isGenesis) { if (opts.assignBits && !b.bits) b.bits = P.genesisBits; windows.set(b.hash, { win: new Heap(P.windowSize), exact: true, root: null, missing: 0, bitsCalc: P.genesisBits }); continue; }
    const memberHashes = [...(b.mergeSetBluesHashes || []), ...(b.mergeSetRedsHashes || [])].filter(h => h !== sp.hash);
    const others = memberHashes.map(h => byHash.get(h)).filter(Boolean); const missing = spw.missing + (memberHashes.length - others.length);
    const { heap } = childWindow(spw.win, sp, others, b.blueScore, P);
    const bitsCalc = calculateDifficultyBits(heap, sp, P); if (opts.assignBits && !b.bits) b.bits = bitsCalc;
    // exact 证书: 继承; 或 截断根之后 [堆满 ∧ 堆内最小蓝功 > blue_work(根) ∧ 根后 mergeset 成员零缺失]
    let exact = spw.exact && missing === 0; const root = spw.root, rootBw = spw.rootBw;
    if (!exact && root != null && missing === 0 && heap.full() && heap.minBw() > rootBw) exact = true;
    windows.set(b.hash, { win: heap, exact, root, rootBw, missing, bitsCalc });
  }
  return { windows, byHash };
}

export function wChildUb(sp, windows, blocks, P, excludeHash = null) {   // (23) v0.14 拟 (i)-(v), 覆盖集 = window(SP) ∪ Ncand(SP)
  const wi = windows.get(sp.hash); const w = wi.win;
  const w2 = sp.isGenesis ? calcWork(P.genesisBits) : calcWork(sp.bits);
  const targetReachable = w.size() + P.evictMax >= P.minWindow;
  if (!wi.exact) return { sp: sp.hash, w_child_ub: null, reason: 'WINDOW_INEXACT', window_exact: false };
  if (!targetReachable) return { sp: sp.hash, K_size: null, target_branch_reachable: false, w_fixed_branch: w2.toString(), w_child_ub: w2.toString(), window_exact: true };
  // K_SP = 去按 SortableBlock 序最小的 evict_max 个; 边界并列蓝功者全去(只会更保守) —— 引理 L1
  let cut = Math.min(P.evictMax, w.items.length); if (cut > 0 && cut < w.items.length) { const edge = bw(w.items[cut - 1]); while (cut < w.items.length && bw(w.items[cut]) === edge) cut++; }
  const K = w.items.slice(cut);
  const mLb = K.length ? Math.max(1, Math.max(...K.map(b => b.timestamp)) - Math.min(...K.map(b => b.timestamp))) : 1;
  const ncand = blocks.filter(b => !b.isGenesis && b.hash !== excludeHash && (b.hash === sp.hash || b.blueScore >= sp.blueScore + 1 - P.full));
  const cover = [...w.items, ...ncand];
  const tLb = cover.reduce((m, b) => { const t = targetFromBits(b.bits); return m == null || t < m ? t : m; }, null);
  let tgt = tLb * BigInt(mLb) / P.expectedFull; if (tgt > P.maxTarget) tgt = P.maxTarget; if (tgt < 1n) tgt = 1n;
  const w1 = calcWork(compactTargetBits(tgt));
  return { sp: sp.hash, K_size: K.length, m_lb_ms: mLb, T_lb: tLb.toString(), ncand_size: ncand.length, target_branch_reachable: true, w_target_branch: w1.toString(), w_fixed_branch: w2.toString(), w_child_ub: (w1 > w2 ? w1 : w2).toString(), window_exact: true };
}

export const N_SMALL = 12;   // (D) 有界穷举对抗模型池上限(写死): ≤ 4096 子集 × bs 范围; 引理链机器检验, 非生产验收
// 候选窗生成器((D): 对生成的候选 C 直接用 calculate_difficulty_bits 对照上界, 零 skip)
// 候选 = 任意 mergeset 子集 M ⊆ (已收 ∖ past(SP) ∖ {SP}) 且 |M| ≤ limit−1, bs(C) ∈ [bs(SP)+1, bs(SP)+1+|M|]  —— 合法候选的【超集】(不做 GHOSTDAG 着色/闭包, 超集通过 ⇒ 合法全通过)
export function enumerateBounded(sp, blocks, windows, P, { maxSubset = N_SMALL } = {}) {   // (D) 有界穷举对抗模型 —— 引理链的机器检验, 非生产验收; 池 > N_SMALL ⇒ throw(不静默截断)
  const byHash = new Map(blocks.map(b => [b.hash, b])); const past = new Set(); const stack = [sp.hash];
  while (stack.length) { const h = stack.pop(); if (past.has(h)) continue; past.add(h); const b = byHash.get(h); for (const p of (b?.parents || [])) stack.push(p); }
  // 候选父块须 ∉ past(SP) 且 blue_work ≤ blue_work(SP)(否则它才是 selected parent, protocol.rs:99-102); 其闭包成员同在 pool 内 ⇒ 子集枚举覆盖全部合法 mergeset
  const pool = blocks.filter(b => !past.has(b.hash) && !b.isGenesis && bw(b) <= bw(sp));
  if (pool.length > maxSubset) throw new Error('enumerateBounded: pool ' + pool.length + ' > N_SMALL ' + maxSubset + ' ((D) 只对合成小 DAG 穷举; 生产验收 = (A)(B)(C), 支配定理免枚举)');
  const out = []; const nSub = 1 << pool.length; const limit = P.mergesetLimit - 1;
  for (let mask = 0; mask < nSub; mask++) { const M = pool.filter((_, i) => mask & (1 << i)); if (M.length > limit) continue;
    for (let bsC = sp.blueScore + 1; bsC <= sp.blueScore + 1 + M.length; bsC++) { const { heap, admitted, nonDaa } = childWindow(windows.get(sp.hash).win, sp, M, bsC, P); const bits = calculateDifficultyBits(heap, sp, P); out.push({ sp: sp.hash, mergeset: M.map(b => b.hash), bsC, admitted, nonDaa, bits, work: calcWork(bits) }); } }
  return out;
}

// (E) 启发式极端候选 smoke(非验收, 证不了极值): 从 Ncand(SP)∖past(SP) 按 target 最小取 ≤ evict_max 个, bs(C) 取使全部过阈值的最小值
export function greedyExtremeSmoke(sp, blocks, windows, P) {
  const byHash = new Map(blocks.map(b => [b.hash, b])); const past = new Set(); const stack = [sp.hash];
  while (stack.length) { const h = stack.pop(); if (past.has(h)) continue; past.add(h); for (const p of (byHash.get(h)?.parents || [])) stack.push(p); }
  const pool = blocks.filter(b => !past.has(b.hash) && !b.isGenesis && bw(b) <= bw(sp) && b.blueScore >= sp.blueScore + 1 - P.full).sort((a, b) => (targetFromBits(a.bits) < targetFromBits(b.bits) ? -1 : 1)).slice(0, P.mergesetLimit - 1);
  const bsC = sp.blueScore + 1 + pool.length;
  const { heap, admitted } = childWindow(windows.get(sp.hash).win, sp, pool, bsC, P); const bits = calculateDifficultyBits(heap, sp, P);
  return { sp: sp.hash, picked: pool.length, admitted, bsC, bits, work: calcWork(bits) };
}
export function wCapWindow(blocks, params = {}, { verifyCandidates = false, maxSubset = N_SMALL, smoke = false, anchor = null } = {}) {
  if (maxSubset > N_SMALL) throw new Error("wCapWindow: maxSubset > N_SMALL (" + N_SMALL + ") 不允许——(D) 是有界对抗模型不是生产验收");
  const P = paramsFrom(params); const { windows, byHash } = rebuildWindows(blocks, P, { anchor });
  const bsTop = Math.max(...blocks.map(b => b.blueScore));
  const S = blocks.filter(b => !b.isGenesis && b.blueScore >= bsTop - P.mergeDepth);
  const perSp = S.map(sp => wChildUb(sp, windows, blocks, P));
  const inexact = perSp.filter(r => r.reason === 'WINDOW_INEXACT').map(r => r.sp);
  const assertionFailures = [];
  for (const b of blocks) { if (b.isGenesis) continue; const sp = byHash.get(b.selectedParentHash); if (!sp || !S.includes(sp)) continue; const r = wChildUb(sp, windows, blocks, P, b.hash); if (r.w_child_ub == null) continue; if (calcWork(b.bits) > BigInt(r.w_child_ub)) assertionFailures.push({ hash: b.hash, work: calcWork(b.bits).toString(), w_child_ub: r.w_child_ub, sp: sp.hash }); }
  const bitsMismatch = blocks.filter(b => !b.isGenesis && windows.get(b.hash).bitsCalc != null && windows.get(b.hash).exact && windows.get(b.hash).bitsCalc !== b.bits).map(b => ({ hash: b.hash, bits: b.bits, bitsCalc: windows.get(b.hash).bitsCalc }));
  let candidateCheck = null;
  if (verifyCandidates) { candidateCheck = { candidates: 0, failures: [], maxAdmitted: 0, nonDaaSeen: 0 }; for (const sp of S) { const r = perSp.find(x => x.sp === sp.hash); if (r.w_child_ub == null) continue; for (const c of enumerateBounded(sp, blocks, windows, P, { maxSubset })) { candidateCheck.candidates++; candidateCheck.maxAdmitted = Math.max(candidateCheck.maxAdmitted, c.admitted); candidateCheck.nonDaaSeen += c.nonDaa; if (c.work > BigInt(r.w_child_ub)) candidateCheck.failures.push({ sp: sp.hash, mergeset: c.mergeset, bsC: c.bsC, work: c.work.toString(), w_child_ub: r.w_child_ub }); } } }
  let smokeCheck = null;
  if (smoke) { smokeCheck = { tried: 0, failures: [] }; for (const sp of S) { const r = perSp.find(x => x.sp === sp.hash); if (r.w_child_ub == null) continue; const g = greedyExtremeSmoke(sp, blocks, windows, P); smokeCheck.tried++; if (g.work > BigInt(r.w_child_ub)) smokeCheck.failures.push({ sp: sp.hash, work: g.work.toString(), w_child_ub: r.w_child_ub }); } }
  // 证书汇总((24) 接口 ⑤): kind GENESIS(全部 S 窗自真 genesis 精确) / TRUNCATION(全部精确, 至少一条经证书乙) / INEXACT
  const sWins = S.map(sp => windows.get(sp.hash)); const allExact = sWins.every(w => w.exact); const anyTrunc = sWins.some(w => w.root != null);
  const heapMinMin = sWins.reduce((m, w) => { const x = w.win.minBw(); return x == null ? m : (m == null || x < m ? x : m); }, null);
  const certificate = { kind: !allExact ? 'INEXACT' : anyTrunc ? 'TRUNCATION' : 'GENESIS', R: anchor ? anchor.hash : (anyTrunc ? [...new Set(sWins.map(w => w.root).filter(Boolean))].join(',') : null), R_blue_work: anchor ? bw(anchor).toString() : null, heapMin_min: heapMinMin == null ? null : heapMinMin.toString(), missing: sWins.reduce((a, w) => a + w.missing, 0), inexact_count: inexact.length };
  const valid = perSp.filter(r => r.w_child_ub != null);
  const wcap = valid.reduce((m, r) => (m == null || BigInt(r.w_child_ub) > m ? BigInt(r.w_child_ub) : m), null);
  const reasons = [inexact.length > 0 && 'WINDOW_INEXACT', assertionFailures.length > 0 && 'ASSERTION_FAIL', candidateCheck && candidateCheck.failures.length > 0 && 'CANDIDATE_FAIL', smokeCheck && smokeCheck.failures.length > 0 && 'SMOKE_FAIL', wcap == null && 'NO_SP'].filter(Boolean);
  return { schema: 'wcap/0-scratch-v2', params: { windowSize: P.windowSize, sampleRate: P.sampleRate, minWindow: P.minWindow, mergesetLimit: P.mergesetLimit, evictMax: P.evictMax, mergeDepth: P.mergeDepth, expectedFull: P.expectedFull.toString() },
    bs_top: bsTop, S_size: S.length, inexact_sps: inexact, certificate, w_cap_window: reasons.length ? null : wcap.toString(), wCapWindow: reasons.length ? null : Number(wcap),   // wCapWindow(Number) 直接喂 (21) hVisUb({wCapWindow}); w_cap_window(字符串) 精确值 argmax_sp: reasons.length ? null : valid.find(r => BigInt(r.w_child_ub) === wcap)?.sp, reason: reasons.length ? reasons.join('+') : null,
    assertion_failures: assertionFailures, bits_mismatch_on_exact_windows: bitsMismatch, candidate_check: candidateCheck, smoke_check: smokeCheck, per_sp: perSp, windows };
}

export const enumerateCandidates = enumerateBounded;   // 旧名别名(scratch 期), 勿在新码使用
