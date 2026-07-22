// M0a baseline 生成器(设计 v0.2 §4): 首次全量 / --refresh-paths / --prune / --report
// 用法:
//   node scripts/gen-m0a-baseline.mjs                  首次全量生成(baseline 已存在时拒绝, 防误覆盖)
//   node scripts/gen-m0a-baseline.mjs --refresh-paths  按 staged rename map 纯 path 改写(移动批用)
//   node scripts/gen-m0a-baseline.mjs --prune          收缩到现实(燃尽落账; 只删/减, 出现增加即拒)
//   node scripts/gen-m0a-baseline.mjs --report         各燃尽桶摘要(Bettor 周检, 三钉(b))
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import {
  snapshotEntries, stagedRenames, BASELINE_PATH, SEP,
} from './m0a-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ABS = path.join(ROOT, BASELINE_PATH);
const mode = process.argv[2] || '--gen';

const load = () => JSON.parse(fs.readFileSync(ABS, 'utf8'));
const save = (baseline) => {
  baseline.entries.sort((a, b) => (a.path + a.family + a.form).localeCompare(b.path + b.family + b.form));
  fs.writeFileSync(ABS, JSON.stringify(baseline, null, 1) + '\n');
};
const head = () => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

const snapshot = () => snapshotEntries(ROOT);

if (mode === '--gen') {
  if (fs.existsSync(ABS)) { console.error(`[gen-m0a] ${BASELINE_PATH} 已存在 — 全量重生成会洗掉燃尽历史, 拒绝。要收缩用 --prune, 移动用 --refresh-paths。`); process.exit(1); }
  const entries = snapshot();
  save({ generated_at_head: head(), entries });
  console.log(`[gen-m0a] baseline 生成: ${entries.length} 条 occurrence(${new Set(entries.map(e => e.path)).size} 文件) @HEAD ${head()}`);
} else if (mode === '--refresh-paths') {
  const baseline = load();
  const renames = stagedRenames(ROOT);
  if (renames.size === 0) { console.log('[gen-m0a] staged 无 rename 对, 零改写。'); process.exit(0); }
  const old2new = new Map([...renames].map(([n, o]) => [o, n]));
  let n = 0;
  for (const e of baseline.entries) if (old2new.has(e.path)) { e.path = old2new.get(e.path); n++; }
  save(baseline);
  console.log(`[gen-m0a] path 改写 ${n} 条(rename 对 ${renames.size} 个)。count/form/owner/burn_down 零变化, lint R-M0A-BASELINE-EDIT-GUARD 会核验。记得 git add ${BASELINE_PATH}`);
} else if (mode === '--prune') {
  const baseline = load();
  const cur = new Map();
  for (const e of snapshot()) cur.set(e.path + SEP + e.family + SEP + e.form, e.count);
  const kept = []; let pruned = 0, shrunk = 0, grew = 0;
  for (const e of baseline.entries) {
    const c = cur.get(e.path + SEP + e.family + SEP + e.form) || 0;
    if (c === 0) { pruned++; continue; }
    if (c < e.count) { shrunk++; e.count = c; }
    if (c > e.count) grew++; // 不动 — 增长绝不经 prune 洗白
    kept.push(e);
  }
  if (grew > 0) console.error(`[gen-m0a] ⚠ ${grew} 条现实 count 高于 baseline — prune 不落增长, 这些会被 lint 拒(增长唯一通道=manifest)。`);
  save({ ...baseline, entries: kept });
  console.log(`[gen-m0a] 燃尽落账: 删 ${pruned} 条, 收缩 ${shrunk} 条, 余 ${kept.length} 条。记得 git add ${BASELINE_PATH}`);
} else if (mode === '--report') {
  const baseline = load();
  const buckets = {};
  for (const e of baseline.entries) {
    const b = (buckets[e.burn_down] ||= { entries: 0, files: new Set() });
    b.entries += e.count; b.files.add(e.path);
  }
  console.log(`[M0a 周检 @baseline ${baseline.generated_at_head}] 总豁免 occurrence=${baseline.entries.reduce((s, e) => s + e.count, 0)}, 文件=${new Set(baseline.entries.map(e => e.path)).size}`);
  for (const [k, v] of Object.entries(buckets).sort()) console.log(`  ${k}: ${v.entries} occ / ${v.files.size} 文件`);
} else {
  console.error('usage: gen-m0a-baseline.mjs [--refresh-paths|--prune|--report]'); process.exit(1);
}
