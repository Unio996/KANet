// (27) v0.6 · §5① claim-shape 深度采样器 — (d) 残余清单第 1 项(部署硬前置)的可执行物, 入库版。只读(DB 经 src/db/client.js 只 SELECT + RPC 只读)。
// 跑(正式): cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.mjs [--mode hist|live] [--limit 200] [--depth 20] [--sleep-ms 20] [--live-minutes 60] [--poll-ms 1000] [--out <dir>] [--dry-run N]
// 测试(离线, 无节点无 DB): node docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.test.mjs
//   退出码: 0 OK / 3 SYNC-GATE / 5 INSUFFICIENT_SAMPLES(fail-closed, 不出统计)
// Codex 6fd55a53 三 MUST-FIX 的落法:
//   ① canonical 反核: tx_log 命中块 getBlock 后 txid ∈ block.transactions 才用; 缺块/getBlock 错/畸形/不可判 ⇒ inconclusive(单列, 不静默计); txid 不在块 ⇒ excluded(单列)。两者都不进 n。
//   ② 入库 + 官方跑可复算: 输出带 schema_version / target_commit(kanet-tn12 HEAD) / rpc(live 二进制 7b1e18cc, url) / cli_args / 原始样本行(samples[] 全量, 可重算分位) / 文件 sha256。
//   ③ Leg A 起点分级: SENDER_TS(发送方进程自记: refund_attempted_at / metadata.refund_dispatched_at / zk_settle_evidence.settled_at 等) > MEMPOOL_SEEN(live: 本机 mempool 1 s 轮询首见, 近似非真提交) > PROXY_POLL(DB 30 s 轮询首见, 明标不入最终界)。
//      feed.legA_final 只用 SENDER_TS; MEMPOOL_SEEN/PROXY_POLL 单列为 observational。最终 T5 界须用 harness 发出时绑定 txid 的 submit_ts(上链跑手 recordSubmission 已带 t)。
// Leg B inclusion→depth-D: 纯确认深度物理; depth = virtualDaaScore − blockDaaScore ≥ D, 同 kasia-relay/src/lib/p2sh.mjs:1484 checkUtxoLanded; D=20 = kasia-console/src/lib/pool-shard-register.mjs:88。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

export const SCHEMA_VERSION = 'claim-depth/6';
// (27) v0.5: SENDER_TS 源 × 写点 × 格式 × tz 依据 —— 每个源只认它【已知写点】会产生的格式; 其它格式(尤其裸 ISO 无 tz)⇒ inconclusive, 不猜时区
export const SENDER_TS_POLICY = {
  // pool_bettor_sides.refund_attempted_at: 写点 pool.js:531 / bettor-refund-claim-auto.mjs:146 = SQLite CURRENT_TIMESTAMP(UTC 文本, SQLite 定义); 另实存整数秒(历史写点)
  refund_attempted_at: { sqliteText: true, intEpoch: true, isoZoned: true, isoNaive: false, writers: ['kasia-console/src/api/pool.js:531 CURRENT_TIMESTAMP', 'kasia-console/src/services/bettor-refund-claim-auto.mjs:146 CURRENT_TIMESTAMP'] },
  // pool_markets.metadata.refund_dispatched_at: 写点 bshard-auto-settler.mjs:983 new Date().toISOString() ⇒ 恒带 Z
  refund_dispatched_at: { sqliteText: false, intEpoch: false, isoZoned: true, isoNaive: false, writers: ['kasia-console/src/services/bshard-auto-settler.mjs:983 toISOString'] },
  // pool_markets.metadata.settle_evidence.settled_at: 写点 bshard-settle-daemon.mjs:885 toISOString(本机 DB 实存 146/270 行, 全 ISO Z); zk_settle_evidence.settled_at: :697 toISOString(DB 现 0 行);
  // 其它 settled_at 出现处, (27) 一律不读 ⇒ 不在本策略内: kasia-console/src/api/kanet-broker.js:227/260/327 = 【非写点】read-side by_market 投影(:174 注释), r.updated_at 来自 SELECT 不落表; kasia-console/src/api/trading.js:1909 = 写 trade_baselines(参数, 别的表); kasia-console/src/services/bettor-prediction-settler.js:137 toISOString(别的表)
  settled_at: { sqliteText: false, intEpoch: false, isoZoned: true, isoNaive: false, writers: ['kasia-console/src/services/bshard-settle-daemon.mjs:885 toISOString (settle_evidence)', 'kasia-console/src/services/bshard-settle-daemon.mjs:697 toISOString (zk_settle_evidence)'] },
};
export const MIN_SAMPLES = 30;          // (d) §5① / Codex 残余清单 1
export const DEFAULT_DEPTH = 20;        // REORG_SAFE_MIN_DEPTH (pool-shard-register.mjs:88)
export const LEGA_SOURCES = { SENDER_TS: 'SENDER_TS', MEMPOOL_SEEN: 'MEMPOOL_SEEN', PROXY_POLL: 'PROXY_POLL' };

// —— 纯函数(可离线测) ——
// canonical 时间戳解析(Codex 5d23a4be MUST-FIX): 只接受【真实持久化格式】, 其余 ⇒ inconclusive(不进 n)。全部按 UTC 解析——依据:
//   (a) SQLite CURRENT_TIMESTAMP 文本 "YYYY-MM-DD HH:MM:SS" = UTC(SQLite 文档: CURRENT_TIMESTAMP 返回 UTC; 生产写点 pool.js:531 / bettor-refund-claim-auto.mjs:146);
//       JS Date.parse 会把它当【本地时】(本机 UTC+7 ⇒ 差 −7 h), v0.3 用 Date.parse = 真 bug, 本版改 Date.UTC 显式;
//   (b) ISO-8601 带 Z 或 ±hh:mm(metadata.refund_dispatched_at 等 = toISOString) 按其时区; 不带时区的 ISO 按 UTC(我们的写点全 UTC);
//   (c) 整数: >=1e12 ⇒ 毫秒; 1e9 <= x < 1e12 ⇒ 秒×1000(refund_attempted_at 实存 1783785324 这种秒值); 其它量级 ⇒ inconclusive;
//   (d) null/空/畸形/NaN ⇒ inconclusive。
export function parseTs(v, policy = { sqliteText: true, intEpoch: true, isoZoned: true, isoNaive: true }) {
  if (v == null || v === '') return { ok: false, reason: 'null/empty' };
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v); if (!Number.isFinite(n)) return { ok: false, reason: 'non-finite number' };
    if (!policy.intEpoch) return { ok: false, reason: 'int epoch not allowed for this source (no known writer)' };
    if (n >= 1e12) return { ok: true, ms: Math.round(n), fmt: 'int_ms' };
    if (n >= 1e9) return { ok: true, ms: Math.round(n * 1000), fmt: 'int_s' };
    return { ok: false, reason: 'integer magnitude ambiguous (<1e9)' };
  }
  if (typeof v !== 'string') return { ok: false, reason: 'unsupported type ' + typeof v };
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?$/);
  if (m) { if (!policy.sqliteText) return { ok: false, reason: 'sqlite text not allowed for this source (writer uses toISOString)' }; const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + (m[7] ? Math.round(parseFloat(m[7]) * 1000) : 0); return Number.isFinite(ms) ? { ok: true, ms, fmt: 'sqlite_utc_text' } : { ok: false, reason: 'sqlite text invalid date' }; }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    let ms;
    if (m[8]) { if (!policy.isoZoned) return { ok: false, reason: 'iso not allowed for this source' }; const norm = t.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'); ms = Date.parse(norm); }
    else if (!policy.isoNaive) return { ok: false, reason: 'naive ISO (no tz) not allowed for this source: writer is toISOString ⇒ must carry Z/offset; tz unknown ⇒ inconclusive' };
    else ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + (m[7] ? Math.round(parseFloat(m[7]) * 1000) : 0);
    return Number.isFinite(ms) ? { ok: true, ms, fmt: m[8] ? 'iso_zoned' : 'iso_naive_as_utc' } : { ok: false, reason: 'iso invalid' };
  }
  return { ok: false, reason: 'malformed: ' + t.slice(0, 32) };
}
export function txIdsOf(block) { return (block?.transactions || []).map(t => t?.verboseData?.transactionId || t?.transactionId || t?.id).filter(Boolean); }
export function verifyInclusion(block, txid) {
  // 三态: verified(在块内) / excluded(块可判且 txid 不在 = tx_log 陈旧/被 reorg 出) / inconclusive(缺块·畸形·未载 tx = 不可判, 不静默计)
  if (!block || !block.header) return { state: 'inconclusive', reason: 'block missing / malformed' };
  if (!Array.isArray(block.transactions) || !block.transactions.length) return { state: 'inconclusive', reason: 'block has no transactions loaded' };
  const ids = txIdsOf(block);
  if (!ids.length) return { state: 'inconclusive', reason: 'transactions lack ids (malformed RPC shape)' };
  return ids.includes(txid) ? { state: 'verified', reason: null } : { state: 'excluded', reason: 'txid not in canonical block.transactions (tx_log stale / reorged)' };
}
export function legBFromBlocks(inclusionHeader, laterBlocks, depth) {
  const incDaa = Number(inclusionHeader.daaScore), incTs = Number(inclusionHeader.timestamp), target = incDaa + depth;
  const hit = laterBlocks.map(b => b.header || b).filter(h => Number(h.daaScore) >= target).sort((a, b) => Number(a.daaScore) - Number(b.daaScore))[0];
  if (!hit) return { ok: false, err: 'depth target not reached within paging' };
  return { ok: true, inclusion_daa: incDaa, inclusion_ts: incTs, reach_daa: Number(hit.daaScore), reach_ts: Number(hit.timestamp), legB_daa: Number(hit.daaScore) - incDaa, legB_wall_s: +((Number(hit.timestamp) - incTs) / 1000).toFixed(1) };
}
export function legAFrom({ submitTs, submitDaa, source, inclusionHeader, submitRaw, submitFmt }) {
  if (!source) return null;
  const incTs = Number(inclusionHeader?.timestamp);
  const wall = (Number.isFinite(submitTs) && Number.isFinite(incTs)) ? (incTs - submitTs) / 1000 : NaN;
  // (Codex 5d23a4be MUST-FIX ②) 只有 finite 且非负 的 Leg A 才可 final-eligible; 否则 state=inconclusive_ts, 剔除并 surfaced, 不进 legA n
  if (!Number.isFinite(wall) || wall < 0) return { source, state: 'inconclusive_ts', reason: !Number.isFinite(wall) ? 'submit ts unparsable/non-finite' : 'negative leg (inclusion before submit => ts format/timezone wrong)', submit_raw: submitRaw ?? null, submit_fmt: submitFmt ?? null, final_eligible: false };
  const out = { source, state: 'ok', legA_wall_s: +wall.toFixed(1), final_eligible: source === LEGA_SOURCES.SENDER_TS, submit_fmt: submitFmt ?? null };
  if (Number.isFinite(submitDaa)) out.legA_daa = Number(inclusionHeader.daaScore) - submitDaa;
  out.note = source === LEGA_SOURCES.SENDER_TS ? '发送方进程自记时刻, 可入最终界(轻代理偏短=低估向, 归 S_unalloc)' : source === LEGA_SOURCES.MEMPOOL_SEEN ? '本机 mempool 轮询首见(≈1 s 粒度), 偏晚=低估向, observational 不入最终界' : 'DB 30 s 轮询首见, 偏晚显著, PROXY_POLL 不入最终界';
  return out;
}
export const stats = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; const mean = s.reduce((a, b) => a + b, 0) / s.length; const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length); return { n: s.length, p50: q(0.5), p90: q(0.9), p100: s[s.length - 1], mean: +mean.toFixed(2), sd: +sd.toFixed(2), S_unalloc_rule: +Math.max(s[s.length - 1] - q(0.5), 3 * sd).toFixed(2) }; };

export function summarize(samples, { minSamples = MIN_SAMPLES, dry = false } = {}) {
  // samples: [{ kind, txid, verified:{state,reason}, legA|null, legB:{ok,...} }]
  const byState = (st) => samples.filter(s => s.verified?.state === st);
  const excluded = byState('excluded'), inconclusive = byState('inconclusive');
  const reasons = (arr) => Object.fromEntries([...new Set(arr.map(s => s.verified?.reason || '?'))].map(r => [r, arr.filter(s => (s.verified?.reason || '?') === r).length]));
  const okB = samples.filter(s => s.verified?.state === 'verified' && s.legB?.ok);
  const legATs = samples.filter(s => s.verified?.state === 'verified' && s.legA?.state === 'inconclusive_ts');
  const legAAll = samples.filter(s => s.verified?.state === 'verified' && s.legA && s.legA.state === 'ok');
  const legAFinal = legAAll.filter(s => s.legA.final_eligible);
  const legAObs = legAAll.filter(s => !s.legA.final_eligible);
  const legB = { n: okB.length, daa: stats(okB.map(s => s.legB.legB_daa)), wall_s: stats(okB.map(s => s.legB.legB_wall_s)), note: '纯确认深度物理, 形状无关 ⇒ 代理对 N_claim 大头有效; p100 = 样本内经验下界, 非未来最坏上界' };
  const legA_final = { n: legAFinal.length, sources: { SENDER_TS: legAFinal.length }, wall_s: stats(legAFinal.map(s => s.legA.legA_wall_s)), daa: stats(legAFinal.map(s => s.legA.legA_daa).filter(Number.isFinite)), note: '只含 SENDER_TS(发送方进程自记), 可入最终界; 轻代理低估向归 S_unalloc' };
  const legA_observational = { n: legAObs.length, sources: Object.fromEntries(Object.values(LEGA_SOURCES).filter(k => k !== 'SENDER_TS').map(k => [k, legAObs.filter(s => s.legA.source === k).length])), wall_s: stats(legAObs.map(s => s.legA.legA_wall_s)), daa: stats(legAObs.map(s => s.legA.legA_daa).filter(Number.isFinite)), note: 'MEMPOOL_SEEN / PROXY_POLL: 起点偏晚 = 低估向, 不入最终 T5 界(Codex 6fd55a53 MUST-FIX 3)' };
  const sA = legA_final.daa?.S_unalloc_rule ?? 0, sB = legB.daa?.S_unalloc_rule ?? 0;
  const insufficient = !dry && okB.length < minSamples;
  return { verified_n: samples.filter(s => s.verified?.state === 'verified').length,
    excluded: { n: excluded.length, reasons: reasons(excluded) }, inconclusive: { n: inconclusive.length, reasons: reasons(inconclusive), note: '不可判(缺块/getBlock 错/畸形/未载 tx) 单列 surfaced, 不静默计, 不进 n' },
    legB_inclusion_to_depth: legB, legA_final, legA_observational,
    legA_inconclusive_ts: { n: legATs.length, reasons: reasons(legATs.map(x => ({ verified: { reason: x.legA.reason } }))), note: 'submit ts unparsable/non-finite/negative => excluded and surfaced, not in legA n (Codex 5d23a4be)' },
    feed: { N_claim_envelope_daa: (legB.daa?.p100 ?? 0) + (legA_final.daa?.p100 ?? 0), S_unalloc_daa: +(sA + sB).toFixed(2),
      note: 'N_claim = 实测运行包络(此数) + 具名 S_unalloc(此数, σA+σB 型两腿之和 = 保守过估, 与 reorg/观测/拥塞具名裕度不重复计); 读数带前缀"代理 claim-shape 非 T5 同形"; Leg A 仅 SENDER_TS 进包络' },
    ...(insufficient ? { status: 'INSUFFICIENT_SAMPLES', exit: 5, action: `fail-closed: legB n=${okB.length} < ${minSamples}, 不出统计喂 N_claim/S_unalloc` } : { status: dry ? 'DRY-RUN' : 'OK', exit: 0 }) };
}

// —— 链读 + DB(只在 main 里用) ——
async function main() {
  const require = createRequire('file:///D:/kanet-tn12/kasia-console/package.json');
  const { RpcClient, Encoding } = require('kaspa-wasm');
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const MODE = arg('--mode', 'hist'), LIMIT = Number(arg('--limit', 200)), DEPTH = Number(arg('--depth', DEFAULT_DEPTH)), SLEEP_MS = Number(arg('--sleep-ms', 20)), LIVE_MIN = Number(arg('--live-minutes', 60)), POLL_MS = Number(arg('--poll-ms', 1000));
  const OUT = arg('--out', 'D:/kanet-tn12/docs/provenance/2026-08-27-claim-depth');
  const DRY = argv.includes('--dry-run') ? Number(arg('--dry-run', 5)) : 0;
  const DAA_FLOOR = 80095687, DB_PATH = 'D:/kanet-tn12/kasia-console/data/console.db', RPC_URL = 'ws://127.0.0.1:17210';
  process.env.DB_PATH = process.env.DB_PATH || DB_PATH;             // DB 走 console 的 src/db/client.js 通道(M0a 门), 本脚本零写
  const { sqlite: db } = await import('file:///D:/kanet-tn12/kasia-console/src/db/client.js');
  const nap = () => SLEEP_MS > 0 ? new Promise(r => setTimeout(r, SLEEP_MS)) : Promise.resolve();
  const targetCommit = (() => { try { return execSync('git rev-parse HEAD', { cwd: 'D:/kanet-tn12' }).toString().trim(); } catch { return null; } })();

  function loadProxies(limit) {
    // 每类带 SENDER_TS 来源(若有): refund → MIN(refund_attempted_at) 或 metadata.refund_dispatched_at; settle → metadata.zk_settle_evidence.settled_at(提交返回后写, ≈ 提交时刻+RPC 往返)
    const rows = []; const push = (kind, r, senderTs, senderSrc) => rows.push({ kind, txid: r.txid, sender_ts: senderTs || null, sender_src: senderTs ? senderSrc : null, block_hash: r.block_hash || null, block_time: r.block_time || null, redeem_len: r.redeem_len || null });
    const j = (sql) => db.prepare(sql).all();
    for (const r of j(`SELECT b.claim_txid txid, l.block_hash, l.block_time, length(b.side_redeem_script_hex)/2 redeem_len FROM pool_bettor_sides b JOIN kaspa_tx_log l ON l.tx_id=b.claim_txid WHERE b.claim_txid IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) push('pool_side_claim', r, null, null);
    for (const r of j(`SELECT m.settle_txid txid, m.metadata meta, l.block_hash, l.block_time FROM pool_markets m JOIN kaspa_tx_log l ON l.tx_id=m.settle_txid WHERE m.settle_txid IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) { let ts = null; try { const md = JSON.parse(r.meta || '{}'); ts = md?.zk_settle_evidence?.settled_at || md?.settle_evidence?.settled_at || null; } catch {} push('pool_settle', r, ts, 'settled_at'); }
    // refund: 提交时刻 = 该市场(logical 或其 shard)下 sides 的 MIN(refund_attempted_at)(R-SHARD-BLIND: bshard sides 按 shard_market_id 存, 两边都查) 或 metadata.refund_dispatched_at
    for (const r of j(`SELECT m.id mid, m.refund_txid txid, m.metadata meta, l.block_hash, l.block_time, (SELECT MIN(b.refund_attempted_at) FROM pool_bettor_sides b WHERE b.refund_attempted_at IS NOT NULL AND (b.market_id=m.id OR b.market_id IN (SELECT s.shard_market_id FROM market_shards s WHERE s.logical_market_id=m.id))) att FROM pool_markets m JOIN kaspa_tx_log l ON l.tx_id=m.refund_txid WHERE m.refund_txid IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) { let ts = r.att || null, src = ts ? 'refund_attempted_at' : null; if (!ts) { try { ts = JSON.parse(r.meta || '{}')?.refund_dispatched_at || null; src = ts ? 'refund_dispatched_at' : null; } catch {} } push('pool_refund', r, ts, src); }
    for (const r of j(`SELECT substr(s.current_leaf_outpoint,1,64) txid, l.block_hash, l.block_time, length(s.shard_redeem_hex)/2 redeem_len FROM market_shards s JOIN kaspa_tx_log l ON l.tx_id=substr(s.current_leaf_outpoint,1,64) WHERE s.current_leaf_outpoint IS NOT NULL ORDER BY l.block_time DESC LIMIT ${limit}`)) push('shard_leaf_continuation', r, null, null);
    const seen = new Set(); return rows.filter(r => r.txid && !seen.has(r.txid) && seen.add(r.txid));
  }
  async function pageForward(rpc, lowHash, maxPages = 50) { const out = []; let low = lowHash; for (let i = 0; i < maxPages; i++) { const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: false }); await nap(); const blks = (r.blocks || []).map(b => b.block || b); out.push(...blks); const last = r.blockHashes?.[r.blockHashes.length - 1]; if (!last || last === low || !blks.length) break; low = last; } return out; }
  async function measure(rpc, p, legAInput) {
    let blk; try { blk = (await rpc.getBlock({ hash: p.block_hash, includeTransactions: true })).block; await nap(); } catch (e) { return { verified: { state: 'inconclusive', reason: 'getBlock error: ' + String(e.message || e).slice(0, 80) }, legA: null, legB: { ok: false, err: 'inconclusive' } }; }
    const verified = verifyInclusion(blk, p.txid);
    if (verified.state !== 'verified') return { verified, legA: null, legB: { ok: false, err: verified.state } };
    const later = await pageForward(rpc, p.block_hash);
    return { verified, legA: legAInput ? legAFrom({ ...legAInput, inclusionHeader: blk.header }) : null, legB: legBFromBlocks(blk.header, later, DEPTH), inclusion_block: { hash: blk.header.hash, daaScore: Number(blk.header.daaScore), timestamp: Number(blk.header.timestamp) } };
  }

  const rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: 'testnet-12' });
  await rpc.connect({ timeoutDuration: 8000 });
  const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore);
  if (!(si.isSynced && daa > DAA_FLOOR) && !DRY) { console.error(`⛔ SYNC-GATE: isSynced=${si.isSynced} daa=${daa} (floor ${DAA_FLOOR}) ⇒ 不出数`); await rpc.disconnect(); process.exit(3); }
  const samples = [];
  if (MODE === 'live' && !DRY) {
    // live: (a) 本机 mempool 每 POLL_MS 轮询, 新 txid 首见 = MEMPOOL_SEEN(记 ts + virtualDaaScore); (b) DB 30 s 轮询作 PROXY_POLL 兜底; 进 kaspa_tx_log 后反核 + 量两腿
    const known = new Set(loadProxies(100000).map(r => r.txid)); const pending = new Map(); const mem = new Map(); const t0 = Date.now(); let lastDb = 0;
    while (Date.now() - t0 < LIVE_MIN * 60000) {
      try { const me = await rpc.getMempoolEntries({ includeOrphanPool: false, filterTransactionPool: false }); const s2 = await rpc.getServerInfo(); const now = Date.now(), nowDaa = Number(s2.virtualDaaScore); for (const e of me.mempoolEntries || me.entries || []) { const id = e?.transaction?.verboseData?.transactionId || e?.transaction?.id; if (id && !mem.has(id)) mem.set(id, { ts: now, daa: nowDaa }); } } catch {}
      if (Date.now() - lastDb > 30000) { lastDb = Date.now(); const s2 = await rpc.getServerInfo(); for (const r of loadProxies(500)) if (!known.has(r.txid)) { known.add(r.txid); const m = mem.get(r.txid); pending.set(r.txid, { ...r, legAInput: r.sender_ts ? (() => { const pt = parseTs(r.sender_ts, SENDER_TS_POLICY[r.sender_src] || SENDER_TS_POLICY.settled_at); return { submitTs: pt.ok ? pt.ms : NaN, submitDaa: null, source: LEGA_SOURCES.SENDER_TS, submitRaw: r.sender_ts, submitFmt: pt.ok ? pt.fmt : ('UNPARSED: ' + pt.reason) }; })() : m ? { submitTs: m.ts, submitDaa: m.daa, source: LEGA_SOURCES.MEMPOOL_SEEN } : { submitTs: Date.now(), submitDaa: Number(s2.virtualDaaScore), source: LEGA_SOURCES.PROXY_POLL } }); }
        for (const [txid, p] of pending) { const l = db.prepare('SELECT block_hash, block_time FROM kaspa_tx_log WHERE tx_id=? LIMIT 1').get(txid); if (!l) continue; const m = await measure(rpc, { ...p, block_hash: l.block_hash }, p.legAInput); if (m.legB.ok || m.verified.state !== 'verified' || Date.now() - p.legAInput.submitTs > 30 * 60000) { samples.push({ kind: p.kind, txid, block_hash: l.block_hash, block_time: l.block_time, redeem_len: p.redeem_len, ...m }); pending.delete(txid); } } }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  } else {
    for (const p of loadProxies(DRY ? DRY : LIMIT)) { if (DRY && samples.length >= DRY) break; if (!p.block_hash) continue; const pt = p.sender_ts != null ? parseTs(p.sender_ts, SENDER_TS_POLICY[p.sender_src] || SENDER_TS_POLICY.settled_at) : null; const m = await measure(rpc, p, pt ? { submitTs: pt.ok ? pt.ms : NaN, submitDaa: null, source: LEGA_SOURCES.SENDER_TS, submitRaw: p.sender_ts, submitFmt: pt.ok ? pt.fmt : ('UNPARSED: ' + pt.reason) } : null); samples.push({ kind: p.kind, txid: p.txid, block_hash: p.block_hash, block_time: p.block_time, redeem_len: p.redeem_len, sender_ts: p.sender_ts, sender_src: p.sender_src, ...m }); }
  }
  await rpc.disconnect();
  const sum = summarize(samples, { dry: !!DRY });
  const out = { schema_version: SCHEMA_VERSION, mode: DRY ? 'DRY-RUN(绕过 SYNC-GATE, 只看形状, 不作证据)' : `FORMAL-${MODE}`, t: new Date().toISOString(), target_commit: targetCommit, rpc: { url: RPC_URL, network: 'testnet-12', live_binary_commit: '7b1e18cc', semantics: 'getBlock(includeTransactions) canonical 反核; getBlocks(lowHash) 前向翻页找 depth; getMempoolEntries 首见(live)' }, cli_args: argv, daa, depth: DEPTH, min_samples: MIN_SAMPLES,
    proxy_note: '代理样本 = 现网 pool covenant 花费(PoolSide claim / settle / refund / ShardLeaf 续链), 非 v0.15 T5 同形; Leg B 纯确认深度物理形状无关; Leg A 仅 SENDER_TS 进包络',
    by_kind: Object.fromEntries([...new Set(samples.map(s => s.kind))].map(k => [k, samples.filter(s => s.kind === k).length])), ...sum, samples };
  const json = JSON.stringify(out, null, 1); const sha = createHash('sha256').update(json).digest('hex');
  if (sum.exit === 5) { console.error(`⛔ INSUFFICIENT_SAMPLES: legB n=${sum.legB_inclusion_to_depth.n} < ${MIN_SAMPLES}`); console.log(json); process.exit(5); }
  if (!DRY) { mkdirSync(OUT, { recursive: true }); const f = `${OUT}/claim-depth-${out.t.replace(/[:.]/g, '-')}.json`; writeFileSync(f, json); console.log(`wrote ${f} sha256=${sha}`); }
  console.log(DRY ? json : JSON.stringify({ ...out, samples: `(${samples.length} raw rows in file)`, file_sha256: sha }, null, 1));
}
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('claim-depth-sampler.mjs')) main().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
