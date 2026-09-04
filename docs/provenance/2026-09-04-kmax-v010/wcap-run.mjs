// (24)/(21) v0.10.1 · 真 RPC 跑手(只读, 不改任何状态) —— 步 0 READY 后由 Bettor 派; 输出 fetch-evidence-<UTC>.json(runCycle 全量 + 四闸证据 + hVisUbFromEvidence PROVISIONAL)
// 跑: cd /d/kanet-tn12/kasia-console && node ../docs/provenance/2026-09-04-kmax-v010/wcap-run.mjs --out <dir> [--wait-s 3600] [--sleep-ms 50] [--depth0 62440] [--json]
//   v0.10.1(NWT MUST-1/2/3 + SHOULD-1, 2026-09-04): --out 必传(缺 ⇒ 退出码 1 打 usage, 证据不得静默落仓外); 仓根由本文件位置向上找 kasia-console/package.json 解析, 不写死盘符; 注释默认值与代码对齐
//   SYNC-GATE: isSynced ∧ daa > 80,095,687 否则退出码 3 不取块(绝不连 IBD 节点); 退出码 0 = 出证据(H_vis_ub 可为 null, 看 reason); 1 = 脚本错
//   节奏: 两次轮询之间等 --wait-s(默认 3600 = W_min); 每页 getBlocks 之间 --sleep-ms(默认 50 且自适应, 见 :14; 错峰 (17) ③b); 62,440 蓝分 ≈ 251 页 × 2 次轮询 × 2(G1 二次拉取) ≈ 1000 次 getBlocks
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { runCycle, DAA_FLOOR } from './wcap-fetch.mjs';
import { hVisUbFromEvidence } from './kmax-cost.mjs';

const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const WAIT_S = Number(arg('--wait-s', 3600)), SLEEP_MS = Number(arg('--sleep-ms', 50)), DEPTH0 = Number(arg('--depth0', 36000 + 26440));   // ④ 默认 50 ms 且自适应: 实际 sleep = max(SLEEP_MS, 上次 getBlocks 延迟 × 0.5)(与 console/llama 同机争用时自动放慢)
const VANTAGE = arg('--vantage', 'single-node-da9');
console.error('[③f 前置提醒] 须由派工闸保证: (17) ③d 3600 s 窗已跑完 ∧ ③b 采样器无新 err; 本跑手只读、PROVISIONAL、四闸未闭不喂入场闸; vantage=' + VANTAGE);
const OUT = arg('--out', null); const JSON_ONLY = argv.includes('--json');
if (!OUT) { console.error('usage: node wcap-run.mjs --out <dir> [--wait-s 3600] [--sleep-ms 50] [--depth0 62440] [--json]\n  --out 必传: 证据 JSON 落点须显式给出(不默认落 gitignored 目录)'); process.exit(1); }
// 仓根: 从本文件所在目录向上找含 kasia-console/package.json 的目录(docs/provenance/<dir>/ 或 scratch/<dir>/ 都能解析; 不写死 D:/kanet-tn12)
const REPO_ROOT = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (let i = 0; i < 6; i++) { if (existsSync(join(d, 'kasia-console', 'package.json'))) return d; const up = resolve(d, '..'); if (up === d) break; d = up; } throw new Error('REPO_ROOT not found from ' + import.meta.url); })();
const require = createRequire(join(REPO_ROOT, 'kasia-console', 'package.json'));
const { RpcClient, Encoding } = require('kaspa-wasm');
const rpc = new RpcClient({ url: 'ws://127.0.0.1:17210', encoding: Encoding.Borsh, networkId: 'testnet-12' });
const targetCommit = (() => { try { return execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim(); } catch { return null; } })();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 分页节奏: 包一层 getBlocks 加 sleep(不改 fetchForward 语义); 自适应 pause = min(max(SLEEP_MS, 上次延迟×0.5), 2000)——有上界(NWT 复审): 病态慢节点也不把 ~1000 页拖成小时级
const paced = { calls: { getBlocks: 0, getBlock: 0, getBlockDagInfo: 0 },
  getServerInfo: () => rpc.getServerInfo(), getBlockDagInfo: () => { paced.calls.getBlockDagInfo++; return rpc.getBlockDagInfo(); },
  getBlock: (q) => { paced.calls.getBlock++; return rpc.getBlock({ hash: q.hash, includeTransactions: false }); },
  lastLatencyMs: 0,
  getBlocks: async (q) => { paced.calls.getBlocks++; const pause = Math.min(Math.max(SLEEP_MS, paced.lastLatencyMs * 0.5), 2000); if (pause > 0) await sleep(pause); const t0 = Date.now(); const res = await rpc.getBlocks({ lowHash: q.lowHash, includeBlocks: true, includeTransactions: false }); paced.lastLatencyMs = Date.now() - t0; return res; } };
(async () => {
  await rpc.connect({ timeoutDuration: 8000 });
  const si = await rpc.getServerInfo(); const daa = Number(si.virtualDaaScore);
  if (!si.isSynced || !(daa > DAA_FLOOR)) { console.error(`⛔ SYNC-GATE: isSynced=${si.isSynced} daa=${daa} (floor ${DAA_FLOOR}) ⇒ 不取块`); await rpc.disconnect(); process.exit(3); }
  const t = new Date(); const clock = () => Date.now();
  const r = await runCycle(paced, { params: {}, clock, waitFn: () => sleep(WAIT_S * 1000), depth0: DEPTH0, daaFloor: DAA_FLOOR, syncGate: true, vantage: VANTAGE, fetchOpts: { maxRetries: 3, maxResumes: 2 } });
  await rpc.disconnect();
  const ev = { schema_version: 'fetch-evidence/1', t: t.toISOString(), target_commit: targetCommit, rpc: { url: 'ws://127.0.0.1:17210', network: 'testnet-12', live_binary_commit: '7b1e18cc' }, cli_args: argv, daa_at_start: daa, wait_s: WAIT_S, sleep_ms: SLEEP_MS, depth0: DEPTH0,
    wCapWindow: r.wCapWindow, w_cap_window: r.w_cap_window, certificate: r.certificate, reason: r.reason, S_size: r.S_size, arrivalWindow: r.arrivalWindow, n_arrivals: r.n_arrivals, sum_work: r.sum_work, arrivals: r.arrivals, evidence: r.evidence, attempts: r.attempts, anchor: r.anchor, same_window_object: r.same_window_object, rpc_calls: paced.calls };
  ev.hvis = hVisUbFromEvidence(ev);
  const json = JSON.stringify(ev, null, 1); const sha = createHash('sha256').update(json).digest('hex');
  mkdirSync(OUT, { recursive: true }); const f = `${OUT}/fetch-evidence-${t.toISOString().replace(/[:.]/g, '-')}.json`; writeFileSync(f, json); console.log(`wrote ${f} sha256=${sha}`);
  if (JSON_ONLY) console.log(json); else console.log(`cert=${r.certificate?.kind} missing=${r.certificate?.missing} wCap=${r.wCapWindow} n=${r.n_arrivals} W=${r.arrivalWindow ? (r.arrivalWindow.t1Ms - r.arrivalWindow.t0Ms) / 1000 : null}s G1=${r.evidence?.G1_pagination_complete_deterministic?.pass} G2=${r.evidence?.G2_closure?.pass} G3=${r.evidence?.G3_missing_or_truncated_is_inexact?.pass} G4=${r.evidence?.G4_same_arrival_window?.pass} vantage=${r.evidence?.vantage} retries=${r.evidence?.retries_total} resumed=${r.evidence?.resumed_from?.length} B(exact=${r.evidence?.G5_bits_selfcheck?.exact_windows} checked=${r.evidence?.G5_bits_selfcheck?.checked} mismatch=${r.evidence?.G5_bits_selfcheck?.mismatch} skipped_inexact=${r.evidence?.G5_bits_selfcheck?.skipped_inexact} skipped_no_bits=${r.evidence?.G5_bits_selfcheck?.skipped_no_bits}) attempts=${r.attempts?.length} ⇒ H_vis_ub=${ev.hvis.H_vis_ub} reason=${ev.hvis.reason} (PROVISIONAL, 四闸未闭不喂入场闸)`);
})().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
