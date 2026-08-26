// (21) v0.5 · k_max 绝对成本表工具 — 入库 durable 版(同 (24)/(27) 法)。只读 RPC。
// 跑(正式, 同步后): cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-08-27-kmax/kmax-cost.mjs [--window 1000] [--law3-window-s 600] [--sleep-ms 20] [--json] [--out <dir>]
// 测试(离线, 无节点): node docs/provenance/2026-08-27-kmax/kmax-cost.test.mjs   (向量 vectors.json, 期望 expected-output.json)
//   退出码: 0 OK / 3 SYNC-GATE / 1 脚本错
// 公式与坐标(全 git show 7b1e18cc:<path>, 非工作树 90dbf074):
//   target = from_compact_target_bits(bits)                        math/src/lib.rs:64-80 (mant = bits & 0xFFFFFF, expt = 8×(bits>>24 − 3); mant > 0x7FFFFF ⇒ 0)
//   compact_target_bits(target) 反向                                  math/src/lib.rs:83-97
//   work_per_block = 2^256 / (target + 1)                              consensus/src/processes/difficulty.rs:261-267 calc_work
//   H1 = work_per_block × BPS (法1, TenBps=10)                         consensus/core/src/config/params.rs:669-696 TESTNET12_PARAMS
//   H2 = estimateNetworkHashesPerSecond(window) (法2, Δblue_work/Δt)   consensus/src/processes/difficulty.rs:46-67; rpc/service/src/service.rs:954-972; MAX_SAFE_WINDOW_SIZE=10,000 @ rpc/core/src/api/rpc.rs:16
//   H3 = 墙钟窗 [t−W,t] 内(按块时间戳)块数/W × work_per_block (法3 瞬时估, 对齐 (23) v0.6; W ≫ 132 s, 默认 600 s)
//   决策值 H_net = min(可用法) ((21) v0.2 NWT: 不高估 H_net); v0.5: 只有法1 ⇒ PROVISIONAL_OVERESTIMATE(陈难度, 算力跌后过估 = 危险向) 不作 firm 输入; 两法相差 >2× ⇒ 喂 (23) 入场闸时 = 环境违约 ⇒ gate_input=FAIL_CLOSED(不是取 min 硬用)
//   difficulty_ratio = MAX_DIFFICULTY_TARGET_AS_F64 / target 须 ≈ getBlockDagInfo.difficulty   rpc/service/src/converter/consensus.rs:49-56; consensus/core/src/config/constants.rs:44 (=2^255−1, 5.78960446186581e76)
//   H_adv_implied(k) = (k − 1) × H_floor ((23) H_floor_min = H_adv/(k_baked−1) 反读); 折卡 = H_adv_implied / H_device
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

export const SCHEMA_VERSION = 'kmax-cost/5';
export const BPS = 10;
export const MAX_TARGET_F64 = 5.78960446186581e76;   // consensus/core/src/config/constants.rs:44
export const MAX_SAFE_WINDOW_SIZE = 10000;           // rpc/core/src/api/rpc.rs:16
export const DAA_FLOOR = 80095687;
// 设备参考算力 UNVERIFIED-SOURCED(WebSearch 2026-08-27, (21) v0.3 §3), 档 A 厂商官方 / B 聚合站 / C 社区·估值
// 单位: H1/H2/H3 与设备档同为 kHeavyHash H/s(4090 2.0 GH/s → 2.0e9); 折算只用 kHeavyHash 专属实测/标称档(A/B), C 档估值只列不折
export const DEVICES = [
  { name: 'RTX 4090 (GPU)', hps: 2.0e9, tier: 'B', src: 'WhatToMine KAS/4090 2.00 GH/s @240W (2026-08-27)' },
  { name: 'RTX 5090 (GPU, 估)', hps: 4.0e9, tier: 'C', src: '无 kHeavyHash 公开数; 按 4090 ×2 估(2026-08-27)', fold: false },
  { name: 'IceRiver KS3M (ASIC)', hps: 6.0e12, tier: 'A', src: 'IceRiver 官方 6 TH/s @3400W (2026-08-27)' },
  { name: 'Bitmain KS5 Pro (ASIC)', hps: 2.1e13, tier: 'B', src: 'ASIC Miner Value / Zeus 21 TH/s @3150W (2026-08-27)' },
];
export const KS = [10, 100, 1000];
const TWO256 = 1n << 256n;

// —— 纯函数(可离线测; 镜像 7b1e18cc 算法) ——
export function targetFromBits(bits) {
  bits = Number(bits) >>> 0;
  const unshifted = bits >>> 24;
  let mant, expt;
  if (unshifted <= 3) { mant = (bits & 0xFFFFFF) >>> (8 * (3 - unshifted)); expt = 0; } else { mant = bits & 0xFFFFFF; expt = 8 * (unshifted - 3); }
  if (mant > 0x7FFFFF) return 0n;                           // "mantissa is signed but may not be negative" ⇒ ZERO
  return BigInt(mant) << BigInt(expt);
}
export function compactTargetBits(target) {
  target = BigInt(target); if (target === 0n) return 0;
  const bitlen = target.toString(2).length; let size = Math.ceil(bitlen / 8);
  let compact = size <= 3 ? Number(target << BigInt(8 * (3 - size))) : Number((target >> BigInt(8 * (size - 3))) & 0xFFFFFFFFn);
  if (compact & 0x00800000) { compact >>>= 8; size += 1; }
  return (compact | (size << 24)) >>> 0;
}
export const workPerBlock = (target) => TWO256 / (BigInt(target) + 1n);   // calc_work
export const hNetFromBits = (bits) => Number(workPerBlock(targetFromBits(bits))) * BPS;
export const difficultyRatio = (bits) => MAX_TARGET_F64 / Number(targetFromBits(bits));
export function law3FromBlocks(blocks, tipTs, windowS, target) {
  // 法3 瞬时估: [tipTs−W, tipTs] 内按块【时间戳】计块数 / W × work_per_block(该窗末 target); W ≫ 132 s(戳操纵放大上界 132/W)
  const n = blocks.filter(b => { const ts = Number((b.header || b).timestamp); return ts >= tipTs - windowS * 1000 && ts <= tipTs; }).length;
  return { H3: n / windowS * Number(workPerBlock(target)), blocks_in_window: n, window_s: windowS, stamp_bias_bound: +(132 / windowS).toFixed(4) };
}
export function decideHNet({ h1, h2, h3 }) {
  // v0.5: 决策值 = min(可用法); 只有法1 ⇒ PROVISIONAL_OVERESTIMATE(不作 firm 输入); 可用法相差 >2× ⇒ 表内仍 min 但 gate_input=FAIL_CLOSED(环境违约, 测量不可靠)
  const laws = [['law1', h1], ['law2', h2], ['law3', h3]].filter(([, v]) => v != null && Number.isFinite(v) && v > 0);
  if (!laws.length) return { H_net: null, source: 'none', available: [], gate_input: 'FAIL_CLOSED', note: '无可用法' };
  const [minName, minV] = laws.reduce((a, b) => (b[1] < a[1] ? b : a));
  const maxV = Math.max(...laws.map(([, v]) => v)); const ratio = +(maxV / minV).toFixed(3);
  if (laws.length === 1 && laws[0][0] === 'law1') return { H_net: h1, source: 'law1_only', available: ['law1'], ratio: null, gate_input: 'PROVISIONAL_OVERESTIMATE', note: '只有法1(陈难度): 算力跌后过估 H_net ⇒ 攻击成本看着更贵/地板入场太易 = 危险向; 不许作 (23) firm 输入' };
  if (ratio > 2) return { H_net: minV, source: minName, available: laws.map(([n]) => n), ratio, gate_input: 'FAIL_CLOSED', note: '可用法相差 >2×(tip bits 陈/窗内停滞/戳塞): 成本表内仍取 min 作参考, 但喂 (23) 入场闸 = 环境违约(测量不可靠) ⇒ fail-closed 不入场, 非取 min 硬用' };
  return { H_net: minV, source: minName, available: laws.map(([n]) => n), ratio, gate_input: 'OK', note: null };
}
export const clampWindow = (w) => ({ window: Math.min(Math.max(1000, w), MAX_SAFE_WINDOW_SIZE), clamped: w > MAX_SAFE_WINDOW_SIZE || w < 1000, note: w > MAX_SAFE_WINDOW_SIZE ? `window ${w} > MAX_SAFE_WINDOW_SIZE ${MAX_SAFE_WINDOW_SIZE} (unsafe_rpc=false 拒) ⇒ 夹到上限` : w < 1000 ? 'window < MIN_WINDOW_SIZE 1000 (difficulty.rs:48) ⇒ 夹到 1000' : null });
export const hAdvImplied = (k, hFloor) => (k - 1) * hFloor;
export function foldToDevices(hNeed, devices = DEVICES) { return Object.fromEntries(devices.map(d => [d.name, d.fold === false ? { units: null, tier: d.tier, note: 'C 档估值只列不折(非 kHeavyHash 专属实测)' } : { units: +(hNeed / d.hps).toFixed(3), tier: d.tier }])); }
export function costTable(hNet, ks = KS, devices = DEVICES) { return ks.map(k => ({ k, H_adv_implied: hAdvImplied(k, hNet), devices: foldToDevices(hAdvImplied(k, hNet), devices) })); }

// —— 链读(只在 main 里用) ——
async function main() {
  const require = createRequire('file:///D:/kanet-tn12/kasia-console/package.json');
  const { RpcClient, Encoding } = require('kaspa-wasm');
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const win = clampWindow(Number(arg('--window', 1000))); const W3 = Number(arg('--law3-window-s', 600)); const SLEEP_MS = Number(arg('--sleep-ms', 20));
  const nap = () => SLEEP_MS > 0 ? new Promise(r => setTimeout(r, SLEEP_MS)) : Promise.resolve();
  const OUT = arg('--out', 'D:/kanet-tn12/docs/provenance/2026-08-27-kmax'); const JSON_ONLY = argv.includes('--json');
  const targetCommit = (() => { try { return execSync('git rev-parse HEAD', { cwd: 'D:/kanet-tn12' }).toString().trim(); } catch { return null; } })();
  const rpc = new RpcClient({ url: 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId: 'testnet-12' });
  await rpc.connect({ timeoutDuration: 8000 });
  const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore);
  if (!si.isSynced || !(daa > DAA_FLOOR)) { console.error(`⛔ SYNC-GATE: isSynced=${si.isSynced} daa=${daa} (floor ${DAA_FLOOR}) ⇒ 不出数`); await rpc.disconnect(); process.exit(3); }
  const bd = await rpc.getBlockDagInfo(); const tipHash = bd.tipHashes[0];
  const blk = (await rpc.getBlock({ hash: tipHash, includeTransactions: false })).block; const bits = Number(blk.header.bits);
  const h1 = hNetFromBits(bits); let h2 = null, hErr = null;
  try { const r = await rpc.estimateNetworkHashesPerSecond({ windowSize: win.window, startHash: undefined }); h2 = Number(r.networkHashesPerSecond); } catch (e) { hErr = String(e.message || e); }
  // 法3: 选择链回溯到窗起点, getBlocks 全量翻页, 按块时间戳计数
  const tipTs = Number(blk.header.timestamp); let l3 = null, l3Err = null;
  try {
    let h = tipHash; const spine = [];
    while (h && spine.length < W3 * BPS * 2) { const r = await rpc.getBlock({ hash: h, includeTransactions: false }); await nap(); const b = r.block; if (tipTs - Number(b.header.timestamp) > W3 * 1000) break; spine.push(b); const par = b.header.parents?.[0]?.parentHashes || b.header.parentsByLevel?.[0] || []; h = par[0]; }
    const start = spine[spine.length - 1] || blk; const seen = new Set(); const all = []; let low = start.header.hash;
    for (let i = 0; i < 200; i++) { const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: false }); await nap(); const bs = (r.blocks || []).map(x => x.block || x); if (!bs.length) break; for (const b of bs) { if (!seen.has(b.header.hash)) { seen.add(b.header.hash); all.push(b); } } const last = r.blockHashes?.[r.blockHashes.length - 1]; if (!last || last === low) break; low = last; }
    l3 = law3FromBlocks(all, tipTs, W3, targetFromBits(bits));
  } catch (e) { l3Err = String(e.message || e); }
  await rpc.disconnect();
  const d = decideHNet({ h1, h2, h3: l3?.H3 ?? null });
  const out = { schema_version: SCHEMA_VERSION, t: new Date().toISOString(), target_commit: targetCommit, rpc: { url: 'ws://127.0.0.1:17210', network: 'testnet-12', live_binary_commit: '7b1e18cc' }, cli_args: argv, daa, tipHash, bits, bits_hex: '0x' + bits.toString(16), target: targetFromBits(bits).toString(), bits_roundtrip_ok: compactTargetBits(targetFromBits(bits)) === bits,
    difficulty_rpc: Number(bd.difficulty), difficulty_ratio_calc: difficultyRatio(bits), work_per_block: workPerBlock(targetFromBits(bits)).toString(),
    H1_from_bits_Hs: h1, H2_estimate_Hs: h2, estimate_err: hErr, window: win, H3_law3: l3, law3_err: l3Err, decision: d, table: d.H_net ? costTable(d.H_net) : null, devices: DEVICES, units: 'kHeavyHash H/s (H1/H2/H3 与设备档同单位; C 档估值不折)',
    note: 'H_adv_implied(k) = (k−1)×H_net = 对手要达到 k 倍须注入的算力; 折卡按 UNVERIFIED-SOURCED 设备档 A/B/C; 判据见 (21) v0.3 §5(CAPEX vs VaR)' };
  const json = JSON.stringify(out, null, 1); const sha = createHash('sha256').update(json).digest('hex');
  mkdirSync(OUT, { recursive: true }); const f = `${OUT}/kmax-${out.t.replace(/[:.]/g, '-')}.json`; writeFileSync(f, json); console.log(`wrote ${f} sha256=${sha}`);
  if (JSON_ONLY) console.log(json); else console.log(`daa=${daa} bits=0x${bits.toString(16)} H1=${h1.toExponential(3)} H2=${h2 == null ? 'ERR ' + hErr : h2.toExponential(3)} ⇒ H_net(min)=${d.H_net.toExponential(3)} [${d.source}]\n` + out.table.map(r => `k=${r.k}: H_adv_implied=${r.H_adv_implied.toExponential(2)} ` + Object.entries(r.devices).map(([n, v]) => `${n}=${v.units}`).join(' | ')).join('\n'));
}
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('kmax-cost.mjs')) main().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
