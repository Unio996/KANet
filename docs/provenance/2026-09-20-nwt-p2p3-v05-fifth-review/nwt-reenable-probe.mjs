// 真实场景: index.js 里 `// startMonitor();  // disabled per Owner ...` 被人取消注释重新启用 -> 对账是否转红
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(here, 'boot-guard-check.mjs');
const { analyzeBootFile, reconcileBoot } = await import(pathToFileURL(TOOL).href);
const LISTS = JSON.parse(spawnSync(process.execPath, [TOOL, '--print-lists'], { encoding: 'utf8' }).stdout);
const REAL = fs.readFileSync(process.argv[2], 'utf8');
const needle = '// startMonitor();';
if (REAL.split(needle).length !== 2) throw new Error('needle matched ' + (REAL.split(needle).length - 1) + 'x');
const run = (t) => reconcileBoot(analyzeBootFile(t), LISTS);
console.log('control (real file): problems =', run(REAL).length);
const p = run(REAL.replace(needle, 'startMonitor();'));
console.log('startMonitor() uncommented: problems =', p.length, p.length ? ':: ' + p[0].slice(0, 140) : '');
