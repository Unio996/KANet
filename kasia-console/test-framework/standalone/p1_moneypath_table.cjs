// 卡①(甲) 机械生成的钱路清单 — 2026-08-05 J2
// 要求(Codex 第十四轮 · Bettor 采纳): 表必须【机械生成且可重跑】, 手写清单会系统性漏掉
// 「作者当时不在那个文件里工作」的那一族(2026-08-05 实证: 手写 §4.1 漏了 prediction_* 整族)。
// 🔴 本脚本内不许出现 head/tail/slice 之类的展示截断 —— 那会让"展示上限"变成"清单上限"
//    (2026-08-05 实证: 我用 `head -8` 把 14 个调用点报成 8 个, 就在宣布"必须机械生成"的同一条消息里)。
// 纯只读: 只 readFile + 正则, 不执行被扫的代码。
//
// 【怎么跑 —— 完整命令, 照抄即可】
//   cd <repo>/kasia-console && node test-framework/standalone/p1_moneypath_table.cjs
//   覆盖扫描根: KANET_ROOT=<repo>  · 无输出文件(结果直接打印)
const fs = require('fs'), path = require('path');
// 🔴 修正 2(13:41): 谓词把【日志文本里提到 dispatchRefund】算成了调用 ⇒ 17 里有 3 个假阳性, 真值 14。
//    ⇒ 机械扫的失败模式是【多报】, 人工的是【少报】—— 两者必须互校, 不是谁替代谁。
// 🔴 路径走 KANET_ROOT 不硬编码(CLAUDE.md:242): v1 写死 `D:/kanet-tn12/…`, 那会让"入库以求可复现"
//    自相矛盾 —— 入了库而别人机器上跑不起来。
const KROOT = process.env.KANET_ROOT || path.resolve(__dirname, '../../..');
const ROOTS = [
  path.join(KROOT, 'kasia-console/src'),
  path.join(KROOT, 'kasia-relay/src'),
  path.join(KROOT, 'shared'),
];
const RE_LOGLINE = /console\.(log|warn|error|info)\s*\(|logThrottled\s*\(/;   // 提及 ≠ 调用

const RE_PRIMITIVE = /type:\s*'([a-z0-9_]*(?:refund|settle|payout|transfer|broadcast|sign|claim|unlock|mint)[a-z0-9_]*)'/g;
const RE_DISPATCH  = /dispatchRefund\s*\(/g;
const RE_AUTHZ_LIT = /authorization:\s*'([a-z0-9_]+)'/g;
const RE_AUTHZ_RET = /return\s*\{[^}]*authorization:\s*'([a-z0-9_]+)'/g;
const RE_UNAUTH    = /\.unauthorized|unauthorized\s*[:=]/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(js|mjs|cjs)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
  }
  return out;
}
const files = ROOTS.filter(r => fs.existsSync(r)).flatMap(r => walk(r));
const rel = (f) => f.replace(/^D:\/kanet-tn12\//, '').replace(/\\/g, '/');

const prim = new Map(), dispatch = [], authzRet = [], unauthHandlers = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'), lines = src.split(/\r?\n/);
  lines.forEach((ln, i) => {
    const at = `${rel(f)}:${i + 1}`;
    if (/^\s*(\/\/|\*)/.test(ln)) return;                       // 跳过注释行
    for (const m of ln.matchAll(RE_PRIMITIVE)) {
      if (!prim.has(m[1])) prim.set(m[1], []);
      prim.get(m[1]).push(at);
    }
    if (RE_DISPATCH.test(ln) && !/function\s+dispatchRefund/.test(ln) && !RE_LOGLINE.test(ln) && !/\/\/.*dispatchRefund/.test(ln)) {
      const lit = [...ln.matchAll(RE_AUTHZ_LIT)].map(x => x[1]);
      // 多行调用: 往后看 6 行找 authorization
      let look = lit.length ? lit : [...lines.slice(i, i + 7).join('\n').matchAll(RE_AUTHZ_LIT)].map(x => x[1]);
      dispatch.push({ at, authz: look.length ? `字面量:${look.join(',')}` : (/decision|\bopts\b/.test(ln) ? '对象(决策函数)' : '🔴 无 authorization') });
    }
    RE_DISPATCH.lastIndex = 0;
    for (const m of ln.matchAll(RE_AUTHZ_RET)) authzRet.push({ at, authz: m[1] });
    if (RE_UNAUTH.test(ln) && !/dispatchRefund/.test(ln)) unauthHandlers.push(at);
    RE_UNAUTH.lastIndex = 0;
  });
}

const REFUND = [...prim.keys()].filter(k => /refund/.test(k)).sort();
console.log('=== 钱路清单(机械生成) ' + new Date().toISOString().slice(0, 19) + 'Z ===');
console.log('扫描文件数 = ' + files.length + '  (已排除 node_modules 与 *.test.*)\n');

console.log('■ 退款类原语 —— ' + REFUND.length + ' 个');
for (const k of REFUND) console.log('   ' + k.padEnd(34) + ' × ' + prim.get(k).length + '  ' + prim.get(k).join(' · '));

console.log('\n■ dispatchRefund 调用点 —— ' + dispatch.length + ' 个(无截断)');
for (const d of dispatch) console.log('   ' + d.at.padEnd(46) + d.authz);

console.log('\n■ 决策函数内部产出 authorization 的 return —— ' + authzRet.length + ' 处');
for (const r of authzRet) console.log('   ' + r.at.padEnd(46) + r.authz);

console.log('\n■ 接住 unauthorized 的地方 —— ' + unauthHandlers.length + ' 处');
for (const u of unauthHandlers) console.log('   ' + u);

console.log('\n■ 全部动钱类原语(阴性对照用: 看这个数量级)');
for (const [k, v] of [...prim.entries()].sort((a, b) => b[1].length - a[1].length)) console.log('   ' + k.padEnd(34) + ' × ' + v.length);
