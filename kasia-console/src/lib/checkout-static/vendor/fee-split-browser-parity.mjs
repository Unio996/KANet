// fee-split-browser-parity.mjs — 守 fee-split-browser.mjs 头注声明的"body 逐字节相同"这句话不落空
// (2026-09-27 补写: 原头注引用本文件、但本文件当时不存在——lint R-FEERULES-CANON-BYPASS warn 审出时
// 发现, 如实补上, 不是设计就有的)。
//
// 判据: 源文件从 `import { blake2b }` 那一行之后的全部内容(不含 import 行本身), 必须与 vendored 版本
// 从同一位置之后的全部内容逐字节相同——唯一允许的差异是各自的 import 语句(bare specifier vs 相对
// 路径指向本目录 vendored blake2b, 浏览器 ESM 无法解析 bare specifier, 见 fee-split-browser.mjs 头注)。
import { readFileSync } from 'node:fs';

const SRC = 'D:/kanet-tn12/kasia-console/src/lib/fee-split.mjs';
const VENDORED = new URL('./fee-split-browser.mjs', import.meta.url);

function bodyAfterImport(text) {
  const idx = text.indexOf("import { blake2b } from");
  if (idx === -1) throw new Error(`未找到 "import { blake2b } from" 行——文件结构变了, 判据本身需要重新对齐: ${text.slice(0, 200)}`);
  const lineEnd = text.indexOf('\n', idx);
  return text.slice(lineEnd + 1);
}

const srcBody = bodyAfterImport(readFileSync(SRC, 'utf8'));
const vendoredBody = bodyAfterImport(readFileSync(VENDORED, 'utf8'));

if (srcBody !== vendoredBody) {
  // 找到第一个不同的字符位置, 打印上下文方便定位
  let i = 0;
  while (i < Math.min(srcBody.length, vendoredBody.length) && srcBody[i] === vendoredBody[i]) i++;
  console.error('FAIL: fee-split-browser.mjs 与 fee-split.mjs 在 import 行之后的内容不再逐字节相同。');
  console.error(`第一个不同处(字符偏移 ${i}):`);
  console.error('  源文件:  ...' + JSON.stringify(srcBody.slice(Math.max(0, i - 40), i + 40)));
  console.error('  vendored: ...' + JSON.stringify(vendoredBody.slice(Math.max(0, i - 40), i + 40)));
  console.error('修法: 把 fee-split.mjs 的改动手工同步进 fee-split-browser.mjs(只改 import 行, 其余逐字节抄), 不是自动同步。');
  process.exit(1);
} else {
  console.log(`PASS: fee-split-browser.mjs 与 fee-split.mjs 在 import 行之后 ${srcBody.length} 字符逐字节相同。`);
}
