// sim-actions.mjs — oracle simnet e2e 操作脚本(只对隔离 simnet console 127.0.0.1:3298 + run 目录里的库)。每个动作追加到 evidence/actions.jsonl(格式同 9-4: {at, action, ...})。
// 复用: harness-lib(真校验 + 真 genesis artifacts + ensureMarketPending)、repo 的 freezeMarket、9-4 的 e2e.mjs(status / log)。不读不打印密钥(env 文件只载入本进程)。
// 命令:
//   create <arm>                         按 ARMS 表建判定题市场并把该臂的场景条目写进 scenario.json
//   bet <arm|marketId> <0|1> <amount>    HTTP 下注(判定题带 side_label: side_map yes→1 / no→0)
//   scenario '<json>'                    把补丁合并进 scenario.json(版本号 +1; 热切换上游)
//   freeze <arm>                         应急冻结(F 臂): 读节点 pmt 作 clock, 记前后读数
//   pmt                                  读节点 pastMedianTime / 墙钟差 / isSynced
//   snapshot <label>                     拷贝库(db + wal + shm)到 evidence/snapshots/<label>/
//   arms                                 打印 arms.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const RUN = 'D:/kanet-tn12/scratch/_j2_f1adv_run';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_e2e';
const EVD = `${RUN}/evidence`; fs.mkdirSync(EVD, { recursive: true });
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
process.env.E2E_REPO_KC = `${WT}/kasia-console`;
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_j2_f1adv_run')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
const BASE = 'http://127.0.0.1:3299';
const state = JSON.parse(fs.readFileSync(`${RUN}/state.json`, 'utf8'));
const now = () => new Date().toISOString();
const rec = (o) => fs.appendFileSync(`${EVD}/actions.jsonl`, JSON.stringify({ at: now(), ...o }) + '\n');
const armsFile = `${RUN}/arms.json`; const readArms = () => (fs.existsSync(armsFile) ? JSON.parse(fs.readFileSync(armsFile, 'utf8')) : {});
const resolveId = (x) => readArms()[x] || x;
const MIN = 60_000;
// 各臂参数(相对"创建时刻"的分钟数)。event / condition 唯一; gamma: prices 决定 uma 票(YES=['1','0'] / NO=['0','1'])。
export const ARMS = {
  H: { event: 9101, oeMin: 16, dMin: 26, espn: { state: 'final' }, gamma: ['1', '0'] },
  D: { event: 9102, oeMin: 16, dMin: 26, espn: { state: 'final' }, gamma: ['0', '1'] },
  A: { event: 9103, oeMin: 16, dMin: 26, espn: { state: 'final', home: 'MIA', away: 'NYK' }, gamma: ['1', '0'], predicate: { metric: 'margin', op: '>=', operand: 55, scale: 1, subject: 'LAL' } },
  T: { event: 9104, oeMin: 16, dMin: 26, espn: { state: 'in' }, gamma: ['1', '0'] },
  F: { event: 9105, oeMin: 16, dMin: 26, espn: { state: 'final' }, gamma: ['1', '0'] },
  P: { event: 9106, oeMin: 16, dMin: 26, espn: { state: 'final' }, gamma: ['0', '1'] },
  L: { event: 9107, oeMin: 80, dMin: 10, espn: { state: 'final' }, gamma: ['1', '0'] },
  S: { event: 9108, oeMin: 3000, dMin: 3060, espn: { state: 'final' }, gamma: ['1', '0'] },   // 哨兵: 走真路由(不在本脚本创建), 仅占位事件
  // F1 对抗重跑(账本1621③, J2 2026-09-22): 沿用 F 臂已验证的定时(oeMin/dMin), 换新 event id 防与旧批 scenario 撞键。
  FZ2: { event: 9203, oeMin: 20, dMin: 35, espn: { state: 'final' }, gamma: ['1', '0'] },
  PC2: { event: 9204, oeMin: 20, dMin: 35, espn: { state: 'final' }, gamma: ['1', '0'] },
};
const patchScenario = (patch) => { const f = `${RUN}/scenario.json`; const cur = JSON.parse(fs.readFileSync(f, 'utf8')); const next = { version: (cur.version || 0) + 1, espn: { ...cur.espn, ...(patch.espn || {}) }, polymarket: { ...cur.polymarket, ...(patch.polymarket || {}) } }; fs.writeFileSync(f, JSON.stringify(next)); return next; };
const espnEntry = (o) => ({ state: 'final', home: 'LAL', away: 'BOS', homeScore: 110, awayScore: 100, homeWins: true, ...o });
const wasm = () => createRequire(`${WT}/kasia-relay/`)('kaspa-wasm');
async function nodeInfo() { const { RpcClient, Encoding } = wasm(); const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({}); const info = await rpc.getServerInfo(); const dag = await rpc.getBlockDagInfo(); await rpc.disconnect().catch(() => {}); return { isSynced: info.isSynced, virtualDaaScore: String(info.virtualDaaScore), pmtMs: Number(dag.pastMedianTime), wallMs: Date.now() }; }
const lib = (rel) => import(pathToFileURL(`${WT}/kasia-console/src/${rel}`).href);
async function api(method, url, body) { const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; } return { status: r.status, json }; }

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (cmd === 'create') {
  const cfg = ARMS[a1]; if (!cfg || a1 === 'S') { console.error('未知 / 非 harness 臂: ' + a1); process.exit(2); }
  const arms = readArms(); if (arms[a1]) { console.error(`臂 ${a1} 已存在: ${arms[a1]}`); process.exit(3); }
  const h = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_e2e/harness-lib.mjs').href);
  const t = Date.now(); const oeMs = t + cfg.oeMin * MIN, dMs = t + cfg.dMin * MIN;
  const cond = h.condOf(cfg.event);
  patchScenario({ espn: { [cfg.event]: espnEntry(cfg.espn) }, polymarket: { [cond]: { prices: cfg.gamma } } });
  const r = await h.createJudgedMarket({ tokenId: state.tokenId, title: `e2e ${a1}`, deadlineMs: dMs, outcomeEndMs: oeMs, spec: h.mkSpec({ event: cfg.event, ...(cfg.predicate ? { predicate: cfg.predicate } : {}) }), conditionId: cond });
  arms[a1] = r.id; fs.writeFileSync(armsFile, JSON.stringify(arms, null, 1));
  rec({ action: 'market_create_harness', arm: a1, marketId: r.id, oeMs, oeIso: new Date(oeMs).toISOString(), deadlineMs: dMs, deadlineIso: new Date(dMs).toISOString(), event: cfg.event, condition: cond, scenarioEspn: cfg.espn, gammaPrices: cfg.gamma });
  console.log(JSON.stringify({ arm: a1, id: r.id, oe: new Date(oeMs).toISOString(), deadline: new Date(dMs).toISOString() }));
} else if (cmd === 'bet') {
  const id = resolveId(a1); const dir = Number(a2), amount = Number(a3);
  const r = await api('POST', `/api/proto-markets/${id}/bet`, { direction: dir, amount, side_label: dir === 1 ? 'yes' : 'no' });
  rec({ action: 'bet', arm: a1, marketId: id, direction: dir, amount, status: r.status, res: r.json }); console.log(JSON.stringify(r));
} else if (cmd === 'scenario') {
  const patch = JSON.parse(a1); const next = patchScenario(patch); rec({ action: 'scenario_patch', patch, version: next.version }); console.log('scenario version', next.version);
} else if (cmd === 'freeze') {
  const id = resolveId(a1); const { sqlite } = await lib('db/client.js'); const { freezeMarket } = await lib('lib/proto-settlement-freeze.mjs');
  const ni = await nodeInfo(); const before = sqlite.prepare('SELECT id, status, winning_side, settlement_frozen_at, frozen_reason, deadline_ms FROM proto_markets WHERE id = ?').get(id);
  const r = freezeMarket({ db: sqlite, marketId: id, reason: 'operator_emergency_stop', pmt: { valid: true, pmtMs: ni.pmtMs }, wallMs: Date.now(), log: console });
  const after = sqlite.prepare('SELECT id, status, winning_side, settlement_frozen_at, frozen_reason FROM proto_markets WHERE id = ?').get(id);
  rec({ action: 'emergency_freeze_harness', arm: a1, marketId: id, node: ni, pmtMinusDeadlineMs: ni.pmtMs - before.deadline_ms, before, after, changes: r.changes }); console.log(JSON.stringify({ before, after, changes: r.changes, pmtMinusDeadlineMs: ni.pmtMs - before.deadline_ms }));
} else if (cmd === 'pmt') {
  const ni = await nodeInfo(); console.log(JSON.stringify({ ...ni, wallMinusPmtMin: ((ni.wallMs - ni.pmtMs) / MIN).toFixed(2), pmtIso: new Date(ni.pmtMs).toISOString() }));
} else if (cmd === 'snapshot') {
  const label = a1 || 'snap'; const d = `${EVD}/snapshots/${label}`; fs.mkdirSync(d, { recursive: true });
  for (const s of ['', '-wal', '-shm']) if (fs.existsSync(process.env.DB_PATH + s)) fs.copyFileSync(process.env.DB_PATH + s, `${d}/console.simnet.db${s}`);
  fs.copyFileSync(`${RUN}/scenario.json`, `${d}/scenario.json`); fs.copyFileSync(armsFile, `${d}/arms.json`);
  const ni = await nodeInfo(); fs.writeFileSync(`${d}/pmt-now.txt`, String(ni.pmtMs)); rec({ action: 'snapshot', label, node: ni }); console.log('snapshot ->', d, 'pmt-now', ni.pmtMs);
} else if (cmd === 'drive') {
  // 自动: 等 betting → bet0(600) → 等确认 → [L: 等 pmt ≥ cutoff−5min] → bet1(700) → 等 sealed。全程记 actions.jsonl; 每步有超时。
  const arm = a1; const id = resolveId(arm); const Database = createRequire(`${WT}/kasia-console/`)('better-sqlite3');
  const ro = () => new Database(process.env.DB_PATH, { readonly: true, fileMustExist: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (what, fn, timeoutMs) => { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { const d = ro(); let v; try { v = fn(d); } finally { d.close(); } if (v) return v; await sleep(4000); } throw new Error(`timeout waiting for ${what}`); };
  const mkt = (d) => d.prepare('SELECT id, status, deadline_ms, outcome_end_ms FROM proto_markets WHERE id = ?').get(id);
  const betRow = (side) => (d) => d.prepare("SELECT id, status FROM proto_bets WHERE market_id = ? AND side = ?").get(id, side);
  const post = async (dir, amount) => { const r = await api('POST', `/api/proto-markets/${id}/bet`, { direction: dir, amount, side_label: dir === 1 ? 'yes' : 'no' }); rec({ action: 'bet', arm, marketId: id, direction: dir, amount, status: r.status, res: r.json }); if (r.status !== 202) throw new Error(`bet ${dir} rejected ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return r; };
  await waitFor('status=betting', (d) => mkt(d)?.status === 'betting', 6 * MIN); await post(0, 600);
  await waitFor('bet0 confirmed', (d) => betRow(0)(d)?.status === 'confirmed', 6 * MIN);
  if (arm === 'L') {   // 第二注按【实时 pmt】择时: cutoff = deadline + 2h − PROMOTION_SAFETY(60min); pmt ≥ cutoff−5min 时才下(seal 落地时 cutoff−pmt−margin<graceMin ⇒ late_seal)
    const m0 = await waitFor('market row', (d) => mkt(d), MIN); const cutoff = m0.deadline_ms + 7_200_000 - 3_600_000; rec({ action: 'L_wait_for_pmt', cutoffMs: cutoff, cutoffIso: new Date(cutoff).toISOString(), waitUntilPmtIso: new Date(cutoff - 5 * MIN).toISOString() });
    for (;;) { const ni = await nodeInfo(); if (ni.pmtMs >= cutoff - 5 * MIN) { rec({ action: 'L_pmt_reached', node: ni, pmtMinusCutoffMs: ni.pmtMs - cutoff }); break; } await sleep(10_000); }
  }
  await post(1, 700);
  const sealed = await waitFor('sealed', (d) => { const m = mkt(d); return m && m.status === 'sealed' ? m : null; }, 10 * MIN); const ni = await nodeInfo();
  rec({ action: 'drive_sealed', arm, marketId: id, node: ni }); console.log(JSON.stringify({ arm, id, sealed: true, pmtIso: new Date(ni.pmtMs).toISOString() }));
} else if (cmd === 'arms') { console.log(JSON.stringify(readArms(), null, 1)); }
else { console.log('usage: create <arm> | bet <arm|id> <0|1> <amount> | scenario <json> | freeze <arm> | pmt | snapshot <label> | arms'); }
process.exit(0);
