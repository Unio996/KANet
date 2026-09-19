// scan-non-test-sources.test.mjs — 共享源码扫描器的自测(9-1 F4 笔, NWT F2-1)。用临时目录树造真实文件做探针, 带对照臂: 应被发现的路径全部被发现, 应被排除的全部不被发现。
// Run: node shared/test-fixtures/source-scan/scan-non-test-sources.test.mjs
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

// ══ 9-1 F5(NWT F4-1): stripComments 换成状态机版(识别字符串 / 模板 / 正则) ══════════════════════════════════════════════
// 旧的简单正则版(9-1 F4 前的实现)在下面三种形态会【漏报真实引用】; 对照臂 oldStrip 就是那个旧实现——证明这三条探针是真的会漏的形态, 不是纸面上的。
const oldStrip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const CALL = 'REAL_CALL_TOKEN(1);';
const FORMS = {
  // 形态 1: 同行前有含 // 的字符串, 后面的真调用被旧正则当成注释吞掉
  '字符串含 // 后接真调用': "const u = 'a//b'; " + CALL + " // 尾注释",
  // 形态 2: 一个字符串里含块注释起始符、另一个字符串里含块注释结束符, 旧正则把两者之间的真调用当成块注释吞掉
  '字符串含块注释起止符夹着真调用': "const a = '/*';\n" + CALL + "\nconst b = '*/';\n",
  // 形态 3: 模板字面量含 //
  '模板字面量含 // 后接真调用': "const t = `x // y`; " + CALL + "\n",
};
t('F5 ▲ 三种形态: 旧简单正则版会漏掉真调用(对照臂), 状态机版保留它; 真注释里的同名仍被去掉', () => {
  for (const [name, src] of Object.entries(FORMS)) {
    if (oldStrip(src).includes(CALL)) throw new Error(`(对照臂失效) 旧实现本应漏掉这条形态: ${name}`);
    if (!stripComments(src).includes(CALL)) throw new Error(`状态机版漏掉了真调用: ${name}`);
  }
  const doc = "/* REAL_CALL_TOKEN(1) */\n// REAL_CALL_TOKEN(2)\n/**\n * REAL_CALL_TOKEN(3)\n */\nconst a = 1;";
  if (/REAL_CALL_TOKEN/.test(stripComments(doc))) throw new Error('真注释里的同名没被去掉');
});
t('F5 v2.1 向量: 正则字面量里的 /* 不吞后面的真调用(字符类 / 转义斜杠 / /[/]/ / 转义 // 对 / return 之后); 除法不是正则(其后两个注释仍是注释); 转义字符与模板 ${} 表达式保持可见', () => {
  const has = (src) => stripComments(src).includes(CALL);
  const cases = [
    ['E1 字符类含 /*', 'const re = /[^/*]+/; ' + CALL],
    ['E1b 转义斜杠+星', 'const re = /a\\/\\*b/; ' + CALL],
    ['E1c 括号后的 /[/]/', 'x = a.replace(/[/]/g, "-"); ' + CALL],
    ['E1d 转义 // 对', 'if (/^a\\/\\//.test(s)) { ' + CALL + ' }'],
    ['E1f return 之后的正则', 'return /x*/.test(s) && ' + CALL],
    ['c4 转义斜杠正则', 'const r = /https?:\\/\\//; ' + CALL],
    ['c3 字符串里的 :// 之后', "const u = 'http://x'; " + CALL + " // trailing"],
    ['模板 ${} 表达式可见', 'const t = `a ${' + CALL + '} b`;'],
    ['多行模板里含 // 与 /*, 闭合之后的真调用', 'const t = `a\n// not a comment\n/* nor this\n`; ' + CALL],
    ['正则字符类里的 //(其后紧跟 *): 类内的 / 不结束正则, 否则会拼出块注释起始符吞掉真调用', 'const re = /[//*]/; ' + CALL],
    ['代码态的转义斜杠: 括号之后的 /a\\//(按除法处理)里 \\/ 是转义对, 不能拼出行注释起始符', 'if (x) /a\\//.test(s); ' + CALL],
    ['字符串里的转义引号不提前结束字符串(其后的 // 仍在字符串内, 之后的真调用保留)', "const s = 'it\\'s //x'; " + CALL],
  ];
  for (const [n, src] of cases) if (!has(src)) throw new Error(`${n}: 真调用被吞了`);
  if (has('const q = a / b; /* REAL_CALL_TOKEN(1); */ const r = c / d; // REAL_CALL_TOKEN(1);')) throw new Error('除法后的两个注释应仍是注释(被当成正则了?)');
});
t('F5 真实文件探针(三种形态各放一个文件, 走 findReferencesInNonTestSources 全链路): 状态机版全部发现; 同一批文件在旧实现下会被漏掉', () => {
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-f5-'));
  try {
    const NEEDLE2 = 'F5_MARKER_MODULE';
    const forms = {
      'kasia-console/src/lib/f5-str.mjs': "const u = 'a//b'; const m = require('./" + NEEDLE2 + ".mjs'); // tail\n",
      'kasia-console/src/lib/f5-block.mjs': "const a = '/*';\nconst m = require('./" + NEEDLE2 + ".mjs');\nconst b = '*/';\n",
      'kasia-console/src/lib/f5-tpl.mjs': "const t = `x // y`; const m = require('./" + NEEDLE2 + ".mjs');\n",
    };
    for (const [rel, body] of Object.entries(forms)) { const p = path.join(root2, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); }
    const hits = findReferencesInNonTestSources(new RegExp(NEEDLE2), { rootDir: root2, minFiles: 1 }).sort();
    eq(hits, Object.keys(forms).sort());
    for (const body of Object.values(forms)) if (oldStrip(body).includes(NEEDLE2)) throw new Error('(对照臂失效) 旧实现本应漏掉');
  } finally { fs.rmSync(root2, { recursive: true, force: true }); }
});

// ══ 9-2b(NWT F5-1): 两条"注释里的引用不算"对照 ═══════════════════════════════════════════════════════════════════════
t('F5-1 ▲ 注释里的引用不报: 完整字符串之后的行尾注释 / 一行含未闭合引号、下一行是注释——两种形态里注释里的引用都不该被当成真引用', () => {
  const REF = 'FIXTURE_ONLY_MODULE_TOKEN';
  if (stripComments('const s = "a"; // ' + REF + '\n').includes(REF)) throw new Error('完整字符串之后的行尾注释里的引用不该保留');
  if (stripComments('const s = "unterminated\n// ' + REF + '\nconst t = 1;\n').includes(REF)) throw new Error('未闭合引号的下一行注释里的引用不该保留');
  // 对照: 真引用仍保留(不是把整行都吞了)
  if (!stripComments('const s = "a"; ' + REF + '(1); // tail\n').includes(REF + '(1)')) throw new Error('同行的真引用必须保留');
  if (!stripComments('const s = "unterminated\n' + REF + '(2);\n').includes(REF + '(2)')) throw new Error('未闭合引号的下一行的真引用必须保留(重新同步)');
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
