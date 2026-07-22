// M0a 裸 import 差分门 · 单源核心库(生成器与 lint 共用同一套枚举/归一化/判定, 设计 §6.3 单源铁律)
// 设计: docs/2026-07-22-m0a-bare-import-differential-lint-design.md v0.2 (NWT GREEN 8c7870bb)
// 模型: path 键逐 occurrence 精确镜像 + git rename(-M) 身份延续。baseline 是现实的镜像不是额度。
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// key 分隔符: form 是任意归一化代码行(可含空格/竖线等一切可打印字符), NUL 是唯一保证不出现的字符。
// 用 fromCharCode 而非字面转义, 防不可见字节混入源码(实现批踩过的坑)。
export const SEP = String.fromCharCode(0);

// 关键字与引号间空白 = 弹性匹配(NWT 实现批 diff 审 MUST-FIX 7d079ed5: 硬编码单形态可被
// "from  '..'"双空格 / "require( '..'"括号后空格 / tab 绕过)。用 POSIX [[:space:]] 类, 不用 \s
// (git grep -E 是 POSIX ERE, \s 非各平台保证)。
const WS_STAR = '[[:space:]]*', WS_PLUS = '[[:space:]]+';
const IMPORT_PREFIX = `(require\\(${WS_STAR}|from${WS_PLUS}|import\\(${WS_STAR})`;
export const FAMILIES = {
  sqlite: {
    // require('better-sqlite3') / from 'better-sqlite3' / import('better-sqlite3')
    grep: `${IMPORT_PREFIX}['"]better-sqlite3`,
    specifier: /^better-sqlite3$/,
  },
  'relay-manager': {
    grep: `${IMPORT_PREFIX}['"][^'"]*relay-manager(\\.m?js)?['"]`,
    specifier: /(^|\/)relay-manager(\.m?js)?$/,
  },
};

// shadow-module 守门 basename(R-M0A-SHADOW-MODULE): 与守门模块同名的新文件禁建。
// 白名单 = 规范模块本体; 嵌套陈旧副本 kanet-tn12/ 随独立卫生卡消亡后从白名单删除。
export const SHADOW_BASENAMES = /^relay-manager\.(js|mjs|cjs)$/;
export const SHADOW_ALLOWLIST = new Set([
  'kasia-console/src/services/relay-manager.js',
  'kanet-tn12/kasia-console/src/services/relay-manager.js', // 陈旧副本, burn_down=hygiene-card
]);

export const BASELINE_PATH = 'scripts/m0a-bare-import-baseline.json';
export const MANIFEST_PATH = 'scripts/m0a-exception-manifest.json';

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'] }); // stderr 压掉: git show :path 探测失败走 fallback 是预期路径, 不该刷 fatal 噪音

// ── occurrence 枚举(读 index/staged 内容, 防 working-tree 干净 staged 藏私货, 设计 §6.2) ──
// 返回 Map<path, Map<familyKey+SEP+form, count>>
export function enumerateOccurrences(root) {
  const byFile = new Map();
  for (const [family, def] of Object.entries(FAMILIES)) {
    let out = '';
    try {
      out = git(root, ['grep', '--cached', '-nE', def.grep, '--', '*.js', '*.mjs', '*.cjs']);
    } catch (e) {
      if (e.status === 1) continue; // no match
      throw e;
    }
    for (const raw of out.split('\n')) {
      if (!raw) continue;
      const m = raw.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const [, fp, , line] = m;
      if (/^\s*(\/\/|\*)/.test(line)) continue; // 注释行启发(设计 §6.3, 生成与检查同函数=一致偏)
      const form = normalizeForm(line, family);
      if (!form) continue;
      const key = family + SEP + form;
      if (!byFile.has(fp)) byFile.set(fp, new Map());
      const fm = byFile.get(fp);
      fm.set(key, (fm.get(key) || 0) + 1);
    }
  }
  return byFile;
}

// ── form 归一化: specifier 归 basename(堵相对前缀改写坑), 空白折叠, 引号剥除, 去尾分号 ──
export function normalizeForm(line, family) {
  const def = FAMILIES[family];
  let s = line.trim().replace(/;+\s*$/, '');
  let hit = false;
  s = s.replace(/['"]([^'"]+)['"]/g, (whole, spec) => {
    if (def.specifier.test(spec)) { hit = true; return path.posix.basename(spec); }
    return whole;
  });
  if (!hit) return null; // 引号串没匹配上族 specifier(如注释里提到的别的串) = 非本族 occurrence
  return s.replace(/\s+/g, ' ');
}

// ── baseline / manifest 读取 ──
// 优先 index 版本(与被检内容同一时间面), 回退工作树(首批 baseline 尚未 add 时), 都无 = null。
export function readJsonStaged(root, rel) {
  try { return JSON.parse(git(root, ['show', ':' + rel])); } catch { /* not in index */ }
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; }
}
export function readJsonHead(root, rel) {
  try { return JSON.parse(git(root, ['show', 'HEAD:' + rel])); } catch { return null; }
}

// ── staged rename map(git -M 身份延续) ──
export function stagedRenames(root) {
  const map = new Map(); // newPath -> oldPath
  let out = '';
  try { out = git(root, ['diff', '--cached', '-M', '--name-status']); } catch { return map; }
  for (const raw of out.split('\n')) {
    const m = raw.match(/^R\d*\t([^\t]+)\t([^\t]+)$/);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

const entryKey = (e) => e.path + SEP + e.family + SEP + e.form;

// ── 主判定: 精确镜像(设计 §3.2 表) ──
// 返回 violations: [{rule, msg, file}]
export function diffAgainstBaseline(root) {
  const violations = [];
  const baseline = readJsonStaged(root, BASELINE_PATH);
  const manifest = readJsonStaged(root, MANIFEST_PATH);
  if (!baseline || !Array.isArray(baseline.entries)) {
    violations.push({ rule: 'R-M0A-BARE-IMPORT-DIFF', file: BASELINE_PATH,
      msg: `baseline 不存在或损坏 — 跑 node scripts/gen-m0a-baseline.mjs 生成后 git add。M0a 门 fail-closed。` });
    return violations;
  }
  // 允许集: baseline ∪ manifest, 键 = path+family+form → count
  const allowed = new Map();
  for (const e of baseline.entries) allowed.set(entryKey(e), (allowed.get(entryKey(e)) || 0) + (e.count || 1));
  for (const e of (manifest && Array.isArray(manifest.entries) ? manifest.entries : []))
    allowed.set(entryKey(e), (allowed.get(entryKey(e)) || 0) + (e.count || 1));

  const current = enumerateOccurrences(root);
  const renames = stagedRenames(root);
  const seen = new Set();

  for (const [fp, forms] of current) {
    for (const [key, count] of forms) {
      const [family, form] = key.split(SEP);
      const k = fp + SEP + key;
      seen.add(k);
      const allow = allowed.get(k) || 0;
      if (count > allow) {
        const old = renames.get(fp);
        const hint = old && allowed.get(old + SEP + key)
          ? `检测到本 commit 纯移动 ${old} → ${fp}: 请跑 node scripts/gen-m0a-baseline.mjs --refresh-paths 并把 baseline 一起 stage(机械 path 改写, lint 会核验)。`
          : `新增裸 ${family} import 即败(M0a 门)。合法通道: 经审 manifest(${MANIFEST_PATH}) 或删除该 import 改走仓储层/HTTP API。若这是分两 commit 的移动: 纯移动请单 commit 内 git mv 完成。`;
        violations.push({ rule: 'R-M0A-BARE-IMPORT-DIFF', file: fp,
          msg: `${fp} 裸 ${family} import "${form}" ×${count} 超出 baseline+manifest 额度(${allow})。${hint}` });
      }
    }
  }
  // 反向: baseline 条目在现实中已减少/消失 → 必须同 commit prune 落账(镜像不许悬空)
  for (const e of baseline.entries) {
    const k = entryKey(e);
    const cur = current.get(e.path)?.get(e.family + SEP + e.form) || 0;
    if (cur < (e.count || 1)) {
      violations.push({ rule: 'R-M0A-BARE-IMPORT-DIFF', file: e.path,
        msg: `baseline 记录 ${e.path} 裸 ${e.family} import ×${e.count} 现实只剩 ${cur} — 燃尽必须同 commit 落账: 跑 node scripts/gen-m0a-baseline.mjs --prune 并把 baseline 一起 stage(防 headroom 银行, 设计 §3.2)。` });
    }
  }
  return violations;
}

// ── R-M0A-BASELINE-EDIT-GUARD: baseline 编辑三合法形态(设计 §4) ──
export function baselineEditGuard(root) {
  const violations = [];
  const head = readJsonHead(root, BASELINE_PATH);
  const staged = readJsonStaged(root, BASELINE_PATH);
  if (!head) return violations; // 首批采纳(HEAD 无 baseline)不设卡
  if (!staged || !Array.isArray(staged.entries)) {
    violations.push({ rule: 'R-M0A-BASELINE-EDIT-GUARD', file: BASELINE_PATH,
      msg: 'baseline 被删除或损坏 — baseline 只准收缩/path 改写, 不准整体移除(M5 豁免表物理删除是路线图批次动作, 走正规审)。' });
    return violations;
  }
  const headMap = new Map(head.entries.map((e) => [entryKey(e), e]));
  const renames = stagedRenames(root);
  for (const e of staged.entries) {
    const k = entryKey(e);
    const h = headMap.get(k);
    if (h) {
      if ((e.count || 1) > (h.count || 1))
        violations.push({ rule: 'R-M0A-BASELINE-EDIT-GUARD', file: BASELINE_PATH,
          msg: `baseline 条目 ${e.path} count ${h.count}→${e.count} 增加 — 硬拒。增长唯一通道 = manifest(经审)。` });
      headMap.delete(k);
      continue;
    }
    // 新键: 只允许 path 改写且与 staged rename 对一一对应(form/count 不变)
    const old = renames.get(e.path);
    const hk = old ? old + SEP + e.family + SEP + e.form : null;
    const oh = hk ? headMap.get(hk) : null;
    if (oh && (oh.count || 1) === (e.count || 1)) { headMap.delete(hk); continue; }
    violations.push({ rule: 'R-M0A-BASELINE-EDIT-GUARD', file: BASELINE_PATH,
      msg: `baseline 出现 HEAD 没有的条目 ${e.path} (${e.family}) 且无对应 git rename 对 — 新增/伪造 path 改写硬拒。增长唯一通道 = manifest。` });
  }
  // headMap 剩余 = 被删条目(合法收缩), 不报。
  return violations;
}

// ── R-M0A-MANIFEST-SCHEMA + R-M0A-OPS-NOT-READONLY(设计 §5) ──
const MANIFEST_FIELDS = ['id', 'family', 'form', 'path', 'capability', 'justification', 'review_ref'];
const CAPABILITIES = new Set(['db-readonly', 'test-fixture']);

export function manifestChecks(root) {
  const violations = [];
  const manifest = readJsonStaged(root, MANIFEST_PATH);
  if (!manifest) return violations; // manifest 可以不存在(= 零例外)
  if (!Array.isArray(manifest.entries)) {
    violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH, msg: 'manifest 损坏: entries 不是数组。' });
    return violations;
  }
  for (const e of manifest.entries) {
    const missing = MANIFEST_FIELDS.filter((f) => !(f in e) || e[f] === '' || e[f] == null);
    if (missing.length) {
      violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
        msg: `manifest 条目 "${e.id || '(无id)'}" 缺字段: ${missing.join(', ')} — 七字段全必填(缺 key = 这个维度没人想过)。` });
      continue;
    }
    if (!CAPABILITIES.has(e.capability)) {
      violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
        msg: `manifest 条目 "${e.id}" capability "${e.capability}" 不在 {db-readonly, test-fixture} — relay-manager 族不开任何 ops/test 口(设计 §5)。` });
      continue;
    }
    if (e.family === 'relay-manager') {
      violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
        msg: `manifest 条目 "${e.id}" family=relay-manager — 该族不开 manifest 通道, 新增一律正规审批走仓储层/API(设计 §5)。` });
      continue;
    }
    // 静态限制核验(读 index 内容)
    let content = null;
    try { content = git(root, ['show', ':' + e.path]); }
    catch { try { content = fs.readFileSync(path.join(root, e.path), 'utf8'); } catch { /* gone */ } }
    if (content == null) {
      violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: MANIFEST_PATH,
        msg: `manifest 条目 "${e.id}" 指向的 ${e.path} 不存在于 index — path 锚定 fail-closed: 文件移动必须同步改 manifest。` });
      continue;
    }
    violations.push(...checkReadonlyConstraint(e, content));
    if (e.capability === 'test-fixture') {
      const inTestPath = /(^|\/)test-framework\//.test(e.path) || /\.test\.[cm]?js$/.test(e.path) || /(^|\/)test\//.test(e.path);
      if (!inTestPath) {
        violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: e.path,
          msg: `manifest 条目 "${e.id}" capability=test-fixture 但文件不在测试路径模式(test-framework/ 或 *.test.* 或 test/) — 静态限制不满足。` });
      } else if (e.review_ref === 'self-serve:readonly-test') {
        // 自助道合法条件已由 checkReadonlyConstraint + inTestPath 覆盖, 到这里即静态可核全过。
      }
    }
    if (e.capability === 'db-readonly' && e.review_ref === 'self-serve:readonly-test') {
      violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
        msg: `manifest 条目 "${e.id}" db-readonly 不适用自助 review_ref — ops 诊断工具走人审锚(频道 txid / ledger)。` });
    }
  }
  return violations;
}

// new Database(...) 每处必须静态可证 readonly:true; 计算 opts 无法核 = 拒非跳过(NWT 实现批注记, fail-closed)
export function checkReadonlyConstraint(entry, content) {
  const violations = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/new\s+Database\s*\(/.test(lines[i]) || /^\s*(\/\/|\*)/.test(lines[i])) continue;
    const window = lines.slice(i, i + 3).join(' ');
    if (!/readonly\s*:\s*true/.test(window)) {
      violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: entry.path,
        msg: `${entry.path}:${i + 1} new Database(...) 无法静态核出 readonly:true(字面缺失或 opts 为计算值) — fail-closed 拒(计算 opts 不豁免, NWT 注记)。manifest 条目 "${entry.id}"。` });
    }
  }
  if (entry.family === 'sqlite' && /(require\(\s*|from\s+|import\(\s*)['"][^'"]*relay-manager/.test(content)) {
    violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: entry.path,
      msg: `${entry.path} manifest 只读例外文件内出现 relay-manager import — 只读诊断没有碰 relay 的理由, 拒。` });
  }
  return violations;
}

// ── R-M0A-SHADOW-MODULE(设计 §6.1, 裁定③): 禁新建与守门模块同 basename 的文件 ──
export function shadowModuleCheck(root) {
  const violations = [];
  let out = '';
  try { out = git(root, ['ls-files']); } catch { return violations; }
  const staged = (() => { try { return git(root, ['diff', '--cached', '--name-only']); } catch { return ''; } })();
  const all = new Set([...out.split('\n'), ...staged.split('\n')].filter(Boolean));
  for (const fp of all) {
    if (SHADOW_BASENAMES.test(path.posix.basename(fp)) && !SHADOW_ALLOWLIST.has(fp)) {
      violations.push({ rule: 'R-M0A-SHADOW-MODULE', file: fp,
        msg: `${fp} 与守门模块 relay-manager 同 basename — 禁建(冒充面, 设计 §6.1)。规范模块唯一: kasia-console/src/services/relay-manager.js。` });
    }
  }
  return violations;
}

// ── owner / burn_down 组件归属映射(设计 §4, 显式维护, 生成时落文件供人审) ──
export function classifyOwnership(fp) {
  if (fp.startsWith('kanet-tn12/')) return { owner: 'stale-copy', burn_down: 'hygiene-card' };
  if (fp === 'kasia-console/src/db/client.js') return { owner: 'base-repository-layer', burn_down: 'M5-底座保留' };
  if (fp.startsWith('tg-bot/')) return { owner: 'prediction-app', burn_down: 'M4' };
  if (fp.startsWith('kas-market-maker/')) return { owner: 'exchange-app', burn_down: 'M2' };
  if (/(^|\/)(test|test-framework)\//.test(fp) || /\.test\.[cm]?js$/.test(fp))
    return { owner: 'test', burn_down: 'M5-manifest化' };
  if (fp.startsWith('kasia-console/scripts/') || fp.startsWith('scripts/'))
    return { owner: 'operator-ops', burn_down: 'M5-manifest化' };
  if (fp.startsWith('kasia-console/src/')) return { owner: 'console-core', burn_down: 'M1' };
  return { owner: 'unclassified', burn_down: 'M5-manifest化' };
}

// ── snapshot: 现实 occurrence → baseline 条目(生成器与测试共用) ──
export function snapshotEntries(root) {
  const entries = [];
  for (const [fp, forms] of enumerateOccurrences(root)) {
    for (const [key, count] of forms) {
      const sp = key.indexOf(SEP);
      const family = key.slice(0, sp), form = key.slice(sp + 1);
      entries.push({ path: fp, family, form, count, ...classifyOwnership(fp) });
    }
  }
  return entries;
}

export function runAllM0aChecks(root) {
  return [
    ...diffAgainstBaseline(root),
    ...baselineEditGuard(root),
    ...manifestChecks(root),
    ...shadowModuleCheck(root),
  ];
}
