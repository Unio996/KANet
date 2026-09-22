// drive-e2e.mjs — D-032 单口径 simnet e2e 驱动脚本(H 正臂 / R 故障臂)。
// H: 建判定题市场(§2.6 两步回签)→ 下注 2 笔(seal_count=2)→ mock ESPN final → adapter 判 → promote → close_commit → claim。
// R: 同建题, mock ESPN 永不 final(state='in') → 永不出票 → 过 cutoff 冻结 → refund_flip(harness 手拼验证, 同四臂 harness D 臂手法)。
// 用法: node drive-e2e.mjs create H|R  |  node drive-e2e.mjs bet <marketId> <0|1> <amount>  |  node drive-e2e.mjs status <marketId>  |  node drive-e2e.mjs scenario '<json patch>'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RUN = 'D:/kanet-tn12/scratch/_j2_d032_e2e';
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
process.env.E2E_REPO_SRC = 'D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/src';
process.env.E2E_SCENARIO_FILE = process.env.E2E_SCENARIO_FILE || `${RUN}/scenario.json`;
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_j2_d032_e2e')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
await import(pathToFileURL(`${RUN}/scripts/upstream-mock-d032.mjs`).href);   // createJudgedMarket 的 §2.6 fetch 也要走同一份 mock(与起 console 时装的那份逻辑同源, 只是这里是本进程内)
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const MIN = 60_000;
const armsFile = `${RUN}/arms.json`;
const readArms = () => (fs.existsSync(armsFile) ? JSON.parse(fs.readFileSync(armsFile, 'utf8')) : {});
const resolveId = (x) => readArms()[x] || x;
const rec = (o) => fs.appendFileSync(`${RUN}/actions.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
async function api(method, url, body) { const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; } return { status: r.status, json }; }
function patchScenario(patch) { const f = `${RUN}/scenario.json`; const cur = JSON.parse(fs.readFileSync(f, 'utf8')); const next = { version: (cur.version || 0) + 1, espn: { ...cur.espn, ...(patch.espn || {}) }, registryTeamIds: patch.registryTeamIds || cur.registryTeamIds || [] }; fs.writeFileSync(f, JSON.stringify(next)); return next; }

const ARMS = {
  H: { event: '5101', homeId: '13', awayId: '2', oeMin: 1, dMin: 7, espn: { state: 'final', homeWins: true } },
  R: { event: '5102', homeId: '13', awayId: '2', oeMin: 1, dMin: 7, espn: { state: 'in' } },   // 永不 final ⇒ 永不出票 ⇒ 过 cutoff 冻结
};

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (cmd === 'create') {
  const cfg = ARMS[a1]; if (!cfg) { console.error('未知臂: ' + a1); process.exit(2); }
  const arms = readArms(); if (arms[a1]) { console.error(`臂 ${a1} 已存在: ${arms[a1]}`); process.exit(3); }
  patchScenario({ espn: { [cfg.event]: { home: 'LAL', homeId: cfg.homeId, away: 'BOS', awayId: cfg.awayId, homeScore: 110, awayScore: 100, date: '2026-10-01T00:00Z', league: 'NBA', ...cfg.espn } }, registryTeamIds: [cfg.homeId, cfg.awayId] });
  const t = Date.now(); const oeMs = t + cfg.oeMin * MIN, dMs = t + cfg.dMin * MIN;
  const h = await import(pathToFileURL(`${RUN}/scripts/harness-lib-d032.mjs`).href);
  const r = await h.createJudgedMarket({ tokenId: process.env.E2E_TOKEN_ID, title: `d032-e2e-${a1}`, deadlineMs: dMs, outcomeEndMs: oeMs, spec: h.mkSpec({ event: cfg.event }) });
  arms[a1] = r.id; fs.writeFileSync(armsFile, JSON.stringify(arms, null, 1));
  rec({ action: 'market_create', arm: a1, marketId: r.id, oeMs, oeIso: new Date(oeMs).toISOString(), deadlineMs: dMs, deadlineIso: new Date(dMs).toISOString(), event: cfg.event, canonical_event: r.canonical_event, resolution_statement: r.resolution_statement });
  console.log(JSON.stringify({ arm: a1, id: r.id, oe: new Date(oeMs).toISOString(), deadline: new Date(dMs).toISOString(), canonical_event: r.canonical_event }));
} else if (cmd === 'bet') {
  const id = resolveId(a1); const dir = Number(a2), amount = Number(a3);
  const r = await api('POST', `/api/proto-markets/${id}/bet`, { direction: dir, amount, side_label: dir === 1 ? 'yes' : 'no' });
  rec({ action: 'bet', marketId: id, dir, amount, status: r.status, json: r.json });
  console.log(JSON.stringify(r));
} else if (cmd === 'status') {
  const id = resolveId(a1);
  const r = await api('GET', `/api/proto-markets/${id}`);
  console.log(JSON.stringify(r.json, null, 1));
} else if (cmd === 'scenario') {
  console.log(JSON.stringify(patchScenario(JSON.parse(a1))));
} else if (cmd === 'arms') {
  console.log(JSON.stringify(readArms(), null, 1));
} else {
  console.error('usage: create <H|R> | bet <arm|id> <0|1> <amount> | status <arm|id> | scenario <json> | arms');
  process.exit(1);
}
