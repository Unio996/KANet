// 统计真实 index.js: 相对静态导入的绑定名, 哪些没被分析器算作"使用"(导入了但从未引用; 其模块顶层照样会执行)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { analyzeBootFile, stripComments, blankQuotedStrings } = await import(pathToFileURL(path.join(here, 'boot-guard-check.mjs')).href);
const text = fs.readFileSync(process.argv[2], 'utf8');
const a = analyzeBootFile(text);
const code = stripComments(text), view = blankQuotedStrings(code);
const names = [];
for (const m of view.matchAll(/(?<![\w$.])import\s+([\s\S]*?)\s*from\s*(['"])([^'"\n]*)\2/dg)) {
  const clause = code.slice(m.indices[1][0], m.indices[1][1]), spec = code.slice(m.indices[3][0], m.indices[3][1]);
  if (!spec.startsWith('.')) continue;
  const ns = /^\*\s*as\s+([\w$]+)$/.exec(clause.trim()); if (ns) { names.push([ns[1], spec]); continue; }
  const named = /\{([\s\S]*)\}/.exec(clause); const head = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
  if (head) for (const h of head.split(/\s+/)) if (/^[\w$]+$/.test(h)) names.push([h, spec]);
  if (named) for (const part of named[1].split(',')) { const p = part.trim(); if (!p) continue; names.push([p.split(/\s+as\s+/).pop().trim(), spec]); }
}
const usedKeys = [...a.uses.keys()];
const unused = names.filter(([n]) => !usedKeys.some((k) => k === n || k.startsWith(n + '.')));
console.log(`relative static import bindings: ${names.length}; counted as used: ${names.length - unused.length}; NOT counted (imported, never referenced): ${unused.length}`);
for (const [n, s] of unused) console.log('  unused:', n, 'from', s);
console.log('distinct relative modules imported statically:', new Set(names.map((x) => x[1])).size);
