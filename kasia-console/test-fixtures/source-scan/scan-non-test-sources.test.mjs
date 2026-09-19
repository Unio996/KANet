// scan-non-test-sources.test.mjs — 共享源码扫描器的自测(9-1 F4 笔, NWT F2-1)。用临时目录树造真实文件做探针, 带对照臂: 应被发现的路径全部被发现, 应被排除的全部不被发现。
// Run: cd kasia-console && node test-fixtures/source-scan/scan-non-test-sources.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listNonTestSources, findReferencesInNonTestSources, stripComments, repoRootDir, DEFAULT_EXCLUDED_PREFIXES } from './scan-non-test-sources.mjs';

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'eq'}:\n  ${JSON.stringify(a)}\n  != ${JSON.stringify(b)}`); };

const NEEDLE = 'MARKER_ONLY_FOR_TESTS_MODULE';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-selftest-'));
const put = (rel, body) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
const REF = `import x from './${NEEDLE}.mjs';\n`;
// 应被发现(NWT F2-1 的真实探针形态): 深层 data、scripts、根 scripts、各种扩展名、require
put('kasia-console/src/services/a.js', REF);                   // 控制臂: 普通源码
put('kasia-console/src/data/_x/d.js', REF);                    // 曾被 skipDir 含 data 漏掉
put('kasia-console/scripts/_x.mjs', REF);                      // 曾不在扫描根内
put('scripts/y.mts', REF);                                     // 根 scripts + .mts
put('kasia-relay/src/z.cjs', `const m = require('./${NEEDLE}.mjs');\n`);
put('packages/p/q.tsx', REF);
put('kaspa-scout/src/w.ts', REF);
// 应被排除
put('docs/provenance/n.mjs', REF);                             // 文档/证据
put('scratch/s.mjs', REF);
put('logs/l.mjs', REF);
put('kasia-console/test-fixtures/f.mjs', REF);                 // 测试夹具
put('kasia-console/test-framework/tf.mjs', REF);
put('kasia-console/data/dd.mjs', REF);                         // 运行时数据目录(仓库根相对路径 kasia-console/data/)
put('node_modules/x/i.js', REF);                               // 依赖
put('kasia-console/node_modules/y/j.js', REF);                 // 依赖(任意深度)
put('kasia-console/src/lib/foo.test.mjs', REF);                // 测试文件
put('kasia-console/src/lib/bar.spec.ts', REF);
put('kasia-console/src/lib/readme.md', REF);                   // 非源码扩展名
// 注释里提到 / 动态拼接(已知边界)
put('kasia-console/src/lib/commented.mjs', `// import x from './${NEEDLE}.mjs'\n/* ${NEEDLE} */\nconst a = 1;\n`);
put('kasia-console/src/lib/dynamic.mjs', `const m = './MARKER_ONLY_FOR_' + 'TESTS_MODULE.mjs'; // 动态拼接: 文本扫描看不见(已知边界)\n`);

const FOUND = ['kaspa-scout/src/w.ts', 'kasia-console/scripts/_x.mjs', 'kasia-console/src/data/_x/d.js', 'kasia-console/src/services/a.js', 'kasia-relay/src/z.cjs', 'packages/p/q.tsx', 'scripts/y.mts'].sort();
const find = (opts = {}) => findReferencesInNonTestSources(new RegExp(NEEDLE), { rootDir: tmp, minFiles: 1, ...opts }).sort();

t('探针树里应被发现的 7 个路径全部被发现(深层 src/data、kasia-console/scripts、根 scripts、.mts/.tsx/.ts/.cjs、require)——含曾经漏掉的 src/data 与 scripts', () => {
  eq(find(), FOUND);
});
t('应被排除的一律不出现: docs/scratch/logs、测试夹具与测试框架、kasia-console/data、任意深度 node_modules、.test/.spec 文件、非源码扩展名; 注释里提到不算; 动态拼接看不见(已知边界, 头注已写)', () => {
  const all = listNonTestSources({ rootDir: tmp }).map((f) => f.rel);
  for (const bad of ['docs/provenance/n.mjs', 'scratch/s.mjs', 'logs/l.mjs', 'kasia-console/test-fixtures/f.mjs', 'kasia-console/test-framework/tf.mjs', 'kasia-console/data/dd.mjs', 'node_modules/x/i.js', 'kasia-console/node_modules/y/j.js', 'kasia-console/src/lib/foo.test.mjs', 'kasia-console/src/lib/bar.spec.ts', 'kasia-console/src/lib/readme.md']) {
    if (all.includes(bad)) throw new Error(`${bad} 不该被扫描`);
  }
  if (find().includes('kasia-console/src/lib/commented.mjs')) throw new Error('注释里的提及被算成引用');
  if (find().includes('kasia-console/src/lib/dynamic.mjs')) throw new Error('(已知边界)动态拼接不该被发现——若发现了说明扫描器变了, 头注要跟着改');
});
t('exceptRel 放行定义者自己; minFiles 下限: 扫描范围小于下限即抛错(防扫描根失效成空判据)', () => {
  eq(find({ exceptRel: ['kasia-console/src/services/a.js'] }).includes('kasia-console/src/services/a.js'), false);
  let e = null; try { findReferencesInNonTestSources(new RegExp(NEEDLE), { rootDir: tmp, minFiles: 1000 }); } catch (x) { e = x; }
  if (!e || !/扫描范围疑似失效/.test(e.message)) throw new Error('minFiles 下限未生效');
});
t('排除只按仓库根的相对路径前缀: 非根位置的同名目录(kasia-console/src/data、scripts/docs 里的 docs/ 不是根 docs/)不被排除', () => {
  put('scripts/docs/inner.mjs', REF);                            // scripts/docs/ ≠ 根 docs/
  put('kasia-console/src/logs/inner.mjs', REF);                  // src/logs/ ≠ 根 logs/ ≠ kasia-console/logs/
  const hits = find();
  for (const want of ['scripts/docs/inner.mjs', 'kasia-console/src/logs/inner.mjs']) if (!hits.includes(want)) throw new Error(`${want} 应被扫描(排除只按仓库根相对路径)`);
});
t('stripComments: 块注释与行注释被去掉, 字符串里的 :// 保留', () => {
  eq(stripComments("a /* x */ b // c\nconst u = 'http://h/p';\n").replace(/\s+/g, ' ').trim(), "a b const u = 'http://h/p';");
});
t('真实仓库树的健全检查: 默认根扫描到 ≥ 500 个非测试源码、且包含 kasia-console/src/data 与 kasia-console/scripts 下的文件(若这两处没有源码则该断言不适用——按存在性检查)', () => {
  const files = listNonTestSources({ rootDir: repoRootDir() }).map((f) => f.rel);
  if (files.length < 500) throw new Error(`只扫到 ${files.length} 个`);
  if (!files.some((r) => r.startsWith('kasia-console/scripts/'))) throw new Error('kasia-console/scripts 没被扫描');
  if (!files.some((r) => r.startsWith('scripts/'))) throw new Error('根 scripts 没被扫描');
  if (fs.existsSync(path.join(repoRootDir(), 'kasia-console/src/data')) && fs.readdirSync(path.join(repoRootDir(), 'kasia-console/src/data')).some((n) => /\.(mjs|js|cjs)$/.test(n)) && !files.some((r) => r.startsWith('kasia-console/src/data/'))) throw new Error('kasia-console/src/data 没被扫描');
  if (!Array.isArray(DEFAULT_EXCLUDED_PREFIXES) && !Object.isFrozen(DEFAULT_EXCLUDED_PREFIXES)) throw new Error('排除清单应是冻结数组');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
