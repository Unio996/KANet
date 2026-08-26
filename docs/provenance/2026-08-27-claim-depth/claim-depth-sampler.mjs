// (27) v0.2 · §5① claim-shape 深度采样器 — (d) 残余清单第 1 项(部署硬前置)的可执行物, 入库版。只读(DB 经 src/db/client.js 只 SELECT + RPC 只读)。
// 跑(正式): cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs [--mode hist|live] [--limit 200] [--depth 20] [--sleep-ms 20] [--live-minutes 60] [--out <dir>] [--dry-run N]
// 测试(离线, 无节点无 DB): node docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.test.mjs
//   退出码: 0 OK / 3 SYNC-GATE / 5 INSUFFICIENT_SAMPLES(fail-closed, 不出统计)
// 样本源(代理·非 v0.15 T5 同形, 见方法稿 §1): pool_bettor_sides.claim_txid / pool_markets.settle_txid / pool_markets.refund_txid(+refund_attempted_at) / market_shards 续链
// 🔴 v0.2 (NWT): kaspa_tx_log 命中的包含块须 getBlock 反核 —— txid ∈ block.transactions 才用该块 daaScore 作 Leg B 起点; tx_log hit 非 canonical 证明(可能陈旧/被 reorg 出); 反核失败 ⇒ 剔除并计数。
// 两腿两列(Codex D-2): Leg A submit→inclusion(轻代理 PoolSide 450 B, 低估向, 归 S_unalloc); Leg B inclusion→depth-D(纯确认深度物理, 形状无关)。
//   depth 判据 = virtualDaaScore − blockDaaScore ≥ D, 同 kasia-relay/src/lib/p2sh.mjs:1484 checkUtxoLanded; D=20 = kasia-console/src/lib/pool-shard-register.mjs:88 REORG_SAFE_MIN_DEPTH。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MIN_SAMPLES = 30;          // (d) §5① / Codex 残余清单 1
export const DEFAULT_DEPTH = 20;        // REORG_SAFE_MIN_DEPTH (pool-shard-register.mjs:88)

// —— 纯函数(可离线测) ——
export function txIdsOf(block) {
  return (block?.transactions || []).map(t => t?.verboseData?.transactionId || t?.transactionId || t?.id).filter(Boolean);
}
export function verifyInclusion(block, txid) {
  // tx_log 命中块须反核: txid 真在该块的 transactions 里
  const ids = txIdsOf(block); const ok = ids.includes(txid);
  return { ok, reason: ok ? null : (ids.length ? 'txid not in block.transactions (tx_log stale / reorged)' : 'block has no transactions loaded') };
}
export function legBFromBlocks(inclusionHeader, laterBlocks, depth) {
  // laterBlocks: 从包含块起前向翻页得到的块(含或不含包含块本身); 取首个 daaScore ≥ inc+depth 的块
  const incDaa = Number(inclusionHeader.daaScore), incTs = Number(inclusionHeader.timestamp), target = incDaa + depth;
  const hit = laterBlocks.map(b => b.header || b).filter(h => Number(h.daaScore) >= target).sort((a, b) => Number(a.daaScore) - Number(b.daaScore))[0];
  if (!hit) return { ok: false, err: 'depth target not reached within paging' };
  return { ok: true, inclusion_daa: incDaa, inclusion_ts: incTs, reach_daa: Number(hit.daaScore), reach_ts: Number(hit.timestamp), legB_daa: Number(hit.daaScore) - incDaa, legB_wall_s: +((Number(hit.timestamp) - incTs) / 1000).toFixed(1) };
}
export function legAFrom({ submitTs, submitDaa, inclusionHeader }) {
  if (!submitTs) return null;
  const out = { legA_wall_s: +((Number(inclusionHeader.timestamp) - submitTs) / 1000).toFixed(1), note: '轻代理(PoolSide 450 B 等)偏短 = 低估向, 归 S_unalloc; hist 的 submit 来自 DB 时刻, live 为 DB 首现(30 s 粒度)' };
  if (Number.isFinite(submitDaa)) out.legA_daa = Number(inclusionHeader.daaScore) - submitDaa;
  return out;
}
export const stats = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; const mean = s.reduce((a, b) => a + b, 0) / s.length; const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length); return { n: s.length, p50: q(0.5), p90: q(0.9), p100: s[s.length - 1], mean: +mean.toFixed(2), sd: +sd.toFixed(2), S_unalloc_rule: +Math.max(s[s.length - 1] - q(0.5), 3 * sd).toFixed(2) }; };

export function summarize(samples, { minSamples = MIN_SAMPLES, dry = false } = {}) {
  // samples: [{ kind, txid, verified:{ok,reason}, legA|null, legB:{ok,...} }]
  const excluded = samples.filter(s => !s.verified?.ok);
  const okB = samples.filter(s => s.verified?.ok && s.legB?.ok);
  const okA = samples.filter(s => s.verified?.ok && s.legA);
  const legB = { n: okB.length, daa: stats(okB.map(s => s.legB.legB_daa)), wall_s: stats(okB.map(s => s.legB.legB_wall_s)), note: '纯确认深度物理, 形状无关 ⇒ 代理对 N_claim 大头有效' };
  const legA = { n: okA.length, wall_s: stats(okA.map(s => s.legA.legA_wall_s)), daa: stats(okA.map(s => s.legA.legA_daa).filter(Number.isFinite)), note: '轻代理低估向(小), 归 S_unalloc; DAA 列只有 live 有' };
  const sA = legA.daa?.S_unalloc_rule ?? 0, sB = legB.daa?.S_unalloc_rule ?? 0;
  const S_unalloc_sum = +(sA + sB).toFixed(2);
  const insufficient = !dry && okB.length < minSamples;
  return { verified_excluded: { n: excluded.length, reasons: Object.fromEntries([...new Set(excluded.map(s => s.verified?.reason || 'unverified'))].map(r => [r, excluded.filter(s => (s.verified?.reason || 'unverified') === r).length])) },
    legB_inclusion_to_depth: legB, legA_submit_to_inclusion: legA,
    feed: { N_claim_lower_bound_daa: (legB.daa?.p100 ?? 0) + (legA.daa?.p100 ?? 0), S_unalloc_daa: S_unalloc_sum, note: 'S_unalloc = σ_A + σ_B 型两腿之和 ≥ √(σA²+σB²): 配对样本不可得故取和 = 保守过估, 非危险双计; 读数带前缀"代理 claim-shape 非 T5 同形"' },
    ...(insufficient ? { status: 'INSUFFICIENT_SAMPLES', exit: 5, action: `fail-closed: legB n=${okB.length} < ${minSamples}, 不出统计喂 N_claim/S_unalloc` } : { status: dry ? 'DRY-RUN' : 'OK', exit: 0 }) };
}

// —— 链读 + DB(只在 main 里用) ——
async function main() {
  const require = createRequire('file:///D:/kanet-tn12/kasia-console/package.json');
  const { RpcClient, Encoding } = require('kaspa-wasm');
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const MODE = arg('--mode', 'hist'), LIMIT = Number(arg('--limit', 200)), DEPTH = Number(arg('--depth', DEFAULT_DEPTH)), SLEEP_MS = Number(arg('--sleep-ms', 20)), LIVE_MIN = Number(arg('--live-minutes', 60));
  const OUT = arg('--out', 'D:/kanet-tn12/docs/provenance/2026-08-27-claim-depth');
  const DRY = argv.includes('--dry-run') ? Number(arg('--dry-run', 5)) : 0;
  const DAA_FLOOR = 80095687, DB_PATH = 'D:/kanet-tn12/kasia-console/data/console.db';
  // DB 走 console 的 src/db/client.js 通道(M0a 门: 不裸 import sqlite; DB_PATH 环境变量选库), 本脚本只做 SELECT
  process.env.DB_PATH = process.env.DB_PATH || DB_PATH;
  const { sqlite: dbConn } = await import('file:///D:/kanet-tn12/kasia-console/src/db/client.js');
  const nap = () => SLEEP_MS > 0 ? new Promise(r => setTimeout(r, SLEEP_MS)) : Promise.resolve();

  function loadProxies(db, limit) {
    const rows = []; const push = (kind, r) => rows.push({ kind, txid: r.txid, submit_at: r.submit_at || null, block_hash: r.block_hash || null, block_time: r.block_time || null, redeem_len: r.redeem_len || null });
    const j = (sql) => db.prepare(sql).all();
    for (const r of j(`SELECT b.claim_txid txid, NULL submit_at, l.block_hash, l.block_time, length(b.side_redeem_script_hex)/2 redeem_len FROM pool_bettor_sides b JOIN kaspa_tx_log l ON l.tx_id=b.claim_txid WHERE b.claim_txid IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) push('pool_side_claim', r);
    for (const r of j(`SELECT m.settle_txid txid, NULL submit_at, l.block_hash, l.block_time, NULL redeem_len FROM pool_markets m JOIN kaspa_tx_log l ON l.tx_id=m.settle_txid WHERE m.settle_txid IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) push('pool_settle', r);
    for (const r of j(`SELECT m.refund_txid txid, (SELECT MIN(b.refund_attempted_at) FROM pool_bettor_sides b WHERE b.market_id=m.id AND b.refund_attempted_at IS NOT NULL) submit_at, l.block_hash, l.block_time, NULL redeem_len FROM pool_markets m JOIN kaspa_tx_log l ON l.tx_id=m.refund_txid WHERE m.refund_txid IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) push('pool_refund', r);
    for (const r of j(`SELECT substr(s.current_leaf_outpoint,1,64) txid, NULL submit_at, l.block_hash, l.block_time, length(s.shard_redeem_hex)/2 redeem_len FROM market_shards s JOIN kaspa_tx_log l ON l.tx_id=substr(s.current_leaf_outpoint,1,64) WHERE s.current_leaf_outpoint IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) push('shard_leaf_continuation', r);
    const seen = new Set(); return rows.filter(r => r.txid && !seen.has(r.txid) && seen.add(r.txid));
  }
  async function pageForward(rpc, lowHash, maxPages = 50) {
    const out = []; let low = lowHash;
    for (let i = 0; i < maxPages; i++) { const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: false }); await nap(); const blks = (r.blocks || []).map(b => b.block || b); out.push(...blks); const last = r.blockHashes?.[r.blockHashes.length - 1]; if (!last || last === low || !blks.length) break; low = last; }
    return out;
  }
  async function measure(rpc, p, submitTs, submitDaa) {
    const blk = (await rpc.getBlock({ hash: p.block_hash, includeTransactions: true })).block; await nap();
    const verified = verifyInclusion(blk, p.txid);
    if (!verified.ok) return { verified, legA: null, legB: { ok: false, err: 'unverified inclusion' } };
    const later = await pageForward(rpc, p.block_hash);
    return { verified, legA: legAFrom({ submitTs, submitDaa, inclusionHeader: blk.header }), legB: legBFromBlocks(blk.header, later, DEPTH), inclusion_block: { hash: blk.header.hash, daaScore: Number(blk.header.daaScore), timestamp: Number(blk.header.timestamp) } };
  }

  const rpc = new RpcClient({ url: 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId: 'testnet-12' });
  await rpc.connect({ timeoutDuration: 8000 });
  const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore);
  if (!(si.isSynced && daa > DAA_FLOOR) && !DRY) { console.error(`⛔ SYNC-GATE: isSynced=${si.isSynced} daa=${daa} (floor ${DAA_FLOOR}) ⇒ 不出数`); await rpc.disconnect(); process.exit(3); }
  const db = dbConn; // client.js 打开的连接(读写句柄, 本脚本零写)
  const samples = [];
  if (MODE === 'live' && !DRY) {
    const known = new Set(loadProxies(db, 100000).map(r => r.txid)); const pending = new Map(); const t0 = Date.now();
    while (Date.now() - t0 < LIVE_MIN * 60000) {
      const s2 = await rpc.getServerInfo(); const nowDaa = Number(s2.virtualDaaScore), nowTs = Date.now();
      for (const r of loadProxies(db, 500)) if (!known.has(r.txid)) { known.add(r.txid); pending.set(r.txid, { ...r, submit_ts: nowTs, submit_daa: nowDaa }); }
      for (const [txid, p] of pending) { const l = db.prepare('SELECT block_hash, block_time FROM kaspa_tx_log WHERE tx_id=? LIMIT 1').get(txid); if (!l) continue; const m = await measure(rpc, { ...p, block_hash: l.block_hash }, p.submit_ts, p.submit_daa); if (m.legB.ok || !m.verified.ok || Date.now() - p.submit_ts > 30 * 60000) { samples.push({ ...p, block_hash: l.block_hash, ...m }); pending.delete(txid); } }
      await new Promise(r => setTimeout(r, 30000));
    }
  } else {
    for (const p of loadProxies(db, DRY ? DRY : LIMIT)) { if (DRY && samples.length >= DRY) break; if (!p.block_hash) continue; let m; try { m = await measure(rpc, p, p.submit_at ? Date.parse(p.submit_at) : null, null); } catch (e) { m = { verified: { ok: false, reason: 'getBlock error: ' + String(e.message || e) }, legA: null, legB: { ok: false, err: String(e.message || e) } }; } samples.push({ ...p, ...m }); }
  }
  db.close(); await rpc.disconnect();
  const sum = summarize(samples, { dry: !!DRY });
  const out = { mode: DRY ? 'DRY-RUN(绕过 SYNC-GATE, 只看形状, 不作证据)' : `FORMAL-${MODE}`, t: new Date().toISOString(), daa, depth: DEPTH, min_samples: MIN_SAMPLES,
    proxy_note: '代理样本 = 现网 pool covenant 花费(PoolSide claim / settle / refund / ShardLeaf 续链), 非 v0.15 T5 同形; Leg B 纯确认深度物理形状无关; Leg A 轻代理低估向',
    by_kind: Object.fromEntries([...new Set(samples.map(s => s.kind))].map(k => [k, samples.filter(s => s.kind === k).length])), ...sum, samples: samples.slice(0, DRY ? DRY : 5000) };
  const json = JSON.stringify(out, null, 1);
  if (sum.exit === 5) { console.error(`⛔ INSUFFICIENT_SAMPLES: legB n=${sum.legB_inclusion_to_depth.n} < ${MIN_SAMPLES}`); console.log(json); process.exit(5); }
  if (!DRY) { mkdirSync(OUT, { recursive: true }); const f = `${OUT}/claim-depth-${out.t.replace(/[:.]/g, '-')}.json`; writeFileSync(f, json); console.log(`wrote ${f} sha256=${createHash('sha256').update(json).digest('hex')}`); }
  console.log(DRY ? json : JSON.stringify({ ...out, samples: `(${samples.length} in file)` }, null, 1));
}
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('claim-depth-sampler.mjs')) main().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
