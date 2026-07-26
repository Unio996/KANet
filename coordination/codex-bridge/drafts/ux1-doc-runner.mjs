#!/usr/bin/env node
// ux1-doc-runner.mjs — UX1 Quickstart 文档执行器 v0.1 (J2, 契约 DRI)
//
// 卡: c45acd37 v1.2 §6A.2 UX1-LIVING-QUICKSTART
// 判据来源(全部是今晚被红队/裁定钉死的, 逐条注明, 免得下一版有人以为可以简化):
//   · Bettor 04:42 裁: 【文档是源】—— runner 抽取并执行文档里的块, 不是另维护一份脚本
//   · Bettor 04:54 / J2 04:52: 【开闭配对遍历, 不许用正则数围栏】—— 正则会把闭合围栏一起数进去,
//     两人各自踩过同一个坑
//   · NWT 04:39 ④: 【三态不设兜底】—— 无名兜底会静默吸收不合身的东西
//   · J2 04:47: 【未标注的块单独计数且刺眼】+ shrink-only 棘轮
//   · J2 04:56 / NWT 04:38: 【单一来源 ≠ 唯一来源】—— 加状态词扫描拦第二份
//   · 通用: 【空集不许判绿】—— 读到 0 个块一律作废
//
// 🔴🔴 一处【故意的偏离】, 理由必须留在这里:
//   "执行文档里的 bash 块"最朴素的写法是 sh -c <块内容>。**我不那么写。**
//   那等于: 谁能改这份 markdown, 谁就能在跑 runner 的人机器上执行任意命令 ——
//   而这份文档【正要给外部读者看】, 且将来要进 CI。
//   ⇒ 改为: runner 把块解析成 {method, url}, 自己用 fetch 发【只读 GET】。
//     解析不出只读 GET 的块 ⇒ NOT_RUN + 写明拒绝理由, 绝不"尽力而为地跑一下"。
//   ⚠️ 代价我明标: 这意味着 runner 能跑的块【只有 GET 这一种形状】。
//     文档将来若出现别的形状(POST/签名/多步), runner 会如实报 NOT_RUN, 而不是假装覆盖了。
//
// 用法:
//   node ux1-doc-runner.mjs <doc.md> [--http] [--host 127.0.0.1] [--accept-shrink]
//   🔴 默认【不发任何网络请求】。必须显式 --http 才发, 且只发 GET。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const docPath = argv.find((a) => !a.startsWith('--') && a.endsWith('.md'));
if (!docPath) { console.error('用法: node ux1-doc-runner.mjs <doc.md> [--http] [--host H] [--accept-shrink]'); process.exit(2); }

const RATCHET_PATH = new URL('./ux1-unlabeled-ratchet.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DISCLAIMER =
  '⚠️ 本结果【不证明】照本文档操作的人能成功。它只证明: 被标 ux1:executable 的块, ' +
  '在本机、由本 runner、按 GET 形状发出去时得到了预期响应。文档里的散文、前提、顺序、' +
  '以及"外部读者能不能连到这台机器", 本 runner 一概不验。';

// ── 状态三态 + 一个刺眼的第四类。🔴 第四类不是兜底, 它是【报错通道】。 ──────────
const KIND = Object.freeze({ EXEC: 'EXEC', NON_EXEC: 'NON_EXEC', UNLABELED: 'UNLABELED', BAD_LABEL: 'BAD_LABEL' });

// 🔴 状态词黑名单。诚实标注: 这是【黑名单】, 它只拦我们想到的词。
//   真正的根治是产品面【渲染】能力清单而不是自己写词(J2 04:56 ①)。本条只是 ① 没被执行时的兜底。
const FORBIDDEN_STATUS_WORDS = ['建设中', '开发中', '即将上线', '敬请期待', '正在开发', 'coming soon', 'WIP'];
const STATUS_ENUM = ['MOCK_ONLY', 'NOT_AVAILABLE', 'READ_ONLY'];

const lines = readFileSync(docPath, 'utf8').split(/\r?\n/);

// ── ① 开闭配对遍历。不用正则计数 —— 那会把闭合围栏也算成一个块。 ───────────────
function pairFences(ls) {
  const blocks = []; let open = null;
  for (let i = 0; i < ls.length; i++) {
    if (!/^\s*```/.test(ls[i])) continue;
    if (open === null) open = { openLine: i, info: ls[i].replace(/^\s*```/, '').trim() };
    else { blocks.push({ ...open, closeLine: i, body: ls.slice(open.openLine + 1, i).join('\n') }); open = null; }
  }
  return { blocks, unclosed: open };
}

// ── ② 标签只认【紧邻上方】(可跨空行), 遇任何别的内容即停 ────────────────────────
//    🔴 不向上扫描远处 —— 否则一个标签会泄漏到后面每一个块上, 而那正是"数目对但对应错"。
function labelFor(ls, openLine) {
  for (let i = openLine - 1; i >= 0; i--) {
    const t = ls[i].trim();
    if (t === '') continue;
    const m = t.match(/^<!--\s*(ux1:[^\s>]+)([^>]*)-->$/);
    if (!m) return null;
    return { tag: m[1], rest: (m[2] || '').trim(), line: i };
  }
  return null;
}

function classify(lab) {
  if (lab === null) return { kind: KIND.UNLABELED, why: '块上方没有 ux1: 标签' };
  if (lab.tag === 'ux1:executable') return { kind: KIND.EXEC, why: '' };
  if (lab.tag === 'ux1:non-exec') {
    const m = lab.rest.match(/reason=(\S+)/);
    // 🔴 没有 reason 的 non-exec 【不算 non-exec】。否则"不可执行"会变成万能借口
    //    —— 与能力清单里"没有条号的 OUT_OF_SCOPE 不许存在"同一条判据。
    if (!m) return { kind: KIND.BAD_LABEL, why: 'ux1:non-exec 缺 reason= ⇒ 不许当作已解释' };
    return { kind: KIND.NON_EXEC, why: m[1] };
  }
  // 🔴 认不出的 ux1: 标签必须刺眼, 绝不落进任何一档
  return { kind: KIND.BAD_LABEL, why: `未知标签 ${lab.tag}` };
}

// ── ③ 只把块解析成只读 GET。解析不出就 NOT_RUN, 不"尽力跑一下"。 ──────────────
function parseReadOnlyGet(body) {
  const cmd = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).join(' ');
  if (!/^curl\b/.test(cmd)) return { ok: false, why: '不是 curl 开头 ⇒ 本 runner 拒绝执行(见文件头"故意的偏离")' };
  if (/(^|\s)(-X|--request)\s+(?!GET\b)/i.test(cmd)) return { ok: false, why: '显式指定了非 GET 方法 ⇒ 拒绝' };
  if (/(^|\s)(-d|--data|--data-binary|--data-raw|-F|--form|-T|--upload-file)\b/.test(cmd)) return { ok: false, why: '带请求体 ⇒ 非只读 ⇒ 拒绝' };
  const u = cmd.match(/["']([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^"']+)["']/) || cmd.match(/\s(https?:\/\/\S+)/);
  if (!u) return { ok: false, why: '取不出 URL ⇒ 拒绝' };
  return { ok: true, url: u[1] };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────
const { blocks, unclosed } = pairFences(lines);
const problems = [];
if (unclosed) problems.push(`🔴 有未闭合的围栏, 开在第 ${unclosed.openLine + 1} 行 ⇒ 抽取不可信`);
// 🔴 空集不许判绿
if (blocks.length === 0) { console.error('🔴 文档里配对到 0 个代码块 —— 判据作废, 不判绿'); process.exit(2); }

const rows = blocks.map((b) => ({ ...b, ...classify(labelFor(lines, b.openLine)) }));
const count = (k) => rows.filter((r) => r.kind === k).length;

console.log(`# UX1 文档执行器 —— ${docPath}`);
console.log(`\n配对到 ${blocks.length} 个代码块 (开闭配对遍历, 未用正则计数)\n`);
console.log('| 行 | info | 归类 | 说明 |');
console.log('|---|---|---|---|');
for (const r of rows) {
  const mark = r.kind === KIND.EXEC ? '✅' : r.kind === KIND.NON_EXEC ? '🔵' : '🔴';
  console.log(`| ${r.openLine + 1}-${r.closeLine + 1} | \`${r.info || '(无)'}\` | ${mark} ${r.kind} | ${r.why || '—'} |`);
}
console.log(`\n归类合计: EXEC=${count(KIND.EXEC)} · NON_EXEC=${count(KIND.NON_EXEC)} · 🔴 UNLABELED=${count(KIND.UNLABELED)} · 🔴 BAD_LABEL=${count(KIND.BAD_LABEL)}`);
console.log(`总判: ${count(KIND.EXEC) + count(KIND.NON_EXEC) + count(KIND.UNLABELED) + count(KIND.BAD_LABEL)} = ${blocks.length} ⇒ ${
  count(KIND.EXEC) + count(KIND.NON_EXEC) + count(KIND.UNLABELED) + count(KIND.BAD_LABEL) === blocks.length ? '每个块都被归了类, 无遗漏' : '🔴 归类数与块数不等'}`);

if (count(KIND.BAD_LABEL) > 0) problems.push(`🔴 ${count(KIND.BAD_LABEL)} 个块的标签不合规 —— 未知标签或 non-exec 缺 reason`);

// ── ④ shrink-only 棘轮: 未标注数只许降 ────────────────────────────────────────
const nUnlabeled = count(KIND.UNLABELED);
// 🔴 首跑抓到的第二个自己的 bug: 基线原本是【全局单值】, 而 runner 会跑多份文档
//   ⇒ 在 A 文档上收紧到 0, 会让 B 文档凭空变红。基线必须【按文档分键】。
const docKey = docPath.replace(/\\/g, '/').split('/').pop();
let store = {};
if (existsSync(RATCHET_PATH)) { try { store = JSON.parse(readFileSync(RATCHET_PATH, 'utf8')); } catch { store = {}; } }
if (typeof store.unlabeled_max === 'number') store = {}; // 旧的全局格式一律作废重建, 不迁移(它本来就是错的)
let baseline = typeof store[docKey] === 'number' ? store[docKey] : null;
const saveRatchet = (n) => { store[docKey] = n; writeFileSync(RATCHET_PATH, JSON.stringify(store, null, 2)); };
if (baseline === null) {
  console.log(`\n⚠️ 「${docKey}」棘轮基线不存在 ⇒ 本次【建立】基线 = ${nUnlabeled}。🔴 首次建立不构成"通过", 它只是把现状记下来。`);
  saveRatchet(nUnlabeled);
} else if (nUnlabeled > baseline) {
  problems.push(`🔴 未标注块数 ${nUnlabeled} > 基线 ${baseline} ⇒ 棘轮只许降。要升必须写具名理由 + 红队引用, 不许改基线了事。`);
} else if (nUnlabeled < baseline) {
  console.log(`\n🔵 未标注块数 ${nUnlabeled} < 基线 ${baseline}。`);
  if (flag('--accept-shrink')) { writeFileSync(RATCHET_PATH, JSON.stringify({ unlabeled_max: nUnlabeled }, null, 2)); console.log('✅ 已收紧基线。'); }
  else console.log('⚠️ 基线【未自动收紧】—— 自动改状态是静默行为。要收紧请显式加 --accept-shrink。');
} else console.log(`\n✅ 未标注块数 ${nUnlabeled} = 基线, 未劣化。`);

// ── ⑤ 状态词扫描: 拦"第二份权威" ─────────────────────────────────────────────
const text = lines.join('\n');
// 🔴 首跑就抓到自己一个假阳: 我在文档里【引用】那个词来解释它为什么被禁, 被当成了"在用它".
//   与"计数把讨论自身计进去"同一形状。⇒ 需要一个【使用 vs 提及】的区分, 而它必须是显式的:
//   行尾加 <!-- ux1:status-word-exempt reason=... -->, 且 reason 不许空(与 non-exec 同判据)。
//   ⚠️ 豁免数【也要报出来】—— 静默的豁免等于没有检查。
const EXEMPT_RE = /<!--\s*ux1:status-word-exempt\s+reason=(\S+)[^>]*-->/;
console.log('\n## 状态词扫描 (拦"单一来源之外的第二份说法")');
const hits = [], exempted = [];
for (const w of FORBIDDEN_STATUS_WORDS) {
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(w)) continue;
    const m = lines[i].match(EXEMPT_RE);
    if (m) exempted.push({ w, line: i + 1, reason: m[1] });
    else hits.push({ w, line: i + 1 });
  }
}
for (const e of exempted) console.log(`🔵 L${e.line} 「${e.w}」已显式豁免 — reason=${e.reason}`);
if (exempted.length) console.log(`⚠️ 共 ${exempted.length} 处豁免。豁免【不是通过】—— 每一处都要有人看得见。`);
const hitWords = [...new Set(hits.map((h) => h.w))];
if (hits.length) problems.push(`🔴 ${hits.length} 处 STATUS 枚举外的能力状态词 (${hits.map((h) => `L${h.line}「${h.w}」`).join(' · ')}) ⇒ 应改为渲染能力清单, 不自己写词`);
else console.log(`✅ 无未豁免命中。文档里出现的枚举 token: ${STATUS_ENUM.filter((s) => text.includes(s)).join(', ') || '(无)'}`);
console.log('⚠️ 强度限界: 这是【黑名单】, 只拦想到的词。拦得住"枚举外的词", 拦不住"枚举内但写错的那个词"。');
console.log('   ⇒ 根治是产品面【渲染】能力清单; 本项只是渲染没被执行时的兜底。');

// ── ⑥ 执行 EXEC 块 (只读 GET, 且默认不发) ────────────────────────────────────
console.log('\n## EXEC 块');
const host = opt('--host', process.env.KANET_HOST || null);
for (const r of rows.filter((x) => x.kind === KIND.EXEC)) {
  const p = parseReadOnlyGet(r.body);
  if (!p.ok) { problems.push(`🔴 第 ${r.openLine + 1} 行的 EXEC 块 NOT_RUN: ${p.why}`); console.log(`🔴 L${r.openLine + 1} NOT_RUN — ${p.why}`); continue; }
  let url = p.url;
  if (url.includes('<KANET_HOST>')) {
    // 🔴 占位符不许静默填默认值 —— 那会让"读者按文档跑"与"runner 跑"变成两件事
    if (!host) { problems.push(`🔴 第 ${r.openLine + 1} 行含占位符 <KANET_HOST> 而未给 --host/KANET_HOST ⇒ NOT_RUN(不静默默认)`); console.log(`🔴 L${r.openLine + 1} NOT_RUN — 占位符未提供取值`); continue; }
    url = url.replaceAll('<KANET_HOST>', host);
  }
  if (!flag('--http')) { console.log(`⏸ L${r.openLine + 1} NOT_RUN — 默认不发网络请求; 加 --http 才发, 且只发 GET。URL=${url}`); problems.push(`⏸ 第 ${r.openLine + 1} 行未实跑(未加 --http) ⇒ 【不得】把本次结果读作"示例可跑"`); continue; }
  try {
    const t0 = Date.now();
    const res = await fetch(url, { method: 'GET' });
    const body = await res.text();
    const ms = Date.now() - t0;
    let json = null; try { json = JSON.parse(body); } catch { /* 非 JSON 如实报, 不吞 */ }
    console.log(`${res.ok ? '✅' : '🔴'} L${r.openLine + 1} GET ${url} ⇒ HTTP ${res.status} (${ms}ms, ${body.length}B, ${json ? 'JSON' : '非 JSON'})`);
    if (!res.ok) problems.push(`🔴 第 ${r.openLine + 1} 行示例返回 HTTP ${res.status}`);
    // 🔴 断言用的每个字段名必须能在文档里 grep 到 —— 否则 runner 在验一份文档没承诺的东西
    for (const f of ['txid']) {
      if (!text.includes(f)) { problems.push(`🔴 runner 想断言字段 \`${f}\`, 而它在文档里 grep 不到 ⇒ 断言无据`); continue; }
      const has = json && Array.isArray(json.messages) && json.messages.length > 0 && typeof json.messages[0][f] === 'string';
      console.log(`   ${has ? '✅' : '🔴'} 响应里 messages[0].${f} 存在且为字符串`);
      if (!has) problems.push(`🔴 第 ${r.openLine + 1} 行示例响应缺 messages[0].${f} —— 而文档正是拿它当"链上凭据"`);
    }
  } catch (e) {
    console.log(`🔴 L${r.openLine + 1} 请求抛错: ${e.message}`);
    problems.push(`🔴 第 ${r.openLine + 1} 行示例请求抛错: ${e.message}`);
  }
}

// ── 结论 ───────────────────────────────────────────────────────────────────────
console.log('\n## 结论');
if (problems.length === 0) console.log('✅ 未发现问题。');
else { console.log(`🔴 ${problems.length} 条:`); for (const p of problems) console.log(`  - ${p}`); }
console.log(`\n${DISCLAIMER}`);
console.log('\n🔴 未满足的 DoD(如实报, 不掩): 「示例由 CI 实际运行」—— 本仓【零 CI】, 本 runner 目前只是一条本地命令。');
console.log('   🔵 而它被设计成可替换: 现在这条命令与将来 CI 里那条【是同一条】, 换的只是谁来敲。');
process.exit(problems.length === 0 ? 0 : 1);
