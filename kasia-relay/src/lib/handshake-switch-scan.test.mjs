// handshake-switch-scan.test.mjs — V9(设计 v0.4 §7.3 / §8.1): kasia-relay/src 里 acceptHandshake 的【确切形状白名单】源码扫描。
//
// 这是"清单钉住"不是保护本身(保护本身是 chain.mjs acceptHandshake 的 chokepoint, 见 handshake-chokepoint.test.mjs; 行为在各落点测试里驱动)。
// 它守的是: 第 N 个调用点 / 别名 / 非调用引用 / 第二处注入不会悄悄出现。用 F5 共享扫描器的 stripComments(状态机版, 识别字符串 / 模板 / 正则),
// 再自己把字符串字面量内容抹成空格——所以"守卫只在字符串里"与"守卫只在注释里"都不算守卫。
//
// 检查函数 checkV9(files) 是纯函数(输入 {相对路径: 源码}), 所以对照臂可以喂"改坏的文件集"证明它真会红。
// 单文件跑: node src/lib/handshake-switch-scan.test.mjs (只读源码文本, 不 import 被扫模块)。
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../../../kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELAY_SRC = path.resolve(HERE, '..');   // kasia-relay/src
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

// ── 把已去注释的源码里的字符串 / 模板字面量【内容】抹成空格(保留定界符与换行, 长度不变 ⇒ 下标与去注释文本一一对应) ────────────────────
function blankStrings(src) {
  let out = '', i = 0, mode = 'code', quote = '';
  const exprDepth = [];   // 模板 ${ } 表达式内的花括号深度栈(表达式内是代码)
  while (i < src.length) {
    const c = src[i];
    if (mode === 'code') {
      if (c === "'" || c === '"') { mode = 'str'; quote = c; out += c; i++; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i++; continue; }
      if (exprDepth.length) {
        if (c === '{') exprDepth[exprDepth.length - 1]++;
        else if (c === '}') {
          if (exprDepth[exprDepth.length - 1] === 0) { exprDepth.pop(); mode = 'tpl'; out += c; i++; continue; }
          exprDepth[exprDepth.length - 1]--;
        }
      }
      out += c; i++; continue;
    }
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (mode === 'str') {
      if (c === quote) { mode = 'code'; out += c; i++; continue; }
      if (c === '\n') { mode = 'code'; out += c; i++; continue; }   // 未闭合的单行字符串: 换行处重新同步(与 stripComments 一致)
      out += ' '; i++; continue;
    }
    // tpl
    if (c === '`') { mode = 'code'; out += c; i++; continue; }
    if (c === '$' && src[i + 1] === '{') { exprDepth.push(0); mode = 'code'; out += '${'; i += 2; continue; }
    out += c === '\n' ? '\n' : ' '; i++;
  }
  return out;
}
const view = (src) => { const noComments = stripComments(src); return { noComments, code: blankStrings(noComments) }; };

// 括号配平取范围: 从 code[openIdx](应为 '(' 或 '{')起找到匹配的闭合下标
function matchClose(code, openIdx) {
  const open = code[openIdx], close = open === '(' ? ')' : '}';
  let d = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (i > 0 && code[i - 1] === '\\') continue;   // 被转义的括号(正则字面量里的 \( \{ 等)不是代码括号
    if (code[i] === open) d++; else if (code[i] === close) { d--; if (d === 0) return i; }
  }
  return -1;
}
// 位置 idx 之前的花括号深度(忽略被反斜杠转义的花括号)
const depthBefore = (code, idx) => { const b = code.slice(0, idx); return (b.match(/(?<!\\)\{/g) || []).length - (b.match(/(?<!\\)\}/g) || []).length; };
// 顶层函数 NAME 的函数体范围 [bodyOpen, bodyClose](在 code 里; 找 `function NAME(` 后第一个 '{' 起配平)
function functionBody(code, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(code);
  if (!m) return null;
  const paren = code.indexOf('(', m.index);
  const parenClose = matchClose(code, paren);
  const open = code.indexOf('{', parenClose);
  return { start: m.index, open, close: matchClose(code, open) };
}
const occurrences = (code, re) => { const r = []; let m; const g = new RegExp(re.source, 'g'); while ((m = g.exec(code))) r.push(m.index); return r; };
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

const GUARD_CALL = /if\s*\(\s*!\s*handshakeAutoAcceptEnabled\s*\(/;
// relay.mjs 接线的精确文本(H1-1): 改这一行(增删注入项 / 改变量名)时须同步改这里——这正是"钉住"的意义。
const WIRING_LINE = 'const doAcceptHandshake = createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress });';
const WIRING_DECLS = {
  'acceptHandshake / sendKaspa(import 来源 ./chain.mjs)': 'import { getConversations, getMessages, sendMessage, acceptHandshake, sendKaspa, custodialSendKaspa } from "./chain.mjs";',
  'ingestHandshake / ingestTx(import 来源 ./ingest.mjs)': 'import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from "./ingest.mjs";',
  'log': 'function log(...args) {',
  'CONSOLE_URL': 'const CONSOLE_URL = process.env.CONSOLE_URL || "";',
  'localAddress': 'const localAddress = getWallet().getAddress();',
};

/** V9: 返回违规列表(空 = 通过)。files: { 'kasia-relay/src/…': 源码 } */
export function checkV9(files) {
  const v = [];
  const IDENT = /\bacceptHandshake\b/;
  for (const [rel, src] of Object.entries(files)) {
    const { noComments, code } = view(src);
    const occ = occurrences(code, IDENT);
    const respTrue = occurrences(code, /\bisResponse\s*:\s*true\b/);
    const base = rel.replace(/^kasia-relay\/src\//, '');

    // (c) isResponse: true 只准出现在 chain.mjs 的 acceptHandshake 函数体内(恰 1 处)
    if (respTrue.length) {
      if (base !== 'chain.mjs') v.push(`${rel}: isResponse: true 出现在 chain.mjs 之外(第 ${lineOf(code, respTrue[0])} 行)`);
      else {
        const fb = functionBody(code, 'acceptHandshake');
        const inside = fb && respTrue.filter((i) => i > fb.open && i < fb.close);
        if (!fb || inside.length !== 1 || respTrue.length !== 1) v.push(`${rel}: isResponse: true 应恰 1 处且在 acceptHandshake 函数体内(实得 ${respTrue.length} 处 / 函数内 ${inside ? inside.length : '无函数'})`);
      }
    }
    if (!occ.length) continue;

    if (base === 'chain.mjs') {
      // 定义恰 1 且是 export async function; 守卫(return null)在函数体最前、任何钱包使用之前
      const fb = functionBody(code, 'acceptHandshake');
      if (occ.length !== 1 || !/export\s+async\s+function\s+acceptHandshake\s*\(/.test(noComments.slice(Math.max(0, occ[0] - 30), occ[0] + 30))) v.push(`${rel}: acceptHandshake 应恰 1 处且是 export async function 定义(实得 ${occ.length})`);
      else if (!fb) v.push(`${rel}: 找不到 acceptHandshake 函数体`);
      else {
        const body = code.slice(fb.open, fb.close);
        const g = GUARD_CALL.exec(body);
        const use = body.search(/\bgetWallet\s*\(|\bencrypt\s*\(|\bderiveAliases\s*\(/);
        if (!g || (use >= 0 && g.index > use)) v.push(`${rel}: acceptHandshake 缺 chokepoint 守卫,或守卫在 getWallet/encrypt/deriveAliases 之后`);
        else if (!/return\s+null\s*;/.test(body.slice(g.index, g.index + 400))) v.push(`${rel}: chokepoint 守卫分支里没有 return null`);
      }
      continue;
    }

    if (base === 'relay.mjs') {
      // 恰 1 条 import(来自 ./chain.mjs) + 恰 1 处注入(createHandshakeAcceptor({ … }) 的对象字面量内, 形态 acceptHandshake, / acceptHandshake: acceptHandshake)
      const imp = /import\s*\{[^}]*\bacceptHandshake\b[^}]*\}\s*from\s*["']\.\/chain\.mjs["']/g;
      const impCount = (noComments.match(imp) || []).length;
      const call = code.indexOf('createHandshakeAcceptor(');
      let injections = [];
      if (call >= 0) {
        const open = code.indexOf('(', call), close = matchClose(code, open);
        injections = occ.filter((i) => i > open && i < close && /^acceptHandshake\s*(,|\}|:\s*acceptHandshake\b)/.test(noComments.slice(i, i + 60)));
      }
      if (impCount !== 1) v.push(`${rel}: 来自 ./chain.mjs 的 acceptHandshake import 应恰 1 条(实得 ${impCount})`);
      if (injections.length !== 1) v.push(`${rel}: 注入 createHandshakeAcceptor({ … }) 的 acceptHandshake 应恰 1 处(实得 ${injections.length})`);
      if (occ.length !== 2) v.push(`${rel}: acceptHandshake 总出现次数应为 2(import + 注入), 实得 ${occ.length}`);
      // H1-1(NWT 笔一审: 对这一行做 7 个变异 6 个存活——sendKaspa 换 custodialSendKaspa / ingest 互换 / 每次调用新建 / localAddress 换 CONSOLE_URL / log 换 console.log /
      // acceptHandshake 换 sendMessage——因为上面只查了"名字出现在对象里"): 把整行钉成精确文本(模块顶层、整行一字不差、恰一处), 再钉八个注入名各自的声明 / import 来源恰一处。
      const lines = noComments.split('\n');
      const hits = lines.filter((l) => l === WIRING_LINE).length;
      if (hits !== 1) v.push(`${rel}: 接线行应【整行一字不差】恰 1 处(实得 ${hits})——注入实参被换 / 换序 / 改形态都会红`);
      else {
        const at = noComments.indexOf(WIRING_LINE);
        const depth = depthBefore(code, at);
        if (depth !== 0) v.push(`${rel}: 接线行不在模块顶层(花括号深度 ${depth}) — 每次调用新建 acceptor 会丢去重状态`);
      }
      const factories = occurrences(code, /\bcreateHandshakeAcceptor\s*\(/).length;
      if (factories !== 1) v.push(`${rel}: createHandshakeAcceptor( 应恰 1 处(实得 ${factories})`);
      for (const [name, line] of Object.entries(WIRING_DECLS)) {
        const n = lines.filter((l) => l === line).length;
        if (n !== 1) v.push(`${rel}: 注入名 ${name} 的声明 / import 来源行应整行一字不差恰 1 处(实得 ${n}): ${line}`);
      }
      // 影子声明: 八个注入名不得在别处被重新声明 / 别名 import(log 与 CONSOLE_URL 与 localAddress 各自的那一处除外)
      const SHADOW = { acceptHandshake: 0, sendKaspa: 0, ingestHandshake: 0, ingestTx: 0, fetch: 0, log: 1, CONSOLE_URL: 1, localAddress: 1 };
      for (const [name, allowed] of Object.entries(SHADOW)) {
        const decl = occurrences(code, new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`)).length + occurrences(code, new RegExp(`\\bas\\s+${name}\\b`)).length;
        if (decl !== allowed) v.push(`${rel}: 注入名 ${name} 的(重新)声明 / 别名数应为 ${allowed}(实得 ${decl})`);
      }
      continue;
    }

    if (base === 'lib/handshake-accept.mjs') {
      // 出现: 工厂参数解构 1 处 + 调用 1 处, 且调用在 doAcceptHandshake 内、守卫子句之后
      const calls = occ.filter((i) => /^acceptHandshake\s*\(/.test(noComments.slice(i, i + 40)));
      const header = code.indexOf('createHandshakeAcceptor(');
      const hOpen = header >= 0 ? code.indexOf('(', header) : -1;
      const hClose = hOpen >= 0 ? matchClose(code, hOpen) : -1;
      const destructured = occ.filter((i) => i > hOpen && i < hClose);
      const fb = functionBody(code, 'doAcceptHandshake');
      if (occ.length !== 2 || calls.length !== 1 || destructured.length !== 1) v.push(`${rel}: acceptHandshake 应为 解构 1 + 调用 1(实得总 ${occ.length} / 调用 ${calls.length} / 解构 ${destructured.length})`);
      else if (!fb || !(calls[0] > fb.open && calls[0] < fb.close)) v.push(`${rel}: 调用不在 doAcceptHandshake 函数体内`);
      else {
        const g = GUARD_CALL.exec(code.slice(fb.open, fb.close));
        if (!g || fb.open + g.index > calls[0]) v.push(`${rel}: doAcceptHandshake 缺守卫子句,或守卫在 acceptHandshake( 调用之后`);
      }
      continue;
    }

    if (base === 'rpc-listener.mjs') {
      const imp = (noComments.match(/import\s*\{[^}]*\bacceptHandshake\b[^}]*\}\s*from\s*['"]\.\/chain\.mjs['"]/g) || []).length;
      const calls = occ.filter((i) => /^acceptHandshake\s*\(/.test(noComments.slice(i, i + 40)));
      if (imp !== 1) v.push(`${rel}: 来自 ./chain.mjs 的 acceptHandshake import 应恰 1 条(实得 ${imp})`);
      if (occ.length !== 3 || calls.length !== 2) v.push(`${rel}: acceptHandshake 应为 import 1 + 调用 2(实得总 ${occ.length} / 调用 ${calls.length}) — 别名 / 非调用引用 / 第三处调用都会红`);
      for (const fn of ['processHandshake', 'catchUpHistory']) {
        const fb = functionBody(code, fn);
        if (!fb) { v.push(`${rel}: 找不到 ${fn}`); continue; }
        const inFn = calls.filter((i) => i > fb.open && i < fb.close);
        if (inFn.length !== 1) { v.push(`${rel}: ${fn} 内 acceptHandshake( 调用应恰 1 处(实得 ${inFn.length})`); continue; }
        const g = GUARD_CALL.exec(code.slice(fb.open, fb.close));
        if (!g || fb.open + g.index > inFn[0]) v.push(`${rel}: ${fn} 缺守卫子句 if (!handshakeAutoAcceptEnabled(…)),或守卫在调用之后`);
      }
      // 落点 2 的位置(§2.2-2): 守卫在 step 4 ingestMessage 之后、step 5 create_and_claim 之前
      const ph = functionBody(code, 'processHandshake');
      if (ph) {
        const bodyNC = noComments.slice(ph.open, ph.close);
        const gi = bodyNC.search(GUARD_CALL);
        const im = bodyNC.indexOf('ingestMessage(');
        const cl = bodyNC.indexOf('create_and_claim');
        if (!(im >= 0 && cl >= 0 && gi > im && gi < cl)) v.push(`${rel}: processHandshake 守卫应在 ingestMessage( 之后、create_and_claim 之前(im=${im} gi=${gi} cl=${cl})`);
      }
      continue;
    }

    // 其余任何文件出现 acceptHandshake(别名 import / 裸调用 / const f = acceptHandshake / 传回调 …)一律红
    v.push(`${rel}: acceptHandshake 出现在白名单之外(第 ${lineOf(code, occ[0])} 行, 共 ${occ.length} 处)`);
  }
  return v;
}

// ── 读真实文件集 ─────────────────────────────────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js|cjs)$/.test(e.name) && !/\.(test|spec)\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const REAL = {};
for (const p of walk(RELAY_SRC)) REAL['kasia-relay/src/' + path.relative(RELAY_SRC, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
const K = { CH: 'kasia-relay/src/chain.mjs', RM: 'kasia-relay/src/relay.mjs', HA: 'kasia-relay/src/lib/handshake-accept.mjs', RL: 'kasia-relay/src/rpc-listener.mjs' };
const mut = (rel, fn) => { const f = { ...REAL }; f[rel] = fn(REAL[rel]); return f; };
const must = (s, find, repl) => { if (s.split(find).length - 1 < 1) throw new Error('对照臂锚点缺失: ' + find.slice(0, 40)); return s.replace(find, () => repl); };
const redWith = (files, needle) => { const v = checkV9(files); assert.ok(v.length > 0, '应红却通过'); if (needle) assert.ok(v.some((x) => x.includes(needle)), '红了但不是预期原因: ' + v.join(' | ')); };

await t('扫描非空: 找到 kasia-relay/src 的源文件, 且含四个关键文件(防"扫了个空目录"的空通过)', () => {
  assert.ok(Object.keys(REAL).length >= 20, '文件数 ' + Object.keys(REAL).length);
  for (const k of Object.values(K)) assert.ok(REAL[k], '缺 ' + k);
  assert.ok(Object.keys(REAL).every((k) => !k.includes('.test.')), '不应含测试文件');
});
await t('V9 真实文件集: 全部符合确切形状白名单(chain 定义 1 + 守卫; relay import 1 + 注入 1; handshake-accept 解构 1 + 调用 1 + 守卫在前; rpc-listener import 1 + 两处调用各有前置守卫; 其余文件 0)', () => {
  const v = checkV9(REAL);
  assert.deepStrictEqual(v, []);
  // 阳性: 确实数到了预期的出现次数(不是因为扫描器什么都没看到)
  const cnt = (rel) => occurrences(view(REAL[rel]).code, /\bacceptHandshake\b/).length;
  assert.strictEqual(cnt(K.CH), 1); assert.strictEqual(cnt(K.RM), 2); assert.strictEqual(cnt(K.HA), 2); assert.strictEqual(cnt(K.RL), 3);
});

// ── 对照臂: 每一种绕过 / 漏守卫都必须红 ─────────────────────────────────────────────────────────────────────────
await t('对照臂 A1 无守卫: rpc-listener processHandshake 删掉守卫 ⇒ 红', () => {
  redWith(mut(K.RL, (s) => must(s, "    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled — left pending for', senderAddress.slice(-12));\n      return;\n    }\n", '')), 'processHandshake');
});
await t('对照臂 A2 守卫在调用之后: 把 processHandshake 的守卫挪到 acceptHandshake 调用之后 ⇒ 红', () => {
  redWith(mut(K.RL, (s) => {
    const g = "    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled — left pending for', senderAddress.slice(-12));\n      return;\n    }\n";
    let x = must(s, g, '');
    return must(x, "    const draft = await acceptHandshake({ address: senderAddress });\n", "    const draft = await acceptHandshake({ address: senderAddress });\n" + g);
  }), 'processHandshake');
});
await t('对照臂 A3 守卫只在字符串里: if (!handshakeAutoAcceptEnabled()) 变成一段字符串字面量 ⇒ 红', () => {
  redWith(mut(K.RL, (s) => must(s, "    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled — left pending for', senderAddress.slice(-12));\n      return;\n    }\n",
    "    const _g = 'if (!handshakeAutoAcceptEnabled()) { return; }';\n")), 'processHandshake');
});
await t('对照臂 A4 守卫只在注释里: 把守卫整块注释掉 ⇒ 红', () => {
  redWith(mut(K.RL, (s) => must(s, "    if (!handshakeAutoAcceptEnabled()) {\n      log('HANDSHAKE auto-accept disabled — left pending for', senderAddress.slice(-12));\n      return;\n    }\n",
    "    // if (!handshakeAutoAcceptEnabled()) { return; }\n    /* if (!handshakeAutoAcceptEnabled()) { return; } */\n")), 'processHandshake');
});
await t('对照臂 A5 别名 import: 新文件 import { acceptHandshake as ah } 并调用 ah( ⇒ 红', () => {
  redWith({ ...REAL, 'kasia-relay/src/lib/sneaky.mjs': "import { acceptHandshake as ah } from '../chain.mjs';\nexport const go = (a) => ah({ address: a });\n" }, 'sneaky.mjs');
});
await t('对照臂 A6 非调用引用: rpc-listener 里 const f = acceptHandshake ⇒ 红', () => {
  redWith(mut(K.RL, (s) => must(s, "import { handshakeAutoAcceptEnabled } from './lib/handshake-switch.mjs';\n", "import { handshakeAutoAcceptEnabled } from './lib/handshake-switch.mjs';\nconst _f = acceptHandshake;\n")), K.RL);
});
await t('对照臂 A7 新增裸调用(别的文件): 任意新文件 acceptHandshake( ⇒ 红; 与 F5 三形态之一并用: 字符串含 // 之后的真调用也必须被看见', () => {
  redWith({ ...REAL, 'kasia-relay/src/lib/x.mjs': "import { acceptHandshake } from '../chain.mjs';\nexport const go = async (a) => { const u = 'a//b'; return await acceptHandshake({ address: a }); };\n" }, 'x.mjs');
  redWith({ ...REAL, 'kasia-relay/src/lib/y.mjs': "const a = '/*';\nawait acceptHandshake({});\nconst b = '*/';\n" }, 'y.mjs');
  redWith({ ...REAL, 'kasia-relay/src/lib/z.mjs': 'const t = `x // y`; acceptHandshake({});\n' }, 'z.mjs');
});
await t('对照臂 A8 relay.mjs 第二次注入: createHandshakeAcceptor 对象里 acceptHandshake 出现两次 ⇒ 红', () => {
  redWith(mut(K.RM, (s) => must(s, 'createHandshakeAcceptor({ acceptHandshake, ', 'createHandshakeAcceptor({ acceptHandshake, acceptHandshake, ')), K.RM);
  redWith(mut(K.RM, (s) => s + '\nconst second = createHandshakeAcceptor({ acceptHandshake });\n'), K.RM);
});
await t('对照臂 A9 handshake-accept.mjs 内第二处调用 ⇒ 红', () => {
  redWith(mut(K.HA, (s) => must(s, '      log("HANDSHAKE ACCEPTED TX:", sent?.txId || sent);', '      await acceptHandshake({ address: peer });\n      log("HANDSHAKE ACCEPTED TX:", sent?.txId || sent);')), K.HA);
});
await t('对照臂 A10 handshake-accept.mjs 无守卫 / 守卫在调用之后 ⇒ 红', () => {
  const G = "    if (!handshakeAutoAcceptEnabled()) {\n      logDisabledOnce(peer, `HANDSHAKE auto-accept disabled (poll) — left pending for ${peer.slice(-12)}`);\n      return;\n    }\n";
  redWith(mut(K.HA, (s) => must(s, G, '')), K.HA);
  redWith(mut(K.HA, (s) => must(must(s, G, ''), '      const draft = await acceptHandshake({ address: peer });\n', '      const draft = await acceptHandshake({ address: peer });\n' + G)), K.HA);
});
await t('对照臂 A11 chain.mjs chokepoint: 删守卫 / 守卫在 getWallet 之后 / 守卫分支不 return null ⇒ 红', () => {
  const start = REAL[K.CH].indexOf('  if (!handshakeAutoAcceptEnabled()) {');
  assert.ok(start > 0);
  const end = REAL[K.CH].indexOf('    return null;\n  }\n', start) + '    return null;\n  }\n'.length;
  const block = REAL[K.CH].slice(start, end);
  redWith(mut(K.CH, (s) => s.replace(block, '')), K.CH);
  redWith(mut(K.CH, (s) => must(s.replace(block, ''), '  const wallet = getWallet();\n  const myPrivateKeyHex = wallet.getPrivateKey().toString();\n  const { myAlias, theirAlias } = await deriveAliases(myPrivateKeyHex, params.address);\n  const handshake = {\n    type: \'handshake\', alias: myAlias, theirAlias,\n    timestamp: Date.now(), version: 1, isResponse: true,', '  const wallet = getWallet();\n' + block + '  const myPrivateKeyHex = wallet.getPrivateKey().toString();\n  const { myAlias, theirAlias } = await deriveAliases(myPrivateKeyHex, params.address);\n  const handshake = {\n    type: \'handshake\', alias: myAlias, theirAlias,\n    timestamp: Date.now(), version: 1, isResponse: true,')), K.CH);
  redWith(mut(K.CH, (s) => s.replace('    return null;\n  }\n  const wallet', '    return undefined;\n  }\n  const wallet')), K.CH);
});
await t('对照臂 A12 (c) isResponse: true 出现在 chain.mjs 之外(自拼握手载荷绕过 acceptHandshake) ⇒ 红; chain.mjs 内第二处也红', () => {
  redWith({ ...REAL, 'kasia-relay/src/lib/forge.mjs': "export const hs = () => ({ type: 'handshake', version: 1, isResponse: true });\n" }, 'isResponse');
  redWith(mut(K.CH, (s) => s + "\nexport const forged = { isResponse: true };\n"), 'isResponse');
});
await t('对照臂 A13 (c) 字符串 / 注释里的 isResponse: true 不算(不误红): 只在注释与字符串里出现 ⇒ 仍绿', () => {
  const v = checkV9({ ...REAL, 'kasia-relay/src/lib/doc.mjs': "// isResponse: true is built in chain.mjs\nexport const s = 'isResponse: true';\n/* acceptHandshake( */ export const t = \"acceptHandshake(\";\n" });
  assert.deepStrictEqual(v, []);
});

// ── H1-1: NWT 笔一审的 7 个接线变异(6 个当时存活)——现在必须全红 ─────────────────────────────────────────────────
const W = "const doAcceptHandshake = createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress });";
const wiringMut = (name, repl) => t('H1-1 对照臂 ' + name + ' ⇒ 红', () => redWith(mut(K.RM, (s) => must(s, W, repl)), K.RM));
await t('H1-1 基线: 真实接线行整行精确匹配且通过(对照臂的起点)', () => { assert.ok(REAL[K.RM].split('\n').includes(WIRING_LINE)); assert.deepStrictEqual(checkV9(REAL), []); });
await wiringMut('W1 sendKaspa 换 custodialSendKaspa', W.replace('{ acceptHandshake, sendKaspa,', '{ acceptHandshake, sendKaspa: custodialSendKaspa,'));
await wiringMut('W2 ingestHandshake / ingestTx 互换', W.replace('ingestHandshake, ingestTx,', 'ingestHandshake: ingestTx, ingestTx: ingestHandshake,'));
await wiringMut('W3 localAddress 换 CONSOLE_URL', W.replace('localAddress });', 'localAddress: CONSOLE_URL });'));
await wiringMut('W4 log 换 console.log', W.replace(' log,', ' log: console.log,'));
await wiringMut('W5 acceptHandshake 换 sendMessage', W.replace('{ acceptHandshake,', '{ acceptHandshake: sendMessage,'));
await wiringMut('W6 consoleUrl 换 localAddress', W.replace('consoleUrl: CONSOLE_URL', 'consoleUrl: localAddress'));
await wiringMut('W7 fetch 换 undefined', W.replace(' fetch,', ' fetch: undefined,'));
await t('H1-1 对照臂 W8 每次调用新建 acceptor: 接线行搬进 poll() 内(不再在模块顶层) ⇒ 红', () => {
  redWith(mut(K.RM, (s) => must(must(s, W + '\n', ''), '        await doAcceptHandshake(conv.contactAddress);', '        await ((' + W.slice('const doAcceptHandshake = '.length, -1) + ')(conv.contactAddress));')), K.RM);
});
await t('H1-1 对照臂 W9 接线行还在但被注释掉 / 多复制一份 ⇒ 红', () => {
  redWith(mut(K.RM, (s) => must(s, W, '// ' + W)), K.RM);
  redWith(mut(K.RM, (s) => must(s, W, W + '\n' + W)), K.RM);
});
await t('H1-1 对照臂 W10 声明来源被换: sendKaspa 改从别处 import / log 被重新声明 / CONSOLE_URL 换写法 / localAddress 换写法 ⇒ 红', () => {
  redWith(mut(K.RM, (s) => must(s, 'acceptHandshake, sendKaspa, custodialSendKaspa } from "./chain.mjs";', 'acceptHandshake, custodialSendKaspa } from "./chain.mjs";\nimport { sendKaspa } from "./lib/transaction.mjs";')), K.RM);
  redWith(mut(K.RM, (s) => must(s, 'function log(...args) {', 'const log = (...args) => console.log(...args);\nfunction log2(...args) {')), K.RM);
  redWith(mut(K.RM, (s) => must(s, 'const CONSOLE_URL = process.env.CONSOLE_URL || "";', 'const CONSOLE_URL = process.env.OTHER_URL || "";')), K.RM);
  redWith(mut(K.RM, (s) => must(s, 'const localAddress = getWallet().getAddress();', 'const localAddress = process.env.SOMETHING;')), K.RM);
  redWith(mut(K.RM, (s) => must(s, 'import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from "./ingest.mjs";', 'import { ingestMessage, ingestReply, ingestTx, ingestHandshake } from "./ingest.mjs";\nimport { ingestTx as ingestHandshake } from "./x.mjs";')), K.RM);
});

// ── 启动行位置(V5 结构侧): relay.mjs 顶层、RELAY_MODE 分支之前, 恰一处 ─────────────────────────────────────────────
function checkStartupLine(src) {
  const v = [];
  const { code } = view(src);
  const calls = occurrences(code, /\bhandshakeStartupLine\s*\(/);
  const branch = code.search(/\bif\s*\(\s*RELAY_MODE\s*===/);
  if (calls.length !== 1) v.push(`handshakeStartupLine( 应恰 1 处(实得 ${calls.length})`);
  else {
    const depth = depthBefore(code, calls[0]);
    if (depth !== 0) v.push(`启动行不在模块顶层(花括号深度 ${depth})`);
    if (branch < 0 || calls[0] > branch) v.push('启动行应在 if (RELAY_MODE === …) 分支之前');
    if (!/handshakeStartupLine\s*\(\s*process\.env\s*,\s*RELAY_MODE\s*\)/.test(code.slice(calls[0], calls[0] + 80))) v.push('启动行应带 RELAY_MODE 参数');
  }
  return v;
}
await t('V5 结构: relay.mjs 启动行在模块顶层、RELAY_MODE 分支之前、带 RELAY_MODE、恰一处', () => assert.deepStrictEqual(checkStartupLine(REAL[K.RM]), []));
await t('V5 结构对照臂: 启动行挪进 rpc 分支内 / 挪到分支之后 / 复制第二处 / 删掉 ⇒ 红', () => {
  const line = 'log(handshakeStartupLine(process.env, RELAY_MODE));\n';
  assert.ok(REAL[K.RM].includes(line));
  assert.ok(checkStartupLine(REAL[K.RM].replace(line, '').replace('if (RELAY_MODE === "rpc") {', 'if (RELAY_MODE === "rpc") {\n  ' + line)).length > 0, '进分支应红');
  assert.ok(checkStartupLine(REAL[K.RM].replace(line, '') + '\n' + line).length > 0, '挪到分支之后应红');
  assert.ok(checkStartupLine(REAL[K.RM].replace(line, line + line)).length > 0, '重复应红');
  assert.ok(checkStartupLine(REAL[K.RM].replace(line, '')).length > 0, '删掉应红');
  assert.ok(checkStartupLine(REAL[K.RM].replace(line, "log('handshake auto-accept: DISABLED');\n")).length > 0, '手写日志不走 handshakeStartupLine 应红');
});

// ── V6 口径: 启动行文本只有一个来源(否则 grep -c 'handshake auto-accept: DISABLED' 的计数 != relay 子进程数) ─────────────────────────
function startupLineSources(files) {
  const hits = [];
  for (const [rel, src] of Object.entries(files)) if (/handshake auto-accept: (?:DISABLED|ENABLED)/.test(stripComments(src))) hits.push(rel);
  return hits;
}
await t('V6 口径: "handshake auto-accept: DISABLED/ENABLED" 文本只出现在 handshake-switch.mjs 一处(relay.mjs 调它、rpc-listener 不另打)', () => {
  assert.deepStrictEqual(startupLineSources(REAL), ['kasia-relay/src/lib/handshake-switch.mjs']);
});
await t('V6 口径对照臂: rpc-listener 另打一行同文本 / relay.mjs 手写一行 ⇒ 来源不止一处(红)', () => {
  const DUP = "\nlog('handshake auto-accept: DISABLED (dup)');\n";
  assert.ok(startupLineSources(mut(K.RL, (s) => s + DUP)).length > 1);
  assert.ok(startupLineSources(mut(K.RM, (s) => s + DUP)).length > 1);
});

// ── 扫描器自身的锚点(F5): 用的是共享扫描器的状态机版 stripComments, 不是本文件私有正则 ─────────────────────────────────
await t('用的是共享扫描器状态机版 stripComments: 字符串含 // 后的真调用被保留(旧简单正则会吞掉)', () => {
  assert.ok(stripComments("const u = 'a//b'; acceptHandshake(1); // tail").includes('acceptHandshake(1)'));
});

console.log(`\nhandshake-switch-scan.test: ${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
