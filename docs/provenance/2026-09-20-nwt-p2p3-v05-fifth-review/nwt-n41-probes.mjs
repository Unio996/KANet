// NWT 五审 N4-1 对抗探针: 在【真实 index.js】上追加 / 插入新形状, 走守卫自己的 analyzeBootFile + reconcileBoot(与守卫每次启动对生产 index.js 跑的同一对账), 看是否转红。
// 用法: node nwt-n41-probes.mjs <index.js 路径>   (只读; 不写任何仓库文件)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(here, 'boot-guard-check.mjs');
const { analyzeBootFile, reconcileBoot } = await import('file:///' + TOOL.replace(/\\/g, '/'));
const LISTS = JSON.parse(spawnSync(process.execPath, [TOOL, '--print-lists'], { encoding: 'utf8' }).stdout);
const REAL = fs.readFileSync(process.argv[2], 'utf8');
const verdict = (text) => { const a = analyzeBootFile(text); const p = reconcileBoot(a, LISTS); return { p, uses: a.uses.size, timers: a.timers.length, unparsed: a.unparsed.length }; };

const out = [];
const base = verdict(REAL);
out.push(`P0 control (real index.js): problems=${base.p.length} uses=${base.uses} timers=${base.timers} unparsed=${base.unparsed}`);
const lines = REAL.split('\n');
const idxOf = (needle) => { const i = lines.findIndex((l) => l.includes(needle)); if (i < 0) throw new Error('needle not found: ' + needle); return i; };
const insertBefore = (needle, add) => { const i = idxOf(needle); return [...lines.slice(0, i), add, ...lines.slice(i)].join('\n'); };
const insertAfterLine = (needle, add) => { const i = idxOf(needle); return [...lines.slice(0, i + 1), add, ...lines.slice(i + 1)].join('\n'); };

const P = [
  // 应红(对照: 我预期分析器抓得到)
  ['C1 control: 追加带调用的动态起动 (const {startX}=await import; startX())', 'red', REAL + "\nconst { startRogue } = await import('./services/rogue.js');\nstartRogue();\n"],
  ['C2 control: 裸 await import(...) 无绑定', 'red', REAL + "\nawait import('./services/rogue.js');\n"],
  ['C3 control: 孤立的 setInterval 追加在文件尾', 'red', REAL + "\nsetInterval(() => rogue(), 1000);\n"],
  // 我担心的形状
  ['U1 静态命名导入,【从不使用】', 'hole?', REAL + "\nimport { startRogueSpend } from './services/rogue.js';\n"],
  ['U2 静态默认导入,【从不使用】', 'hole?', REAL + "\nimport rogueDefault from './services/rogue.js';\n"],
  ['U3 静态命名空间导入,【从不使用】', 'hole?', REAL + "\nimport * as rogueNs from './services/rogue.js';\n"],
  ['R1 export * from 相对模块(再导出也会执行该模块顶层)', 'hole?', REAL + "\nexport * from './services/rogue.js';\n"],
  ['R2 export { x } from 相对模块', 'hole?', REAL + "\nexport { startRogue } from './services/rogue.js';\n"],
  ['T1 新 setInterval 紧挨在已声明的 exchange.expireTick 定时器【之前】(窗口 before=2)', 'hole?', insertBefore("setInterval(wrapTick('exchange.expireTick'", "setInterval(() => rogueSpend(), 1000);")],
  ['T2 新 setInterval 紧挨在已声明的 console.heartbeatFile 定时器【之前】', 'hole?', insertBefore("setInterval(wrapTick('console.heartbeatFile'", "setInterval(() => rogueSpend(), 1000);")],
  ['T3 新 setInterval 在已声明定时器【之后 1 行】(窗口 after=1): 插在 exchange.expireTick 行之后', 'hole?', insertAfterLine("setInterval(wrapTick('exchange.expireTick'", "setInterval(() => rogueSpend(), 1000);")],
  ['T4 别名: const si = setInterval; si(fn, 5)', 'hole?', REAL + "\nconst si = setInterval;\nsi(() => rogueSpend(), 1000);\n"],
  ['T5 globalThis.setInterval(...)(孤立处)', 'red', REAL + "\nglobalThis.setInterval(() => rogueSpend(), 1000);\n"],
];
for (const [label, expect, text] of P) {
  let v; try { v = verdict(text); } catch (e) { out.push(`${label} => THREW ${e.message}`); continue; }
  const red = v.p.length > 0 && v.p.some((x) => !base.p.includes(x));
  out.push(`${red ? 'RED  ' : 'GREEN'} (expected ${expect}) ${label}${red ? '  :: ' + v.p.filter((x) => !base.p.includes(x))[0].slice(0, 110) : ''}`);
}
console.log(out.join('\n'));
