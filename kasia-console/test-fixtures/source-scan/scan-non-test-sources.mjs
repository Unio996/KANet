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
  'kasia-console/test-fixtures/', 'kasia-console/test-framework/', 'kasia-console/test/', 'kasia-console/data/', 'kasia-console/logs/',
]);

/** 仓库根(本文件在 kasia-console/test-fixtures/source-scan/ 下)。 */
export function repoRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** 去掉块注释与行注释(保留 '://' 之类字符串里的双斜杠): 注释里提到标识符不算引用。 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
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
