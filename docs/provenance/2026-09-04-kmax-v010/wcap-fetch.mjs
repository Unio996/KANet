// (24)/(21) v0.10 · w_cap_window 取数器(只读 RPC) —— NWT 取数设计 3f7ef2c5 + 不变量 448469b2 的实现; 输出四闸证据 fetch-evidence.json(Codex 283 实现四闸: 须真 RPC 路实测才闭)。
//   ① getBlocks(lowHash, includeBlocks=true, includeTransactions=false) 前向分页到 sink(service.rs:426-477: 含 low(:452 "+1"), ≤ mergeset_size_limit+1 = 249/页(:452-453), 游标 = 返回 blockHashes 末项, == sink ⇒ 停; 幂等续游标)
//   ② 起锚: getBlockDagInfo().sink → getBlock 沿 verboseData.selectedParentHash 回溯到 blueScore ≤ bs_top − depth(起 62,440), 记回溯步数
//   ③ 喂 rebuildWindows({anchor}) → certificate; 在线判定 blue_work(R) < min heapMin ∧ missing=0 不达标 ⇒ 锚几何加深(×2), 上限真 genesis / pruning point ⇒ 最终 INEXACT
//   ④ 四闸证据 G1 分页完整确定(同 sink 两次独立拉取 hash 集相等; blockCount 对账只作弱旁证) / G2 sink-anticone 闭包(mergeset 引用全在返回集, 缺列 hash) / G3 缺失·剪裁·IBD ⇒ INEXACT(负向: 丢一页重放必 INEXACT) / G4 t0/t1 = 接收时钟区间, 与 hVisUb 同一 sampled_at 结构体
//   🔴 绝不连 IBD 期活节点(daa=0/空返回会伪装成"完整"): 取前 SYNC-GATE isSynced ∧ daa > DAA_FLOOR; 真跑由 Bettor 派。
import { fromRpcBlock, wCapWindow, isTrueGenesis, calcWork } from './wcap-window.mjs';
export const DAA_FLOOR = 80095687;
export const DEPTH0 = 36000 + 26440;   // 起锚深度 = merge depth + 窗准入地板((24) ②: 仅起点, 证书才是判据)
export const PAGE_MAX = 249;

const bw = (x) => typeof x === 'bigint' ? x : BigInt(String(x).startsWith('0x') ? x : '0x' + x);
export const unwrap = (x) => x.block || x;

// ② 起锚: 从 sink 沿 selectedParentHash 回溯到 blueScore ≤ targetBs
export async function findAnchor(rpc, sinkHash, targetBs, { maxSteps = 200000 } = {}) {
  let h = sinkHash, steps = 0, b = fromRpcBlock(unwrap((await rpc.getBlock({ hash: h, includeTransactions: false }))));
  while (b.blueScore > targetBs && b.selectedParentHash && steps < maxSteps) { h = b.selectedParentHash; b = fromRpcBlock(unwrap((await rpc.getBlock({ hash: h, includeTransactions: false })))); steps++; }
  return { anchor: b, steps, reachedGenesis: isTrueGenesis(b) };
}

// ① 前向分页(幂等续游标); stopAt = 本次要停的 sink(G1 二次拉取用同一 sink)
// ④ 鲁棒性(NWT 预审): 每页 getBlocks 指数退避重试(maxRetries 次, backoff(k) ms); 重试耗尽 ⇒ 从同一游标"续"(maxResumes 次, 长退避) 不重头; 全部失败 ⇒ 该页记 FAILED、complete=false(G1 必失, fail-closed)。evidence 记 retries_total / resumed_from。
export const DEFAULT_BACKOFF = (k) => 250 * 2 ** k;   // 250, 500, 1000 ms
export async function fetchForward(rpc, lowHash, stopAt, { clock = () => Date.now(), maxPages = 100000, maxRetries = 3, maxResumes = 2, backoff = DEFAULT_BACKOFF, sleepFn = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  const pages = []; const byHash = new Map(); let low = lowHash, done = false, pageNo = 0; let retriesTotal = 0; const resumedFrom = []; let resumes = 0;
  const getPage = async (lowH) => { let lastErr = null; for (let k = 0; k <= maxRetries; k++) { try { return await rpc.getBlocks({ lowHash: lowH, includeBlocks: true, includeTransactions: false }); } catch (e) { lastErr = e; retriesTotal++; if (k < maxRetries) await sleepFn(backoff(k)); } } throw lastErr; };
  while (!done && pageNo < maxPages) {
    let r; try { r = await getPage(low); } catch (e) { if (resumes < maxResumes) { resumes++; resumedFrom.push({ page: pageNo + 1, low, err: String(e.message || e).slice(0, 60) }); await sleepFn(backoff(maxRetries + resumes)); continue; } pages.push({ page: pageNo + 1, low, high: null, count: 0, t_recv_ms: clock(), note: 'FAILED_AFTER_RETRIES: ' + String(e.message || e).slice(0, 60) }); break; }
    pageNo++;
    const blocks = (r.blocks || []).map(unwrap).map(fromRpcBlock); const hashes = r.blockHashes || blocks.map(b => b.hash);
    const t = clock(); pages.push({ page: pageNo, low, high: hashes[hashes.length - 1] ?? null, count: blocks.length, t_recv_ms: t });
    for (const b of blocks) byHash.set(b.hash, b);
    if (!hashes.length) { pages[pages.length - 1].note = 'EMPTY_PAGE'; break; }   // 空页 = 中断/故障 ⇒ 不算完整(G1 必失)
    if (blocks.length > PAGE_MAX + 0 && !r.__anticone) pages[pages.length - 1].note = 'PAGE_GT_249(含 sink anticone?)';
    const high = hashes[hashes.length - 1]; if (hashes.includes(stopAt) || high === stopAt) { done = true; break; }
    if (high === low) { pages[pages.length - 1].note = 'NO_PROGRESS'; break; }   // 游标不前进 ⇒ 停(不无限循环)
    low = high;
  }
  return { blocks: [...byHash.values()], pages, complete: done, retries_total: retriesTotal, resumed_from: resumedFrom };
}

// G2: 每块 mergeset/selectedParent/parents 引用是否全在返回集 ∪ 锚过去(锚过去允许缺: 证书乙靠 blue_work 处理)
export function closureCheck(blocks, anchorHash) {
  const have = new Set(blocks.map(b => b.hash)); const missing = new Map();
  for (const b of blocks) { if (b.hash === anchorHash) continue;   // 锚 R 自己的引用全在 past(R)(未取), 合法缺席
    for (const ref of [...(b.mergeSetBluesHashes || []), ...(b.mergeSetRedsHashes || []), ...(b.selectedParentHash ? [b.selectedParentHash] : [])]) if (!have.has(ref)) { if (!missing.has(b.hash)) missing.set(b.hash, []); missing.get(b.hash).push(ref); } }
  // 注: 非锚块引用 past(R) 里的块也会列入(如 anticone tip 的 SP 在 past(R)); 是否构成【S 内窗】的洞由重建器 certificate.missing 判 ⇒ G2 判据 = certificate(无 anchor).missing == 0, 本表只作诊断
  return { unreturned_refs: [...missing.entries()].map(([h, refs]) => ({ block: h, refs })), n_blocks_with_missing: missing.size };
}

// ③+④ 主流程: 返回 { wCapWindow, certificate, arrivalWindow{t0Ms,t1Ms}, evidence, attempts }
export async function fetchCover(rpc, { params = {}, clock = () => Date.now(), depth0 = DEPTH0, maxDeepen = 8, syncGate = true, daaFloor = DAA_FLOOR, verifyG1 = true, arrivalWindow: awIn = null, fetchOpts = {}, vantage = 'single-node-da9' } = {}) {   // fetchOpts: {maxRetries, maxResumes, backoff, sleepFn}; vantage: 观测点声明(Codex f7bc9057 对齐: 单节点 da9 非独立多点)   // awIn: runCycle 注入的接收窗对象(闸4 同一对象); 缺省自建   // daaFloor 只在 replay 测试里降为 0(合成 DAG daa 小); 生产恒 DAA_FLOOR
  if (syncGate) { const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore); if (!si.isSynced || !(daa > daaFloor)) return { wCapWindow: null, w_cap_window: null, certificate: { kind: 'INEXACT', reason: 'SYNC_GATE' }, reason: 'SYNC_GATE', evidence: { sync: { isSynced: si.isSynced, daa, daaFloor } }, attempts: [], rpc_calls: rpc.calls || null }; }
  const t0Ms = awIn ? awIn.t0Ms : clock(); const dag = await rpc.getBlockDagInfo(); const sink = dag.sink || dag.tipHashes?.[0];
  const sinkBlock = fromRpcBlock(unwrap((await rpc.getBlock({ hash: sink, includeTransactions: false })))); const bsTop = sinkBlock.blueScore;
  const attempts = []; let depth = depth0, result = null;
  for (let k = 0; k <= maxDeepen; k++) {
    const { anchor, steps, reachedGenesis } = await findAnchor(rpc, sink, bsTop - depth);
    const f1 = await fetchForward(rpc, anchor.hash, sink, { clock, ...fetchOpts });
    const closure = closureCheck(f1.blocks, anchor.hash);
    // NWT 审 a93f9c5e affirming note: anchor 的 rootBw=min(own,bw(R)) 只在 antipast(R)∩past(sink) 已证全取(G1 ∧ G2)后安全 ⇒ 先无 anchor(无条件安全)重建; G1(同 sink 二次拉取集相等 ∧ 两次完整) ∧ G2(闭包零缺) 过了才传 anchor
    const r0 = wCapWindow(f1.blocks, params, {});
    let g1 = null; if (verifyG1) { const f2 = await fetchForward(rpc, anchor.hash, sink, { clock, ...fetchOpts }); const s1 = new Set(f1.blocks.map(b => b.hash)), s2 = new Set(f2.blocks.map(b => b.hash)); const eq = s1.size === s2.size && [...s1].every(h => s2.has(h)); g1 = { two_fetch_hashset_equal: eq, n1: s1.size, n2: s2.size, pages1: f1.pages.length, pages2: f2.pages.length, blockCount_node: Number(dag.blockCount), cover_le_blockCount: s1.size <= Number(dag.blockCount), pass: eq && f1.complete && f2.complete }; }
    const anchorAllowed = !!(g1 && g1.pass && r0.certificate.missing === 0 && f1.complete);
    const r = anchorAllowed ? wCapWindow(f1.blocks, params, { anchor: { hash: anchor.hash, blueWork: anchor.blueWork } }) : r0;
    const cert = r.certificate; const heapMinMin = cert.heapMin_min == null ? null : BigInt(cert.heapMin_min);
    const online = { bw_R: anchor.blueWork.toString(), heapMin_min: cert.heapMin_min, bwR_lt_heapMin: heapMinMin != null && anchor.blueWork < heapMinMin, missing: cert.missing };
    attempts.push({ k, depth, anchor: anchor.hash, anchor_bs: anchor.blueScore, backtrack_steps: steps, reachedGenesis, pages: f1.pages.length, blocks: f1.blocks.length, fetch_complete: f1.complete, closure_missing: closure.n_blocks_with_missing, anchor_used: anchorAllowed, kind_no_anchor: r0.certificate.kind, certificate: cert, online });
    if (r.wCapWindow != null && cert.kind !== 'INEXACT' && f1.complete) { result = { r, f1, anchor, closure, g1 }; break; }
    if (reachedGenesis || !f1.complete) { result = { r, f1, anchor, closure, g1 }; break; }   // 到 genesis 仍 INEXACT / 拉取本身不完整 ⇒ 最终 fail-closed
    depth *= 2;   // 几何加深
  }
  const t1Ms = awIn ? awIn.t1Ms : clock(); const { r, f1, anchor, closure, g1 } = result;
  const arrivalWindow = awIn || { t0Ms, t1Ms };   // G4: 与 hVisUb({t0Ms, t1Ms}) 同一结构体(runCycle 注入时 = 接收计的同一对象)
  if (r.certificate) r.certificate.sampled_at_ms = t1Ms;   // 认证时刻 = t1 读 sink 的时刻((24) v0.2 闸4: sampled_at ∈ [t0,t1])
  // (B) 逐窗自洽计数(Codex 19284783 ⑤: 零静默 skip): exact 窗全部核 bitsCalc == 收块 bits; 非 exact 窗不核但【显式计数】为 skipped_inexact; 无 bitsCalc(genesis/截断根/genesis 子块)计 skipped_no_bits
  const bsc = { exact_windows: 0, checked: 0, mismatch: 0, skipped_inexact: 0, skipped_no_bits: 0 };
  for (const [h, w] of r.windows) { if (w.bitsCalc == null) { bsc.skipped_no_bits++; continue; } if (!w.exact) { bsc.skipped_inexact++; continue; } bsc.exact_windows++; bsc.checked++; const blk = f1.blocks.find(b => b.hash === h); if (blk && w.bitsCalc !== blk.bits) bsc.mismatch++; }
  bsc.pass = bsc.mismatch === 0 && bsc.checked === bsc.exact_windows; bsc.note = 'skipped_* 是显式计数非静默; exact 窗 100% 核对';
  const g4 = { arrivalWindow, sampled_at_ms: r.certificate?.sampled_at_ms ?? null, same_window_object: !!awIn, in_window: r.certificate?.sampled_at_ms != null && r.certificate.sampled_at_ms >= arrivalWindow.t0Ms && r.certificate.sampled_at_ms <= arrivalWindow.t1Ms, note: 'hVisUb 必须收同一对象; (21) 接收计 n 亦须以此窗计' }; g4.pass = g4.same_window_object && g4.in_window;   // ⑥ co-located 机械字段(runCycle 注入同一对象时才可 pass)
  const evidence = { vantage, retries_total: (f1.retries_total || 0) + (g1 ? 0 : 0), resumed_from: f1.resumed_from || [], G5_bits_selfcheck: bsc, G1_pagination_complete_deterministic: g1, G2_closure: { pass: r.certificate.missing === 0 && f1.complete, s_window_missing: r.certificate.missing, ...closure }, G3_missing_or_truncated_is_inexact: { certificate_kind: r.certificate.kind, wCapWindow_null_when_inexact: r.certificate.kind !== 'INEXACT' || r.wCapWindow == null, pass: r.certificate.kind !== 'INEXACT' || r.wCapWindow == null }, G4_same_arrival_window: g4, pages: f1.pages, sink, bs_top: bsTop };
  return { wCapWindow: r.wCapWindow, w_cap_window: r.w_cap_window, certificate: r.certificate, reason: r.reason, S_size: r.S_size, arrivalWindow, evidence, attempts, anchor: anchor.hash, rpc_calls: rpc.calls || null };
}

// —— 法 3′ 接收计((23) v0.10+ MUST-B): 两次本机时钟轮询 reachable 集, n = |reachable(t1) ∖ reachable(t0)|, Σwork 按接收不按戳 —— 只报数不判(闸在 hVisUb W_MIN/N_MIN) ——
//   实现 = 复用 fetchForward 从同一 low 锚拉到各自 sink(t0: sink0, t1: sink1); 两次都须 complete, 否则 n=null + ARRIVAL_INCOMPLETE ⇒ hVisUb NO_N
export async function arrivalCounter(rpc, { lowHash, clock = () => Date.now(), waitFn = async () => {}, fetchOpts = {} } = {}) {
  const t0Ms = clock(); const d0 = await rpc.getBlockDagInfo(); const sink0 = d0.sink || d0.tipHashes?.[0]; const f0 = await fetchForward(rpc, lowHash, sink0, { clock, ...fetchOpts });
  await waitFn();
  const t1Ms = clock(); const d1 = await rpc.getBlockDagInfo(); const sink1 = d1.sink || d1.tipHashes?.[0]; const f1 = await fetchForward(rpc, lowHash, sink1, { clock, ...fetchOpts });
  const arrivalWindow = { t0Ms, t1Ms };
  const base = { t0Ms, t1Ms, arrivalWindow, sink0, sink1, reachable0: f0.blocks.length, reachable1: f1.blocks.length, pages0: f0.pages.length, pages1: f1.pages.length, complete0: f0.complete, complete1: f1.complete, retries_total: (f0.retries_total || 0) + (f1.retries_total || 0), resumed_from: [...(f0.resumed_from || []), ...(f1.resumed_from || [])] };
  if (!f0.complete || !f1.complete) return { ...base, n_arrivals: null, sum_work: null, reason: 'ARRIVAL_INCOMPLETE' };
  const s0 = new Set(f0.blocks.map(b => b.hash)); const fresh = f1.blocks.filter(b => !s0.has(b.hash));
  const sumWork = fresh.reduce((a, b) => a + calcWork(b.bits), 0n);
  // 对照列(只作诊断): 若按【块戳】落在 [ts(sink0), ts(sink1)] 计数会漏掉旧戳陈父块 —— MUST-B 的可见证据
  const ts0 = Number(f0.blocks.find(b => b.hash === sink0)?.timestamp ?? 0), ts1 = Number(f1.blocks.find(b => b.hash === sink1)?.timestamp ?? 0);
  const byStamp = fresh.filter(b => b.timestamp > ts0 && b.timestamp <= ts1).length;
  return { ...base, n_arrivals: fresh.length, sum_work: sumWork.toString(), n_by_stamp_window_diag: byStamp, old_stamp_arrivals: fresh.filter(b => b.timestamp <= ts0).map(b => b.hash).slice(0, 10), reason: null, new_hashes_head: fresh.slice(0, 10).map(b => b.hash) };
}
// 一次完整周期: 接收计(t0→t1) + t1 时刻 w_cap 认证, 共享同一 arrivalWindow 对象 ⇒ fetch-evidence(含 n_arrivals) ⇒ hVisUbFromEvidence 直接可用
export async function runCycle(rpc, { params = {}, clock = () => Date.now(), waitFn = async () => {}, depth0 = DEPTH0, daaFloor = DAA_FLOOR, syncGate = true, fetchOpts = {}, vantage = 'single-node-da9' } = {}) {
  if (syncGate) { const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore); if (!si.isSynced || !(daa > daaFloor)) return { wCapWindow: null, n_arrivals: null, certificate: { kind: 'INEXACT', reason: 'SYNC_GATE' }, reason: 'SYNC_GATE' }; }
  const dag0 = await rpc.getBlockDagInfo(); const sink0 = dag0.sink || dag0.tipHashes?.[0]; const sinkBlock0 = fromRpcBlock(unwrap((await rpc.getBlock({ hash: sink0, includeTransactions: false }))));
  const { anchor } = await findAnchor(rpc, sink0, sinkBlock0.blueScore - depth0);   // 接收计的公共 low 锚(t0 视角), 两次轮询同一 low
  const arrivals = await arrivalCounter(rpc, { lowHash: anchor.hash, clock, waitFn, fetchOpts });
  const cover = await fetchCover(rpc, { params, clock, depth0, daaFloor, syncGate: false, arrivalWindow: arrivals.arrivalWindow, fetchOpts, vantage });   // t1 认证, 注入同一窗对象
  if (cover.evidence) cover.evidence.retries_total += arrivals.retries_total || 0;
  return { ...cover, n_arrivals: arrivals.n_arrivals, sum_work: arrivals.sum_work, arrivals, same_window_object: cover.arrivalWindow === arrivals.arrivalWindow };
}
