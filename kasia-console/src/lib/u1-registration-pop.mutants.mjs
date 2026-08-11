// N8 PoP 层的变异测试。**11 格全绿只说明用例跑到了。** 把每道闸逐条拆掉、看它会不会红, 才是证据。
// 🔴 三类计数缺一不可: MISSED(拆了没红) / INERT(没改到文件) / BROKEN(改成语法坏的, 必然"检出")。
// 🔴 收尾验还原逐字节相同 —— 变异体留在库里比不跑变异更糟。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'u1-registration-pop.mjs');
const TEST = join(HERE, 'u1-registration-pop.test.mjs');
const CWD = join(HERE, '..', '..');
const original = readFileSync(SRC, 'utf8');
const originalSha = createHash('sha256').update(original).digest('hex');

const MUTANTS = [
  // 🔴 头一条就是整层的承重点: 不真验签, 只看签名"像不像"
  ['只验签名形状、不验签名本身(承重点失守)',
    (s) => s.replace('valid = await verify({ message: messageHashHex, signature: String(s.signature).trim(), publicKey: verifiedWith });',
      "valid = /^[0-9a-fA-F]+$/.test(String(s.signature).trim());")],
  ['验签结果不判(valid 恒真)',
    (s) => s.replace('if (!valid) {', 'if (false) {')],
  ['验签抛错时当作通过',
    (s) => s.replace("return { ok: false, code: POP_REJECT.SIGNATURE_INVALID, reason: `verifyMessage threw: ${e?.message || e}`, verifiedWith };",
      'valid = true;')],
  // 挑战串四道闸
  ['挑战串查不到也放行(不是我们签发的也认)',
    (s) => s.replace('if (!challengeRecord || !nonEmpty(challengeRecord.challenge)) {', 'if (false) {')],
  ['挑战串与记录不符也放行',
    (s) => s.replace("if (String(challengeRecord.challenge).trim() !== String(s.challenge).trim()) {", 'if (false) {')],
  ['已用过的挑战串仍放行(重放门开)',
    (s) => s.replace('if (challengeRecord.usedAt) {', 'if (false) {')],
  ['过期的挑战串仍放行',
    (s) => s.replace('if (nowMs > expMs) return', 'if (false) return')],
  ['expiresAt 读不出来时当成"永不过期"',
    (s) => s.replace("if (!Number.isFinite(expMs)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'challengeRecord.expiresAt unreadable' };", '')],
  // 结构闸
  ['缺签名也放行',
    (s) => s.replace("if (!nonEmpty(s.signature)) return { ok: false, code: POP_REJECT.MALFORMED, reason: 'signature missing' };", '')],
  // payload 绑定面
  ['payload 不绑 relay_id',
    (s) => s.replace('    `relay_id=${relayId.trim()}`,\n', '')],
  ['payload 不绑 challenge',
    (s) => s.replace('    `challenge=${challenge.trim()}`,\n', '')],
  ['payload 不绑 identity_index',
    (s) => s.replace('    `identity_index=${identityIndex}`,\n', '')],
];

let det = 0; let miss = 0; let inert = 0; let broken = 0;
try {
  for (const [name, fn] of MUTANTS) {
    const mutated = fn(original);
    if (mutated === original) { inert += 1; console.log(`[INERT ] ${name} — 变异没改动文件, 这条什么也没测`); continue; }
    writeFileSync(SRC, mutated, 'utf8');
    let syntaxOk = true;
    try { execFileSync(process.execPath, ['--check', SRC], { stdio: 'ignore' }); } catch { syntaxOk = false; }
    if (!syntaxOk) { broken += 1; console.log(`[BROKEN] ${name} — 变异体语法坏, 必然"检出", 什么也没证`); continue; }
    let green = true;
    try { execFileSync(process.execPath, [TEST], { stdio: 'ignore', cwd: CWD }); } catch { green = false; }
    if (green) { miss += 1; console.log(`[MISSED] ${name} — 闸被拆掉而用例【全绿】`); }
    else { det += 1; console.log(`[detect] ${name}`); }
  }
} finally {
  writeFileSync(SRC, original, 'utf8');
  const back = createHash('sha256').update(readFileSync(SRC, 'utf8')).digest('hex');
  console.log(back === originalSha ? '\n[restore] 逐字节还原已验(sha256 相同)' : `\n🔴🔴 [restore] 还原【对不上】! 手工检查 ${SRC}`);
  if (back !== originalSha) process.exit(2);
}
console.log(`detected=${det}  MISSED=${miss}  INERT=${inert}  BROKEN=${broken}`);
if (miss || inert || broken) process.exit(1);
