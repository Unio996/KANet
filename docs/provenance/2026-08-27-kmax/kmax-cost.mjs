// (21) v0.8 · k_max 绝对成本表工具 — 入库 durable 版(同 (24)/(27) 法)。只读 RPC。v0.8: 加 D-STAT-1/2 纯函数块(lambdaUb Garwood 上括号 / Chernoff 上轨 / 夹逼+精确向量自检 / nMin / hVisUb 硬闸), 只加不改, main 与三估计器路径未动。
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

// ===== (21) v0.8 · D-STAT-1/2 (Codex 280 d7fefb58 设计层 CLOSED) · 纯函数, 只加不改 =====
// 语义: λ_ub(n) = 泊松单侧 1−α 上置信界(Garwood ½χ²_{1−α}(2n+2)); 实现 = 泊松 CDF 对数域二分, 【返回上括号 hi】⇒ impl ≥ 精确(零静默欠射, Codex 验收项)。
//   可证上轨 Chernoff: (√(L/2)+√(L/2+n))², L=ln(1/α) (泊松下尾 P(X≤λ−t)≤exp(−t²/2λ)); 高斯 n+z√n 只作夹逼【下轨】, 任何 n 都欠覆盖, 绝不作闸值。
//   nMin(δ) = 最小整数 n 使 λ_ub(n)/n − 1 ≤ δ (D-STAT-2 机械样本闸; δ_max=5% ⇒ 4,000 取整)。
//   hVisUb = λ_ub(n) · w_cap_window / (t1−t0) 并带硬闸 W<3600 s ∨ n<4000 ∨ 无 w_cap ⇒ H_vis_ub=null(回 (a-total)); w_cap_window 重建器等 Codex 281, 先参数注入。
//   selfCheck(): 精确对照向量(n=0/10/30/100/1000/36000)+夹逼断言, 任一不过 ⇒ throw ⇒ 调用方非零退出(fail-closed); hVisUb 首次调用强制跑。
export const DSTAT_VERSION = 'dstat/1';
export const ALPHA = 1e-3;
export const W_MIN_S = 3600;       // (23) v0.11 abda09f3 运营最小窗
export const N_MIN = 4000;         // (23) v0.12 0e123323: Garwood + δ_max=5% ⇒ 3,974 向上取整
export const DELTA_MAX = 0.05;
export const GAUSS_Z = 3.0902;     // 单侧 99.9% 正态分位, 只作夹逼下轨
export const GARWOOD_EXACT_REF = { 0: 6.907755, 10: 24.133971, 30: 51.083124, 100: 134.924319, 1000: 1101.626944, 36000: 36590.189486 }; // Codex 280 独立复算 0.5·chi2.ppf(0.999, 2n+2)
export const GARWOOD_REF_TOL = 1e-5; // 参考值 6 位小数 ⇒ |impl−ref| ≤ 1e-5; impl ≥ 精确由二分上括号保证
export function logPoissonCdf(n, lam) {           // log P(X ≤ n | λ), 对数域稳定求和
  if (!(lam > 0)) return n >= 0 ? 0 : -Infinity;
  let logp = -lam, logs = logp;
  for (let k = 1; k <= n; k++) { logp += Math.log(lam / k); const m = Math.max(logs, logp); logs = m + Math.log(Math.exp(logs - m) + Math.exp(logp - m)); }
  return logs;
}
export function lambdaUb(n, alpha = ALPHA, iters = 100) {
  if (!Number.isInteger(n) || n < 0) throw new Error('lambdaUb: n must be a non-negative integer');
  const la = Math.log(alpha); let lo = n, hi = n + 20 * Math.sqrt(n + 1) + 50;   // 不变量: cdf(lo) > α (λ 偏小), cdf(hi) ≤ α
  if (!(logPoissonCdf(n, hi) <= la)) throw new Error('lambdaUb: initial hi bracket too small');
  for (let i = 0; i < iters; i++) { const mid = (lo + hi) / 2; if (mid <= lo || mid >= hi) break; if (logPoissonCdf(n, mid) > la) lo = mid; else hi = mid; }
  return hi;                                        // 上括号: 满足 P(X≤n|hi) ≤ α ⇒ hi ≥ 精确 Garwood
}
export const lambdaUbChernoff = (n, alpha = ALPHA) => { const L = Math.log(1 / alpha); return (Math.sqrt(L / 2) + Math.sqrt(L / 2 + n)) ** 2; };
export const lambdaUbGaussRail = (n) => n + GAUSS_Z * Math.sqrt(n);   // 仅下轨, 非闸值
export function bracketCheck(n, alpha = ALPHA, implFn = lambdaUb) {   // implFn 只供测试注入坏实现(v0.8 fix-up), 生产路径恒为 lambdaUb
  const impl = implFn(n, alpha), lo = lambdaUbGaussRail(n), hi = lambdaUbChernoff(n, alpha);
  const ref = GARWOOD_EXACT_REF[n]; const refOk = ref == null ? null : Math.abs(impl - ref) <= GARWOOD_REF_TOL && impl >= ref - 1e-6;
  return { n, impl: +impl.toFixed(6), gauss_rail: +lo.toFixed(6), chernoff_rail: +hi.toFixed(6), bracket_ok: lo <= impl && impl <= hi, ref, ref_ok: refOk, ok: (lo <= impl && impl <= hi) && refOk !== false };
}
let _selfCheck = null;   // 只缓存【成功】结果; 失败永不缓存 ⇒ 每次调用都重跑、都 throw(NWT v0.8 审: 缓存失败 = fail-closed 机制自身 fail-open)
export function selfCheck({ implFn = lambdaUb } = {}) {
  const injected = implFn !== lambdaUb;                 // 测试注入坏实现时永不读/写缓存
  if (!injected && _selfCheck) return _selfCheck;
  const rows = Object.keys(GARWOOD_EXACT_REF).map(Number).map(n => bracketCheck(n, ALPHA, implFn));
  const sweep = []; for (let n = 0; n <= 200; n++) { const r = bracketCheck(n, ALPHA, implFn); if (!r.bracket_ok) sweep.push(n); }
  const ok = rows.every(r => r.ok) && sweep.length === 0;
  const result = { ok, rows, sweep_0_200_bracket_failures: sweep };
  if (!ok) throw new Error('DSTAT_SELFCHECK_FAIL ' + JSON.stringify({ ok, failed_rows: rows.filter(r => !r.ok).map(r => r.n), sweep_failures: sweep.length }));
  if (!injected) _selfCheck = result;
  return result;
}
export function nMin(delta = DELTA_MAX, alpha = ALPHA) {           // 最小整数 n: λ_ub(n)/n − 1 ≤ δ
  let lo = 1, hi = 200000; if (!(lambdaUb(hi, alpha) / hi - 1 <= delta)) throw new Error('nMin: δ too small for search bound 2e5');
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lambdaUb(m, alpha) / m - 1 <= delta) hi = m; else lo = m; }
  return hi;
}
export function hVisUb({ n, wCapWindow, t0Ms, t1Ms, alpha = ALPHA }) {
  selfCheck();
  const W_s = (Number(t1Ms) - Number(t0Ms)) / 1000;
  const gate = { W_ok: W_s >= W_MIN_S, n_ok: Number.isInteger(n) && n >= N_MIN, w_cap_ok: Number.isFinite(Number(wCapWindow)) && Number(wCapWindow) > 0 };
  const reasons = [!gate.W_ok && 'W_MIN', !gate.n_ok && 'N_MIN', !gate.w_cap_ok && 'NO_W_CAP'].filter(Boolean);
  if (reasons.length) return { H_vis_ub: null, lambda_ub: null, n, W_s, w_cap_window: wCapWindow ?? null, gate, reason: reasons.join('+'), fallback: '(a-total) min(1, H_adv_cap/H_total_lb)' };
  const lam = lambdaUb(n, alpha);
  return { H_vis_ub: lam * Number(wCapWindow) / W_s, lambda_ub: +lam.toFixed(6), n, W_s, w_cap_window: Number(wCapWindow), gate, reason: null, fallback: null, note: 'w_cap_window 由参数注入((23) v0.13 层1 重建器待 Codex 281); 单位 = 每块 work(与 calc_work 同), H_vis_ub = work/s' };
}

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
