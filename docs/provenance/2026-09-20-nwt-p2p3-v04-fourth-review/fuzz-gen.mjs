// NWT 四审 N-3: 生成随机 env 文件(UTF-8 带 BOM 写盘, 使 PowerShell 的 Get-Content 与 node 解码一致), 固定种子可复现。
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
let s = 123456789; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WS = [' ', '\t', ' ', '\u0085', ' ', '\u000B', '\u000C', '﻿', '　'];
const NAMES = ['NWTZ_A', 'nwtz_a', 'NWTZ_B', 'Nwtz_B', 'NWTZ_C'];
const VALS = ['1', '0', 'false', 'FALSE', ' ', '"1"', "'1'", '1 ', ' 1', '=', '=1', '#x', 'a b', ' ', ' ', '1 ', 'x=y', '', '', ''];
const EOLS = ['\n', '\r\n', '\r'];
function line() {
  const r = rnd();
  if (r < 0.08) return pick(['#', ' #', '\t#']) + pick(NAMES) + '=' + pick(VALS);
  if (r < 0.12) return pick(['', ' ', '\t', ' ']);
  if (r < 0.16) return 'export ' + pick(NAMES) + '=' + pick(VALS);
  if (r < 0.20) return pick(NAMES);                       // no '='
  if (r < 0.24) return pick(WS) + '=' + pick(VALS);       // empty (whitespace) name
  const pre = rnd() < 0.3 ? pick(WS) : '', mid1 = rnd() < 0.3 ? pick(WS) : '', mid2 = rnd() < 0.2 ? pick(WS) : '';
  return pre + pick(NAMES) + mid1 + '=' + mid2 + pick(VALS);
}
const N = 600; const meta = [];
for (let i = 0; i < N; i++) {
  const n = 1 + Math.floor(rnd() * 6); let txt = '';
  const eolMode = pick(['lf', 'crlf', 'cr', 'mixed']);
  for (let j = 0; j < n; j++) { txt += line(); if (j < n - 1 || rnd() < 0.5) txt += eolMode === 'mixed' ? pick(EOLS) : { lf: '\n', crlf: '\r\n', cr: '\r' }[eolMode]; }
  fs.writeFileSync(path.join(dir, `case_${String(i).padStart(4, '0')}.env`), '﻿' + txt, 'utf8');   // node writes the BOM as EF BB BF
}
console.log('wrote', N, 'cases to', dir);
