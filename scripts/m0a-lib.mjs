// M0a 裸 import 差分门 · 单源核心库(生成器与 lint 共用同一套枚举/归一化/判定, 设计 §6.3 单源铁律)
// 设计: docs/2026-07-22-m0a-bare-import-differential-lint-design.md v0.2 (NWT GREEN 8c7870bb)
// 模型: path 键逐 occurrence 精确镜像 + git rename(-M) 身份延续。baseline 是现实的镜像不是额度。
import { execFileSync } from 'child_process';
import crypto from 'crypto';
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
  'kasia-console/src/services/relay-manager.js', // 唯一规范模块(嵌套陈旧副本已随卫生卡删除, 白名单收窄)
]);

export const BASELINE_PATH = 'scripts/m0a-bare-import-baseline.json';
export const MANIFEST_PATH = 'scripts/m0a-exception-manifest.json';

// ── considered amendment(2026-07-23, NWT 4 约束): 窄 capability m0c-controlled-relay-endpoint ──
// M0c-1 收窄后, 所有 relay 访问该走的正规 funnel(operator-settle 专道 / 未来能力网关)理应 import
// relay-manager; 但 §5 对 relay-manager 族原文是"不开任何通道"完全硬拒。红队定这是一次 considered
// amendment: 加一个窄 capability, 只对白名单内的受控 funnel 文件放行, 受 4 约束焊死:
//   ① "受控非裸连"(端点必过 authorizeCommand+命令白名单+不裸透传)= NWT diff 审判的语义, lint 不校;
//      lint 只校 manifest schema(capability 合法/字段全/digest 匹配/白名单命中)。
//   ② lint 只是完整性门, NWT diff 审是唯一 load-bearing 闸。
//   ③ 白名单有界、shrink-only(只准收窄, 扩张走 NWT 审 + Owner 知情)。
//   ④ TOCTOU 防御: 条目 content_digest 锚定该文件"批准时"内容 sha256, 每次核现内容, 失配=批准后被
//      改过没重审=拒(见 manifestChecks)。
export const CONTROLLED_RELAY_CAP = 'm0c-controlled-relay-endpoint';
// 受控 funnel 白名单(硬编码、有界、shrink-only, 约束③)。扩张(如未来 capability-gateway.js 能力网关)
// 要走 NWT 审 + Owner 知情, 不预先塞占位。
export const CONTROLLED_FUNNEL_ALLOWLIST = new Set([
  'kasia-console/src/api/operator-settle.js', // M0c-1 批B operator 结算专道(relay.js:1726 money-path 出口收敛)
  'kasia-console/src/api/capability.js', // 机制A HTTP 能力网关 custodial_transfer 受控 funnel(NWT G2 整体 diff GREEN·review_ref 3a58f2b4·MRC-capability-gateway-wallet-transfer)
]);

// ── considered amendment #2(2026-07-23, Bettor 快裁·blocker): 窄 capability m0c1-provision-writer ──
// M0c-1 app provision 的 operator 离线脚本(grant-provision.mjs)直写 grant DB 是 NWT GREEN 判据③本意
// (零 HTTP/IPC/relay 写入面=场景A结构不可达的实现方式), 但 M0a 三 capability 无一适配 writer。
// 同 m0c-controlled-relay-endpoint 先例四约束 + writer 特有静态负面检查(NWT §③ grep 判据机制化):
//   ① 白名单有界 shrink-only(仅 grant-provision.mjs, 扩张走 NWT 审 + Owner 知情)。
//   ② content_digest TOCTOU 锚(批准时内容 sha256, 失配=改过没重审=拒)。
//   ③ writer 不走 checkReadonlyConstraint(直写是其存在意义), 换 provision 专属静态负面检查:
//      文件内禁 relay-manager import / 禁 http·fetch·listen·sendCommand 面(离线纯 DB 写)。
//   ④ lint 是完整性门, NWT diff 审仍是唯一 load-bearing 闸(受控语义人审)。
export const PROVISION_WRITER_CAP = 'm0c1-provision-writer';
export const PROVISION_WRITER_ALLOWLIST = new Set([
  'kasia-console/scripts/m0c1-grant-provision.mjs', // M0c-1 app provision operator 离线签发脚本(唯一 registry 写入方)
]);

// ── considered amendment #3(2026-07-24, Bettor 裁定·Codex MF2 步骤4 reviewed helper)：
// 窄 capability m0c1-pilot-custodial-writer ──
// m0c1-provision-writer 是 m0c1_app_grants(grant registry)那个写权威专锚——语义刻意窄化,
// 不该被"写 tg_custodial_wallets(pilot custodial 钱包表)"的另一个 writer 蹭进同一
// capability 名字(两张不同表/不同写权威, 混进一个名字会稀释每个 capability 的语义纯度,
// 也给"以后随便什么 writer 都往 provision-writer 里塞"开口子)。故照抄 provision-writer
// 的四约束模型新开一个专属窄 capability, 白名单只锚 m0c1-pilot-custodial-insert.mjs：
//   ① 白名单有界 shrink-only(仅这一个文件, 扩张走 NWT 审 + Owner 知情)。
//   ② content_digest TOCTOU 锚(批准时内容 sha256, 失配=改过没重审=拒)。
//   ③ writer 不走 checkReadonlyConstraint(直写是其存在意义), 换专属静态负面检查：
//      文件内禁 relay-manager import / 禁 http·fetch·listen·sendCommand 面(离线纯 DB 写)。
//   ④ lint 是完整性门, NWT diff 审仍是唯一 load-bearing 闸(受控语义人审)。
export const PILOT_CUSTODIAL_WRITER_CAP = 'm0c1-pilot-custodial-writer';
export const PILOT_CUSTODIAL_WRITER_ALLOWLIST = new Set([
  'kasia-console/scripts/m0c1-pilot-custodial-insert.mjs', // MF2 步骤4 reviewed helper(唯一 pilot custodial 钱包写入方)
]);

// ── considered amendment #4(2026-07-25, Bettor 裁定·G5 v2 regression 测试)：窄 capability
// m0c1-test-fixture-writer ──
// 前三个 writer capability(provision-writer/pilot-custodial-writer)的威胁模型是"离线纯 DB 写脚本
// 不该有网络/relay 面"——但测试 harness 本质不同: 它天然需要起本地 stub 服务(http.createServer)+
// 调子进程(经 execFileSync 打真 RPC), 硬套"零网络面"负面检查会把合法的测试基础设施误拒。这个
// capability 的真实威胁模型是另一件事: "这份写入有没有可能碰到 live 数据"——所以负面检查换成
// "文件内不得出现指向 live console.db 的硬编码路径"(kasia-console/data/console.db 那个具体路径
// 字符串), 而非笼统禁网络面。
//   ① 白名单有界 shrink-only(扩张走 NWT 审 + Owner 知情)。
//   ② content_digest TOCTOU 锚(批准时内容 sha256, 失配=改过没重审=拒)。
//   ③ 专属静态负面检查: 文件内不得硬编码 live console.db 路径字符串(防测试误写生产库的机械防线;
//      "写的确实是隔离 scratch DB"这条实质判断仍是 NWT diff 审的活, 这条只是补一道机械兜底)。
//   ④ lint 是完整性门, NWT diff 审仍是唯一 load-bearing 闸(受控语义人审)。
export const TEST_FIXTURE_WRITER_CAP = 'm0c1-test-fixture-writer';
export const TEST_FIXTURE_WRITER_ALLOWLIST = new Set([
  'kasia-console/test-framework/cases/m0c1-gate/g5-real-chain-smoke-regression.mjs', // G5 v2 regression, 写隔离 scratch/g5-regression.db
]);
const LIVE_CONSOLE_DB_PATH_LITERAL = /kasia-console\/data\/console\.db|kasia-console[\\/]data[\\/]console\.db/;

export const sha256Hex = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

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
// 读文件内容: 优先 git show :path(与被检 occurrence 同一 index 时间面, 防 working-tree 干净 staged
// 藏私货), 回退 fs.readFileSync(首批尚未 add 时)。都无 = null。与 readJsonStaged 同款时间面。
export function readStagedContent(root, rel) {
  try { return git(root, ['show', ':' + rel]); } catch { /* not in index */ }
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
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
// 七字段(MANIFEST_FIELDS)全必填对所有 capability 生效; content_digest 是"仅此 capability 附加必填"
// (m0c-controlled-relay-endpoint), 单独校验(见 manifestChecks relay-manager 分支), 不并入 MANIFEST_FIELDS
// —— 否则 db-readonly / test-fixture 存量条目会因缺新字段被全判挂(向后兼容, NWT 第4约束的兼容边界)。
const CAPABILITIES = new Set(['db-readonly', 'test-fixture', CONTROLLED_RELAY_CAP, PROVISION_WRITER_CAP, PILOT_CUSTODIAL_WRITER_CAP, TEST_FIXTURE_WRITER_CAP]);

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
        msg: `manifest 条目 "${e.id}" capability "${e.capability}" 不在 {${[...CAPABILITIES].join(', ')}}(设计 §5 + considered amendment)。` });
      continue;
    }
    if (e.family === 'relay-manager') {
      // considered amendment(NWT 4 约束): relay-manager 族只经窄 capability m0c-controlled-relay-endpoint
      // 放行受控 funnel。其他 capability = 保持既有硬拒(既有 block, 非新增)。
      if (e.capability !== CONTROLLED_RELAY_CAP) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" family=relay-manager 只能经窄 capability ${CONTROLLED_RELAY_CAP}(受控 funnel), 不开 db-readonly/test-fixture 口 —— 其余 relay-manager import 一律正规审批走仓储层/API(设计 §5 + considered amendment)。` });
        continue;
      }
      // ↓↓↓ 本 amendment 新增的 m0c-controlled-relay-endpoint 安全控制校验 ↓↓↓
      // NWT diff 审(6c612df5)GREEN → fail-closed block(规则65"NWT GREEN 后升 block"触发点)。
      // 判据精确(白名单命中 + digest 匹配), 无误拦 dev 活风险, relay-import 安全控制该硬 block 非 warn。
      // 既有 relay-manager 硬拒(上面 capability!==cap 分支)本就 block, 与此一致。约束②: NWT diff 审
      // 是唯一 load-bearing 闸; lint 是完整性门, 此处硬拒即"完整性不满足"。
      // 约束③ 白名单有界、shrink-only: 非白名单文件用此 capability = 拒。
      if (!CONTROLLED_FUNNEL_ALLOWLIST.has(e.path)) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${CONTROLLED_RELAY_CAP} 但 path ${e.path} 不在受控 funnel 白名单 — 只有 {${[...CONTROLLED_FUNNEL_ALLOWLIST].join(', ')}} 可用此 capability(白名单 shrink-only, 扩张走 NWT 审 + Owner 知情)。` });
        continue;
      }
      // 约束④ TOCTOU 防御: content_digest 仅此 capability 必填, 核现文件内容 sha256 == 批准时 digest。
      if (!('content_digest' in e) || e.content_digest === '' || e.content_digest == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${CONTROLLED_RELAY_CAP} 缺 content_digest — 受控 funnel 条目必填(该文件批准时内容的 sha256 hex, TOCTOU 防御, NWT 第4约束)。` });
        continue;
      }
      const funnelContent = readStagedContent(root, e.path);
      if (funnelContent == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" 指向的受控文件 ${e.path} 不存在于 index — path 锚定 fail-closed: 文件移动必须同步改 manifest。` });
        continue;
      }
      const actualDigest = sha256Hex(funnelContent);
      if (actualDigest !== e.content_digest) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `受控文件 ${e.path} 内容变更(digest 失配: 现 ${actualDigest.slice(0, 12)}… ≠ manifest ${String(e.content_digest).slice(0, 12)}…)需重新 NWT 审并更新 content_digest。` });
        continue;
      }
      // 全过: 合法受控 funnel relay import(白名单命中 + digest 匹配)。放行, 不落 sqlite 只读检查。
      continue;
    }
    if (e.capability === PROVISION_WRITER_CAP) {
      // ↓↓↓ considered amendment #2: m0c1-provision-writer 安全控制校验(先例四约束 + writer 静态负面检查)↓↓↓
      if (e.family !== 'sqlite') {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${PROVISION_WRITER_CAP} 只适配 family=sqlite(provision 直写 grant DB 的裸 sqlite import), 不开其他族口。` });
        continue;
      }
      if (!PROVISION_WRITER_ALLOWLIST.has(e.path)) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${PROVISION_WRITER_CAP} 但 path ${e.path} 不在 provision writer 白名单 — 只有 {${[...PROVISION_WRITER_ALLOWLIST].join(', ')}} 可用此 capability(白名单 shrink-only, 扩张走 NWT 审 + Owner 知情)。` });
        continue;
      }
      if (!('content_digest' in e) || e.content_digest === '' || e.content_digest == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${PROVISION_WRITER_CAP} 缺 content_digest — writer 条目必填(批准时内容 sha256 hex, TOCTOU 防御, 同先例第4约束)。` });
        continue;
      }
      const writerContent = readStagedContent(root, e.path);
      if (writerContent == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" 指向的 writer 文件 ${e.path} 不存在于 index — path 锚定 fail-closed: 文件移动必须同步改 manifest。` });
        continue;
      }
      const writerDigest = sha256Hex(writerContent);
      if (writerDigest !== e.content_digest) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `writer 文件 ${e.path} 内容变更(digest 失配: 现 ${writerDigest.slice(0, 12)}… ≠ manifest ${String(e.content_digest).slice(0, 12)}…)需重新 NWT 审并更新 content_digest。` });
        continue;
      }
      // writer 静态负面检查(NWT app provision verdict §③ grep 判据机制化, 每次核现内容非只批准时):
      // 离线纯 DB 写 = 零 relay 面 + 零网络面。任一出现 = provision 离线性质被破坏 = 拒(需重审)。
      if (/(require\(\s*|from\s+|import\(\s*)['"][^'"]*relay-manager/.test(writerContent)) {
        violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: e.path,
          msg: `${e.path} provision writer 文件内出现 relay-manager import — operator 离线签发脚本没有碰 relay 的理由(场景A结构不可达前提), 拒。` });
        continue;
      }
      if (/\b(fetch\s*\(|https?\.|\.listen\s*\(|sendCommandAsync|createServer)/.test(writerContent)) {
        violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: e.path,
          msg: `${e.path} provision writer 文件内出现网络/relay 面(fetch/http/listen/sendCommandAsync/createServer)— 离线纯 DB 写性质被破坏(NWT §③ 判据), 拒需重审。` });
        continue;
      }
      // 全过: 合法 provision writer(白名单 + digest + 静态负面全净)。放行, 不落只读检查(writer 本意)。
      continue;
    }
    if (e.capability === PILOT_CUSTODIAL_WRITER_CAP) {
      // ↓↓↓ considered amendment #3: m0c1-pilot-custodial-writer 安全控制校验(照 provision-writer 四约束模型) ↓↓↓
      if (e.family !== 'sqlite') {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${PILOT_CUSTODIAL_WRITER_CAP} 只适配 family=sqlite(reviewed helper 直写 tg_custodial_wallets 的裸 sqlite import), 不开其他族口。` });
        continue;
      }
      if (!PILOT_CUSTODIAL_WRITER_ALLOWLIST.has(e.path)) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${PILOT_CUSTODIAL_WRITER_CAP} 但 path ${e.path} 不在 pilot custodial writer 白名单 — 只有 {${[...PILOT_CUSTODIAL_WRITER_ALLOWLIST].join(', ')}} 可用此 capability(白名单 shrink-only, 扩张走 NWT 审 + Owner 知情)。` });
        continue;
      }
      if (!('content_digest' in e) || e.content_digest === '' || e.content_digest == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${PILOT_CUSTODIAL_WRITER_CAP} 缺 content_digest — writer 条目必填(批准时内容 sha256 hex, TOCTOU 防御, 同 provision-writer 先例约束)。` });
        continue;
      }
      const pilotWriterContent = readStagedContent(root, e.path);
      if (pilotWriterContent == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" 指向的 writer 文件 ${e.path} 不存在于 index — path 锚定 fail-closed: 文件移动必须同步改 manifest。` });
        continue;
      }
      const pilotWriterDigest = sha256Hex(pilotWriterContent);
      if (pilotWriterDigest !== e.content_digest) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `writer 文件 ${e.path} 内容变更(digest 失配: 现 ${pilotWriterDigest.slice(0, 12)}… ≠ manifest ${String(e.content_digest).slice(0, 12)}…)需重新 NWT 审并更新 content_digest。` });
        continue;
      }
      // writer 静态负面检查(同 provision-writer 判据, 换成锚 tg_custodial_wallets 那个 writer):
      // 离线纯 DB 写 = 零 relay 面 + 零网络面。任一出现 = writer 离线性质被破坏 = 拒(需重审)。
      if (/(require\(\s*|from\s+|import\(\s*)['"][^'"]*relay-manager/.test(pilotWriterContent)) {
        violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: e.path,
          msg: `${e.path} pilot custodial writer 文件内出现 relay-manager import — operator 离线密钥经手脚本没有碰 relay 的理由, 拒。` });
        continue;
      }
      if (/\b(fetch\s*\(|https?\.|\.listen\s*\(|sendCommandAsync|createServer)/.test(pilotWriterContent)) {
        violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: e.path,
          msg: `${e.path} pilot custodial writer 文件内出现网络/relay 面(fetch/http/listen/sendCommandAsync/createServer)— 离线纯 DB 写性质被破坏, 拒需重审。` });
        continue;
      }
      // 全过: 合法 pilot custodial writer(白名单 + digest + 静态负面全净)。放行, 不落只读检查(writer 本意)。
      continue;
    }
    if (e.capability === TEST_FIXTURE_WRITER_CAP) {
      // ↓↓↓ considered amendment #4: m0c1-test-fixture-writer 安全控制校验(白名单+digest 同前例,
      // 静态负面检查换成"不硬编码 live console.db 路径", 因为威胁模型不是"零网络面"而是"别碰 live 数据") ↓↓↓
      if (e.family !== 'sqlite') {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${TEST_FIXTURE_WRITER_CAP} 只适配 family=sqlite, 不开其他族口。` });
        continue;
      }
      if (!TEST_FIXTURE_WRITER_ALLOWLIST.has(e.path)) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${TEST_FIXTURE_WRITER_CAP} 但 path ${e.path} 不在 test fixture writer 白名单 — 只有 {${[...TEST_FIXTURE_WRITER_ALLOWLIST].join(', ')}} 可用此 capability(白名单 shrink-only, 扩张走 NWT 审 + Owner 知情)。` });
        continue;
      }
      if (!('content_digest' in e) || e.content_digest === '' || e.content_digest == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" capability=${TEST_FIXTURE_WRITER_CAP} 缺 content_digest — writer 条目必填(批准时内容 sha256 hex, TOCTOU 防御, 同先例约束)。` });
        continue;
      }
      const fixtureWriterContent = readStagedContent(root, e.path);
      if (fixtureWriterContent == null) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `manifest 条目 "${e.id}" 指向的 writer 文件 ${e.path} 不存在于 index — path 锚定 fail-closed: 文件移动必须同步改 manifest。` });
        continue;
      }
      const fixtureWriterDigest = sha256Hex(fixtureWriterContent);
      if (fixtureWriterDigest !== e.content_digest) {
        violations.push({ rule: 'R-M0A-MANIFEST-SCHEMA', file: MANIFEST_PATH,
          msg: `writer 文件 ${e.path} 内容变更(digest 失配: 现 ${fixtureWriterDigest.slice(0, 12)}… ≠ manifest ${String(e.content_digest).slice(0, 12)}…)需重新 NWT 审并更新 content_digest。` });
        continue;
      }
      if (LIVE_CONSOLE_DB_PATH_LITERAL.test(fixtureWriterContent)) {
        violations.push({ rule: 'R-M0A-OPS-NOT-READONLY', file: e.path,
          msg: `${e.path} test fixture writer 文件内出现硬编码 live console.db 路径字符串 — 测试写入不该指向生产库, 拒需重审(机械兜底; "写的确实是隔离 scratch DB"这条实质判断仍需 NWT diff 审确认)。` });
        continue;
      }
      // 全过: 合法 test fixture writer(白名单 + digest + 不碰 live db 路径全净)。放行, 不落只读检查(writer 本意)。
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
  // --diff-filter=d 排除删除: 被删文件的路径也会出现在 name-only 里, 不滤会把"正在删除的旧 shadow"误报成"新建 shadow"(卫生卡删陈旧副本时实撞)
  const staged = (() => { try { return git(root, ['diff', '--cached', '--name-only', '--diff-filter=d']); } catch { return ''; } })();
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
