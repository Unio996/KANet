// NWT 四审: boot-guard-check.test.mjs 的 discoverStartCalls / checkRegistry 逐字移植; 对真实 index.js(f0c45290) 追加五种写法的"新 cron", 看对账是否变红。
import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const TOOL = 'D:/kanet-tn12/scratch/_nwt_boot_v04/boot-guard-check.mjs';
const LISTS = JSON.parse(spawnSync(process.execPath, [TOOL, '--print-lists'], { encoding: 'utf8' }).stdout);
const real = fs.readFileSync('D:/kanet-tn12/scratch/_nwt_wt_b90/kasia-console/src/index.js', 'utf8');
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
function discoverStartCalls(indexText) {
  const code = stripComments(indexText); const imports = new Map();
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) for (const n of m[1].split(',')) { const nm = n.trim().split(/\s+as\s+/).pop(); if (nm) imports.set(nm, m[2]); }
  for (const m of code.matchAll(/import\s+(\w+)\s+from\s*['"](\.[^'"]+)['"]/g)) imports.set(m[1], m[2]);
  const called = new Set([...code.matchAll(/\b(start\w*|init\w*|autoSplitAll)\s*\(/g)].map((m) => m[1]));
  return [...called].filter((n) => imports.has(n)).map((n) => ({ name: n, module: imports.get(n) })).sort((a, b) => a.name.localeCompare(b.name));
}
function checkRegistry(discovered, lists) {
  const problems = []; const reg = lists.cronRegistry;
  for (const d of discovered) if (!reg[d.name]) problems.push(`UNREGISTERED ${d.name}`);
  for (const k of Object.keys(reg)) if (!discovered.some((d) => d.name === k)) problems.push(`STALE ${k}`);
  return problems;
}
const cases = [
  ['F baseline: real index.js as is', real],
  ['A control: import { startBrandNewCron } + startBrandNewCron()', real + "\nimport { startBrandNewCron } from './services/new.js';\nstartBrandNewCron();\n"],
  ['B static import, verb "launch": launchPayoutSweeper()', real + "\nimport { launchPayoutSweeper } from './services/new.js';\nlaunchPayoutSweeper();\n"],
  ['C dynamic import destructure: const { startDynCron } = await import(...)', real + "\nconst { startDynCron } = await import('./services/dyn.js');\nstartDynCron();\n"],
  ['D namespace import: ns.startNsCron()', real + "\nimport * as ns from './services/ns.js';\nns.startNsCron();\n"],
  ['E direct timer in index.js: setInterval(() => sendMoney(), 1000)', real + "\nsetInterval(() => sendMoney(), 1000);\n"],
  ['G bare side-effect import (module starts a timer at import): import "./services/x.js"', real + "\nimport './services/x.js';\n"],
];
for (const [name, txt] of cases) { const p = checkRegistry(discoverStartCalls(txt), LISTS); console.log((p.length ? 'RED   ' : 'green ') + name + (p.length ? '  -> ' + p.join('; ') : '')); }
