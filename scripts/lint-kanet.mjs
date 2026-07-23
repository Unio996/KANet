#!/usr/bin/env node
// lint-kanet.mjs — KANet 工程陷阱静态扫 (T-NWT-2026-04-26)
//
// 强制 ANTI-PATTERNS.md 规则在 commit 前过. git pre-commit hook 调.
// 失败一条 commit 都不让. 用法:
//   node scripts/lint-kanet.mjs           # 扫整库
//   node scripts/lint-kanet.mjs <file>... # 扫特定文件 (pre-commit hook 用)
//
// 当前规则 (按 ANTI-PATTERNS.md 编号对应):
//   R9  Qwen LLM caller 必有 chat_template_kwargs.enable_thinking=false
//   R10 broker DM kind (_qDm / _enqueue 'dm_*') 必在 broker-action-queue TX_PRODUCING_KINDS 里
//   R11 中文 deterministic regex 含 PAID|FINISH 类完成动作必含 (?:了)? 后缀
//   R6  send broadcast / chat send 必显式带 relayId (不从 LLM/payload 拿)
//   R19 broker SYSTEM_PROMPT/template 不准 hardcoded 完整 EVM 地址 (LLM 会 copy = 钱丢, J1 67903c5b)
//   misc SQL prepare 不准 string interpolation (防 inject)
//
// 不是 ESLint 替代, 是 KANet-specific 模式. 跑 1-2s 完.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MONEY_PATH_MANIFESTS } from '../kasia-console/src/lib/money-path-manifests.mjs';
import { runAllM0aChecks } from './m0a-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const violations = [];
const warnings = [];  // warn-mode: report without blocking commit
const file = (rel) => path.join(ROOT, rel);
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const read = (p) => fs.readFileSync(p, 'utf8');

function violate(rule, msg, file, line) {
  violations.push({ rule, msg, file, line });
}

function warn(rule, msg, file, line) {
  warnings.push({ rule, msg, file, line });
}

function* walk(dir, ext = ['.js', '.mjs']) {
  const skip = new Set(['node_modules', '.git', 'logs', 'dist', 'build', 'out', '.cache', '__tests__']);
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full, ext);
    else if (st.isFile() && ext.some(e => name.endsWith(e))) yield full;
  }
}

// ── 输入: argv 给的 file 列表, 或全库扫 ──
const argv = process.argv.slice(2);
const targets = argv.length > 0
  ? argv.map(p => path.resolve(p)).filter(exists)
  : [...walk(path.join(ROOT, 'kasia-console/src')), ...walk(path.join(ROOT, 'agent-mind/src')), ...walk(path.join(ROOT, 'agent-adapter/src')), ...walk(path.join(ROOT, 'scripts'))];

console.log(`[lint-kanet] scanning ${targets.length} files...`);

// ── R_NULLIFIER_I64: unbounded-N nullifier/claimed/refunded bitmap 禁单 i64 (= 63-slot cap = 假无限) ──
// 根因: i64 bitmap 只 63 可用 bit; merkle depth 允许 >63 leaf 时, winner#64+ 的 slot 装不下 → nullifier 失效 → 双领抽干.
// 出现 2 次 (④ refund-merkle + B2 PayoutShard, J1 复犯) → baked-lint 根治. 解: byte[] 多-slot OR 分桶 ≤63/shard.
// 配 ANTI-PATTERNS / 记忆 feedback-recreatable-utxo-nullifier-defeatable.
// ── R-M0A-* [ERROR×5] (M0a repo-wide differential 门, 2026-07-22, 设计 docs/2026-07-22-m0a-bare-import-differential-lint-design.md v0.2 NWT GREEN):
// 裸 better-sqlite3 / relay-manager import 与 baseline+manifest 精确镜像比对(path 键+git rename 身份延续)。
// 判定逻辑全在 scripts/m0a-lib.mjs(生成器/测试/lint 单源)。检查执行本身失败 = fail-closed 报 ERROR。
function checkM0A() {
  let results;
  try { results = runAllM0aChecks(ROOT); }
  catch (e) {
    violate('R-M0A-BARE-IMPORT-DIFF', `M0a 检查执行失败(fail-closed, 门不许静默失效): ${e.message}`, file('scripts/m0a-lib.mjs'), 0);
    return;
  }
  for (const v of results) violate(v.rule, v.msg, path.isAbsolute(v.file) ? v.file : file(v.file), 0);
}

function checkR_NULLIFIER_I64() {
  const silDirs = [path.join(ROOT, 'kasia-console/src/lib'), path.join(ROOT, '_j2_probe_branch')];
  for (const dir of silDirs) {
    if (!fs.existsSync(dir)) continue;  // exists() 只判 isFile, 目录用 existsSync
    for (const fp of walk(dir, ['.sil'])) {
      let content; try { content = read(fp); } catch { continue; }
      const lines = content.split('\n');
      // 单-i64 nullifier bitmap 声明 (ctor param 或 local): `int ...(claimed|refunded|nullifier)...bitmap`
      const i64Bitmap = lines.findIndex(l => /\bint\b[^=;]*?(claimed|refunded|nullifier)\w*bitmap/i.test(l) && !/byte\s*\[/.test(l));
      if (i64Bitmap < 0) continue;
      // 该合约 merkle depth 是否允许 >63 leaf (2^6=64>63 → depth>=6) OR 标注无限/unbounded/>63
      // 精确信号 = merkle tree_depth 上界允许 >63 leaf (2^6=64>63 → depth>=6). depth<=1 (RootClaim depth-1) 正确用 i64, 不误报.
      const depthM = content.match(/tree_depth\s*<=\s*(\d+)/);
      const depthOver63 = depthM && parseInt(depthM[1], 10) >= 6;
      if (depthOver63) {
        violate('R_NULLIFIER_I64', `单-i64 nullifier bitmap (line ${i64Bitmap + 1}) 但 merkle depth/N 允许 >63 winner → i64 只 63-slot 装不下 → winner#64+ 双领抽干. 必 byte[] 多-slot 或分桶 ≤63/shard (配 feedback-recreatable-utxo-nullifier)`, fp, i64Bitmap + 1);
      }
    }
  }
}

// ── R-LEDGER-SIZE [WARN]: COORD-LEDGER 活跃窗口制 (D-010 2026-07-10, Bettor 拟稿+NWT GREEN) ──
// docs/iteration/COORD-LEDGER.md 单文件无界膨胀过 (7/9 实测 301KB, 接位一次读不进要分段翻).
// >100KB 提醒切档到 docs/iteration/archive/COORD-LEDGER-YYYY-MM.md, warn-not-block (不阻 commit,
// 切档是有意识动作非自动触发). 见 docs/2026-07-10-d010-handoff-status-channel-proposal.md §2.3。
function checkLedgerSize() {
  const ledgerFile = file('docs/iteration/COORD-LEDGER.md');
  if (!exists(ledgerFile)) return;
  const sizeBytes = fs.statSync(ledgerFile).size;
  const THRESHOLD = 100 * 1024;
  if (sizeBytes > THRESHOLD) {
    warn('R-LEDGER-SIZE',
      `COORD-LEDGER.md 现 ${(sizeBytes / 1024).toFixed(0)}KB > ${THRESHOLD / 1024}KB 阈值 — 建议按月切档到 docs/iteration/archive/COORD-LEDGER-YYYY-MM.md (活跃文件只留当月内容+归档索引). 见 D-010 §2.3.`,
      ledgerFile, 0);
  }
}

// ── R-STATUS-GUARD-BLACKLIST [WARN]: UPDATE ...protocol_status 的安全闸用黑名单(NOT IN)启发式提醒换白名单 ──
// (处置设计红队 2026-07-12, NWT H1 + Bettor 钉死"今晚第三次撞同一模式"后要求补的启发式规则): 黑名单
// (NOT IN (...))枚举"不该碰的状态"天生不完备(活库状态集持续增长, 设计者凭记忆写的黑名单会漏, NWT 处置
// 设计红队现场撞到——5 项黑名单漏了 refunded/refunding/disputed 等 10 项活库真实状态)。同一行/相邻窗口
// 内出现 IN(...) 白名单则不告警(已用推荐写法)。启发式非精确 AST, 只在同段 SQL 文本内粗判, 误报可接受
// (WARN 不阻塞, "随手写不强求"精神——Bettor #hgmhxf.2)。
function checkR_STATUS_GUARD_BLACKLIST(fp, content) {
  if (!/\.(mjs|js|cjs)$/.test(fp)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/UPDATE\s+\w+\s+SET[^;]*protocol_status/i.test(lines[i])) continue;
    const windowText = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
    if (!/protocol_status\s*NOT\s+IN\s*\(/i.test(windowText)) continue;
    if (/protocol_status\s+IN\s*\(/i.test(windowText.replace(/NOT\s+IN/i, ''))) continue;   // 同段也有白名单写法, 不告警
    warn('R-STATUS-GUARD-BLACKLIST [WARN]',
      `UPDATE ...protocol_status 的安全闸用黑名单(NOT IN)——枚举"不该碰的状态"天生不完备(活库状态集会持续增长/漏项), 改白名单(AND protocol_status IN (目标市场理应处的状态)), 同 R-FEE-SPLIT-PKG-DRIFT/反馈工具 allow-list 同一封闭式防护原则(处置设计 NWT 红队 H1, 2026-07-12)。`,
      fp, i + 1);
  }
}

// ── R-EXPLORER-URL-BYPASS [ERROR, 硬阻塞]: explorer 死域名字面量禁散装 ──
// (explorer 死链全库收敛设计 §3, docs/2026-07-12-explorer-url-dead-link-consolidation-design.md, NWT diff审
// d7c28353 提醒: helper 契约改了但零调用点, 各消费点各自 inline null-safe 重写——不是这条规则堵复发, 收敛
// 目标"防第 N+1 个新散装点"没物理达成, 本规则补上)。explorer-tn12.kaspa.org / explorer.kaspa.org 域名字面量
// 出现在 kasia-console/src/lib/explorer-url.mjs 以外的任何 .js/.mjs/.eta 文件 = ERROR(该 helper 的 mainnet
// 分支合法使用 explorer.kaspa.org, 别处一律不该硬编码——testnet 已知无公网 explorer, mainnet 该走 helper 单源)。
const _EXPLORER_URL_HOME = path.join(ROOT, 'kasia-console/src/lib/explorer-url.mjs');
function checkR_EXPLORER_URL_BYPASS(fp, content) {
  if (!/\.(mjs|js|cjs|eta)$/.test(fp)) return;
  if (path.resolve(fp) === _EXPLORER_URL_HOME) return;   // 唯一合法落点
  if (/旁支重复目录|kanet-tn12[\\/]kanet-tn12/.test(fp)) return;   // 旧重复子目录已知问题, 另案处理不在本规则范围(设计 §4)
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/explorer-tn12\.kaspa\.org|explorer\.kaspa\.org/.test(lines[i])) continue;
    if (/^\s*(\/\/|\*|#)/.test(lines[i]) || /^\s*<!--/.test(lines[i])) continue;   // 纯注释提及(如本次改动的记账注释)不算散装
    violate('R-EXPLORER-URL-BYPASS',
      `explorer 域名字面量硬编码在 explorer-url.mjs 以外的文件——单源契约形同虚设(建了没人被强制用, 死链
全库收敛设计 §3 收敛目标)。改用 buildExplorerUrl/buildExplorerAddressUrl + formatTxReference(kasia-console/
src/lib/explorer-url.mjs), 或(tg-bot/.eta 等不能 import 该 ESM helper 的场景)按同款 null-safe 降级模式手写,
不内联域名字符串。`,
      fp, i + 1);
  }
}

// ── R-PS-FAMILY-DISPATCH [ERROR, 硬阻塞]: compilePayoutShardRedeem/V2Redeem 调用点必在已知白名单内 ──
// (K-18 §3.4 lint 原设计, docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md §3.4)。
// 🔴 落码时核实修正(2026-07-21, J1 grep 全库实测坐实, 不是猜): 原稿以为只有 pool-shard-register.mjs(定义
// 处)+coherence gate 单源两处该出现, 实际 grep 出 bshard-auto-settler.mjs(6 处, close/claim/cancel/refund
// redeem 构建——这些是构建"即将真实广播的花费 TX"所需的合法必经路径, 不是绕过 gate 的散装误用)+
// bshard-settle-daemon.mjs(1 处, P0 已落地的 non-blocking recompile 校验, verify-value-source 已审)也是
// 合法既有调用点——若不列入白名单, 这条规则会把 6+1 处已经过 NWT/Codex 红队审过的生产核心代码全部拦下,
// 是本规则最初设计粒度过细(误以为"物理调用点位置"能作为"是否经过 coherence gate 保护"的判据, 实际两者
// 无必然对应, coherence gate 保护是运行时/调用序列层面的事, 不是文件位置能表达的)。收窄本规则实际能提供
// 的价值: 不是"运行时强制经过 gate"(那需要 AST 级调用图分析, 不是本规则能力范围, 诚实标注非本规则职责),
// 而是"防止第 N+1 个新增/意外调用点悄悄冒出来绕过既有审查纪律"——白名单 = 已知+已审过的合法调用点全集,
// 任何新文件/新位置调这两个函数 = 触发人工审查(是否也该走 coherence gate / splice-not-recompile 纪律)。
const _PS_FAMILY_DISPATCH_WHITELIST = [
  path.join(ROOT, 'kasia-console/src/lib/pool-shard-register.mjs'),          // 定义处
  path.join(ROOT, 'kasia-console/src/lib/bshard-payout-family-coherence.mjs'), // coherence gate 单源(K-18 §3.1-3.3)
  path.join(ROOT, 'kasia-console/src/db/migrate.js'),                        // v189 backfill(一次性, 允许子进程成本)
  path.join(ROOT, 'kasia-console/src/services/bshard-auto-settler.mjs'),     // close/claim/cancel/refund redeem 构建(既有, 已审)
  path.join(ROOT, 'kasia-console/src/services/bshard-settle-daemon.mjs'),    // P0 non-blocking recompile 校验(已审, verify-value-source)
];
function checkR_PS_FAMILY_DISPATCH(fp, content) {
  if (!/\.(mjs|js|cjs)$/.test(fp)) return;
  if (/\.test\.mjs$/.test(fp)) return;   // 测试文件允许直接验证编译产物
  const resolved = path.resolve(fp);
  if (_PS_FAMILY_DISPATCH_WHITELIST.some(w => resolved === w)) return;
  if (/[\\/]scripts[\\/]_\w*k18\w*\.mjs$/.test(fp.replace(/\\/g, '/'))) return;   // K-18 一次性 backfill/诊断脚本同一权限级别
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(\/\/|\*)/.test(lines[i])) continue;   // 纯注释提及不算
    if (!/\bcompilePayoutShard(V2)?Redeem\s*\(/.test(lines[i])) continue;
    violate('R-PS-FAMILY-DISPATCH',
      `compilePayoutShardRedeem/V2Redeem 调用点出现在白名单(pool-shard-register.mjs 定义处 / bshard-payout-
family-coherence.mjs coherence gate 单源 / migrate.js backfill / K-18 诊断脚本 / *.test.mjs)之外的文件——
这两个函数的编译产物只能作 validation-only 校验用, 不能绕过 assertPayoutShardCoherence 直接当花费权威字节
使用(K-18 §3.4, 呼应 Codex MUST-FIX4 教训)。改走 assertPayoutShardCoherence(psRow, {p2sh, tier}) 或 splice
(pool-shard-settle.mjs autoDetectConsolidateResume/consolidateAllShards 已返回 spliced redeemHex, 不需要
自己 recompile)。`,
      fp, i + 1);
  }
}

// ── R-FEE-SPLIT-PKG-DRIFT [ERROR, 硬阻塞]: packages/fee-split/fee-split.mjs 必与源同步 ──
// (B线落3, NWT G1 修法②, 2026-07-12): packages/fee-split/fee-split.mjs 是
// kasia-console/src/lib/fee-split.mjs 的构建产物(packages/fee-split/scripts/sync.mjs 生成, 逐字节复制
// +生成头), 单源策略靠这条规则机制化(手改/漏同步 = commit 卡点, 非 WARN——落1 F1 就在源文件修过一次,
// 若产物 drift, 第三方会拿到已知有漏洞的旧快照, 比不做这个包更糟)。
function checkR_FEE_SPLIT_PKG_DRIFT() {
  const srcFile = file('kasia-console/src/lib/fee-split.mjs');
  const pkgFile = file('packages/fee-split/fee-split.mjs');
  if (!exists(srcFile) || !exists(pkgFile)) return;   // 包未建/源已删, 不在本规则职责内
  const src = read(srcFile);
  const pkg = read(pkgFile);
  // 生成头 = sync.mjs 写的固定两行 + 空行, 剥掉后剩余内容必须逐字节 == 源文件。
  const HEADER_RE = /^\/\/ ⚠ 自动生成 — 勿手改[^\n]*\n\/\/ 手改会被 lint-kanet[^\n]*\n\n/;
  const stripped = pkg.replace(HEADER_RE, '');
  if (stripped !== src) {
    violate('R-FEE-SPLIT-PKG-DRIFT',
      `packages/fee-split/fee-split.mjs 与源 kasia-console/src/lib/fee-split.mjs 不一致(drift)——第三方
会拿到过期/错误的分润组件快照。重新同步: node packages/fee-split/scripts/sync.mjs, 然后 git add 两处一起提交。`,
      pkgFile, 0);
  }
}

// ── R-MANIFEST-* [件④ money-path manifest 门禁, 2026-07-16, NWT 主笔, Owner 终裁件④]: 校验
// kasia-console/src/lib/money-path-manifests.mjs 里的清单条目本身(不是扫源码找漏登记的路径——
// 那是 R-MANIFEST-COVERAGE 的职责, 需要调用图静态分析, 工作量大, 排 v2 独立落, 诚实标注不在本批。
// 本批 3 条规则只校验"已登记条目的数据完整性/一致性", 首批清单参见
// docs/2026-07-16-money-path-manifest-schema-and-lint-gate-design.md)。
//
// R-MANIFEST-SCHEMA-COMPLETE [ERROR]: 每条 manifest 必须有 path_id/description/intake_transaction/
// locked_states/normal_exit/timeout_exit/escape_exit/responsible_worker/kill_switch_effect/
// fault_domain/admin_capabilities/required_tests 十二个顶层字段, 缺一不算合规条目(字段可以是
// null/none/空数组, 但 KEY 本身不能缺——缺 key = 从没被人想过这一维度, 跟"想过了填 none"是两回事)。
const _MANIFEST_REQUIRED_KEYS = [
  'path_id', 'description', 'intake_transaction', 'locked_states', 'normal_exit',
  'timeout_exit', 'escape_exit', 'responsible_worker', 'kill_switch_effect',
  'fault_domain', 'admin_capabilities', 'required_tests',
];
function checkR_MANIFEST_SCHEMA_COMPLETE() {
  const manifestFile = file('kasia-console/src/lib/money-path-manifests.mjs');
  for (const entry of MONEY_PATH_MANIFESTS) {
    const missing = _MANIFEST_REQUIRED_KEYS.filter((k) => !(k in entry));
    if (missing.length > 0) {
      violate('R-MANIFEST-SCHEMA-COMPLETE',
        `manifest 条目 "${entry.path_id || '(无 path_id)'}" 缺字段: ${missing.join(', ')} — schema 定义的十二个顶层字段必须全部存在(值可以是 null/'none'/空数组, 但 key 不能缺, 缺 key 意味着这个维度从没被人想过)。`,
        manifestFile, 0);
    }
  }
}

// R-MANIFEST-EXIT-REACHABLE [ERROR]: normal_exit/timeout_exit/escape_exit 三者至少一个 trigger
// 非 'none' 且 mechanism 非空——三者全空 = 资金锁死无出口, K-10 直接违反(不是 WARN 级别的问题)。
function checkR_MANIFEST_EXIT_REACHABLE() {
  const manifestFile = file('kasia-console/src/lib/money-path-manifests.mjs');
  for (const entry of MONEY_PATH_MANIFESTS) {
    const exits = [entry.normal_exit, entry.timeout_exit, entry.escape_exit].filter(Boolean);
    const hasReachable = exits.some((e) => e.trigger && e.trigger !== 'none' && e.mechanism);
    if (!hasReachable) {
      violate('R-MANIFEST-EXIT-REACHABLE',
        `manifest 条目 "${entry.path_id}" 的 normal_exit/timeout_exit/escape_exit 三者全部是 none/空 mechanism — 这笔锁定资金没有任何声明的出口, K-10("Failure Has an Exit")直接违反。`,
        manifestFile, 0);
    }
  }
}

// R-MANIFEST-TEST-COVERAGE [WARN]: required_tests 至少覆盖 normal_exit(以及任何已声明为非 none
// 的 timeout_exit/escape_exit)——非阻塞, 首批清单里已知有"待补"占位, warn 而非 error 防止卡住
// 尚在积累测试覆盖率过程中的正常条目。
function checkR_MANIFEST_TEST_COVERAGE() {
  const manifestFile = file('kasia-console/src/lib/money-path-manifests.mjs');
  for (const entry of MONEY_PATH_MANIFESTS) {
    const declaredExits = ['normal_exit', 'timeout_exit', 'escape_exit']
      .filter((k) => entry[k]?.trigger && entry[k].trigger !== 'none' && entry[k].mechanism);
    const covered = new Set((entry.required_tests || []).map((t) => t.covers));
    const uncovered = declaredExits.filter((k) => !covered.has(k));
    if (uncovered.length > 0) {
      warn('R-MANIFEST-TEST-COVERAGE',
        `manifest 条目 "${entry.path_id}" 的 required_tests 未覆盖: ${uncovered.join(', ')}(已声明生效的 exit 类型里, 这些在 required_tests[].covers 里零命中)。`,
        manifestFile, 0);
    }
  }
}

// R-MANIFEST-ADMIN-TIER-MATCH [WARN]: admin_capabilities[].admin_secret_var 若非 null, 必须能在
// ⑥ADMIN_SECRET拆分设计已定的密钥变量表里找到(不能声明一个不存在的密钥名), risk_tier 必须是已定义
// 的五级枚举之一(或 'none')——两份独立维护的清单一致性检查, WARN(两份文档协同演进期间难免暂时脱节)。
const _KNOWN_ADMIN_SECRET_VARS = new Set([
  'ADMIN_SECRET_ZK_CLOSE_BROADCAST', 'ADMIN_SECRET_STATUS_SIGN',
  'ADMIN_SECRET_ZK_STATE_PREP', 'ADMIN_SECRET_READONLY',
]);
const _KNOWN_RISK_TIERS = new Set([
  'T-READONLY', 'T-STATE-PREP', 'T-SIGN', 'T-BROADCAST', 'T-BREAK-GLASS', 'none',
]);
function checkR_MANIFEST_ADMIN_TIER_MATCH() {
  const manifestFile = file('kasia-console/src/lib/money-path-manifests.mjs');
  for (const entry of MONEY_PATH_MANIFESTS) {
    for (const cap of entry.admin_capabilities || []) {
      if (cap.admin_secret_var && !_KNOWN_ADMIN_SECRET_VARS.has(cap.admin_secret_var)) {
        warn('R-MANIFEST-ADMIN-TIER-MATCH',
          `manifest 条目 "${entry.path_id}" 的 admin_capabilities 声明了未知密钥变量 "${cap.admin_secret_var}"(不在⑥ADMIN_SECRET拆分设计已定的四把钥匙里)——核对是不是笔误, 或⑥那份清单需要同步更新。`,
          manifestFile, 0);
      }
      if (cap.risk_tier && !_KNOWN_RISK_TIERS.has(cap.risk_tier)) {
        warn('R-MANIFEST-ADMIN-TIER-MATCH',
          `manifest 条目 "${entry.path_id}" 的 admin_capabilities risk_tier="${cap.risk_tier}" 不在已定义的五级枚举里(T-READONLY/T-STATE-PREP/T-SIGN/T-BROADCAST/T-BREAK-GLASS/none)。`,
          manifestFile, 0);
      }
    }
  }
}

// ── R-SELF-HTTP-FETCH [WARN]: console 进程禁 fetch 自己的 HTTP 端点 ──
// (2026-07-14, docs/2026-07-14-legacy-refund-self-fetch-deadlock-fix-design.md 修法A 同族排查:
// legacyRefundBuilderTick 靠 fetch('http://127.0.0.1:${PORT}/...') 自己调自己复用 HTTP handler 逻辑,
// 事件循环被占时这个自我往返永远等不到自己处理, 造成自锁死循环——夜间 285 次冻结/94 次 >30s/最长 316s。
// 全库 grep 发现 15+ 同族残留(bettor.js/exchange.js/pool.js/agent-health.js/broker-*.js/market-seeder.js
// 等), 部分带 timeout 部分没有——这条规则堵"下周长出第 N+1 个"复发, 已知残留先 WARN(migration checklist),
// 不马上升 ERROR(会挡住无关 commit)。同进程内复用逻辑正确做法 = 抽纯函数直调(同 buildBettorRefundClaim
// 先例), 不经 HTTP loopback。
const _SELF_FETCH_PORT_RE = /127\.0\.0\.1:\$\{?\s*(process\.env\.)?(PORT|CONSOLE_PORT)\b|127\.0\.0\.1:(3100|3200|3300)\b/;
function checkR_SELF_HTTP_FETCH(fp, content) {
  if (!/\.(mjs|js)$/.test(fp)) return;
  if (/[\\/]scratch[\\/]|\.test\.mjs$/.test(fp)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue;   // 纯注释提及(如本次改动的记账注释)不算
    if (!/\bfetch\(/.test(line)) continue;
    if (!_SELF_FETCH_PORT_RE.test(line)) continue;
    warn('R-SELF-HTTP-FETCH',
      `fetch() 目标疑似 console 自己的端口(127.0.0.1:PORT/3100/3200/3300)——进程内自己调自己的 HTTP
端点, 事件循环被占时会自我死锁(见 2026-07-14 legacyRefundBuilderTick 事故, 夜间 285 次冻结)。若这是
periodic tick/cron 里复用同进程 handler 逻辑, 改成抽纯函数直调(同 buildBettorRefundClaim 先例, HTTP
路由与调用方共用同一份实现), 不经网络往返。若确实需要跨进程/外部调用, 忽略本警告。`,
      fp, i + 1);
  }
}

// ── R-FETCH-NO-TIMEOUT [WARN]: fetch() 调用建议带 AbortSignal.timeout ──
// (同上 2026-07-14 设计 修法C 兜底): 任何无 timeout 的 fetch 都是潜在无限悬挂——legacyRefundBuilderTick
// 那条 fetch 就是零 timeout 撞出的事故。启发式(WARN, 非精确 AST 解析): 检查 fetch( 所在行起 10 行窗口内
// 有没有 AbortSignal.timeout 或 signal: —— 窗口法会有少量假阴性/假阳性(多行调用/邻近无关 timeout),
// 可接受(migration checklist 性质, 不做commit 硬阻塞)。
function checkR_FETCH_NO_TIMEOUT(fp, content) {
  if (!/\.(mjs|js)$/.test(fp)) return;
  if (/[\\/]scratch[\\/]|\.test\.mjs$/.test(fp)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue;
    if (!/\bfetch\(/.test(line)) continue;
    const window = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
    if (/AbortSignal\.timeout|signal:\s*\w/.test(window)) continue;
    warn('R-FETCH-NO-TIMEOUT',
      `fetch() 调用附近 10 行内未见 AbortSignal.timeout——无 timeout 的 fetch 是潜在无限悬挂(见 2026-07-14
legacyRefundBuilderTick 自锁死循环事故根因之一)。补 { signal: AbortSignal.timeout(N) }(N 按调用语义选,
通常 3000-15000ms)。`,
      fp, i + 1);
  }
}

// ── R-SCRATCH-CLUTTER [WARN]: 临时脚本铁律 (Owner 2026-06-27 钦定·防根目录堆爆) ──
// 一次性诊断/测试脚本写 scratch/ (gitignored, 绝对路径), 不堆仓库根目录. gitignore (`_*`) 防入库不防
// 物理堆在文件浏览器 → whole-repo warn (每次 commit 跑 lint 都提醒). 历史: 821 临时文件堆爆 (归档 815).
// keep-list = launcher / 各 agent canonical send (`_<agent>_send.cjs`) / 代码引用的常驻工具. 详见 CLAUDE.md.
function checkScratchClutter() {
  const KEEP = new Set([
    '_bettor_send.cjs', '_bettor_verify.cjs', '_nwt_send.cjs', '_j1_send.cjs',
    '_j2_send.cjs', '_kanetui_send.cjs', '_j2_ready.cjs',
    '_launch_tg_bot.mjs', '_launch_broker_bot.mjs', '_launch_owner_bot.mjs',
    '_autobet_config_parse.mjs', '_bettor_ticket_byteeq.mjs', '_fee_single_source.mjs',
    '_j2tn_backfill_snapshot_v2.mjs', '_nwt_tn_autobet_loop.mjs',
  ]);
  let clutter;
  try {
    clutter = fs.readdirSync(ROOT).filter(f => /^_.*\.(cjs|mjs)$/.test(f) && !KEEP.has(f));
  } catch { return; }
  if (clutter.length > 0) {
    warn('R-SCRATCH-CLUTTER',
      `${clutter.length} 个临时脚本堆在仓库根目录 — 一次性脚本应写 scratch/ (gitignored, 绝对路径). 新增常驻工具→加进本 lint keep-list. 见 CLAUDE.md 临时脚本铁律. 例: ${clutter.slice(0, 5).join(', ')}`,
      file(clutter[0]), 0);
  }
}

// ── R9: Qwen LLM caller 必有 chat_template_kwargs.enable_thinking=false ──
// 检测: fetch 调 /chat/completions 的 body 里没 chat_template_kwargs.enable_thinking=false
// 排除: openai.com / api.anthropic.com (非 Qwen, 不需此 kwarg)
function checkR9(filepath, content) {
  const lines = content.split('\n');
  // 简化检 fetch...chat/completions 的紧邻 body 块. 5-50 行 window 看是否含 chat_template_kwargs
  const callPattern = /fetch\s*\([^)]*?chat\/completions/g;
  let m;
  while ((m = callPattern.exec(content)) !== null) {
    const callStart = content.slice(0, m.index).split('\n').length;
    // 取 callStart 起 50 行 body 检
    const block = lines.slice(callStart - 1, callStart + 50).join('\n');
    // 排除 openai/anthropic
    if (/openai\.com|api\.anthropic\.com|api\.openai/i.test(block)) continue;
    // body 里若含 model: ... messages: ... tools 等 (Qwen 模式) 必有 chat_template_kwargs
    const looksQwen = /model\s*:\s*['"`].*[Qq]wen|model\s*:\s*a\.ai_model|qwen|local.*llama/i.test(block);
    const hasKwarg = /chat_template_kwargs[^=]*enable_thinking\s*:\s*false/i.test(block);
    if (looksQwen && !hasKwarg) {
      violate('R9', '[ANTI-PATTERNS R9] Qwen LLM caller 漏 chat_template_kwargs.enable_thinking=false (Rule 11) — broker LLM 60-120s timeout 真因. 复制 agent-adapter/src/providers/openai.mjs:141 模式.', filepath, callStart);
    }
  }
}

// ── R10: 新 broker DM kind 必注册 broker-action-queue ──
// 提取所有 _qDm/_enqueue('dm_*') 调用 vs broker-action-queue TX_PRODUCING_KINDS Set + executeAction case
function checkR10() {
  const queueFile = file('kasia-console/src/services/broker-action-queue.js');
  if (!exists(queueFile)) return;
  const queueContent = read(queueFile);
  // 提 TX_PRODUCING_KINDS Set 内容
  const setMatch = queueContent.match(/TX_PRODUCING_KINDS\s*=\s*new\s+Set\s*\(\s*\[([^\]]+)\]/);
  const registered = setMatch ? new Set(setMatch[1].match(/['"`]([^'"`]+)['"`]/g)?.map(s => s.slice(1, -1)) || []) : new Set();
  // executeAction case 列表
  const caseMatches = [...queueContent.matchAll(/case\s+['"`]([^'"`]+)['"`]\s*:/g)];
  const cased = new Set(caseMatches.map(m => m[1]));

  // 扫所有 _qDm('dm_*') / enqueue({ kind: 'dm_*' }) 调用
  const used = new Set();
  for (const fp of targets) {
    if (fp === queueFile) continue;
    if (!fp.includes('broker') && !fp.includes('exchange') && !fp.includes('watcher')) continue;
    const c = read(fp);
    for (const m of c.matchAll(/_qDm\(\s*['"`](dm_[a-z_]+)['"`]/g)) used.add(m[1]);
    for (const m of c.matchAll(/enqueue\s*\(\s*\{\s*kind\s*:\s*['"`](dm_[a-z_]+)['"`]/g)) used.add(m[1]);
  }
  for (const kind of used) {
    if (!registered.has(kind)) {
      violate('R10', `[ANTI-PATTERNS R10] DM kind '${kind}' 没在 broker-action-queue.js TX_PRODUCING_KINDS 注册 — pump 时 throw 'unknown queue kind' retry 3 × 6s = 18s 阻塞 + anti-spam 拒重发.`, queueFile, 0);
    }
    if (!cased.has(kind)) {
      violate('R10', `[ANTI-PATTERNS R10] DM kind '${kind}' 没在 broker-action-queue.js executeAction switch 加 case — 同上 throw.`, queueFile, 0);
    }
  }
}

// ── R11: 中文 deterministic 完成动作 regex 必含 (?:了)? 后缀 ──
// 检测: const X_REGEX = /^(...|完成|付了|转完|done|...)\s*[!！。.…]*\s*$/  无 (?:了)?
function checkR11(filepath, content) {
  // R11 只查真实 source 里的 const X_REGEX 声明. .md 文档(如 ANTI-PATTERNS.md 自己规则11的
  // "### Wrong" 教学代码块)会把示例性缺后缀 regex 字面量误判成真实违规, 导致自身规则文档永远
  // 过不了自己的 lint (2026-07-11 KANet-UI 发现, 见 memory). 文档示例不是要被 lint 的源码.
  if (filepath.endsWith('.md')) return;
  const lines = content.split('\n');
  // 看变量名含 PAID/FINISH/DONE 的 regex literal
  const re = /const\s+(\w*(?:PAID|FINISH|DONE|COMPLETE)\w*_REGEX)\s*=\s*(\/[^\n]+\/[gimsu]*)/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const lineNo = content.slice(0, m.index).split('\n').length;
    const regexStr = m[2];
    // 含 完成 / 付了 / done 类 + 中文范围 (有 一-鿿 或 中文字符) → 必含 (?:了|啦)?
    const hasChinese = /[一-鿿]/.test(regexStr);
    if (!hasChinese) continue;
    // 仅检 anchored deterministic regex (^...$), 排除 capture 类 (有未转义 group) — 那是 extract 不是 detect
    const isAnchored = /^\/\^/.test(regexStr) && /\$\/[gimsu]*$/.test(regexStr);
    if (!isAnchored) continue;  // PAID_REGEX 是 capture (\b0x[hex]{64}\b), 不需此规则
    const hasEndMarker = /\(\?\:\s*了/.test(regexStr) || /\[了啦/.test(regexStr);
    if (!hasEndMarker) {
      violate('R11', `[ANTI-PATTERNS R11] ${m[1]} 中文 deterministic regex 漏完成态助词 (?:了)? 后缀 — 'X 了' 类 user 输入静默 fall LLM → 60-120s timeout (R9 真因). 加 \\s*(?:了|啦)?\\s* 在主词后.`, filepath, lineNo);
    }
  }
}

// ── R6: 链上 send 必显式 relayId (不从 LLM/payload/header 拿) ──
function checkR6(filepath, content) {
  // 检 fetch '/api/chat/send' body 含 relayId
  // 简化: 扫 /api/chat/send POST body, 看是否含 'relayId:' 字面量 (变量也算)
  // 真正复杂场景手动 review.
  const lines = content.split('\n');
  const re = /fetch\s*\([^)]*\/api\/chat\/send/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const callStart = content.slice(0, m.index).split('\n').length;
    // 扩 window: fetch 前 30 行 + 后 20 行 (body 常 const 在 fetch 上面)
    const winStart = Math.max(0, callStart - 30);
    const block = lines.slice(winStart, callStart + 20).join('\n');
    if (!/relayId/.test(block)) {
      violate('R6', '[ANTI-PATTERNS R6] /api/chat/send 调用没显式传 relayId — 可能身份冒用 (2026-04-24 J2 冒用事件). 必 CFG.relayId / hardcode 自己 daemon relay.', filepath, callStart);
    }
  }
}

// ── KI-33: broker-llm-agent.js SYSTEM_PROMPT 必含 {{trust_score}} placeholder (Oracle v0.3 §9) ──
// Owner 5/26 钦定 KANet-UI r14 raise + Bettor r17 R3 close: oracle 信任分 broker LLM 必翻译
// SYSTEM_PROMPT 含 {{trust_score}} 表示 oracle 介绍信誉翻译铁律已 baked, 防 prompt refactor 漏丢.
function checkKI33_trust_score_placeholder(filepath, content) {
  if (!/broker-llm-agent\.js$/.test(filepath)) return;
  if (!content.includes('{{trust_score}}')) {
    violate('KI-33', `[Oracle v0.3 §9] broker-llm-agent.js SYSTEM_PROMPT 缺 {{trust_score}} placeholder — Owner 5/26 钦定 oracle 介绍必翻译信任分. 加 "# Oracle 信任分铁律" section 含 {{trust_score}} 后端 inject 位置. spec ref: dev-coord-testnet Bettor r17 R3 §9.`, filepath, 1);
  }
}

// ── R19: broker SYSTEM_PROMPT / preview_text 不准含 hardcoded EVM 地址 ──
// J1 67903c5b 真测撞: SYSTEM_PROMPT example 含 `0xaD12544E...` LLM 直接 copy 当真地址输出.
// 真 user 真转 USDT 到 LLM 编的 placeholder = 钱永久丢. 防御: SYSTEM_PROMPT 严禁完整 0x{40hex}, 用 '后端注入' 代.
function checkR19(filepath, content) {
  // 只检 broker-llm-agent / broker-buy-handler 等 broker 服务文件
  if (!/broker-(llm-agent|buy-handler|sell-handler|action-queue)\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过 // 单行注释 和 doc 注释 (broker 拿真 owner BSC 0xaD12... 注释里讨论 case 不 lint)
    if (/^\s*\/\//.test(line)) continue;
    // 跳过 import 语句 / 单纯字符串变量赋值
    const m = line.match(/0x[a-fA-F0-9]{40}/);
    if (!m) continue;
    // 在 string template / 普通 string 字面量里 → 命中 (LLM/template 会 copy)
    const isInString = /["'`].*0x[a-fA-F0-9]{40}.*["'`]/.test(line);
    if (isInString) {
      violate('R19', `[ANTI-PATTERNS R19] broker 服务文件 SYSTEM_PROMPT/template 含 hardcoded EVM 地址 '${m[0]}' — LLM 会 copy 当真地址 (J1 67903c5b 真测撞 fake placeholder bug, 真 user 真转 USDT 钱丢). 改用 \\\${makerWallet.address} 后端真 fetch.`, filepath, i + 1);
    }
  }
}

// ── R29: LLM dumb tools rich — broker-v2/llm.js SYSTEM_PROMPT 不许含 user-facing directive ──
// 4-27 J1 e450ea19 钦定 R29 architectural principle (ANTI-PATTERNS L907-955) — user-facing content
// 100% tool-generated, LLM verbatim transmit. Testable invariant: LLM reply.bytes ⊆ tool output ∪ user-input.
// 但 R29 自钦定起 4-27 至 4-30 lint 未实施, 5+ commit (NWT bug 1 priceBlock / bug 5 non-custodial / J2 L5a v2)
// 都把 user-facing directive 直 inject SYSTEM_PROMPT, Qwen 弱遵循 → Owner 真测撞 fake price 0.0525 等.
// 修法: lint hard 检 broker LLM service file SYSTEM_PROMPT 不许含 directive 词 (请回/严禁 reply/必须如下/...)
// — 仅允 tool 描述 + 系统语义. 物理消除 prompt-injection violation 可能性, 不靠人记忆.
// ── R-NWT-2026-04-30 KANet 框架 enforce — broker-* 业务不许直 fetch 外部 endpoint ──
// Owner ~03:30 钦定: KANet 框架 = adapter+relay+console; 任何跳框架 = 严重错误.
// broker 业务必走 adapter (LLM call) / relay (chain TX) / console internal API (loopback OK).
// Phase Y RFC r49-r70 14/14 共识 lock D9 hard fail (J2 r58 push back NWT r59 服):
// broker-* file 直 fetch 外部 endpoint → hard fail commit.
// escape hatch: `// lint-allow-fetch: <reason>` 行注释 (上一行) — legitimate test framework / cron probe / OAuth callback 等
//
// loopback 例外: fetch http://127.0.0.1:* OR localhost:* OR `\${PORT}` template 不算违规 (console 内自调).
function checkR_NWT_FRAMEWORK(filepath, content) {
  // 仅检 services/broker-*.js OR services/broker-v2/*.js
  if (!/services[\\/]broker-[\w-]+\.js$|services[\\/]broker-v2[\\/][\w-]+\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过 // 单行注释 + /* */ 块注释 (粗略)
    if (/^\s*\/\//.test(line)) continue;
    // 检 await fetch( OR fetch( (callable form)
    if (!/(?:^|\s)(?:await\s+)?fetch\s*\(/.test(line)) continue;
    // escape hatch: 前 1-3 行内 // lint-allow-fetch: <reason>
    let allowFound = false;
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      if (/\/\/\s*lint-allow-fetch:\s*\S/.test(lines[j])) { allowFound = true; break; }
      // 仅容忍空行 + 注释; 遇业务行停搜
      if (!/^\s*$/.test(lines[j]) && !/^\s*\/\//.test(lines[j])) break;
    }
    if (allowFound) continue;
    // loopback 检 — 同行 OR 紧邻 (3 行内) URL pattern 含 127.0.0.1 / localhost / process.env.PORT / `${PORT}`
    let isLoopback = false;
    const window = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join(' ');
    if (/(?:127\.0\.0\.1|localhost):[\d`$]|\$\{(?:PORT|CONSOLE_URL|process\.env\.[A-Z_]+_URL)/.test(window)) isLoopback = true;
    if (isLoopback) continue;
    violate(
      'R-NWT-FRAMEWORK',
      `[ANTI-PATTERNS R-NWT] broker-* 业务直 fetch 外部 endpoint (跳 KANet 框架). Owner 钦定 跳框架=严重错误. LLM call 必走 adapter HTTP, chain TX 必走 relay, console internal 走 loopback. 修法 Phase Y RFC r49-r70 共识 (broker-llm-agent _callLlm → adapter 阶段 3 已 ship). 此 fetch 如属 legitimate exception (test framework / cron probe / OAuth) 加上一行 \`// lint-allow-fetch: <reason>\`.`,
      filepath, i + 1
    );
  }
}

// ── R-NWT-STATE-MACHINE: broker-* 直 UPDATE retail_dex_orders.state 跳状态机 owner ──
// Owner 2026-04-30 钦定 "每个链上动作对应一个数据状态转换".
// 必经 broker-state-machine.transition() — 唯一 transition entry.
// 来源: docs/STATE-MACHINES.md v0.2 + tasks/PZ-STATE-MACHINE-shipA.md SA-3.
//
// regex multiline: UPDATE retail_dex_orders ... SET ... state = (跨行 300 char window)
// 排除: broker-state-machine.js 自身 (canonical entry, transition() 内 SQL UPDATE 是 唯一合法实现)
// escape hatch: 前 1-3 行 // lint-allow-state-update: <reason ref PZ-STATE-T<N>>
function checkR_NWT_STATE_MACHINE(filepath, content) {
  // 排除 canonical entry 自身
  if (/services[\\/]broker-state-machine\.js$/.test(filepath)) return;
  // 仅检 services/broker-* + broker-v2/* + exchange-machine.js
  if (!/services[\\/]broker-[\w-]+\.js$|services[\\/]broker-v2[\\/][\w-]+\.js$|services[\\/]exchange-machine\.js$/.test(filepath)) return;

  const pattern = /UPDATE\s+retail_dex_orders\b[\s\S]{0,300}?\bSET\b[\s\S]{0,300}?\bstate\s*=/gi;
  const lines = content.split('\n');
  let m;
  while ((m = pattern.exec(content)) !== null) {
    // 计算 match 起 line number
    const lineNo = content.slice(0, m.index).split('\n').length;
    // 跳过 // 单行注释 (line 起始)
    if (/^\s*\/\//.test(lines[lineNo - 1] || '')) continue;
    // 跳过 JSDoc / 块注释里出现的 SQL (粗略: 前一行 ` * ` 或 ` */ ` 模式)
    if (/^\s*\*/.test(lines[lineNo - 1] || '')) continue;
    // multiline SQL: UPDATE retail_dex_orders 在 template literal 内, 真起始 prepare( 调用行.
    // step 1: 回找 prepare( 调用行 (5 行内)
    let prepareLineIdx = lineNo - 1;  // 0-indexed default
    for (let j = lineNo - 2; j >= 0 && j >= lineNo - 6; j--) {
      if (/\.prepare\s*\(\s*`?/.test(lines[j] || '')) { prepareLineIdx = j; break; }
    }
    // step 2: escape hatch 在 prepare( 行前 1-3 行
    // // lint-allow-state-update: PZ-STATE-T<N> <reason>
    let allowFound = false;
    for (let j = prepareLineIdx - 1; j >= 0 && j >= prepareLineIdx - 3; j--) {
      if (/\/\/\s*lint-allow-state-update:\s*\S/.test(lines[j] || '')) { allowFound = true; break; }
      // 仅容忍空行 + 注释; 遇业务行停搜
      if (!/^\s*$/.test(lines[j] || '') && !/^\s*\/\//.test(lines[j] || '')) break;
    }
    if (allowFound) continue;
    violate(
      'R-NWT-STATE-MACHINE',
      `[STATE-MACHINES] retail_dex_orders.state 直 SQL UPDATE 跳过状态机 owner. Owner 钦定 "每个链上动作对应一个数据状态转换". 必经 broker-state-machine.transition() — 唯一 transition entry (docs/STATE-MACHINES.md v0.2). 如 legitimate exception (legacy / BUY 路径 phase 2 后置) 加上一行 // lint-allow-state-update: PZ-STATE-T<N> <reason>.`,
      filepath, lineNo
    );
  }
}

function checkR29(filepath, content) {
  // 仅检 broker-v2/llm.js + broker-llm-agent.js (LLM caller files)
  if (!/broker-v2[\\/]llm\.js$|broker-llm-agent\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  // 定位 SYSTEM_PROMPT block (template literal 或 const SYSTEM_PROMPT = `...`)
  let inSysPrompt = false;
  let sysPromptStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/const\s+SYSTEM_PROMPT\s*=\s*`/.test(line)) { inSysPrompt = true; sysPromptStart = i; continue; }
    // Closing detection: backtick semicolon 末尾 (inline OR 行首). 容忍 `;` / \`;<空> / \`; // 注释 等
    if (inSysPrompt && /`\s*;\s*(?:\/\/.*)?$/.test(line)) { inSysPrompt = false; continue; }
    if (!inSysPrompt) continue;
    // R29 directive detect: user-facing 对话 instruction 词
    // user-facing directive 应在 tool 实施 (preview_text/error_message), 不在 SYSTEM_PROMPT
    // 跳过 // 单行注释 (注释里讨论 case 不 lint)
    if (/^\s*\/\//.test(line)) continue;
    // J2 r64 dimension: lint-allow-r29 escape hatch — pre-existing tech debt grandfather, reason 必含 PZ-R29-T<N> phase Z task ref.
    // 前一行 (或 # 章节 header 容忍 1 空行间隔) 含 // lint-allow-r29: PZ-R29-T<N> 注释 → 跳过 violation.
    // phase Z R29 generator tool refactor 真 ship 时 grep `lint-allow-r29` 直找 grandfather list 清理.
    let allowFound = false;
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      const prev = lines[j];
      if (/\/\/\s*lint-allow-r29:\s*PZ-R29-T\d+/.test(prev)) { allowFound = true; break; }
      // 仅容忍空行 / 章节 header (# xxx) / 紧邻 1 行非注释; 遇到其他 SYSTEM_PROMPT 实质内容停搜
      if (!/^\s*$/.test(prev) && !/^\s*#/.test(prev) && !/^\s*\/\//.test(prev)) break;
    }
    if (allowFound) continue;
    const directivePatterns = [
      { pat: /请回/, label: '请回' },
      { pat: /严禁\s*reply\s*含/i, label: '严禁 reply 含' },
      { pat: /必须\s*如下/, label: '必须如下' },
      { pat: /回应\s*user.*['"`].*['"`]\s*必/, label: '回应 user 必如下' },
      { pat: /反正方向已锁/, label: '反正方向已锁 (LLM directive)' },
      { pat: /如\s*user\s*问.*仅引用/, label: '如 user 问 仅引用 (Qwen 弱遵循)' },
      { pat: /(?:你应该|你需要|你必须)/, label: '你应该/你需要/你必须 (user-facing directive)' },
    ];
    for (const { pat, label } of directivePatterns) {
      if (pat.test(line)) {
        violate('R29', `[ANTI-PATTERNS R29] broker LLM SYSTEM_PROMPT 含 user-facing directive '${label}' — LLM dumb tools rich 钦定 user-facing content 100% tool-generated, LLM verbatim transmit. Qwen 3.6 弱遵循 prompt directive (实证: Owner 真测撞 fake price 0.0525). 改写 generator tool (e.g. ask_recv_address/get_kas_price/explain_X) 让 LLM 调用 + verbatim transmit.`, filepath, i + 1);
        break;  // 1 line 1 violation 够
      }
    }
  }
}

// ── R33: broker reply path 真 ALL consult conversation state authority ──
// 真 ANTI-PATTERNS R33 (J1 sediment 3b6911f3): 真 broker handler reply 真 generate 真 BEFORE
// 真 must consult getConvoState/shouldDeterministicFire 真 prevent 11+ paths fragmented blind.
//
// 真 heuristic: scan broker-buy-handler / broker-sell-handler / broker-llm-agent for reply
// generation patterns (return string literal / _qDm / _enqueue / reply.send) — flag any
// reply path 真 NOT preceded (within ~30 line window) by getConvoState OR shouldDeterministicFire
// import OR call. R33 hasn't shipped yet, so initial state: warn only on broker handler files.
//
// 真 phase 1 (current): warn-only — broker handler missing R33 imports
// 真 phase 2 (post J2 R33 broker code ship): strict — every reply path requires gating call
function checkR33(filepath, content) {
  // 只 broker handler 文件
  if (!/broker-(llm-agent|buy-handler|sell-handler)\.js$/.test(filepath)) return;

  // 真 R33 expected imports / API surface (允 .js 扩展名)
  const hasR33Import = /from\s+['"`]\.\/broker-state-authority(?:\.js)?['"`]|require\(\s*['"`]\.\/broker-state-authority(?:\.js)?['"`]/.test(content);
  // 真 R33 API 6 个: getConvoState/setConvoStateLock/resetConvoState/shouldDeterministicFire/llmSystemPromptStateLock/validateLlmReply
  // broker-llm-agent 用 LLM 专 surface (set+systemPrompt+validate), 不一定 call getConvoState/shouldDeterministicFire 直接
  const hasR33ApiCall = /\b(?:getConvoState|setConvoStateLock|resetConvoState|shouldDeterministicFire|llmSystemPromptStateLock|validateLlmReply)\s*\(/.test(content);

  // count reply-generation sites (heuristic — return string + _qDm + enqueue dm_*)
  const replyPaths = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line)) continue;
    // return literal string OR template literal
    if (/^\s*return\s+['"`]/.test(line) || /return\s+`[\s\S]*?`/.test(line)) replyPaths.push(i + 1);
    // _qDm or _enqueue dm_*
    if (/_qDm\s*\(|_enqueue\s*\(\s*['"`]dm_/.test(line)) replyPaths.push(i + 1);
  }

  if (replyPaths.length === 0) return;  // no reply generation, no R33 concern

  // Phase 2 strict (post J2 R33 broker code ship 371e4ca62): broker handlers WITH
  // reply paths MUST import broker-state-authority AND call at least 1 R33 API. Otherwise commit blocked.
  if (!hasR33Import || !hasR33ApiCall) {
    violate('R33', `[ANTI-PATTERNS R33] broker handler ${replyPaths.length} reply paths 必 consult conversation state authority. Import broker-state-authority.js + 调 R33 API (getConvoState/setConvoStateLock/resetConvoState/shouldDeterministicFire/llmSystemPromptStateLock/validateLlmReply 任一). R33 design: docs/ANTI-PATTERNS.md.`, filepath, replyPaths[0]);
  }
}

// ── R33b: user-supplied conditions retention pipeline (4 step, J1 NWT GAP B + J2 真根因) ──
// 真 ANTI-PATTERNS.md '规则 33b': user 条件 (limit_price / refund_timeout_min) 必经 4 步 pipeline.
// (1) regex extract in _extractFieldsFromMsg
// (2) tool schema 含 optional conditions params
// (3) 透传 preview function (buyPreview/sellPreview signature 含 conditions)
// (4) preview_text echo accept/reject (broker 决策可见)
//
// 真 lint heuristic: 检查 4 步至少头 3 步在源码可见 (step 4 是 runtime 行为, 不静态可查).
// 真 J1 6e77cb55 + 226da7ac + 9bc6c3aa 真**真**真已落地 — 此 lint 防 future 扩 SOL/TRON/USDC 时
// 漏一步重蹈 B3b silent drop 覆辙.
function checkR33b(filepath, content) {
  // broker-llm-agent: 真**真**真 _extractFieldsFromMsg 真 contain conditions extract regex
  if (/broker-llm-agent\.js$/.test(filepath)) {
    const hasExtractConditions = /limit_price\s*[:?]?\s*(?:limitMatch|fresh\.limit_price|prev\.limit_price)|挂单价|限价/.test(content);
    const hasToolSchemaConditions = /(?:limit_price|refund_timeout_min)\s*:\s*\{\s*type/.test(content);
    if (!hasExtractConditions) {
      violate('R33b', `[ANTI-PATTERNS R33b] broker-llm-agent.js _extractFieldsFromMsg 必 extract user 条件 (limit_price 等). Pipeline step 1 missing — 重蹈 B3b silent drop. 加 regex 匹 '挂单价/限价/不低于' 等. R33b doc: docs/ANTI-PATTERNS.md '规则 33b'.`, filepath, 1);
    }
    if (!hasToolSchemaConditions) {
      violate('R33b', `[ANTI-PATTERNS R33b] broker-llm-agent.js TOOLS preview_order schema 必含 limit_price + refund_timeout_min optional params. Pipeline step 2 missing.`, filepath, 1);
    }
  }
  // broker-buy-handler / broker-sell-handler: preview function signature 真 contain conditions destructured
  if (/broker-(buy|sell)-handler\.js$/.test(filepath)) {
    // 真**真**真 export async function buyPreview({...}) 真 destructure 真**真**真 contain 'limit_price'
    const previewFnRe = /export\s+async\s+function\s+(?:buy|sell)Preview\s*\(\s*\{[\s\S]{0,800}?\}/;
    const m = previewFnRe.exec(content);
    if (m) {
      const sig = m[0];
      if (!/limit_price/.test(sig) || !/refund_timeout_min/.test(sig)) {
        violate('R33b', `[ANTI-PATTERNS R33b] ${filepath.match(/broker-(buy|sell)-handler/)[0]}.js preview function signature 必 destructure limit_price + refund_timeout_min (R33b pipeline step 3). 漏 = silent drop. R33b doc: docs/ANTI-PATTERNS.md.`, filepath, 1);
      }
    }
  }
}

// R-NWT-2026-04-28 Layer 5 (Z21 root + future regression防): broker → relay command type
// must be from canonical enum (kasia-relay/src/lib/commands.mjs). String literals like
// 'send_kas', 'send_message' in sendCommandAsync calls are forbidden — use COMMAND_TYPES.
//
// Z21 真因 = broker enqueue type='send_kas', relay only 'transfer'. silent fall-through.
// 修法 = enum import + lint catches string literals.
function checkCommandEnum(filepath, content) {
  if (!/broker-(?:action-queue|intake-watcher|buy-handler|sell-handler|llm-agent|cancel-refund)\.js$|settler-router\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  // Match {type: 'literal'} or {type: "literal"} where literal is one of relay command types.
  // Allowed: COMMAND_TYPES.X, COMMAND_TYPE_SET, dynamic vars.
  const RELAY_LITERALS = ['handshake', 'send_message', 'publish_card', 'send_broadcast', 'transfer', 'split_utxo', 'send_kas'];
  const literalSet = new Set(RELAY_LITERALS);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;  // skip comments
    const code = line.replace(/\/\/.*$/, '');
    // capture {type: '...'} pattern
    const m = code.match(/type:\s*['"]([\w_]+)['"]/);
    if (m && literalSet.has(m[1])) {
      // 'send_kas' is the deprecated name — definite violation
      // others are valid command types but should use COMMAND_TYPES enum
      violations.push({
        rule: 'CommandEnum (Z21/Layer 5)',
        file: filepath,
        line: i + 1,
        msg: `relay command type '${m[1]}' as string literal — use COMMAND_TYPES.${m[1].toUpperCase()} from kasia-relay/src/lib/commands.mjs (Z21 防 silent fall-through)`,
      });
    }
  }
}

// R-SCA-ALIAS-ORIGIN [WARN] (M0c-1 批C 2026-07-23, NWT 完整清单复核 24da7ea9 硬前置):
// sendCommandAsync 别名(解构重命名 { sendCommandAsync: X } / import rename as X / 裸值赋值·传参)
// 会让按名字 string-grep 的 origin 迁移扫描漏掉别名 call site(实撞: 8 处别名迁移清单初版全漏,
// bettor sca/exchange sendCancelCmd/trading·exchange-machine·mind-manager sendCmd/settler sca2)。
// gate armed=on 后未标 origin 的调用 fail-closed 拒 → 漏标别名 call = 现网该路径当场断。
// 检测: ①别名定义处向后扫该别名的 call, call 实参 span(括号配对深度扫描, 非行窗口)内无 origin
// 实参('internal'/'app'/'operator')→ warn ②sendCommandAsync 裸值传参(callback 形态, 静态不可追踪)→ warn。
// call-arg-span(NWT ff28fe68 NOTE-B): 相邻 call 的 origin 字面量不再满足本 call(消 window-bleed 假阴)。
// ERROR 级(2026-07-23 升级): warn-first 落码(7aa2d117)→call-arg-span 收窗(dc73ae06)→NWT 两轮 diff
// GREEN 后升 ERROR(规则65 门①完整走完)。8 存量别名 call 已全标注 origin=零现存阻挡。
// 残留限界(NWT dc73ae06 verdict 诚实标·非 blocker): 本 call payload 内裸 'app'/'internal'/'operator'
// 字符串字面量可满足 ORIGIN_RE(限本 call args 内, 远窄于旧 window-bleed; 现存 8 别名结构化 payload 零命中)。
// 别名的别名(二级)不追, 由一级 ERROR 逼平。
function checkR_SCA_ALIAS_ORIGIN(filepath, content) {
  if (!/kasia-console[\\/]src[\\/].*\.(?:js|mjs)$/.test(filepath)) return;
  if (/relay-manager\.js$/.test(filepath)) return; // 定义方自身豁免
  const lines = content.split('\n');
  const ORIGIN_RE = /['"](?:internal|app|operator|legacy-unmigrated)['"]/; // 五值(C 分阶段 arm 8282dd61: legacy-unmigrated=显式过渡标, 别名 call 带它=已标注非缺失)
  const aliases = []; // { name, defLine }
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '');
    if (/^\s*(?:\*|\/\*)/.test(lines[i])) continue;
    let m;
    if ((m = code.match(/sendCommandAsync\s*:\s*([A-Za-z_$][\w$]*)/))) aliases.push({ name: m[1], defLine: i + 1 });
    else if ((m = code.match(/sendCommandAsync\s+as\s+([A-Za-z_$][\w$]*)/))) aliases.push({ name: m[1], defLine: i + 1 });
    else if ((m = code.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*sendCommandAsync\s*[;,)\]]?\s*$/))) aliases.push({ name: m[1], defLine: i + 1 });
    // 裸值传参(callback): foo(sendCommandAsync) / foo(x, sendCommandAsync, y) — 静态不可追踪。
    // 排除: 动态 import/require 解构 + 静态 import/export 具名列表(relay.js:8 实撞误报: import { a, sendCommandAsync, b } from ...)
    if (/[(,]\s*sendCommandAsync\s*[,)]/.test(code) && !/await\s+import|require\s*\(/.test(code) && !/^\s*(?:import|export)\b/.test(code)) {
      violate('R-SCA-ALIAS-ORIGIN', `sendCommandAsync 以裸值传参(callback 形态)— origin 迁移扫描静态不可追踪, gate armed 后此路径若未标 origin 会 fail-closed 断。改传显式 wrapper((id,cmd,t)=>sendCommandAsync(id,cmd,t,'<origin>'))或直接调用。`, filepath, i + 1);
    }
  }
  // call-arg-span 提取: 从 call 开括号起括号配对深度扫描到闭合(简易字符串状态机跳过引号内容,
  // 上限 40 行防未闭合失控), 返回实参 span 文本; 未闭合返 null(按可疑处理仍 warn, fail-closed 倾向)。
  const extractCallArgSpan = (startLine, startCol) => {
    let depth = 0, span = '', inStr = null;
    for (let li = startLine; li < Math.min(startLine + 40, lines.length); li++) {
      const s = lines[li];
      for (let ci = (li === startLine ? startCol : 0); ci < s.length; ci++) {
        const ch = s[ci], prev = ci > 0 ? s[ci - 1] : '';
        if (inStr) {
          span += ch;
          if (ch === inStr && prev !== '\\') inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; span += ch; continue; }
        if (ch === '(') { depth++; if (depth === 1) continue; }
        if (ch === ')') { depth--; if (depth === 0) return span; }
        if (depth >= 1) span += ch;
      }
      span += '\n';
    }
    return null; // 40 行内未闭合
  };
  for (const { name, defLine } of aliases) {
    const callRe = new RegExp(`(?:^|[^.\\w$])${name.replace(/\$/g, '\\$')}\\s*\\(`);
    for (let i = defLine; i < lines.length; i++) {
      const code = lines[i].replace(/\/\/.*$/, '');
      if (/^\s*(?:\*|\/\*)/.test(lines[i])) continue;
      const cm = callRe.exec(code);
      if (!cm) continue;
      const openCol = code.indexOf('(', cm.index + cm[0].length - 1);
      const span = extractCallArgSpan(i, openCol >= 0 ? openCol : 0);
      if (span == null || !ORIGIN_RE.test(span)) {
        violate('R-SCA-ALIAS-ORIGIN', `sendCommandAsync 别名 '${name}'(定义 :${defLine})调用${span == null ? '实参 40 行内未闭合(可疑)' : '实参 span 内未见 origin'}('internal'/'app'/'operator'/'legacy-unmigrated')— 别名 call 必须与直接调用同样标 origin 第4实参(M0c-1 批C armed 硬前置), 否则 gate armed=on 后 fail-closed 拒·现网该路径断。`, filepath, i + 1);
      }
    }
  }
}

// R-NWT-2026-04-28 Bug-Z22 (Owner production 真撞): "真**真**真" stutter pattern leaked from
// dev-coord agent broadcast style INTO broker user-facing strings. Real users see broker DM
// replies containing "真**真**真**真 cancel" (Owner screenshot 04:33). Catastrophic UX —
// users who don't accept stutter / repetition fully reject the product.
// Scope: broker-*.js + conversations.js (broker reply path). Block 真[*]{2,} or [^a-zA-Z0-9]\*\*[^a-zA-Z0-9]
// inside string literals (return/preview_text/message:/enqueue payload). Allow in comments.
function checkBrokerStutter(filepath, content) {
  if (!/broker-(?:buy-handler|sell-handler|llm-agent|cancel-refund|intake-watcher|action-queue)\.js$/.test(filepath)
      && !/conversations\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip comments
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    // strip inline comments to avoid false positives
    const code = line.replace(/\/\/.*$/, '');
    // detect stutter inside string literals (single, double, backtick)
    if (/['"`][^'"`]*真\*{2,}真[^'"`]*['"`]/.test(code)) {
      violations.push({ rule: 'BrokerStutter (Z22)', file: filepath, line: i + 1, msg: '真**真 stutter pattern in user-facing string — Owner production 真撞, plain 中文 only' });
    }
  }
}

// ── R37 (T-J1-19f, Bug-Z24): broker-llm-agent.js 单 system message literal ──
// 真根因 (Bug-Z24 e8f8e064): R33 wire (commit 371e4ca62) 漏看 T-J1-19f inline comment,
// reintroduce 第二条 {role:'system'} stateLockAddendum. Qwen Jinja chat template 见
// 2 个 system message 直接返 500 Bad Request → broker LLM 60-120s timeout 全崩.
// J1 e8f8e064 修法: 把 stateLockAddendum merge 进单条 system message.
// 防 reintroduce: lint count {role:'system'} literal, > 1 → block commit.
// 三方 v2.2 convergence: dev-coord broadcast a874c0d8 (2026-04-28).
function checkR37(filepath, content) {
  if (!/broker-llm-agent\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;  // skip comments
    const code = line.replace(/\/\/.*$/, '');
    const re = /\{\s*role\s*:\s*['"]system['"]/g;
    while (re.exec(code) !== null) hits.push(i + 1);
  }
  if (hits.length > 1) {
    violations.push({
      rule: 'R37 (Bug-Z24/T-J1-19f)',
      file: filepath,
      line: hits[0],
      msg: `broker-llm-agent.js 含 ${hits.length} 个 {role:'system'} literal (lines ${hits.join(',')}) — Qwen Jinja 双 system msg → 500 Bad Request (Bug-Z24 真撞 + R33 reintroduce 教训). 必合并成 1 个 system msg (J1 e8f8e064 修法). 见 ANTI-PATTERNS R37 + QWEN-RULES Rule 12.`,
    });
  }
}

// ── ABE-A.6 (T-J2-2026-05-11 Phase 2 NWT #18): UPDATE exchange_offers SET protocol_status owner invariant ──
// 仅 exchange-machine.js 真 owner. 其他 file 直 UPDATE protocol_status → fail (bypass transition()).
// Whitelist (per A.5 audit): 注释 marker `lint-allow-protocol-status-direct: ABE-A.5-*` 标 site OK。
function checkABE_A6_protocol_status_owner(filepath, content) {
  // 允许 file:
  if (/[/\\]kasia-console[/\\]src[/\\]services[/\\]exchange-machine\.js$/.test(filepath)) return;
  if (/[/\\]kasia-console[/\\]src[/\\]db[/\\]migrate\.js$/.test(filepath)) return;  // migration backfill OK
  // 排除 test files (test fixture exec_sql 直 UPDATE 是 test setup, 不是 production violation)
  if (/[/\\]test-framework[/\\]/.test(filepath)) return;
  if (/[/\\]scripts[/\\]_/.test(filepath)) return;  // one-shot scripts/_*.mjs
  if (/[/\\]scripts[/\\]smoke-/.test(filepath)) return;  // smoke test scripts

  const lines = content.split('\n');
  // 匹 `UPDATE exchange_offers SET protocol_status` (case-insensitive, 允 whitespace variation)
  const pattern = /UPDATE\s+exchange_offers\s+SET[^;]*protocol_status\s*=/i;
  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    // whitelist marker: 此行 OR 前 15 行 含 'lint-allow-protocol-status-direct'
    // (15 行 window 容纳 multi-line audit comment block above SQL prepare statement)
    const windowStart = Math.max(0, i - 15);
    const windowText = lines.slice(windowStart, i + 1).join('\n');
    if (/lint-allow-protocol-status-direct/.test(windowText)) continue;
    violate('ABE-A.6', `[ABE-A.6] UPDATE exchange_offers SET protocol_status 仅允 exchange-machine.js (NWT #18 A 断点 单一所有权切分). 其他 file 走 transition(id, newStatus). 如确需 terminal escape, 加注释 'lint-allow-protocol-status-direct: <reason>' (前 5 行 OR 同行).`, filepath, i + 1);
  }
}

// ── KI-31 (Bettor r184 2026-05-19): Polymarket gamma single-market query 必含 &closed=true ──
// 真因: gamma default filter active=true, resolved market 不返 ('market not found'). settler verify
// 永卡 matched. closed=true 实 'include closed' (= active + closed 都返, 不破 active 路径).
// Whitelist marker `lint-allow-gamma-no-closed: <reason>` 同行 OR 前 5 行 (= 真不需 closed 的 caller).
function checkKI31_gamma_closed_query(filepath, content) {
  if (/[/\\]test-framework[/\\]/.test(filepath)) return;
  if (/[/\\]scripts[/\\]/.test(filepath)) return;

  const lines = content.split('\n');
  // 匹 gamma single-market query (clob_token_ids), 不含 &closed=true
  const pattern = /gamma-api\.polymarket\.com\/markets\?clob_token_ids=[^"'`]+/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (!m) continue;
    if (m[0].includes('closed=true')) continue;  // 已守
    const windowStart = Math.max(0, i - 5);
    const windowText = lines.slice(windowStart, i + 1).join('\n');
    if (/lint-allow-gamma-no-closed/.test(windowText)) continue;
    violate('KI-31', `[KI-31] gamma single-market query 缺 &closed=true → resolved market 不返 (= settler 永卡 matched). 加 '&closed=true' 守 'include closed'. 如确不需, 加注释 'lint-allow-gamma-no-closed: <reason>' (Bettor r184 5/19 Bug PRED-GAMMA-CLOSED).`, filepath, i + 1);
  }
}

// ── KI-30 (Bettor r181 2026-05-19): chain TX amount 必 toFixed(8) 守 Kaspa sompi precision ──
// 真因: JS 浮点 17 decimal → Kaspa wallet API reject 'Amount cannot have more than 8 decimal places'.
// Bug PRED-DECIMAL surface 第 1 prediction test fire 时撞 (Bettor r181 完整诊).
// Whitelist marker `lint-allow-chain-amount-precision: <reason>` 同行 OR 前 5 行.
function checkKI30_chain_amount_precision(filepath, content) {
  // Skip test/migration/scripts (test fixture 可能 raw amount)
  if (/[/\\]test-framework[/\\]/.test(filepath)) return;
  if (/[/\\]scripts[/\\]/.test(filepath)) return;
  if (/[/\\]db[/\\]migrate\.js$/.test(filepath)) return;

  const lines = content.split('\n');
  // 匹 `amount: String(xxxKas|xxxAmount|qty|sizeKas|stakeKas|netKas|numShares)`
  // 跟 protocolMsg 内 give_amount/want_amount: String(...) (= 上链 amount field)
  const pattern = /(?:amount|give_amount|want_amount):\s*String\(\s*([a-zA-Z_$][\w$]*)\s*\)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (!m) continue;
    const windowStart = Math.max(0, i - 5);
    const windowText = lines.slice(windowStart, i + 1).join('\n');
    if (/lint-allow-chain-amount-precision/.test(windowText)) continue;
    violate('KI-30', `[KI-30] chain TX amount field 用 String(${m[1]}) → JS 浮点 17-decimal Kaspa wallet reject. 必 .toFixed(8) 守 sompi 8-decimal max precision (Bettor r181 5/19 Bug PRED-DECIMAL). 如确需 raw String, 加注释 'lint-allow-chain-amount-precision: <reason>' (前 5 行 OR 同行).`, filepath, i + 1);
  }
}

// ── KI-32 (Oracle v0.3 R7 J2 catch 9 + J1 catch 9 endorse): oracle-registry NOT 进 COORD_CHANNELS ──
// 真因: oracle-registry permissionless design (= tier 2/3 任何 relay 可 announce, day 1 同步开).
// COORD_CHANNELS firewall 仅 OPUS_RELAY_NAMES (= Bettor/NWT/J2/J3/Opus/Qclaude) 可发, Agent Mind silence.
// 把 oracle-registry 进 COORD_CHANNELS → 第二/三档 oracle 0 announce 路径 = 违 permissionless oracle design.
//
// 守 (= scan kasia-console/src/api/chat.js):
//   COORD_CHANNELS Set 不可含 'oracle-registry'
//   ORACLE_REGISTRY_CHANNELS Set (= 新 namespace) 不可含 COORD_CHANNELS 任何 channel
//   两 Set 互斥 (= mutex)
//
// Whitelist marker: 'lint-allow-oracle-channel-mutex: <reason>' 同行 OR 前 3 行.
function checkKI32_oracle_channel_mutex(filepath, content) {
  // Only check chat.js
  if (!/[/\\]api[/\\]chat\.js$/.test(filepath)) return;

  const lines = content.split('\n');
  // Extract COORD_CHANNELS + ORACLE_REGISTRY_CHANNELS Set literals
  const coordRe = /COORD_CHANNELS\s*=\s*new\s+Set\(\[([^\]]+)\]/;
  const oracleRe = /ORACLE_REGISTRY_CHANNELS\s*=\s*new\s+Set\(\[([^\]]+)\]/;

  let coordLine = -1, oracleLine = -1;
  let coordSet = null, oracleSet = null;

  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(coordRe);
    if (cm) {
      coordLine = i + 1;
      coordSet = new Set(cm[1].split(',').map(s => s.trim().replace(/['"`]/g, '')).filter(Boolean));
    }
    const om = lines[i].match(oracleRe);
    if (om) {
      oracleLine = i + 1;
      oracleSet = new Set(om[1].split(',').map(s => s.trim().replace(/['"`]/g, '')).filter(Boolean));
    }
  }

  // Rule 1: COORD_CHANNELS 不可含 'oracle-registry'
  if (coordSet?.has('oracle-registry')) {
    const windowStart = Math.max(0, coordLine - 4);
    const windowText = lines.slice(windowStart, coordLine).join('\n');
    if (!/lint-allow-oracle-channel-mutex/.test(windowText)) {
      violate('KI-32', `[KI-32] COORD_CHANNELS 含 'oracle-registry' → 违 permissionless oracle design (Oracle v0.3 R7 J2 catch 9). oracle-registry tier 2/3 任何 relay 可 announce, COORD firewall 仅 Opus → 第二/三档 0 announce 路径. 删 'oracle-registry' from COORD_CHANNELS + 用 ORACLE_REGISTRY_CHANNELS namespace.`, filepath, coordLine);
    }
  }

  // Rule 2: ORACLE_REGISTRY_CHANNELS 不可跟 COORD_CHANNELS 重叠
  if (coordSet && oracleSet) {
    for (const ch of oracleSet) {
      if (coordSet.has(ch)) {
        violate('KI-32', `[KI-32] ORACLE_REGISTRY_CHANNELS 跟 COORD_CHANNELS 重叠 channel '${ch}' → namespace mutex 破. 同 channel 不可同时进 2 list (Oracle v0.3 R7 J1 #4 lint mutex propose).`, filepath, oracleLine);
      }
    }
  }
}

// ── KI-49 silent-skip 第 N 次复刻 sediment (qlfpv 实测 G6 批2 红线 7) ──
//
// qlfpv 5 层 brick 第三面 (= 后 sighash 双 bug 修完): SS 焊死 fee 跟实际 mass 不匹.
// pool.js 创建 contract 用 b.miner_fee || 50_000 作 ctor minerFee, 编进 PoolSpine_v06
// SS L281 require value==makerStakeAmount-minerFee. 但 refund/settle TX 用 SS redeem
// (1942 bytes) scriptSig → mass 4420+ → mempool floor 442_000 sompi >> 50_000 焊死 fee
// → mempool reject. qlfpv 100 KAS effective brick.
//
// 守: pool.js create-v06 (= pool.js L448) 用 b.miner_fee || N 不可低于 SS refund mass
// floor 实测下限. 推荐 default 5_000_000 (= 跟 settle 路径 minerFee floor 同步 Bettor
// 已 r235 钦点, dispatchPhase2 5_000_000 已 ship 47ff13d). create-v06 必符 floor 否则
// 链上市场无法 refund/settle.
//
// 守 b.miner_fee || X 中 X 必 >= 1_000_000 (= 安全余量 SS redeem 1942 byte mass cover).
// Whitelist marker: 'lint-allow-minerfee-low: <reason>'.
function checkR40_minerFee_floor(filepath, content) {
  if (!/[/\\]api[/\\]pool\.js$/.test(filepath)) return;
  const lines = content.split('\n');
  const MIN_SAFE = 1_000_000;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    // Match: parseInt(b.miner_fee, 10) || 50_000 / 20_000 / etc.
    const m = line.match(/parseInt\s*\(\s*b\.miner_fee[\s,]+\d+\s*\)\s*\|\|\s*(\d[\d_]*)/);
    if (!m) continue;
    const defaultValue = parseInt(m[1].replace(/_/g, ''), 10);
    if (defaultValue < MIN_SAFE) {
      const windowStart = Math.max(0, i - 3);
      const windowText = lines.slice(windowStart, i + 1).join('\n');
      if (/lint-allow-minerfee-low/.test(windowText)) continue;
      violate(
        'R40 (G6 批2 红线 7, qlfpv brick sediment)',
        `b.miner_fee || ${defaultValue} too low — SS contract 焊死此 fee 进 PoolSpine_v06 L281 require, 但 refund/settle TX scriptSig ~2000 byte → mass 4000+ → mempool floor ${defaultValue * 100 / MIN_SAFE * MIN_SAFE}+ sompi >> ${defaultValue} → 'transaction is not standard' brick. Bettor r239 钦点 minimum ${MIN_SAFE} sompi (推荐 5_000_000 跟 settle floor 同步, 47ff13d sediment).`,
        filepath, i + 1
      );
    }
  }
}

// ── R_SHARD_BLIND (线8 STEP2, Bettor 2026-06-24 APPROVED): pool_bettor_sides 裸按 logical market_id 查 ──
// 根因: bshard register-v07 bettor 按 shard_market_id 存, 不在 logical_market_id 下.
//       WHERE market_id = logicalId → 0 结果 → settler 误判 0 押注退 maker / display 0 / refund 404.
// 修法: 用 getSidesByLogicalMarket(logicalId, db) (跨-shard 聚合)
//       或  getSidesByShard(shardId, db)      (单片, 已知 shard-level 操作)
//       from: kasia-console/src/lib/pool-bettor-sides-query.mjs
// 注意: shard-allocator.mjs 传入的 shardMarketId 是 CORRECT, 不改.
// Escape hatch: 同行或前3行加 // lint-allow-shard-blind: <reason>
// warn-mode (扫现存 41 命中当 checklist 迁移), 迁完改 error.
function checkR_SHARD_BLIND(filepath, content) {
  if (/\.(md|txt)$/.test(filepath)) return;  // docs/comments not code
  if (/[/\\]test-framework[/\\]/.test(filepath)) return;
  if (/[/\\]scripts[/\\]/.test(filepath)) return;
  if (/shard-allocator\.mjs$/.test(filepath)) return;
  if (/pool-bettor-sides-query\.mjs$/.test(filepath)) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    if (!/pool_bettor_sides/i.test(line)) continue;
    // Match: pool_bettor_sides WHERE market_id = (bare logical query)
    if (!/pool_bettor_sides\b.*WHERE\b.*\bmarket_id\s*=/.test(line)) continue;
    // escape hatch: lint-allow-shard-blind in this line or prev 3 lines
    const windowStart = Math.max(0, i - 3);
    const windowText = lines.slice(windowStart, i + 1).join('\n');
    if (/lint-allow-shard-blind/.test(windowText)) continue;
    warn(
      'R-SHARD-BLIND [WARN]',
      '[线8 STEP2] pool_bettor_sides 裸按 market_id 查 — bshard bettor 按 shard_market_id 存, ' +
      'logical 查不到 → settler 误退 / 显示 0 / refund 404. ' +
      '改用 getSidesByLogicalMarket(logicalId, db) 或 getSidesByShard(shardId, db) ' +
      'from lib/pool-bettor-sides-query.mjs. ' +
      '如确需裸查(已知单片操作), 加 // lint-allow-shard-blind: <reason>.',
      filepath,
      i + 1
    );
  }
}

// ── R-COMMAND-REGISTRATION (#25, NWT 2026-07-04): relay.mjs command case 必在 commands.mjs 三层注册 ──
// 根因(KI-49, 复刻 5+ 次实录·commands.mjs 头部自己列了教训): 有人加 relay.mjs 一个新 case 'x' handler,
// 但忘了在 commands.mjs 里同步注册 COMMAND_TYPES/COMMAND_PAYLOAD_SCHEMA/COMMAND_FIELD_TYPES 三层 —
// validateCommandPayload 在 switch 前查 COMMAND_TYPE_SET 找不到 → 静默 reject "unknown/invalid command
// type" → 调用方(settler/daemon/broker)看到的是"Relay not running"或"INVALID COMMAND"这类误导性错误,
// 真因是白名单没登记。今天(2026-07-04) #28 B(get_per_bet_address+sweep_per_bet)和历史上 sign_input_
// for_settle / pool_side_refund_cancelled_tx / pool_refund_maker_unjoined_tx 等至少 5 次复刻同一个坑。
// 这条 lint 做静态一次性核对: relay.mjs 里所有 case 字符串字面量, 必须都在 commands.mjs 的
// COMMAND_TYPES 值集合里(第一层); COMMAND_TYPES 每个 key 必须在 COMMAND_PAYLOAD_SCHEMA 和
// COMMAND_FIELD_TYPES 里都有对应条目(第二三层, 防只补了枚举没补 schema/field-types 这种半截注册)。
function checkR_COMMAND_REGISTRATION() {
  const relayFile = file('kasia-relay/src/relay.mjs');
  const commandsFile = file('kasia-relay/src/lib/commands.mjs');
  if (!exists(relayFile) || !exists(commandsFile)) return;
  const relayContent = read(relayFile);
  const commandsContent = read(commandsFile);

  // relay.mjs case 字符串字面量(只认 case 'literal': 形态, 不含 case CONST: 这种间接引用 — 现状全库
  // relay.mjs 命令 case 都是裸字符串字面量, 见 commands.mjs 头部注释 "2. Add case in relay.mjs switch").
  const relayLines = relayContent.split('\n');
  const relayCases = [];
  for (let i = 0; i < relayLines.length; i++) {
    const m = relayLines[i].match(/^\s*case\s+['"]([a-z][a-z0-9_]*)['"]\s*:/);
    if (m) relayCases.push({ type: m[1], line: i + 1 });
  }

  // commands.mjs 三层: COMMAND_TYPES { KEY: 'value', ... } / COMMAND_PAYLOAD_SCHEMA { [COMMAND_TYPES.KEY]: [...] }
  // / COMMAND_FIELD_TYPES { [COMMAND_TYPES.KEY]: {...} }。抓 block 用 Object.freeze({ ... }); 边界(找不到就空).
  function extractBlock(varName) {
    const re = new RegExp(`export const ${varName}\\s*=\\s*Object\\.freeze\\(\\{`);
    const m = re.exec(commandsContent);
    if (!m) return '';
    // 从匹配点数括号找配对的 }); (block 内不会有更深层嵌套的 { 使这个简单计数失配 — 三个 export 都是扁平对象)
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < commandsContent.length && depth > 0) {
      if (commandsContent[i] === '{') depth++;
      else if (commandsContent[i] === '}') depth--;
      i++;
    }
    return commandsContent.slice(start, i - 1);
  }
  const typesBlock = extractBlock('COMMAND_TYPES');
  const schemaBlock = extractBlock('COMMAND_PAYLOAD_SCHEMA');
  const fieldTypesBlock = extractBlock('COMMAND_FIELD_TYPES');

  // COMMAND_TYPES: KEY: 'value' 对 (跳注释行)
  const typeEntries = [...typesBlock.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*['"]([a-z][a-z0-9_]*)['"]/gm)];
  const typeKeyToValue = new Map(typeEntries.map((m) => [m[1], m[2]]));
  const typeValueSet = new Set(typeEntries.map((m) => m[2]));

  // ① relay.mjs 每个 case 必须在 COMMAND_TYPES 值集合里 — 这是历史上真正咬人的那一层.
  for (const { type, line } of relayCases) {
    if (!typeValueSet.has(type)) {
      violate(
        'R-COMMAND-REGISTRATION (#25, KI-49 第 N 次复刻)',
        `relay.mjs case '${type}' 没在 commands.mjs COMMAND_TYPES 注册 — validateCommandPayload 会静默 reject "unknown command type", 调用方只会看到"Relay not running"/"INVALID COMMAND"这类误导性错误(真因是白名单没登记)。加 COMMAND_TYPES.${type.toUpperCase()}: '${type}' + 同步 COMMAND_PAYLOAD_SCHEMA/COMMAND_FIELD_TYPES(三层缺一不可)。`,
        relayFile, line
      );
    }
  }

  // ②③ COMMAND_TYPES 每个 key 必须在 SCHEMA / FIELD_TYPES 里有 [COMMAND_TYPES.KEY]: 条目 — 防"加了枚举
  // 没加后两层"这种半截注册(validateCommandPayload 对 SCHEMA 里没有的 type 会 skip 必填字段校验,
  // 不是硬拒绝, 但意味着这个命令的必填参数完全不受检查, 静默数据缺陷比硬拒绝更隐蔽).
  for (const [key] of typeKeyToValue) {
    const ref = `[COMMAND_TYPES.${key}]`;
    if (!schemaBlock.includes(ref)) {
      warn(
        'R-COMMAND-REGISTRATION [WARN]',
        `commands.mjs COMMAND_TYPES.${key} 没在 COMMAND_PAYLOAD_SCHEMA 里注册对应 [COMMAND_TYPES.${key}] 条目 — 这个命令类型的必填字段完全不受 validateCommandPayload 校验(半截注册, 比硬拒绝更隐蔽)。`,
        commandsFile, 0
      );
    }
    if (!fieldTypesBlock.includes(ref)) {
      warn(
        'R-COMMAND-REGISTRATION [WARN]',
        `commands.mjs COMMAND_TYPES.${key} 没在 COMMAND_FIELD_TYPES 里注册对应 [COMMAND_TYPES.${key}] 条目 — 这个命令类型的字段类型完全不受校验(半截注册)。`,
        commandsFile, 0
      );
    }
  }
}

// ── R-FEE-LEAVES-BYPASS [WARN] (P4/D-008, 2026-07-09, J2): ZK 线文件禁直调 deriveFeeLeaves/FEE_CONFIG ──
// 根因(7/8 门②实弹分叉): propose/enqueue/委员 voter 三处各自手搓 fee 派生, 同一市场三处三说法(pool 基数漏
// seed/费率用协议常量非市场级 broker_fee_pct)。P4 收敛为单源 deriveSettlementFeeLeaves(pool-shard-settle.mjs),
// deriveFeeLeaves/FEE_CONFIG 收窄为 V1(PayoutShard/committee-settle)专属——ZK 线文件(bshard-close-transport.mjs
// /zk-prove-enqueue.mjs/zk-prove-worker.mjs)若出现 deriveFeeLeaves(/FEE_CONFIG 直调 = 复发同一坑, WARN 标记。
// ⚠ 不含 bshard-close-enforce.mjs: 该文件 V1(enforceCloseAttest)/V2(enforceCloseAttestV2)共存, V1 分支
// 合法保留 deriveFeeLeaves/FEE_CONFIG(P4 只抽出了 V2 分支), 文件级静态扫无法可靠区分函数边界, 不纳入本规则
// (人工 review 覆盖, 见设计文档 §2 四侧接线)。
const _FEE_LEAVES_BYPASS_FILES = [
  'kasia-console/src/lib/bshard-close-transport.mjs',
  'kasia-console/src/lib/zk-prove-enqueue.mjs',
  'kasia-console/src/services/zk-prove-worker.mjs',
];
function checkR_FEE_LEAVES_BYPASS() {
  for (const rel of _FEE_LEAVES_BYPASS_FILES) {
    const fp = file(rel);
    if (!exists(fp)) continue;
    const content = read(fp);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bderiveFeeLeaves\s*\(/.test(line) || /\bFEE_CONFIG\b/.test(line)) {
        warn(
          'R-FEE-LEAVES-BYPASS [WARN]',
          `ZK 线文件直用 deriveFeeLeaves()/FEE_CONFIG(V1 协议常量口径)——P4/D-008 单源收敛后 ZK 线一律走 deriveSettlementFeeLeaves(pool-shard-settle.mjs, 市场级 broker_fee_pct+consolidatedPool 含seed), 否则复发 7/8 门②"同一市场三处三说法"同族坑。`,
          fp, i + 1
        );
      }
    }
  }
}

// ── R-FEERULES-CANON-BYPASS [WARN] (B线落1, 2026-07-12, J2): feeRules canonicalize/hash 单源封旁路 ──
// 根因(spec 2026-06-22-modular-fee-split-component-spec.md v1.2-2): create-time commit 与 settle-time
// re-derive 若各自实现"同一"canonical 规范 = driver/committee 漏配家族的根(7/11 一夜炸五处同形状)。
// canonicalizeFeeRules()/computeFeeRulesCommit() 唯一家 = kasia-console/src/lib/fee-split.mjs。
// 其它文件出现 ①canonicalizeFeeRules 重定义 或 ②对 feeRules 直接 blake2b = 旁路, WARN 标记。
const _FEERULES_CANON_HOME = 'kasia-console/src/lib/fee-split.mjs';
// packages/fee-split/fee-split.mjs(B线落3)是 _FEERULES_CANON_HOME 的 sync 构建产物(R-FEE-SPLIT-PKG-DRIFT
// 守内容一致), 不是独立实现——同源排除, 否则每次 sync 都会在这条 WARN 上噪音。
const _FEERULES_CANON_HOME_SYNCED_COPIES = new Set(['packages/fee-split/fee-split.mjs']);
function checkR_FEERULES_CANON_BYPASS(fp, content) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
  if (rel === _FEERULES_CANON_HOME || _FEERULES_CANON_HOME_SYNCED_COPIES.has(rel)) return;
  if (!/\.(mjs|js|cjs)$/.test(fp)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:function\s+canonicalizeFeeRules|(?:const|let|var)\s+canonicalizeFeeRules\s*=)/.test(line)) {
      warn('R-FEERULES-CANON-BYPASS [WARN]',
        `canonicalizeFeeRules 重定义——feeRules canonical 序列化唯一家=${_FEERULES_CANON_HOME}(spec v1.2-2 单一共享函数), 两处各自实现同一规范=commit 永假/永真同族坑, import 组件的那份。`,
        fp, i + 1);
    }
    if (/blake2b\s*\([^)]*fee_?[Rr]ules/.test(line)) {
      warn('R-FEERULES-CANON-BYPASS [WARN]',
        `对 feeRules 直接 blake2b——hash-commit 必走 computeFeeRulesCommit(${_FEERULES_CANON_HOME})单源, 自 hash = canonical 规范旁路。`,
        fp, i + 1);
    }
  }
}

// R-PHANTOM-FIELD (2026-07-05, qzdh7nar/J1, following #48/#50/maker-P&L 三例同根): metadata fields written
// ONLY by the legacy v0.6 settler (pool-market-settler.js) are read unconditionally elsewhere as if they're
// always populated — but bshard(v0.7)/create-v07 markets never write them (deriveFeeLeaves/phase2_* writeback
// live only in the old settler), so an unguarded read silently gets `undefined` for every v0.7 market and either
// crashes or (worse) produces a wrong display (win shown as loss, fee shown as 0, P&L shown as "pending" forever).
// Three real incidents hit this exact pattern in 48h (phase2_winner #48, phase2_broker_fee_sompi #50,
// phase2_maker_payout_sompi maker-P&L) — this rule stops a 4th field from repeating it. Heuristic, not full AST:
// any `phase2_<word>` property read outside the writer file must have a same-line null/undefined/equality guard
// (`!= null`, `!== undefined`, `=== 0`, `=== 1`, optional chaining `?.`) — mirroring the exact pattern the three
// fixes converged on. WARN not error: some phase2_ references are plain comments/docs, not live reads.
// pool-market-settler.js = the actual v0.6→v0.7 migration risk this rule targets (pool_markets.metadata).
// bettor-prediction-{settler,voter}.js reuse the same "phase2_*" name for an unrelated, self-contained
// exchange_offers writer/reader pair (own dispatchPhase2 write at bettor-prediction-settler.js:338) — same
// field NAMES, different table/feature, not a v0.6/v0.7 split. Excluded to keep signal on the real risk.
const PHANTOM_FIELD_WRITER_FILE = 'services/pool-market-settler.js';
const PHANTOM_FIELD_EXCLUDE_FILES = ['services/bettor-prediction-settler.js', 'services/bettor-prediction-voter.js'];
// property-access only (`.phase2_x` / `['phase2_x']`) — excludes bare mentions inside strings/comments/log messages
// (e.g. migrate.js console.log("... phase2_tx_obj ...") is prose, not a live read).
const PHANTOM_FIELD_ACCESS_RE = /[.\[]['"]?(phase2_[a-z0-9_]+)\b/g;
const PHANTOM_FIELD_GUARD_RE = /!=\s*null|!==\s*null|!=\s*undefined|!==\s*undefined|===\s*0|===\s*1|\?\.|Array\.isArray|![\w.]*phase2_/;
function checkR_PHANTOM_FIELD(filepath, content) {
  const relPath = filepath.replace(/\\/g, '/');
  if (relPath.endsWith(PHANTOM_FIELD_WRITER_FILE)) return;  // the legitimate writer — no read-guard needed
  if (PHANTOM_FIELD_EXCLUDE_FILES.some((f) => relPath.endsWith(f))) return;  // unrelated self-contained phase2_ writer/reader pair
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;  // comment/doc line, not a live read
    const matches = [...line.matchAll(PHANTOM_FIELD_ACCESS_RE)];
    if (matches.length === 0) continue;
    // guard may be on this line or either of the two preceding lines (enclosing `if (x.phase2_y != null) {` block) —
    // matches the codebase's actual fixed pattern (#48 pool.js:2739-2740: guard on the `if`, use on the next line).
    const window = [lines[i - 2], lines[i - 1], line].filter(Boolean).join('\n');
    if (PHANTOM_FIELD_GUARD_RE.test(window)) continue;
    warn(
      'R-PHANTOM-FIELD [WARN]',
      `'${matches[0][1]}' 是 v0.6 老settler(pool-market-settler.js)专属字段, bshard(v0.7)/create-v07 盘从没写过(#48/#50/maker-P&L 三例同根)——这行读它但附近(本行+前两行)看不到 null/undefined/等值/Array.isArray/可选链守卫, 对 v0.7 盘会静默读到 undefined。确认这个读取点是不是也要区分 v0.6/v0.7(仿 #48/#50 fix 的守卫写法), 或者本身就在 v0.6-only 代码路径里(此时可忽略此告警)。`,
      filepath, i + 1
    );
  }
}

// R-COMMINGLE-GUARD (FINDING-2 ③, J1 2026-06-28): every bettor stake-lock handler in pool.js must call the
// single-source assertNotCommingled guard. commit1 inlined the check in register-v07 ONLY and missed the other
// 5 register handlers (register / register-v06{prep,confirm} / register-external{prep,confirm}) → auto-bet + TG
// /bet (register-v06 dual-handle) let commingled bets through. (1) flags any /bettor/register* handler missing
// the guard so a NEW register handler can't silently reopen the hole; (2) warns on inline commingled-detection
// SQL outside the canonical helper (= the same single-source-drift the guard-call-site rule prevents).
function checkR_COMMINGLE_GUARD(filepath, content) {
  // (1) guard-call-site: pool.js /bettor/register* handlers MUST call assertNotCommingled (hard fail).
  // A handler's body ends at the NEXT route handler (any verb) — not the next register handler — so an
  // unguarded handler can't false-pass on a guard call that lives in a non-register handler between them.
  if (/api[\\/]pool\.js$/.test(filepath)) {
    // Enumerate every fastify route handler with its route string, then check each whose body either (a) is a
    // /bettor/register* route OR (b) writes a stake lock (INSERT ... INTO pool_bettor_sides). Keying on the
    // INSERT signature — not just the route name (KANet-UI future-proof catch) — means a NEW stake-lock handler
    // under any path can't silently reopen the hole; the register* condition keeps prep-handler defense coverage.
    const handlerRe = /fastify\.(?:post|put|get|delete|patch)\(\s*['"`]([^'"`]*)['"`]/g;
    const handlers = [];
    let h;
    while ((h = handlerRe.exec(content)) !== null) {
      handlers.push({ idx: h.index, route: h[1], line: content.slice(0, h.index).split('\n').length });
    }
    for (let i = 0; i < handlers.length; i++) {
      const body = content.slice(handlers[i].idx, i + 1 < handlers.length ? handlers[i + 1].idx : content.length);
      const isRegister = /\/bettor\/register/.test(handlers[i].route);
      const locksStake = /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+pool_bettor_sides\b/i.test(body);
      if ((isRegister || locksStake) && !/assertNotCommingled\s*\(/.test(body)) {
        violate(
          'R-COMMINGLE-GUARD',
          '[FINDING-2 ③] bettor stake-lock handler 缺 assertNotCommingled 单源守卫 — commingled-spine 盘可漏押 (commit1 只守 register-v07, 漏 register-v06 dual-handle = auto-bet/TG 主路径; 触发=register* 路由 OR INSERT pool_bettor_sides). market 加载后加一行 `if (assertNotCommingled(market, reply, sqlite)) return;` (lib/pool-commingle-detect.mjs).',
          filepath, handlers[i].line
        );
      }
    }
  }
  // (2) single-source: inline commingled-detection SQL outside the canonical helper = drift risk (warn).
  // Skip the helper itself (canonical home) AND this lint script (whose regex/message literally contains the
  // scanned pattern → would self-flag).
  if (!/pool-commingle-detect\.mjs$/.test(filepath) && !/lint-kanet\.mjs$/.test(filepath)) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:\/\/|\*)/.test(lines[i])) continue;
      const window = lines.slice(i, i + 3).join(' ');
      if (/GROUP\s+BY\s+spine_p2sh\b[\s\S]{0,80}HAVING\s+COUNT\(\*\)\s*>\s*1/i.test(window)) {
        warn(
          'R-COMMINGLE-SINGLE-SOURCE',
          '[FINDING-2 单源] 内联 commingled-spine 检测 SQL (GROUP BY spine_p2sh HAVING COUNT(*)>1) — 应 import commingledSpineSet/isCommingledSpine (lib/pool-commingle-detect.mjs) 防与单源判据漂移.',
          filepath, i + 1
        );
      }
    }
  }
}

// ── R-DOC-PATH / R-DOC-DUPLICATE (③ doc-lint, Bettor 2026-06-29):
//   设计文档(date-prefix *.md)必住 docs/ 根目录·同名多路径 → fail.
//   根因: 今晚 KANet-UI UX doc 误提 kasia-console/docs/ → grep 扫 docs/ 看不到 → 假阴性.
//   同族: J1 stale-local 假阴性(代码同名但版本不同). 此 lint 堵"同名 doc 多路径"变体.
//   Escape hatch: 不支持 (文档无理由散落多路径; 必归 docs/).
function checkDocPath() {
  const DOCS_ROOT = path.join(ROOT, 'docs');
  const datePrefix = /^\d{4}-\d{2}-\d{2}-/;
  // 不走嵌套副本目录 / 无关目录 (kanet-tn12 = 嵌套同名目录, 非本 repo 范围)
  const mdSkip = new Set(['node_modules', '.git', 'logs', 'dist', 'build', 'out', '.cache',
    'scratch', 'tmp', '_archive_root_20260627', 'kasia-console-archive', 'kanet-tn12']);

  const mdFiles = [];
  function walkMd(dir, depth) {
    if (depth > 7) return;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (mdSkip.has(name) || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) walkMd(full, depth + 1);
      else if (st.isFile() && name.endsWith('.md')) mdFiles.push(full);
    }
  }
  walkMd(ROOT, 0);

  // Rule 1: date-prefixed design doc NOT under docs/ hierarchy → block
  // 允许 docs/ 任何子目录 (archived/plans/spec 等); 不允 kasia-console/docs/、根目录 等。
  const docsHierarchy = DOCS_ROOT + path.sep;
  for (const fp of mdFiles) {
    const name = path.basename(fp);
    if (!datePrefix.test(name)) continue;
    if (fp.startsWith(docsHierarchy) || path.dirname(fp) === DOCS_ROOT) continue;
    violate('R-DOC-PATH',
      `设计文档 "${name}" 不在 docs/ 层次下 (当前: ${path.relative(ROOT, fp)}). ` +
      `必 git mv → docs/${name}. Owner 单路径原则·防 grep 假阴性 (今晚教训).`,
      fp, 0);
  }

  // Rule 2: same-basename date-prefix .md in multiple paths → block
  // 只查 date-prefix 设计文档 (排除 README.md / broker-test-guide.md 等通用名).
  const byBasename = {};
  for (const fp of mdFiles) {
    const name = path.basename(fp);
    if (!datePrefix.test(name)) continue;  // skip non-design-doc
    (byBasename[name] ||= []).push(fp);
  }
  for (const [name, fps] of Object.entries(byBasename)) {
    if (fps.length <= 1) continue;
    violate('R-DOC-DUPLICATE',
      `设计文档 "${name}" 散落 ${fps.length} 个路径: ` +
      `${fps.map(f => path.relative(ROOT, f)).join(' + ')} → grep 假阴性. ` +
      `保留 docs/ 一份·删其余.`,
      fps[0], 0);
  }

  // Rule 3 (R-DOC-STATUS, WARN, 2026-07-07 卡3 KANet-UI+Bettor+NWT): date-prefix 设计文档缺 Status 头
  // → 亮灯不 block(现存 123/129 篇无头, hard-block 会瘫掉几乎所有 docs/ commit)。
  // 目的同 D-004 知识分层:接位者一眼看清这篇是 CURRENT/SUPERSEDED/ARCHIVED,不用翻 ledger 猜。
  // 只查 docs/ 根(不含子目录,archived/等子目录本身已经是状态声明,不强制加头)。
  const statusRe = /^\s*>\s*\*\*Status\*\*\s*:\s*(CURRENT|SUPERSEDED|ARCHIVED)/mi;
  for (const fp of mdFiles) {
    const name = path.basename(fp);
    if (!datePrefix.test(name)) continue;
    if (path.dirname(fp) !== DOCS_ROOT) continue;  // 只查 docs/ 根, 子目录已分类不重复要求
    let head;
    try { head = fs.readFileSync(fp, 'utf8').slice(0, 2000); } catch { continue; }
    if (!statusRe.test(head)) {
      warn('R-DOC-STATUS',
        `设计文档 "${name}" 缺 Status 头(> **Status**: CURRENT|SUPERSEDED|ARCHIVED,标题下方几行内). ` +
        `接位者翻 docs/ 时无法一眼判断这篇还作不作数. 加一行, 见任意近期文档示例.`,
        fp, 0);
    }
  }
}

// ── 跑 ──
for (const fp of targets) {
  let content;
  try { content = read(fp); } catch { continue; }
  checkR9(fp, content);
  checkR11(fp, content);
  checkR6(fp, content);
  checkR19(fp, content);
  checkR29(fp, content);
  checkR33(fp, content);
  checkR33b(fp, content);
  checkR37(fp, content);
  checkR_NWT_FRAMEWORK(fp, content);
  checkR_NWT_STATE_MACHINE(fp, content);  // SA-3: retail_dex_orders.state 直 UPDATE → hard fail
  checkBrokerStutter(fp, content);
  checkR_COMMINGLE_GUARD(fp, content);  // FINDING-2 ③: stake-lock handler 必调单源 assertNotCommingled (防漏 handler)
  checkCommandEnum(fp, content);
  checkABE_A6_protocol_status_owner(fp, content);  // ABE-A.6: protocol_status owner invariant
  checkKI30_chain_amount_precision(fp, content);  // KI-30 (Bettor r181 5/19): chain TX amount 必 toFixed(8)
  checkKI31_gamma_closed_query(fp, content);  // KI-31 (Bettor r184 5/19): gamma single-market query 必 &closed=true
  checkKI32_oracle_channel_mutex(fp, content);  // KI-32 (Oracle v0.3 R7 J2 #9 + J1 #4): oracle-registry NOT 进 COORD_CHANNELS + ORACLE_REGISTRY_CHANNELS 跟 COORD mutex
  checkKI33_trust_score_placeholder(fp, content);  // KI-33 (Oracle v0.3 §9 5/26): broker-llm-agent.js SYSTEM_PROMPT 必含 {{trust_score}}
  checkR40_minerFee_floor(fp, content);  // R40 (G6 批2 红线 7, qlfpv brick sediment 5/31): pool.js create-v06 minerFee 默认下限
  checkR_SHARD_BLIND(fp, content);       // R-SHARD-BLIND [WARN] (线8 STEP2 2026-06-24): pool_bettor_sides 裸 logical market_id 查
  checkR_PHANTOM_FIELD(fp, content);     // R-PHANTOM-FIELD [WARN] (2026-07-05, qzdh7nar): v0.6-only phase2_* 字段无守卫读取 — 防第4例(#48/#50/maker-P&L 同根)
  checkR_FEERULES_CANON_BYPASS(fp, content);  // R-FEERULES-CANON-BYPASS [WARN] (B线落1 2026-07-12): feeRules canonicalize/hash 单源封旁路(spec v1.2-2)
  checkR_STATUS_GUARD_BLACKLIST(fp, content);  // R-STATUS-GUARD-BLACKLIST [WARN] (处置设计红队 2026-07-12): protocol_status UPDATE 安全闸黑名单启发式→建议白名单
  checkR_EXPLORER_URL_BYPASS(fp, content);     // R-EXPLORER-URL-BYPASS [ERROR] (死链收敛设计 §3 2026-07-12): explorer 域名字面量禁散装, 单源 explorer-url.mjs 外一律硬阻塞
  checkR_SELF_HTTP_FETCH(fp, content);         // R-SELF-HTTP-FETCH [WARN] (2026-07-14 legacy-refund 自锁死循环修复设计): console 禁 fetch 自己的端口
  checkR_FETCH_NO_TIMEOUT(fp, content);        // R-FETCH-NO-TIMEOUT [WARN] (同上设计 修法C): fetch() 建议带 AbortSignal.timeout
  checkR_PS_FAMILY_DISPATCH(fp, content);      // R-PS-FAMILY-DISPATCH [ERROR] (K-18 §3.4 2026-07-21): compilePayoutShardRedeem/V2Redeem 调用点白名单, 防绕过 coherence gate
  checkR_SCA_ALIAS_ORIGIN(fp, content);        // R-SCA-ALIAS-ORIGIN [WARN] (M0c-1 批C 2026-07-23): sendCommandAsync 别名 call 缺 origin/裸值传参检测, 防 armed 后漏标断路
}
checkR10();
checkR_NULLIFIER_I64();
checkR_COMMAND_REGISTRATION();  // R-COMMAND-REGISTRATION (#25, KI-49 防重复): relay.mjs case 必在 commands.mjs 三层注册
checkR_FEE_LEAVES_BYPASS();     // R-FEE-LEAVES-BYPASS [WARN] (P4/D-008, 2026-07-09): ZK 线禁直调 deriveFeeLeaves/FEE_CONFIG
checkScratchClutter();
checkR_FEE_SPLIT_PKG_DRIFT();     // R-FEE-SPLIT-PKG-DRIFT [ERROR] (B线落3 2026-07-12): packages/fee-split/fee-split.mjs 必与源同步(硬阻塞非WARN)
checkR_MANIFEST_SCHEMA_COMPLETE();  // R-MANIFEST-SCHEMA-COMPLETE [ERROR] (件④ 2026-07-16): money-path manifest 十二字段齐全性
checkR_MANIFEST_EXIT_REACHABLE();   // R-MANIFEST-EXIT-REACHABLE [ERROR] (件④ 2026-07-16): 三种exit全空=K-10直接违反
checkR_MANIFEST_TEST_COVERAGE();    // R-MANIFEST-TEST-COVERAGE [WARN] (件④ 2026-07-16): required_tests 覆盖已声明exit
checkR_MANIFEST_ADMIN_TIER_MATCH(); // R-MANIFEST-ADMIN-TIER-MATCH [WARN] (件④ 2026-07-16): admin_secret_var/risk_tier 对齐⑥拆分清单
checkLedgerSize();               // R-LEDGER-SIZE [WARN] (D-010 2026-07-10): COORD-LEDGER.md >100KB 提醒切档
checkDocPath();                          // R-DOC-PATH/R-DOC-DUPLICATE (③ doc-lint 2026-06-29): date-prefixed doc 必住 docs/ 根·同名多路径 → fail
checkM0A();                              // R-M0A-* [ERROR×5] (M0a 差分门 2026-07-22 设计v0.2 NWT GREEN): 裸 sqlite/relay-manager import 精确镜像 baseline+manifest, 新增即败
checkHooksPathArmed();                   // R-HOOKSPATH-ARMED [WARN·LOUD] (2026-07-23 门虚设事故): core.hooksPath 未设=pre-commit 门静默全关, 自卫检测
checkR_LEGACY_ORIGIN_SHRINK();           // R-LEGACY-ORIGIN-SHRINK [ERROR] (C 分阶段 arm 8282dd61 §3): legacy 迁移债 shrink-only ratchet, 新增即拒+baseline 抬额即拒

// ── R-LEGACY-ORIGIN-SHRINK [ERROR] (C 分阶段 arm 8282dd61 §3, 2026-07-23): migration debt ledger ──
// origin='legacy-unmigrated' = 收敛类零鉴权路由的显式过渡标(armed 下暂放行), 是迁移债记账 marker
// 非安全控制, 目标 shrink 到零。本规则 = shrink-only ratchet 三道:
//   ① 任一文件实际 legacy 计数 > baseline → ERROR(新增 legacy 禁止, 新路由必须直接 app/operator/internal)。
//   ② baseline 文件自身被调升(对比 HEAD 版) → ERROR(防经 baseline 抬额度绕门 = 硬 ratchet,
//      补设计稿"无硬 ratchet 则纪律依赖"残留)。
//   ③ 实际计数 < baseline → warn 提醒收紧 baseline(迁移完成后同 commit 减计数, 债账实时)。
// 计数只认代码里带引号的 'legacy-unmigrated'(注释剥除), 与 gate 分支消费的字面量同源。
function checkR_LEGACY_ORIGIN_SHRINK() {
  const LEGACY_BASELINE_PATH = 'scripts/legacy-origin-baseline.json'; // 声明在函数内(调用点在定义前, 防模块级 const TDZ)
  const LEGACY_RE = /['"]legacy-unmigrated['"]/g;
  const counts = new Map(); // repoRelPath(posix) -> count
  const srcRoot = path.join(ROOT, 'kasia-console', 'src');
  if (!fs.existsSync(srcRoot)) return;
  for (const abs of walk(srcRoot)) {
    let content = '';
    try { content = read(abs); } catch { continue; }
    let n = 0;
    for (const line of content.split('\n')) {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*(?:\*|\/\*)/.test(line)) continue;
      n += (code.match(LEGACY_RE) || []).length;
    }
    if (n > 0) counts.set(path.relative(ROOT, abs).split(path.sep).join('/'), n);
  }
  let baseline = null;
  try { baseline = JSON.parse(read(file(LEGACY_BASELINE_PATH)).replace(/^﻿/, '')); } catch { baseline = null; }
  if (!baseline || typeof baseline.files !== 'object') {
    if (counts.size > 0) {
      violate('R-LEGACY-ORIGIN-SHRINK', `legacy-unmigrated 标存在(${[...counts.keys()].join(', ')})但 baseline ${LEGACY_BASELINE_PATH} 缺失/损坏 — 债账 fail-closed, 恢复 baseline 文件。`, file(LEGACY_BASELINE_PATH), 0);
    }
    return;
  }
  // ② 硬 ratchet: baseline 自身只准降不准升(对比 HEAD 版)。唯一例外=授权扩张通道(2026-07-23 开闸
  // 事故修法引入): expansion_authorizations 含 to_total==现总数的条目→放行+LOUD warn(重分类订正类
  // 合法扩张, 如 17 处误标 app→legacy)。授权条目真实性 lint 不能验(完整性门), 靠 NWT diff 审 load-bearing
  // ——同 M0a manifest review_ref 模式; 无授权条目的调升照拒。
  try {
    const headRaw = execFileSync('git', ['show', 'HEAD:' + LEGACY_BASELINE_PATH], { cwd: ROOT, encoding: 'utf8' });
    const head = JSON.parse(headRaw.replace(/^﻿/, ''));
    if (head && typeof head.files === 'object') {
      const raised = Object.entries(baseline.files).filter(([fp, n]) => n > (head.files[fp] ?? 0));
      if (raised.length > 0) {
        const auths = Array.isArray(baseline.expansion_authorizations) ? baseline.expansion_authorizations : [];
        const authOk = auths.some((a) => a && a.to_total === baseline.total && a.ref);
        if (authOk) {
          warn('R-LEGACY-ORIGIN-SHRINK', `🔴 baseline 授权扩张生效(→total ${baseline.total}, ${raised.length} 文件计数升)— expansion_authorizations 条目匹配。此扩张须经 NWT diff 审 load-bearing 核授权真实性(lint 只校完整性)。涉及: ${raised.map(([fp]) => fp).join(', ')}`, file(LEGACY_BASELINE_PATH), 0);
        } else {
          for (const [fp, n] of raised) {
            violate('R-LEGACY-ORIGIN-SHRINK', `baseline ${fp} 计数被调升(HEAD ${head.files[fp] ?? 0} → ${n})且无匹配授权条目(expansion_authorizations 需 to_total==${baseline.total}+ref)— baseline 只准 shrink, 抬额度=绕 migration debt 门(硬 ratchet)。`, file(LEGACY_BASELINE_PATH), 0);
          }
        }
      }
    }
  } catch { /* baseline 尚未入 HEAD(首 commit)= 跳过 ratchet 对比 */ }
  // ① 实际 > baseline = 新增禁止; ③ 实际 < baseline = 提醒收紧
  const allFiles = new Set([...counts.keys(), ...Object.keys(baseline.files)]);
  for (const fp of allFiles) {
    const actual = counts.get(fp) || 0;
    const allowed = baseline.files[fp] ?? 0;
    if (actual > allowed) {
      violate('R-LEGACY-ORIGIN-SHRINK', `${fp} legacy-unmigrated 计数 ${actual} > baseline ${allowed} — 禁新增 legacy 标(它是迁移债非通行证): 新路由/新调用必须直接 origin=app(信封)/operator(专道)/internal(纯 daemon)。`, file(fp), 0);
    } else if (actual < allowed) {
      warn('R-LEGACY-ORIGIN-SHRINK', `${fp} legacy 实际 ${actual} < baseline ${allowed} — 迁移有进展, 把 ${LEGACY_BASELINE_PATH} 对应计数收紧到 ${actual}(与迁移代码同 commit, 债账实时)。`, file(fp), 0);
    }
  }
}

// ── R-HOOKSPATH-ARMED [WARN·LOUD] (2026-07-23 KANet-UI 抓·Bettor 采纳机制补丁): 门自卫 ──
// 实锤: 本 clone core.hooksPath 从未配置 → pre-commit lint 门全程虚设, 全体 agent commit 裸跑,
// 多个 ERROR 级违规(explorer 硬编码/M0a bare-import)静默过关。hook 激活是 per-clone 一次性动作,
// "hook 文件在仓库里"≠"本 clone 门开着"。本自检让每次手动跑 lint 都 LOUD 提示门的真实状态,
// 防再次静默关门(约定靠自觉守不住→上机制, CLAUDE.md 铁律 0 同族)。
function checkHooksPathArmed() {
  let hp = '';
  try {
    hp = execFileSync('git', ['config', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { hp = ''; } // 未配置时 git config 退出码 1
  if (hp !== '.githooks') {
    warn('R-HOOKSPATH-ARMED', `🔴🔴 core.hooksPath 未指向 .githooks(现值: "${hp || '(未设置)'}")= 本 clone 的 pre-commit lint 门是关的, commit 在裸跑! 立即执行: git config core.hooksPath .githooks(per-clone 一次性, 2026-07-23 门虚设事故复发防)。`, path.join(ROOT, '.git/config'), 0);
  }
}

// ── 报告 ──
// warnings first (non-blocking — WARN rules are migration checklists, not hard blockers)
if (warnings.length > 0) {
  const byWarnRule = {};
  for (const w of warnings) (byWarnRule[w.rule] ||= []).push(w);
  console.log(`\n[lint-kanet] ⚠  ${warnings.length} warning(s) across ${Object.keys(byWarnRule).length} warn-rule(s) (non-blocking — fix as migration checklist):\n`);
  for (const [rule, ws] of Object.entries(byWarnRule)) {
    console.log(`  ${rule}: ${ws.length} hit(s)`);
    for (const w of ws.slice(0, 5)) {
      console.log(`    ${path.relative(ROOT, w.file)}:${w.line}`);
      console.log(`      ${w.msg.slice(0, 200)}`);
    }
    if (ws.length > 5) console.log(`    ... ${ws.length - 5} more`);
  }
  console.log(`\n  Warnings do NOT block commit. Migrate to suppress. See docs/ANTI-PATTERNS.md.`);
}

if (violations.length === 0) {
  if (warnings.length === 0) console.log(`[lint-kanet] ✓ ${targets.length} files clean`);
  else console.log(`[lint-kanet] ✓ ${targets.length} files — 0 errors (${warnings.length} warning(s) above)`);
  process.exit(0);
}

const byRule = {};
for (const v of violations) (byRule[v.rule] ||= []).push(v);

console.log(`\n[lint-kanet] ✗ ${violations.length} violation(s) across ${Object.keys(byRule).length} rule(s):\n`);
for (const [rule, vs] of Object.entries(byRule)) {
  console.log(`  ${rule}: ${vs.length} hit(s)`);
  for (const v of vs.slice(0, 5)) {
    console.log(`    ${path.relative(ROOT, v.file)}:${v.line}`);
    console.log(`      ${v.msg.slice(0, 200)}`);
  }
  if (vs.length > 5) console.log(`    ... ${vs.length - 5} more`);
}
console.log(`\n  See docs/ANTI-PATTERNS.md for context. Fix before commit.`);
process.exit(1);
