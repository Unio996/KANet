// scan-non-test-sources.mjs — 【仅测试用】"非测试源码里不得出现某标识符"的共享源码扫描器(9-1 F4 笔, NWT F2-1; 与 D26-scan v2 同思路)。
//
// 用途: 守住"某模块只准被测试引用"这类边界(proto-chain-parents-fixtures.mjs、verifyStepInputsOnChainWithTimers …), 让它们不只是头注里的约定。
// 🔴 曾经的漏洞(NWT F2-1, 与 D26-scan v1 同类): 按【目录名在任意深度】跳过 data/logs/scratch——而 kasia-console/src/data/ 是真实运行时源码, 被漏掉; 扫描根不含
//   kasia-console/scripts 与根 scripts; 扩展名只认 mjs/js/cjs。修法: ①排除只按【仓库根的相对路径前缀】(node_modules 是依赖、任意深度跳过是对的); ②扫描整个仓库源码树(不是几个白名单根);
//   ③扩展名放宽到 mjs|js|cjs|ts|mts|cts|jsx|tsx。扫描器自己有带对照臂的自测(scan-non-test-sources.test.mjs)。
// 🟡 已知边界(文本扫描的固有限制, 不假装能堵): 动态拼接的模块名(如 'proto-chain-' + 'parents-fixtures')、经变量的 import()、打包后的产物——扫描看不见。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = /\.(mjs|js|cjs|ts|mts|cts|jsx|tsx)$/;
const TEST_NAME = /\.(test|spec)\.(mjs|js|cjs|ts|mts|cts|jsx|tsx)$/;
/** 只在仓库根按相对路径前缀排除(以 / 结尾)。文档/证据/日志/临时目录与测试代码本身不是"非测试源码"。 */
export const DEFAULT_EXCLUDED_PREFIXES = Object.freeze([
  '.git/', 'docs/', 'scratch/', 'logs/', 'artifacts/', 'test/', 'tests/',
  'shared/test-fixtures/', 'kasia-console/test-fixtures/', 'kasia-console/test-framework/', 'kasia-console/test/', 'kasia-console/data/', 'kasia-console/logs/',
]);

/** 仓库根(本文件在 shared/test-fixtures/source-scan/ 下; 9-2b 起从 kasia-console/test-fixtures/ 搬来, 两个包都可 import, 旧路径留一个 re-export 兼容层)。 */
export function repoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * 去注释的状态机(识别字符串 / 模板字面量 / 正则字面量): 注释里提到标识符不算引用, 而"字符串/模板/正则里长得像注释的文本"不会误吞后面的真引用。
 * 🔴 来源: KANet-UI 的 D26-scan v2.1(f72b0cdb, NWT 三审 16899661 §四 N-4)——原样移入此处, D26-scan 与本扫描器应都从这一处导入, 不再各留一份。
 * 🔴 为什么不是简单正则(NWT F4-1 真实探针证实): 简单正则版在三种形态会【漏报真实引用】——同行前有含 // 的字符串('a//b'; 后面的真调用被当成注释吞掉)、
 *   一个字符串里含块注释起始符、另一个字符串里含块注释结束符(块注释被错误配对)、模板字面量含双斜杠。吞掉真代码是不安全的方向。
 * 下面的实现除本头注外与 v2.1 逐字相同(移植脚本程序化提取)。
 */
export function stripComments(src) {
  let out = '', i = 0, state = 'code', quote = '', inClass = false;
  // regex literals (NWT N-4 / E1): `const re = /[^/*]+/; B.ensure…()` — the `/*` INSIDE the character class must not open a block comment (over-stripping
  // real code is the unsafe direction). A `/` starts a regex literal when the previous significant character cannot end an expression.
  const regexCanStart = () => { const t = out.replace(/\s+$/, ''); if (t === '') return true; const p = t[t.length - 1]; return '(,=:[!&|?{};+-*%<>~^'.includes(p) || /(^|[^\w$.])(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(t); };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && regexCanStart()) { state = 'regex'; inClass = false; out += c; i++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = 'str'; quote = c; out += c; i++; continue; }
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }   // an escaped char in code never opens a comment
      out += c; i++; continue;
    }
    if (state === 'regex') {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === '[') inClass = true; else if (c === ']') inClass = false;
      else if (c === '\n') { state = 'code'; }                       // no newline inside a regex literal: resync
      else if (c === '/' && !inClass) { state = 'code'; }
      out += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; out += ' '; } else { if (c === '\n') out += c; i++; } continue; }
    // string / template: copy verbatim (template ${…} expressions stay visible = treated as code = safe direction)
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if (c === quote) { state = 'code'; out += c; i++; continue; }
    if (c === '\n' && quote !== '`') { state = 'code'; }   // unterminated single-line string: resync at newline
    out += c; i++;
  }
  return out;
}

/** 列出仓库里的非测试源码文件(绝对路径)。node_modules 任意深度跳过; 其余只按相对路径前缀排除。 */
export function listNonTestSources({ rootDir = repoRootDir(), excludedPrefixes = DEFAULT_EXCLUDED_PREFIXES } = {}) {
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        if (excludedPrefixes.some((p) => `${childRel}/`.startsWith(p))) continue;
        walk(path.join(abs, ent.name), childRel);
      } else if (ent.isFile() && EXT.test(ent.name) && !TEST_NAME.test(ent.name)) {
        if (excludedPrefixes.some((p) => childRel.startsWith(p))) continue;
        out.push({ abs: path.join(abs, ent.name), rel: childRel });
      }
    }
  };
  walk(rootDir, '');
  return out;
}

/**
 * 在非测试源码(去注释)里找匹配 pattern 的文件, 返回相对路径数组。exceptRel: 允许出现的文件(定义它的模块自己等)。
 * minFiles: 扫描范围的下限断言(防扫描根失效成空判据); 不足即抛错。
 */
export function findReferencesInNonTestSources(pattern, { rootDir, excludedPrefixes, exceptRel = [], minFiles = 500 } = {}) {
  const files = listNonTestSources({ rootDir, excludedPrefixes });
  if (files.length < minFiles) throw new Error(`扫描到的非测试源码只有 ${files.length} 个(下限 ${minFiles}), 扫描范围疑似失效`);
  const hits = [];
  for (const f of files) {
    if (exceptRel.includes(f.rel)) continue;
    if (pattern.test(stripComments(fs.readFileSync(f.abs, 'utf8')))) hits.push(f.rel);
  }
  return hits;
}
