// 阴性对照: 同一批 500 个文件、同一份 oracle2, 换成一个"朴素 JS 解析"(JS trim / JS \s / 直接 utf8 读), 应当出现大量分歧;
// 若朴素版也是 0 分歧, 说明语料或比较没有灵敏度, 上面的 500/500 就不算证据。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const dir = path.join(os.tmpdir(), 'nwt-fuzz-env5');
const oracle = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'nwt-fuzz-oracle5b.json'), 'utf8').replace(/^﻿/, ''));
const hexU = (s) => { let o = ''; for (let i = 0; i < s.length; i++) o += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'); return o; };
function naive(buf) {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const m = new Map();
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    const r = /^([^=]+)=(.*)$/.exec(line); if (!r) continue;
    const k = r[1].trim(); if (/^NWTZ_/i.test(k)) m.set(hexU(k.toUpperCase()), r[2]);
  }
  return m;
}
let same = 0, diff = 0;
for (const [name, o] of Object.entries(oracle)) {
  const omap = new Map(); for (const p of (Array.isArray(o.pairs) ? o.pairs : (o.pairs ? [o.pairs] : []))) omap.set(p.nameHex, p.value);
  const g = naive(fs.readFileSync(path.join(dir, name)));
  if (JSON.stringify([...g].sort()) === JSON.stringify([...omap].sort())) same++; else diff++;
}
console.log(`NAIVE JS parse vs the same oracle: identical=${same} DIFFER=${diff}  (must be clearly > 0 for the 500/500 result to mean anything)`);
