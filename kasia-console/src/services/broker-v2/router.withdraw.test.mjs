// P11 (race 盘点) 源级向量: withdraw 借记先于链转账 + 三态处理 + conversations.js per-peer 串行锁接线。红于旧码 (转账后借记、无锁)。
// 跑: cd kasia-console && node src/services/broker-v2/router.withdraw.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const ROUTER = readFileSync(join(here, 'router.js'), 'utf8');
const CONV = readFileSync(join(here, '..', '..', 'api', 'conversations.js'), 'utf8');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const W = ROUTER.slice(ROUTER.indexOf('const withdrawMatch = msg.match(WITHDRAW_REQUEST_REGEX)'), ROUTER.indexOf('const explorerMap = '));
t('R1 顺序: reserveWithdraw( 在 transferUsdt( 之前; finalizeWithdraw( 在其后; 旧形 "转账后 INSERT INTO user_ledger" 不再存在', () => {
  const iR = W.indexOf('reserveWithdraw(sqlite'), iT = W.indexOf('await transferUsdt('), iF = W.indexOf('finalizeWithdraw(sqlite');
  assert.ok(iR > 0 && iT > iR && iF > iT, `reserve@${iR} transfer@${iT} finalize@${iF}`);
  assert.ok(!/INSERT INTO user_ledger[\s\S]*withdraw_user_initiated/.test(W), '残留转账后直接 INSERT 借记');
});
t('R2 三态: 转账确定失败 ⇒ revertWithdraw; 抛/超时 ⇒ 不 revert + events withdraw_ambiguous + 提示勿重复提', () => {
  assert.ok(/if \(!wRes\?\.ok\) \{\s*revertWithdraw\(sqlite/.test(W), 'ok:false 未 revert');
  const amb = W.slice(W.indexOf('} catch (e) {'), W.indexOf('if (!wRes?.ok)'));
  assert.ok(!/revertWithdraw/.test(amb) && /withdraw_ambiguous/.test(amb) && /请勿重复提/.test(amb), 'ambiguous 分支形不对');
});
t('R3 reserve 拒 insufficient 时不转账 (return 在 transferUsdt 之前)', () => {
  const iRet = W.indexOf("if (!rsv.ok) return"); const iT = W.indexOf('await transferUsdt('); assert.ok(iRet > 0 && iRet < iT);
});
t('C1 conversations.js: withPeerLock 引入, 五个 broker 入口 (v3/v2/buy/sell/llm) 都经 _serial(', () => {
  assert.ok(/import\('\.\.\/lib\/peer-serial-lock\.mjs'\)/.test(CONV));
  for (const l of ["_serial('broker-v3'", "_serial('broker-v2'", "_serial('buy'", "_serial('sell'", "_serial('llm'"]) assert.ok(CONV.includes(l), `缺 ${l}`);
  assert.ok(!/const v2Reply = await handleMessage\(peer, message\);/.test(CONV), '残留裸 handleMessage 调用');
  assert.ok(!/await handleBuyIntent\(peer, message\);/.test(CONV) && !/await handleSellIntent\(peer, message\);/.test(CONV) && !/await handleLlmDialog\(peer, message\);/.test(CONV), '残留裸调用');
});
console.log(`router.withdraw: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
