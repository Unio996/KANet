// mm_deepbets.mjs — simnet only: 在同一个开放 ZK 原生盘上用新鲜 pk 连下 N 笔(stake_ktt), 配合 FEE_PROBE 控制台读每笔 register 的节点实测费用下限(看下限随 shard 内笔数怎么长)。
// 用法: node mm_deepbets.mjs <tag> <N>   (需: console(tag, FEE_PROBE=1, 上限放宽) + 已 arm 的 gamma 桩; 本脚本 arm 桩并等种子器建盘)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const tag = process.argv[2] || 'fee1', N = Number(process.argv[3] || 12);
const OUT = 'D:/kanet-tn12/scratch/_j2_mm';
const Db = createRequire('D:/kanet-tn12/kasia-console/')('better-sqlite3');
const kaspa = createRequire('D:/kanet-tn12/scratch/_j2_wt_sz/kasia-relay/')('kaspa-wasm');
const db = new Db(`${OUT}/console.mm.${tag}.db`, { readonly: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pre = new Set(db.prepare("SELECT id FROM pool_markets").all().map((r) => r.id));
await fetch('http://127.0.0.1:3399/arm', { method: 'POST' });
let m = null;
for (let t = 0; t < 120 && !m; t++) { m = db.prepare("SELECT id FROM pool_markets WHERE protocol_status='pending_bettors' AND id NOT LIKE '%-s%'").all().find((r) => !pre.has(r.id)); if (!m) await sleep(3000); }
if (!m) throw new Error('no market created');
console.log('market', m.id);
const res = [];
for (let i = 0; i < N; i++) {
  const pk = new kaspa.PrivateKey(Buffer.from(Array.from({ length: 32 }, (_, k) => (i * 7 + k * 13 + 41) & 0xff)).toString('hex')).toPublicKey().toXOnlyPublicKey().toString();
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:3298/api/pool/market/${m.id}/bettor/register-v07`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bettor_pk: pk, direction: i % 2, stake_ktt: 1000000000 }) });
  const j = await r.json().catch(() => ({}));
  console.log(`bet #${i + 1} status=${r.status} ms=${Date.now() - t0} ${r.status === 200 ? '' : JSON.stringify(j).slice(0, 160)}`);
  res.push({ i: i + 1, status: r.status });
}
writeFileSync(`${OUT}/mm_deepbets.${tag}.json`, JSON.stringify({ market: m.id, res }, null, 1));
