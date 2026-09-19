// NWT 四审 N-3: 守卫的 parseLauncherEnvText vs 真实 PowerShell 加载器(fuzz-oracle.ps1 的输出)。
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const { parseLauncherEnvText } = await import('file:///D:/kanet-tn12/scratch/_nwt_boot_v04/boot-guard-check.mjs');
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env');
const oracle = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'nwt-fuzz-oracle.json'), 'utf8').replace(/^\uFEFF/, ''));
let same = 0; const diffs = [];
const show = (t) => JSON.stringify(t).replace(/[\u0080-\uFFFF]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
for (const [name, o] of Object.entries(oracle)) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');           // readFileSync 'utf8' keeps the BOM char; the guard strips it itself
  const g = parseLauncherEnvText(text).vars; const gmap = {};
  for (const [k, v] of g) if (k.startsWith('NWTZ_') && v !== null) gmap[k] = v;
  const omap = {}; for (const [k, v] of Object.entries(o.vars || {})) omap[k] = v;
  const a = JSON.stringify(Object.entries(gmap).sort()), b = JSON.stringify(Object.entries(omap).sort());
  if (a === b) same++; else diffs.push({ name, text: show(text.replace(/^\uFEFF/, '')), guard: gmap, launcher: omap, threw: o.threw });
}
console.log(`cases=${Object.keys(oracle).length} identical=${same} DIFFER=${diffs.length}`);
for (const d of diffs.slice(0, 12)) console.log(`  ${d.name} text=${d.text}\n     guard=${JSON.stringify(d.guard)} launcher=${JSON.stringify(d.launcher)} launcherThrows=${d.threw}`);
