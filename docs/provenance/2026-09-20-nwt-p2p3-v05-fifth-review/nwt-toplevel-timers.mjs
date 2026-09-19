// 传递性副作用量化: index.js 静态导入的相对模块里, 有多少在【模块顶层(缩进 0)】起 setInterval/setTimeout/spawn/fork/exec* / new Worker
// (这些是 import 时就会跑的; 分析器只按"index.js 用了哪个入口"分类, 看不到它们)。只读。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { stripComments, blankQuotedStrings } = await import(pathToFileURL(path.join(here, 'boot-guard-check.mjs')).href);
const indexPath = path.resolve(process.argv[2]);
const srcDir = path.dirname(indexPath);
const text = fs.readFileSync(indexPath, 'utf8');
const code = stripComments(text), view = blankQuotedStrings(code);
const specs = new Set();
for (const m of view.matchAll(/(?<![\w$.])import\s+[\s\S]*?\s*from\s*(['"])([^'"\n]*)\1/dg)) { const s = code.slice(m.indices[2][0], m.indices[2][1]); if (s.startsWith('.')) specs.add(s); }
for (const m of view.matchAll(/(?<![\w$.])import\s*\(\s*(['"])([^'"\n]+)\1/dg)) { const s = code.slice(m.indices[2][0], m.indices[2][1]); if (s.startsWith('.')) specs.add(s); }
const re = /^(?:[\w$.]+\s*=\s*)?(?:await\s+)?(setInterval|setTimeout|setImmediate|spawn|fork|execFile|execSync|exec|spawnSync)\s*\(|^new\s+Worker\s*\(|^[\w$]+\s*\.\s*(schedule|setInterval)\s*\(/;
let checked = 0, missing = 0; const hits = [];
for (const s of specs) {
  const f = path.resolve(srcDir, s);
  if (!fs.existsSync(f)) { missing++; continue; }
  checked++;
  const mod = blankQuotedStrings(stripComments(fs.readFileSync(f, 'utf8')));
  mod.split('\n').forEach((l, i) => { if (re.test(l)) hits.push(`${s}:${i + 1}: ${l.trim().slice(0, 90)}`); });
}
console.log(`relative modules named in index.js: ${specs.size}; read: ${checked}; missing: ${missing}`);
console.log(`column-0 timer/process starts found in those modules: ${hits.length}`);
for (const h of hits) console.log('  ' + h);
