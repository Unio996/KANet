// 只读 · 给那 92 份 bridge review 建一个【按代码位置反查】的索引
// 目的：让 Bettor 13:07 立的那条规矩可执行 ——
//   「落码到 live 之前，先查那批 review 里有没有审过这块地方」
// 现状：没有任何东西能回答这一问。
//
// 做法：从每份 review 正文里抽出它提到的【源码文件名】，反转成 文件 → review 列表。
// 🔴 边界（先写在这里，免得它被当成"覆盖全部"）：
//   · 它只抽【正文里逐字出现的文件名】。一份 review 讨论某块地方却没写文件名 ⇒ 抽不到。
//   · 所以它回答的是「有没有 review 逐字提过这个文件」，不是「这块地方有没有被审过」。
//   · ⇒ 命中 = 确实有；未命中 ≠ 没审过。这个不对称必须随索引一起交付。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REF = 'origin/coord/codex-bridge';
const DIR = 'coordination/codex-bridge/responses';
// 🔴 不硬编码绝对路径：这个脚本要在【别人的机器上】跑（跨机核实正是它存在的理由之一）。
//    优先 KANET_ROOT，否则从脚本自身位置往上一层推 —— 两条都不依赖"恰好是这台机"。
const REPO = process.env.KANET_ROOT || path.resolve(__dirname, '..');

const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const files = git('ls-tree', '-r', '--name-only', REF)
  .split('\n').filter(l => l.startsWith(DIR + '/') && l.endsWith('.md'));

// 源码文件名形态：xxx.js / xxx.mjs / xxx.cjs / xxx.sil / xxx.sh
const NAME_RE = /\b([A-Za-z0-9._-]+\.(?:mjs|cjs|js|sil|sh))\b/g;

const index = new Map();      // 文件名 -> Set(review 文件名)
const perReview = new Map();  // review -> Set(文件名)
let scanned = 0, bytes = 0;

for (const f of files) {
  let body;
  try { body = git('show', `${REF}:${f}`); } catch { continue; }
  scanned++; bytes += body.length;
  const base = path.basename(f);
  const hits = new Set();
  let m;
  while ((m = NAME_RE.exec(body)) !== null) {
    const n = m[1];
    // 排除 review 自己的文件名与明显的非源码
    if (n.endsWith('.md')) continue;
    hits.add(n);
    if (!index.has(n)) index.set(n, new Set());
    index.get(n).add(base);
  }
  perReview.set(base, hits);
}

const rows = [...index.entries()]
  .map(([n, s]) => ({ name: n, count: s.size, reviews: [...s].sort() }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const out = [];
out.push('# bridge review 反查索引 —— 源码文件 → 审过它的 review');
out.push('');
out.push('> 生成器：`scripts/build-review-index.cjs`（只读，可随时重跑推翻本表）');
out.push('> 用途：**落码到 live 之前，先查这块地方有没有被审过**（Bettor 2026-07-29 13:07 立）。');
out.push('');
out.push('## 🔴 先读这段：它照不到什么');
out.push('');
out.push('它只抽 review 正文里**逐字出现的文件名**。一份 review 讨论了某块地方却没点名文件 ⇒ 它照不到。');
out.push('');
out.push('> ### 🔴 **索引里没有 ≠ 没人审过这块。**');
out.push('> **命中 = 确实有人审过；未命中 = 没查到，仅此而已。**');
out.push('');
out.push('这个不对称是这个工具的性质，不是缺陷 —— 但**把它当成"查过了就是没有"，它就变成又一个没有信息量的绿灯**。');
out.push('');
out.push('还照不到：review 里以路径而非文件名提及的、以功能名描述的、以及非 `.js/.mjs/.cjs/.sil/.sh` 的对象。');
out.push('');
out.push(`扫描：${scanned} 份 review · ${(bytes / 1024).toFixed(0)} KB 正文 · 抽出 ${rows.length} 个不同源码文件名`);
out.push('');
out.push('| 源码文件 | 被几份 review 提到 | review |');
out.push('|---|---|---|');
for (const r of rows) {
  out.push(`| \`${r.name}\` | ${r.count} | ${r.reviews.map(x => x.replace(/^RESPONSE-/, '').replace(/-CODEX-REVIEW\.md$|-CODEX-RULING\.md$|\.md$/, '')).join('<br>')} |`);
}

fs.writeFileSync(path.join(REPO, 'docs/iteration/REVIEW-INDEX-by-source-file.md'), out.join('\n'), 'utf8');

console.log(`扫描 ${scanned} 份 · ${(bytes / 1024).toFixed(0)} KB`);
console.log(`抽出 ${rows.length} 个源码文件名`);
console.log('');
console.log('被提到最多的前 15 个：');
rows.slice(0, 15).forEach(r => console.log(`  ${String(r.count).padStart(2)} × ${r.name}`));
console.log('');
console.log('⇒ 写入 docs/iteration/REVIEW-INDEX-by-source-file.md');
