// NWT 五审 N4-3: v0.5 守卫(decodeEnvFile + parseLauncherEnvText) vs 真实 PowerShell 启动器循环(oracle 输出)。
// guard 判 UNKNOWN(fail-closed)的文件单列, 不算分歧; 其余逐变量比较(变量名按 ToUpper 与 oracle 一致)。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { decodeEnvFile, parseLauncherEnvText } = await import(pathToFileURL(path.join(here, 'boot-guard-check.mjs')).href);
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env5');
const oracle = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'nwt-fuzz-oracle5.json'), 'utf8').replace(/^﻿/, ''));
const meta = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')));
const show = (t) => JSON.stringify(t).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const byEnc = {}; let same = 0, unknown = 0; const diffs = [], unknowns = [];
for (const [name, o] of Object.entries(oracle)) {
  const enc = meta[name]; byEnc[enc] = byEnc[enc] || { n: 0, same: 0, unknown: 0, diff: 0 }; byEnc[enc].n++;
  const buf = fs.readFileSync(path.join(dir, name));
  const d = decodeEnvFile(buf);
  if (d.unknown) { unknown++; byEnc[enc].unknown++; unknowns.push([name, enc, d.unknown.slice(0, 60)]); continue; }
  const g = parseLauncherEnvText(d.text).vars; const gmap = {};
  for (const [k, v] of g) if (k.startsWith('NWTZ_') && v !== null) gmap[k] = v;
  const omap = {}; for (const [k, v] of Object.entries(o.vars || {})) omap[k] = v;
  const a = JSON.stringify(Object.entries(gmap).sort()), b = JSON.stringify(Object.entries(omap).sort());
  if (a === b) { same++; byEnc[enc].same++; } else { byEnc[enc].diff++; diffs.push({ name, enc, text: show(d.text), guard: gmap, launcher: omap, threw: o.threw }); }
}
console.log(`cases=${Object.keys(oracle).length} identical=${same} guardUNKNOWN(fail-closed)=${unknown} DIFFER=${diffs.length}`);
console.log('by encoding:', JSON.stringify(byEnc));
if (unknowns.length) console.log('UNKNOWN examples:', JSON.stringify(unknowns.slice(0, 4)));
for (const x of diffs.slice(0, 10)) console.log(`  ${x.name} [${x.enc}] text=${x.text}\n     guard=${show(x.guard)} launcher=${show(x.launcher)} launcherThrows=${x.threw}`);
