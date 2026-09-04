// (21)/(24) v0.10 · 测试专用: 合成 DAG 生成器 + replay 假 RPC(把合成 DAG 序列化成 wRPC 形分页响应)。只在 *.test.mjs 里用, 生产禁用。
import { rebuildWindows, setHashPolicy } from './wcap-window.mjs';
setHashPolicy({ allowSynthetic: true });   // 测试/合成向量: 短名 hash 放行(生产默认严格 64 位 hex)
import { targetFromBits, compactTargetBits } from './kmax-cost.mjs';

// 生成器(同 wcap-window.test.mjs v0.9): 链 + 侧块; redPairs; squeezeFrom; bitsOverride {hash:{div}}; cut {keepFrom, drop[]}
export function genChain(g, P) {
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
  if (g.bitsOverride) { const base = genChain({ ...g, bitsOverride: null }, P); for (const [h, o] of Object.entries(g.bitsOverride)) { const bb = base.find(x => x.hash === h); byHash.get(h).bits = compactTargetBits(targetFromBits(bb.bits) / BigInt(o.div)); } }
  rebuildWindows(blocks, P, { assignBits: true });
  if (g.cut) { const k = g.cut.keepFrom, inRange = (h) => h !== 'g' && Number(h.replace(/^[bs]/, '')) >= k, dropped = new Set(g.cut.drop || []); return blocks.filter(b => inRange(b.hash) && !dropped.has(b.hash)).map(b => ({ ...b, parents: b.parents.filter(inRange), mergeSetBluesHashes: b.mergeSetBluesHashes.filter(inRange) })); }
  return blocks;
}

// —— replay 假 RPC: 把【全 DAG】序列化成 wRPC 形; getBlocks = antipast(low) ∩ past(sink) 拓扑序分页(含 low, ≤pageSize/页, 末页附 sink anticone), 与 service.rs:426-477 语义对齐(测试模型) ——
const hex = (bw) => '0x' + BigInt(bw).toString(16);
export function toRpcShape(b) { return { header: { hash: b.hash, daaScore: String(b.daaScore), blueWork: hex(b.blueWork), timestamp: String(b.timestamp), bits: b.bits, parents: [{ parentHashes: b.parents }] }, verboseData: { hash: b.hash, blueScore: String(b.blueScore), selectedParentHash: b.selectedParentHash, mergeSetBluesHashes: b.mergeSetBluesHashes, mergeSetRedsHashes: b.mergeSetRedsHashes, isChainBlock: false } }; }
function buildState(blocks) {
  const byHash = new Map(blocks.map(b => [b.hash, b]));
  const past = (h) => { const seen = new Set(); const st = [...(byHash.get(h)?.parents || [])]; while (st.length) { const x = st.pop(); if (seen.has(x) || !byHash.has(x)) continue; seen.add(x); st.push(...byHash.get(x).parents); } return seen; };
  const sink = blocks.reduce((m, b) => (m == null || b.blueWork > m.blueWork || (b.blueWork === m.blueWork && b.hash > m.hash) ? b : m), null);
  const sinkPast = past(sink.hash); sinkPast.add(sink.hash);
  const topo = (() => { const indeg = new Map(blocks.map(b => [b.hash, 0])), kids = new Map(blocks.map(b => [b.hash, []])); for (const b of blocks) for (const p of b.parents) if (byHash.has(p)) { indeg.set(b.hash, indeg.get(b.hash) + 1); kids.get(p).push(b.hash); } const q = blocks.filter(b => indeg.get(b.hash) === 0).map(b => b.hash), out = []; const key = (h) => { const b = byHash.get(h); return [b.blueWork, h]; }; while (q.length) { q.sort((x, y) => { const [a, b1] = key(x), [c, d] = key(y); return a < c ? -1 : a > c ? 1 : b1 < d ? -1 : b1 > d ? 1 : 0; }); const h = q.shift(); out.push(h); for (const k of kids.get(h)) { indeg.set(k, indeg.get(k) - 1); if (indeg.get(k) === 0) q.push(k); } } return out; })();
  return { blocks, byHash, past, sink, sinkPast, topo };
}
export function makeReplayRpc(blocks0, { pageSize = 249, dropPages = [], faults = {}, failOnLow = {} } = {}) {   // failOnLow: {lowHash: times} 该 low 的前 times 次 getBlocks 抛 transient 错(测 retry/续游标)
  let st = buildState(blocks0); const failLeft = { ...failOnLow };   // 可增长: rpc.advance(newBlocks) 换整个 DAG 状态(模拟两次轮询之间出块)
  const calls = { getBlocks: 0, getBlock: 0, getBlockDagInfo: 0 };
  return {
    calls, get sinkHash() { return st.sink.hash; }, advance(newBlocks) { st = buildState(newBlocks); },
    async getServerInfo() { return { isSynced: faults.isSynced ?? true, virtualDaaScore: String(st.sink.daaScore) }; },
    async getBlockDagInfo() { calls.getBlockDagInfo++; return { sink: st.sink.hash, tipHashes: [st.sink.hash], blockCount: String(st.blocks.length), virtualDaaScore: String(st.sink.daaScore), pruningPointHash: 'g' }; },
    async getBlock({ hash }) { calls.getBlock++; const b = st.byHash.get(hash); if (!b) throw new Error('block not found: ' + hash); return { block: toRpcShape(b) }; },
    async getBlocks({ lowHash }) {   // antipast(low) ∩ past(sink), 拓扑序, 含 low; 分页 ≤ pageSize; 到 sink 时附 sink anticone(此模型 = 不在 past(sink) 的其它 tips 及其未含祖先)
      calls.getBlocks++; const { byHash, past, sink, sinkPast, topo } = st; if (!byHash.has(lowHash)) throw new Error('lowHash not found: ' + lowHash);
      if (failLeft[lowHash] > 0) { failLeft[lowHash]--; calls.transientFails = (calls.transientFails || 0) + 1; throw new Error('TRANSIENT: simulated rpc failure at low ' + lowHash); }
      const lowPast = past(lowHash); const seq = topo.filter(h => h !== lowHash && !lowPast.has(h) && sinkPast.has(h)); const idx = seq.indexOf(sink.hash);
      const cover = [lowHash, ...seq.slice(0, idx + 1)];   // 到 sink 为止的全序列
      // 分页: 找 low 在全序列里的位置 ⇒ 本页 = low 起 ≤ pageSize 个
      const pageNo = calls.getBlocks; const page = cover.slice(0, pageSize);
      if (dropPages.includes(pageNo)) return { blockHashes: [], blocks: [] };   // 故障注入: 整页丢
      let hashes = page; if (page[page.length - 1] === sink.hash) { const anticone = topo.filter(h => !sinkPast.has(h)); hashes = [...page, ...anticone]; }   // service.rs:459 filtered_sink_anticone 模型
      return { blockHashes: hashes, blocks: hashes.map(h => ({ block: toRpcShape(byHash.get(h)) })) };
    },
  };
}
