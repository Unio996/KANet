// 探针溯源一致性 property test — Codex MSG-238 MUST-FIX
// 断言: ①run-header 的 plan 与探针消息内容的 plan 标签来自同一常量(结构上不可独立漂移)
//       ②生产仪器里无任何退役授权标签 v1.2/v1.3/v1.4/v1.5 残留
// 跑法: node scripts/j1-probe-provenance.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'j1-trough-probe-instrument.mjs');
const s = readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

// ①A: 唯一常量存在
const m = s.match(/const PLAN_LABEL = '([^']+)';/);
t('PLAN_LABEL 单常量存在', !!m);
// ①B: run-header 用常量不用字面量
t('run-header plan: PLAN_LABEL(非字面量)', /plan: PLAN_LABEL,/.test(s));
// ①C: 探针消息用常量不用字面量
t('探针消息用 ${PLAN_LABEL}', /计划 \$\{PLAN_LABEL\} 授权样本/.test(s));
// ②: 生产【授权标签】位(run-header plan / 探针消息)无退役版本硬编码
//    只扫这两处的构造, 不管历史注释(注释不入 run-header/不入被绑内容)
const authLines = s.split('\n').filter(l => /plan:|授权样本/.test(l));
const retired = ['v1.2', 'v1.3', 'v1.4', 'v1.5'];
const leak = retired.filter(v => authLines.some(l => l.includes(v)));
t('授权标签构造无退役版本残留(v1.2-v1.5): ' + (leak.length ? leak.join(',') : '无'), leak.length === 0);
// ③: 若将来改 run-header 成字面量 + 消息成字面量, 两者仍相等——property: 二者绑同源
//    这里以"都引用 PLAN_LABEL"作结构证明(同源即不可独立漂移)
t('run-header 与消息标签同源(都经 PLAN_LABEL)', /plan: PLAN_LABEL,/.test(s) && /\$\{PLAN_LABEL\}/.test(s));

console.log(`probe-provenance: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
