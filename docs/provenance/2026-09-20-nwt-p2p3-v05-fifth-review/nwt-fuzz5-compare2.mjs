// NWT 五审 N4-3 compare v2: 与 oracle2(Win32 环境块, 名字十六进制+值配对)比较。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { decodeEnvFile, parseLauncherEnvText } = await import(pathToFileURL(path.join(here, 'boot-guard-check.mjs')).href);
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env5');
const oracle = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'nwt-fuzz-oracle5b.json'), 'utf8').replace(/^﻿/, ''));
const meta = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')));
const hexOf = (s) => [...s.toUpperCase()].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');   // UTF-16 code units, like the oracle
const hexU = (s) => { let o = ''; for (let i = 0; i < s.length; i++) o += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'); return o; };
const show = (t) => JSON.stringify(t).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
let same = 0, unknown = 0; const diffs = []; const byEnc = {};
for (const [name, o] of Object.entries(oracle)) {
  const enc = meta[name]; byEnc[enc] = byEnc[enc] || { n: 0, same: 0, diff: 0, unknown: 0 }; byEnc[enc].n++;
  const d = decodeEnvFile(fs.readFileSync(path.join(dir, name)));
  if (d.unknown) { unknown++; byEnc[enc].unknown++; continue; }
  const gmap = new Map();
  for (const [k, v] of parseLauncherEnvText(d.text).vars) if (/^NWTZ_/i.test(k) && v !== null) gmap.set(hexU(k.toUpperCase()), v);
  const omap = new Map(); for (const p of (Array.isArray(o.pairs) ? o.pairs : (o.pairs ? [o.pairs] : []))) omap.set(p.nameHex, p.value);
  const a = JSON.stringify([...gmap].sort()), b = JSON.stringify([...omap].sort());
  if (a === b) { same++; byEnc[enc].same++; } else { byEnc[enc].diff++; diffs.push({ name, enc, guard: [...gmap], launcher: [...omap], threw: o.threw }); }
}
console.log(`cases=${Object.keys(oracle).length} identical=${same} guardUNKNOWN=${unknown} DIFFER=${diffs.length}`);
console.log('by encoding:', JSON.stringify(byEnc));
for (const x of diffs.slice(0, 10)) console.log(`  ${x.name} [${x.enc}] launcherThrows=${x.threw}\n     guard=${show(x.guard)}\n     launcher=${show(x.launcher)}`);
