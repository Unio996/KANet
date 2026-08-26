// (24) v0.4 · s_visible_max 提取器 — (23) 算力地板规格 §3.5 "第三方可复核" 的可执行物, 入库版(同 bwin-sim 惯例)。只读。
// 跑(正式): cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-smax/smax-extractor.mjs [--window-s 3600] [--max-blocks (默认 window_s×10×1.1)] [--tol 0.10] [--sleep-ms 20] [--out <dir>] [--dry-run N]
// 测试(离线, 无节点): node docs/provenance/2026-08-27-smax/smax-extractor.test.mjs   (向量 vectors.json, 期望 expected-output.json)
//   退出码: 0 OK / 3 SYNC-GATE / 4 INCOMPLETE_WINDOW(fail-closed, 不出 s_visible_max)
// 🔴 语义(Codex f65c1fbe): 本器输出的是 s_visible_max = 窗内【可见】最大单 coinbase-script 份额 = 对手份额的【下界】(Sybil/共谋令其偏小);
//    它【不是】无假设的对手上界; (23) 规格须另有独立论证的 s_adv_cap ≥ s_visible_max, 无可信 cap ⇒ fail-closed。本器不产 s_adv。
// 逐块归属 = coinbase tx 的 payload 里 miner_data.script_public_key(本块矿工); coinbase 输出地址 = 被 merge 的蓝块矿工集合(仅对照)。
// payload 布局 @7b1e18cc consensus/src/processes/coinbase.rs:150-167 serialize_coinbase_payload(常量 :13-19):
//   [0..8) blue_score u64 LE | [8..16) subsidy u64 LE | [16..18) spk.version u16 LE | [18] spk.script len u8 | [19..19+len) spk.script | 其后 extra_data
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LAYOUT = '@7b1e18cc consensus/src/processes/coinbase.rs:158-163: blue_score u64 LE[0..8) | subsidy u64 LE[8..16) | spk.version u16 LE[16..18) | spk.len u8[18] | spk.script[19..19+len) | extra';
export const BPS = 10;                 // TESTNET12 TenBps (config/params.rs:689-691 @7b1e18cc)
export const TOP_N = 5;

// —— 纯函数(可离线测) ——
export function parseCoinbasePayload(payloadHex) {
  const b = Buffer.from(payloadHex || '', 'hex');
  if (b.length < 19) return { ok: false, err: `payload ${b.length}B < MIN_PAYLOAD_LENGTH 19` };
  const blueScore = b.readBigUInt64LE(0), subsidy = b.readBigUInt64LE(8), spkVersion = b.readUInt16LE(16), spkLen = b.readUInt8(18);
  if (b.length < 19 + spkLen) return { ok: false, err: `payload ${b.length}B < 19+spkLen ${spkLen}` };
  return { ok: true, blueScore: blueScore.toString(), subsidy: subsidy.toString(), spkVersion, spkLen, script: b.subarray(19, 19 + spkLen).toString('hex'), extra: b.subarray(19 + spkLen).toString('hex') };
}
export function serializeCoinbasePayload({ blueScore, subsidy, spkVersion, scriptHex, extraHex = '' }) {
  // 与 coinbase.rs:158-163 同序; 用于合成测试向量
  const script = Buffer.from(scriptHex, 'hex'); const b = Buffer.alloc(19 + script.length);
  b.writeBigUInt64LE(BigInt(blueScore), 0); b.writeBigUInt64LE(BigInt(subsidy), 8); b.writeUInt16LE(spkVersion, 16); b.writeUInt8(script.length, 18); script.copy(b, 19);
  return Buffer.concat([b, Buffer.from(extraHex, 'hex')]).toString('hex');
}
export const minerKey = (p) => `${p.spkVersion}:${p.script}`;   // 归属键 = version+script(ScriptPublicKey 语义)

export function aggregate(blocks) {
  // blocks: [{ header:{hash}, transactions:[ coinbase{ payload, outputs:[{value, verboseData?.scriptPublicKeyAddress | scriptPublicKey?.script}] } ] }]
  const byMiner = new Map(), byOutAddr = new Map(); let parsed = 0, failed = 0; const fails = [];
  for (const blk of blocks) {
    const cb = (blk.transactions || [])[0];
    if (!cb) { failed++; fails.push({ hash: blk.header?.hash, err: 'no tx' }); continue; }
    const p = parseCoinbasePayload(cb.payload || '');
    if (!p.ok) { failed++; fails.push({ hash: blk.header?.hash, err: p.err }); continue; }
    parsed++; const k = minerKey(p); byMiner.set(k, (byMiner.get(k) || 0) + 1);
    for (const o of cb.outputs || []) { const a = o.verboseData?.scriptPublicKeyAddress || o.scriptPublicKey?.script || '?'; byOutAddr.set(a, (byOutAddr.get(a) || 0) + Number(o.value || o.amount || 0)); }
  }
  const total = parsed;
  const shares = [...byMiner.entries()].map(([k, n]) => ({ miner: k, blocks: n, share: +(n / total).toFixed(6) })).sort((a, b) => b.blocks - a.blocks);
  const sumOut = [...byOutAddr.values()].reduce((s, v) => s + v, 0);
  const outShares = [...byOutAddr.entries()].map(([a, v]) => ({ addr: a, value: v, share: sumOut ? +(v / sumOut).toFixed(6) : 0 })).sort((a, b) => b.value - a.value);
  return { parsed, failed, fails: fails.slice(0, 10), s_visible_max: shares[0]?.share ?? null, top: shares.slice(0, TOP_N), distinct_miners: shares.length,
    semantics: 's_visible_max = 窗内可见最大单 coinbase-script 份额 = 对手份额【下界】(Sybil/共谋令其偏小); 非无假设上界, s_adv_cap 须另证(Codex f65c1fbe)',
    control_output_addr: { note: '对照列: coinbase 输出按 value 聚合 = 被本块 merge 的蓝块矿工集合(coinbase.rs:113), 不是逐块归属', s_visible_max_out: outShares[0]?.share ?? null, top: outShares.slice(0, TOP_N) },
    poisson: total ? { blocks: total, rel_sd: +(1 / Math.sqrt(total)).toFixed(6), note: '份额估计的相对标差量级 ≈ 1/√N(块数)' } : null };
}

export function completeness({ tipDaa, startDaa, tipBlue, startBlue, fetched, windowS, tol }) {
  // expected 由【窗两端块的链上计数差】导出(首选 daaScore 差, 备选 blueScore 差), 禁用自身 fetch 计数(循环自证); 名义 window_s×BPS 仅参考
  const daaDelta = Number.isFinite(tipDaa) && Number.isFinite(startDaa) ? tipDaa - startDaa : null;
  const blueDelta = Number.isFinite(tipBlue) && Number.isFinite(startBlue) ? tipBlue - startBlue : null;
  const expected = daaDelta ?? blueDelta;
  const source = daaDelta != null ? 'daaScore_delta(tip−start)' : blueDelta != null ? 'blueScore_delta(tip−start, 只蓝块)' : 'NONE';
  const incomplete = expected == null || fetched < expected * (1 - tol);
  return { expected_blocks: expected, expected_source: source, daa_delta: daaDelta, blue_delta: blueDelta, nominal_bps_ref: windowS != null ? windowS * BPS : null,
    fetched, ratio: expected ? +(fetched / expected).toFixed(3) : null, tol, incomplete, gap_blocks: expected != null ? Math.max(0, expected - fetched) : null,
    note: 'expected 来自链上计数差(非自身 fetch 计数); daaScore 差漏 non-daa 陈块 ⇒ expected 略低=宽松向(已标); 名义 10 BPS 仅参考' };
}

export function decide({ blocks, comp, dry }) {
  if (!dry && comp.incomplete) return { status: 'INCOMPLETE_WINDOW', s_visible_max: null, gap_blocks: comp.gap_blocks, action: 'fail-closed: 不输出 s_visible_max; 调大 --max-blocks 或缩 --window-s 或等 RPC 稳后重跑', exit: 4 };
  return { status: dry ? 'DRY-RUN' : 'OK', ...aggregate(blocks), exit: 0 };
}

// —— 链读(只在 main 里用) ——
async function main() {
  const require = createRequire('file:///D:/kanet-tn12/kasia-console/package.json');
  const { RpcClient, Encoding } = require('kaspa-wasm');
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const WINDOW_S = Number(arg('--window-s', 3600)), TOL = Number(arg('--tol', 0.10)), SLEEP_MS = Number(arg('--sleep-ms', 0));
  const MAX_BLOCKS = Number(arg('--max-blocks', Math.ceil(WINDOW_S * BPS * (1 + TOL))));
  const OUT = arg('--out', 'D:/kanet-tn12/docs/provenance/2026-08-27-smax');
  const DRY = argv.includes('--dry-run') ? Number(arg('--dry-run', 20)) : 0;
  const DAA_FLOOR = 80095687;
  const nap = () => SLEEP_MS > 0 ? new Promise(r => setTimeout(r, SLEEP_MS)) : Promise.resolve();
  const hdrNum = (b, k) => { const v = b?.header?.[k] ?? b?.verboseData?.[k]; return v == null ? null : Number(v); };

  const rpc = new RpcClient({ url: 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId: 'testnet-12' });
  await rpc.connect({ timeoutDuration: 8000 });
  const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore);
  if (!(si.isSynced && daa > DAA_FLOOR) && !DRY) { console.error(`⛔ SYNC-GATE: isSynced=${si.isSynced} daa=${daa} (floor ${DAA_FLOOR}) ⇒ 不出数`); await rpc.disconnect(); process.exit(3); }
  const bd = await rpc.getBlockDagInfo(); const tipHash = bd.tipHashes[0];
  const tipBlk = (await rpc.getBlock({ hash: tipHash, includeTransactions: false })).block; const tipTs = Number(tipBlk.header.timestamp);
  // 选择链回溯到窗起点(与翻页独立)
  const spine = []; let h = tipHash;
  while (spine.length < MAX_BLOCKS && h) {
    const r = await rpc.getBlock({ hash: h, includeTransactions: true }); await nap();
    const blk = r.block; if (tipTs - Number(blk.header.timestamp) > (DRY ? 1e15 : WINDOW_S * 1000)) break;
    spine.push(blk); if (DRY && spine.length >= DRY) break;
    const parents = blk.header.parents?.[0]?.parentHashes || blk.header.parentsByLevel?.[0] || []; h = parents[0];
  }
  const startBlk = spine[spine.length - 1] || tipBlk;
  let blocks;
  if (DRY) blocks = spine;
  else {
    const out = []; const seen = new Set(); let low = startBlk.header.hash;
    while (out.length < MAX_BLOCKS) {
      const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true }); await nap();
      const blks = (r.blocks || []).map(b => b.block || b); if (!blks.length) break;
      for (const b of blks) { if (seen.has(b.header.hash)) continue; seen.add(b.header.hash); out.push(b); }
      const last = r.blockHashes?.[r.blockHashes.length - 1]; if (!last || last === low) break; low = last;
    }
    blocks = out.filter(b => tipTs - Number(b.header.timestamp) <= WINDOW_S * 1000);
  }
  await rpc.disconnect();
  const comp = DRY ? null : completeness({ tipDaa: hdrNum(tipBlk, 'daaScore'), startDaa: hdrNum(startBlk, 'daaScore'), tipBlue: hdrNum(tipBlk, 'blueScore'), startBlue: hdrNum(startBlk, 'blueScore'), fetched: blocks.length, windowS: WINDOW_S, tol: TOL });
  const d = decide({ blocks, comp: comp || { incomplete: false }, dry: !!DRY });
  const out = { mode: DRY ? 'DRY-RUN(绕过 SYNC-GATE, 只看解析形状, 不作证据)' : 'FORMAL', t: new Date().toISOString(), daa, isSynced: si.isSynced, tipHash, tipTs, window_s: DRY ? null : WINDOW_S,
    coverage: DRY ? 'selected-parent 链回溯 ≤N 块(漏非选择链块)' : 'getBlocks 全量翻页(含非选择链块)', blocks_fetched: blocks.length, layout: LAYOUT,
    completeness: comp ? { ...comp, start_block: startBlk.header.hash, start_ts: Number(startBlk.header.timestamp) } : null,
    sample_payloads: blocks.slice(0, 3).map(b => { const cb = (b.transactions || [])[0]; return { hash: b.header.hash, payload_hex: (cb?.payload || '').slice(0, 120), parsed: cb ? parseCoinbasePayload(cb.payload || '') : null }; }),
    ...d };
  const json = JSON.stringify(out, null, 1);
  if (d.exit === 4) { console.error(`⛔ INCOMPLETE_WINDOW: fetched ${blocks.length} < expected ${comp.expected_blocks}×(1−${TOL}) ⇒ 不输出 s_visible_max`); console.log(json); process.exit(4); }
  if (!DRY) { mkdirSync(OUT, { recursive: true }); const f = `${OUT}/smax-${out.t.replace(/[:.]/g, '-')}.json`; writeFileSync(f, json); console.log(`wrote ${f} sha256=${createHash('sha256').update(json).digest('hex')}`); }
  console.log(json);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^([a-z]):/i, (m, d) => d.toUpperCase() + ':')) {
  main().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
} else if (process.argv[1] && process.argv[1].endsWith('smax-extractor.mjs')) {
  main().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
}
