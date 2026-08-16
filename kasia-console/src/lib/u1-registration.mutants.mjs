// u1-registration.mjs 的变异测试 —— 补的是 (333)(334) 指名的洞①:
// 这个文件组装 N4-bis(custody 自查)+ 绑定 + N8(PoP)+ 落库四件, 且明写"完全不看 s.custody",
// 是同族三模块(same-origin/registration-pop/registration)里此前唯一没有变异测试兜底的一个,
// 也是未来最可能被"顺手清理"改坏的地方(Bettor 20:09Z 点名: custody.custody → s.custody 这类回改)。
// 🔴 三类计数缺一不可: MISSED(拆了没红) / INERT(没改到文件) / BROKEN(改成语法坏的, 必然"检出")。
// 🔴 收尾验还原逐字节相同 —— 变异体留在库里比不跑变异更糟。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'u1-registration.mjs');
const TEST = join(HERE, 'u1-registration.test.mjs');
const CWD = join(HERE, '..', '..');
const original = readFileSync(SRC, 'utf8');
const originalSha = createHash('sha256').update(original).digest('hex');

const MUTANTS = [
  // 🔴 头一条是 Bettor 20:09Z 点名那个具体回改: 落库读提交值而不是服务端派生值
  ['落库用提交方 custody 而非服务端派生值(整层承重点失守)',
    (s) => s.replace(
      "        custody.custody);   // 🔴 服务端派生值, 不是 s.custody",
      "        s.custody);")],
  // N4-bis 三道子闸(deriveCustody 内部)
  ['deriveCustody: relay 查无此 id 也放行',
    (s) => s.replace("if (!row) return { ok: false, code: REG_REJECT.RELAY_UNKNOWN, reason: `relay_nodes 里没有 id=${relayId}` };", '')],
  ['deriveCustody: 混合态(mnemonic+privkey 皆非空)也放行',
    (s) => s.replace('if (hasMnemonic && hasPrivkey) {', 'if (false) {')],
  ['deriveCustody: privkey-only(无 mnemonic)也放行',
    (s) => s.replace('if (!hasMnemonic) {', 'if (false) {')],
  // registerIdentity 主流程三道闸
  ['①N4-bis 闸拆掉(custody 不合格也继续走)',
    (s) => s.replace('if (!custody.ok) return { ok: false, code: custody.code, reason: custody.reason };', 'if (false) return null;')],
  ['②绑定闸拆掉(派生证明不合格也继续走)',
    (s) => s.replace('if (!bind.ok) return { ok: false, code: REG_REJECT.BINDING_INVALID, reason: bind.reason };', 'if (false) return null;')],
  ['③N8 PoP 闸拆掉(签名/挑战不合格也继续走)',
    (s) => s.replace('if (!pop.ok) return { ok: false, code: REG_REJECT.POP_FAILED, reason: `${pop.code}: ${pop.reason}` };', 'if (false) return null;')],
  // ── (343) MUST-FIX 之后新增五格: 一次性挑战消费契约的每一段都要被咬 ──
  //    (Codex a89919a0 抓的原病 = optional + non-atomic; 修完必须证明"修的地方真的在挡")
  ['fail-closed 闸拆掉: 不给消费能力也放行(退回 optional, 即原病)',
    (s) => s.replace("  if (typeof consumeChallenge !== 'function' || typeof readChallenge !== 'function') {",
      '  if (false) {')],
  ['只要 consumeChallenge 不要 readChallenge(半套接线放行 ⇒ 空消费分辨不出来)',
    (s) => s.replace(" || typeof readChallenge !== 'function'", '')],
  ['后置条件拆掉: 消费后不再重读(空消费读成成功 ⇒ 又一个恒真闸)',
    (s) => s.replace('    if (!after || !after.usedAt) {', '    if (false) {')],
  ['消费抛错被吞(不回滚 ⇒ 已注册但挑战仍 unused)',
    (s) => s.replace(
      "    catch (e) { throw new _RegTxError(REG_REJECT.CHALLENGE_CONSUME_FAILED, `挑战消费失败, 整笔回滚: ${e?.message || e}`); }",
      '    catch (e) { /* 吞掉 */ }')],
  // 🔴 这一格直接摘掉事务本身 —— 它是"原子性"那格用例的对照臂:
  //    没有它, (b) 只能证明"消费失败会返回 false", 证明不了"INSERT 真的跟着回滚了"。
  ['摘掉事务(照旧版: 先提交 INSERT 再消费)⇒ 消费失败时 INSERT 已落库',
    (s) => s.replace('  const runTx = sqlite.transaction(() => {', '  const runTx = ((__f) => __f)(() => {')],
  ['前置重读拆掉(并发重放闸)⇒ 陈旧记录 + 非 CAS 消费能把同一挑战用两次',
    (s) => s.replace('    if (!before || before.usedAt) {', '    if (false) {')],
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
