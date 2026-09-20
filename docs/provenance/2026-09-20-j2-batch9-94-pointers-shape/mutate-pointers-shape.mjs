// 9-4 pointers 形状解包——变异对照(单文件测试逐个跑)。用法(仓库根): node docs/provenance/2026-09-20-j2-batch9-94-pointers-shape/mutate-pointers-shape.mjs > mutation-raw.txt
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = 'kasia-console/src/lib/proto-settlement-pointers.mjs';
const run = () => { const r = spawnSync(process.execPath, ['src/lib/proto-settlement-pointers.test.mjs'], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 400000, maxBuffer: 1 << 26 }); return { status: r.status, last: ((r.stdout || '') + (r.stderr || '')).match(/\d+ passed, \d+ failed/)?.[0] || '?' }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [
  ['S1', sub('if (Array.isArray(outer)) {', 'if (false) {'), '去掉数组解包(回到修复前的行为: 数组串直接喂 deserialize)'],
  ['S2', sub('outer.length !== 1 ||', 'outer.length < 1 ||'), '放开长度限制(2 元素数组也接受, 取第 0 个)'],
  ['S3', sub("txText = outer[0];", "txText = outer[outer.length - 1];"), '数组取最后一个元素而非唯一元素(与 S2 组合才有区分; 单独跑应仍绿——记为等价对照)'],
  ['S4', sub("typeof outer[0] !== 'string'", "false"), '不检查元素是否为字符串'],
  ['S5', sub("try { outer = JSON.parse(txText); } catch { outer = undefined; }", "outer = JSON.parse(txText);"), '非 JSON 不再走 malformed 路径而是抛原始 SyntaxError'],
];
console.log('BASELINE'); const b = run(); console.log(`  exit=${b.status} ${b.last}`); if (b.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); }
let surv = 0;
for (const [id, f, why] of M) {
  const abs = path.join(ROOT, SRC); const orig = fs.readFileSync(abs, 'utf8'); let m;
  try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) :: ${why}`); surv++; continue; }
  try { fs.writeFileSync(abs, m); const r = run(); if (r.status === 0) surv++; console.log(`${id}: ${r.status !== 0 ? 'KILLED' : 'SURVIVED'} exit=${r.status} ${r.last} :: ${why}`); }
  finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败'); }
}
const a = run(); console.log(`RESTORED exit=${a.status} ${a.last}`); console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${a.status === 0}`); process.exitCode = surv || a.status !== 0 ? 1 : 0;
