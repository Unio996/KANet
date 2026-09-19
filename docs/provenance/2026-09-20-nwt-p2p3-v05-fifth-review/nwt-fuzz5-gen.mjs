// NWT 五审 N4-3: 换种子 + 扩编码/空白集的随机 env 文件。写到 %TEMP%\nwt-fuzz-env5(我自己的临时目录)。固定种子可复现。
// 编码: UTF-8+BOM / UTF-16LE+BOM / UTF-16BE+BOM / 无 BOM UTF-8(只 ASCII 名; 值也只 ASCII——无 BOM 时启动器按 ANSI 代码页解码, 非 ASCII 值不在本差分的可比范围)。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env5');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
let s = 987654321;
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
// .NET / JS 空白集分歧最容易出现的字符 + 几个"看起来像空白但不是"的
const WS = [' ', '\t', ' ', '\u0085', '\u000B', '\u000C', ' ', ' ', '᠎', ' ', ' ', ' ', '​', ' ', ' ', ' ', ' ', '⁠', '　', '﻿'];
const NAMES = ['NWTZ_A', 'nwtz_a', 'NWTZ_B', 'Nwtz_B', 'NWTZ_C', 'NWTZ_D'];
const VALS_ASCII = ['1', '0', 'false', ' ', '"1"', "'1'", '1 ', ' 1', '=', '=1', '#x', 'a b', 'x=y', '', '', ''];
const EOLS = ['\n', '\r\n', '\r'];
function line(allowUni) {
  const vals = allowUni ? [...VALS_ASCII, '1 ', ' 1', '1 ', '᠎1', '1᠎', '1\u0085', '\u{1F600}', 'ab\u0000cd'.replace('\u0000', 'X')] : VALS_ASCII;
  const w = allowUni ? WS : [' ', '\t', '\u000B', '\u000C'];   // 无 BOM: 只放 ASCII 空白
  const r = rnd();
  if (r < 0.08) return pick(['#', ' #', '\t#']) + pick(NAMES) + '=' + pick(vals);
  if (r < 0.12) return pick(['', ' ', '\t', ...(allowUni ? [' ', ' ', '　', '\u0085'] : [])]);
  if (r < 0.16) return 'export ' + pick(NAMES) + '=' + pick(vals);
  if (r < 0.20) return pick(NAMES);
  if (r < 0.24) return pick(w) + '=' + pick(vals);
  const pre = rnd() < 0.35 ? pick(w) : '', mid1 = rnd() < 0.35 ? pick(w) : '', mid2 = rnd() < 0.25 ? pick(w) : '';
  return pre + pick(NAMES) + mid1 + '=' + mid2 + pick(vals);
}
const N = 500; const meta = [];
for (let i = 0; i < N; i++) {
  const enc = pick(['utf8bom', 'utf8bom', 'utf16le', 'utf16be', 'utf8nobom', 'utf8nobom']);
  const allowUni = enc !== 'utf8nobom';
  const n = 1 + Math.floor(rnd() * 6); let txt = '';
  const eolMode = pick(['lf', 'crlf', 'cr', 'mixed']);
  for (let j = 0; j < n; j++) { txt += line(allowUni); if (j < n - 1 || rnd() < 0.5) txt += eolMode === 'mixed' ? pick(EOLS) : { lf: '\n', crlf: '\r\n', cr: '\r' }[eolMode]; }
  let buf;
  if (enc === 'utf8bom') buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(txt, 'utf8')]);
  else if (enc === 'utf16le') buf = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(txt, 'utf16le')]);
  else if (enc === 'utf16be') { const b = Buffer.from(txt, 'utf16le'); b.swap16(); buf = Buffer.concat([Buffer.from([0xFE, 0xFF]), b]); }
  else buf = Buffer.from(txt, 'utf8');
  const name = `case_${String(i).padStart(4, '0')}.env`;
  fs.writeFileSync(path.join(dir, name), buf);
  meta.push([name, enc]);
}
fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify(meta));
console.log('wrote', N, 'cases to', dir);
