// CIS 的变异测试。绿不是证据, 【把守卫拆掉能看见它红】才是。
// 🔴 头一条就是把 Codex 那个缺陷原样装回去(cis_digest 退回旧的 input_set_root 语义) ——
//    装回去, "只改 bets_excluded" 那一格就得自己红, 否则那格用例在说谎。
// 🔴 三类计数缺一不可: MISSED(拆了没红) / INERT(没改动文件) / BROKEN(改成语法坏的, 必然"检出")。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'pool-canonical-input-set.mjs');
const TEST = join(HERE, 'pool-canonical-input-set.test.mjs');
const original = readFileSync(SRC, 'utf8');

const MUTANTS = [
  ['🔴 cis_digest 退回只覆盖 root(Codex 缺陷)',
    (s) => s.replace('for (const k of Object.keys(cis)) if (!SELF_REFERENTIAL_KEYS.includes(k)) body[k] = cis[k];',
      "for (const k of ['domain','policy','order_rule','prior_state','input_set_root']) body[k] = cis[k];")],
  ['自引用集变空(cis_digest 进自己的 body)',
    (s) => s.replace("Object.freeze(['cis_digest'])", 'Object.freeze([])')],
  ['verify 不重算 input_set_root',
    (s) => s.replace('if (cis.input_set_root !== wantRoot) {', 'if (false) {')],
  ['verify 不重算 cis_digest',
    (s) => s.replace('if (cis.cis_digest !== wantDigest) {', 'if (false) {')],
  ['未知键放行(静默剥除)',
    (s) => s.replace('if (missing.length || extra.length) {', 'if (missing.length) {')],
  ['缺键放行',
    (s) => s.replace('if (missing.length || extra.length) {', 'if (extra.length) {')],
  ['schema_version 兼容降级',
    (s) => s.replace('if (cis.schema_version !== CIS_SCHEMA_VERSION)', 'if (false)')],
  ['hex 大小写归一化而非拒绝',
    (s) => s.replace('!HEX32.test(hex)', '!HEX32.test(String(hex).toLowerCase())')],
  ['大数收 number(不强制十进制字符串)',
    (s) => s.replace("if (typeof s !== 'string' || !DECINT.test(s))", 'if (false)')],
  ['摘要字段不验算法标识',
    (s) => s.replace('!DIGEST.test(cis[k])', 'false')],
  ['叶子丢掉 LP 域标签(裸 concat)',
    (s) => s.replace("LP(U('kanet.pool.cis.bet.v1')),", "U('kanet.pool.cis.bet.v1'),")],
  ['归并处丢掉 LP(变长段裸拼)',
    (s) => s.replace('LP(U(CIS_DOMAIN)), LP(U(ctx)),', 'U(CIS_DOMAIN), U(ctx),')],
  ['bets 叶子不含 lock_daa(排序键不进承诺)',
    (s) => s.replace("serializeI64(bigOf(b.lock_daa, 'bets[].lock_daa'), 8),", '')],
  // ── 下面五条守的是 2026-08-11 那次「形状对不上设计」的改正。
  //    改正本身不算数, 【拆掉它能看见红】才算数。
  ['outpoint 结构闸放行(扁平/多余键都收)',
    (s) => s.replace("if (k !== 'index,txid')", 'if (false)')],
  ['bets 叶子不含 outpoint(commingled-spine 可冒用)',
    (s) => s.replace('op.txid, i32le(op.index),\n    hexBuf(b.bettor_pk', "hexBuf(b.bettor_pk")],
  ['不认识的 role 静默当 0',
    (s) => s.replace('if (!Object.prototype.hasOwnProperty.call(table, role)) {', 'if (false) {')
      .replace('return table[role];', 'return table[role] ?? 0;')],
  ['outputs 叶子不含 role_code(角色可互换)',
    (s) => s.replace("serializeI64(BigInt(roleCode(OUTPUT_ROLE_CODE, o.role, 'outputs[]')), 1),", '')],
  ['verify 不重算 bets_root_legacy(只比 CIS 那一个)',
    (s) => s.replace('if (legacy !== cis.bets_root_legacy) {', 'if (false) {')],
  // ── 未裁定标记(NWT 2026-08-11 note)。注释变不成闸, 而【改成会抛的断言】能被变异体拆掉验。
  ['未裁定标记被翻成 true(擅自宣布已裁定)',
    (s) => s.replace('export const ROLE_CODES_RATIFIED = false;', 'export const ROLE_CODES_RATIFIED = true;')],
  ['assertRoleCodesRatified 变成不抛(退回注释级警告)',
    (s) => s.replace('if (!ROLE_CODES_RATIFIED) {', 'if (false) {')],
  ['抛出的话不点出调用点(报错等于没报)',
    (s) => s.replace('`CIS: ${where} 拒绝执行', '`CIS: 拒绝执行')],
];

let det = 0; let miss = 0; let inert = 0; let broken = 0;
const dir = mkdtempSync(join(tmpdir(), 'cis-mut-'));
try {
  for (const [name, fn] of MUTANTS) {
    const mutated = fn(original);
    if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 变异没改动文件, 这条什么也没测`); continue; }
    writeFileSync(SRC, mutated, 'utf8');
    let syntaxOk = true;
    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
    if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 它必然"检出", 什么也没证`); continue; }
    let green = true;
    try { execFileSync(process.execPath, [TEST], { stdio: 'ignore' }); } catch { green = false; }
    if (green) { miss += 1; console.log(`[MISSED] ${name} — 守卫被拆掉而用例【全绿】`); }
    else { det += 1; console.log(`[detect] ${name}`); }
  }
} finally {
  writeFileSync(SRC, original, 'utf8');   // 🔴 无论如何还原, 别把变异体留在库里
  rmSync(dir, { recursive: true, force: true });
}
console.log('');
console.log(`detected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`);
if (miss || inert || broken) process.exit(1);
