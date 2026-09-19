// scan-11-1.mjs — 设计 v0.3.2 §11.1/§11.2/§11.3 的源码扫描, 在合入候选上实跑(J2 2026-09-19)。
// 断言(全部针对【非测试】源码, 先去掉注释再匹配, 避免注释里的说明文字误报):
//   S-a  withdraw / ticket_reclaim 的 builder(buildWithdrawTxJson / buildTicketReclaimTxJson)除【定义它们的文件】外, 全仓 src 不得有任何引用;
//   S-b  驱动与 HTTP 侧(kasia-console/src/services/** 与 kasia-console/src/api/** 下所有文件)不得引用结算 builder 文件
//        (proto-tx-assembly-settlement)本身, 也不得出现 assertWithdrawDestinationAllowed / WITHDRAW_DESTINATION_ALLOWLIST;
//   S-c  allowUnlistedTestDestination 在 services/** 与 api/** 零命中(§11.3: 驱动永不传这个测试放行标志)。
// 另带【对照】: 往驱动源码里塞一条 import 必须被抓到; 只出现在注释里不得误报——否则本扫描是空判据。
// 运行(在仓库根): node docs/provenance/2026-09-19-j2-merge-candidate-batch6-8/scan-11-1.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return /\.(mjs|js|cjs)$/.test(e.name) && !/\.(test|selftest)\.(mjs|js|cjs)$/.test(e.name) ? [p] : [];
});
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const BUILDERS = /\b(buildWithdrawTxJson|buildTicketReclaimTxJson)\b/;
const DEFINING = 'kasia-console/src/lib/proto-tx-assembly-settlement.mjs';
const SETTLEMENT_FILE = /proto-tx-assembly-settlement/;
const GATE_NAMES = /\b(assertWithdrawDestinationAllowed|WITHDRAW_DESTINATION_ALLOWLIST\w*)\b/;
const BYPASS = /\ballowUnlistedTestDestination\b/;

const srcFiles = [...walk(path.join(ROOT, 'kasia-console/src')), ...walk(path.join(ROOT, 'kasia-relay/src'))];
const driverHttp = srcFiles.filter((f) => /^kasia-console\/src\/(services|api)\//.test(rel(f)));

// 纯判定函数(对照也用它)
const violations = (relPath, text) => {
  const code = strip(text), v = [];
  if (relPath !== DEFINING && BUILDERS.test(code)) v.push('S-a 引用了 withdraw/ticket_reclaim builder');
  if (/^kasia-console\/src\/(services|api)\//.test(relPath)) {
    if (SETTLEMENT_FILE.test(code)) v.push('S-b 驱动/HTTP 引用了结算 builder 文件');
    if (GATE_NAMES.test(code)) v.push('S-b 驱动/HTTP 引用了 withdraw 目的地闸相关名字');
    if (BYPASS.test(code)) v.push('S-c 驱动/HTTP 出现 allowUnlistedTestDestination');
  }
  return v;
};

let bad = 0;
const report = [];
for (const f of srcFiles) { const v = violations(rel(f), fs.readFileSync(f, 'utf8')); if (v.length) { bad++; report.push(`  ✗ ${rel(f)}: ${v.join('; ')}`); } }
console.log(`扫描范围: ${srcFiles.length} 个非测试源文件(kasia-console/src + kasia-relay/src), 其中驱动/HTTP 侧 ${driverHttp.length} 个:`);
for (const f of driverHttp) console.log('   - ' + rel(f));
console.log(bad === 0 ? '结果: 0 个违规 ✅' : `结果: ${bad} 个违规 ❌\n${report.join('\n')}`);

// 定义文件本身确实含这两个 builder(否则 S-a 的"零引用"可能只是因为名字改了)
const defText = strip(fs.readFileSync(path.join(ROOT, DEFINING), 'utf8'));
const defOk = /export function buildWithdrawTxJson/.test(defText) && /export function buildTicketReclaimTxJson/.test(defText);
console.log(`定义文件 ${DEFINING} 仍含两个 builder 的导出: ${defOk ? '是 ✅' : '否 ❌(扫描锚点失效)'}`);

// ── 对照: 扫描器必须能抓到违规, 且不对注释误报 ─────────────────────────────────────────────────────────────
const ctl = [
  ['塞一条 import builder 到 proto-driver.mjs', 'kasia-console/src/services/proto-driver.mjs', "import { buildWithdrawTxJson } from '../lib/proto-tx-assembly-settlement.mjs';\nexport const x = 1;", true],
  ['塞 ticket_reclaim builder 到 proto.js', 'kasia-console/src/api/proto.js', "const m = await import('../lib/proto-tx-assembly-settlement.mjs'); m.buildTicketReclaimTxJson({});", true],
  ['驱动里传 allowUnlistedTestDestination', 'kasia-console/src/services/proto-driver.mjs', 'const opts = { allowUnlistedTestDestination: true };', true],
  ['驱动里引用目的地闸', 'kasia-console/src/api/proto.js', "import { assertWithdrawDestinationAllowed } from 'x';", true],
  ['只在注释里提到 builder(不得误报)', 'kasia-console/src/services/proto-driver.mjs', '// 不得 import buildWithdrawTxJson / proto-tx-assembly-settlement\n/* buildTicketReclaimTxJson allowUnlistedTestDestination */\nexport const y = 2;', false],
  ['lib 里别的文件引用 builder(S-a)', 'kasia-console/src/lib/some-new-file.mjs', 'import { buildWithdrawTxJson } from "./proto-tx-assembly-settlement.mjs";', true],
];
let ctlOk = true;
for (const [name, p, text, expectFlag] of ctl) {
  const flagged = violations(p, text).length > 0;
  const ok = flagged === expectFlag;
  if (!ok) ctlOk = false;
  console.log(`  对照 ${ok ? '✅' : '❌'} ${name}: ${flagged ? '被抓到' : '未报'}(期望${expectFlag ? '被抓到' : '不报'})`);
}
const pass = bad === 0 && defOk && ctlOk;
console.log(pass ? '\n§11.1/§11.2/§11.3 扫描: PASS(含对照)' : '\n§11.1/§11.2/§11.3 扫描: FAIL');
process.exit(pass ? 0 : 1);
