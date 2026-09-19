// 握手开关笔二——BEFORE 夹具程序化提取(不手打): 从基线 6635ff89 的 git 对象里逐字截取三个函数的原文, 写到 kasia-relay/test-fixtures/handshake-switch/。
// 函数边界 = 顶层 `[async ]function NAME(` 起, 到其后第一个列 0 的 `\n}\n` 止(这三个文件的顶层函数都是这个风格; 提取后 new Function 求值即证明边界对)。
// 用法(从仓库根): node docs/provenance/2026-09-20-j2-handshake-switch/extract-before-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BASE = '6635ff89';
const OUT = path.join(ROOT, 'kasia-relay/test-fixtures/handshake-switch');
fs.mkdirSync(OUT, { recursive: true });
const show = (p) => execFileSync('git', ['show', `${BASE}:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
function fn(src, name) {
  const m = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
  if (!m) throw new Error('找不到函数 ' + name);
  const end = src.indexOf('\n}\n', m.index);
  if (end < 0) throw new Error('找不到函数结尾 ' + name);
  return src.slice(m.index, end + 3);
}
const rl = show('kasia-relay/src/rpc-listener.mjs');
const ch = show('kasia-relay/src/chain.mjs');
fs.writeFileSync(path.join(OUT, `processHandshake.BEFORE-${BASE}.txt`), fn(rl, 'processHandshake'));
fs.writeFileSync(path.join(OUT, `catchUpHistory.BEFORE-${BASE}.txt`), fn(rl, 'catchUpHistory'));
fs.writeFileSync(path.join(OUT, `acceptHandshake.BEFORE-${BASE}.txt`), fn(ch, 'acceptHandshake'));
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);
