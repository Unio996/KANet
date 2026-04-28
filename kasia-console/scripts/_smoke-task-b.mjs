// Smoke test for task B rewrite — broker-state-authority.js database-backed
// Verifies API surface preserved + R31/R33 SQL guard + lifecycle flow.

import {
  getConvoState, setConvoStateLock, resetConvoState,
  shouldDeterministicFire, llmSystemPromptStateLock, validateLlmReply,
  detectResetIntent, detectAddrChangeAttempt, _clearAllState, _testForceExpire,
} from '../src/services/broker-state-authority.js';
import { sqlite } from '../src/db/client.js';

const peer = 'kaspa:qz_smoke_taskb_' + Date.now();
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} :: ${detail}`); }
}

// Pre-cleanup
sqlite.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qz_smoke_taskb_%'`).run();

console.log('\n── Test 1: empty peer → getConvoState null ──');
check('getConvoState returns null for unknown peer', getConvoState(peer) === null);

console.log('\n── Test 2: detectResetIntent (pure function) ──');
check('detectResetIntent("不要了") true', detectResetIntent('不要了') === true);
check('detectResetIntent("重新下单") true', detectResetIntent('重新下单') === true);
check('detectResetIntent("买 5 KAS") false', detectResetIntent('买 5 KAS') === false);

console.log('\n── Test 3: setConvoStateLock first call (BUY) ──');
const s1 = setConvoStateLock(peer, {
  direction: 'buy',
  qty: 5,
  pay_chain: 'bnb',
  evm_pay_address: '0xABC1234567890ABCDEF1234567890ABCDEF12345',
});
check('first setConvoStateLock returns state', s1 != null);
check('state.direction = buy', s1?.direction === 'buy');
check('state.qty = 5', s1?.qty === 5);
check('state.pay_chain = bnb', s1?.pay_chain === 'bnb');
check('state.evm_pay_address present', s1?.evm_pay_address?.toLowerCase() === '0xabc1234567890abcdef1234567890abcdef12345');
check('state.lifecycle_phase = fields_collection', s1?.lifecycle_phase === 'fields_collection');
check('state.locked = false (aligning)', s1?.locked === false);

console.log('\n── Test 4: getConvoState after first lock ──');
const s1b = getConvoState(peer);
check('getConvoState returns state', s1b != null);
check('state persists through fresh getConvoState call', s1b?.direction === 'buy' && s1b?.qty === 5);

console.log('\n── Test 5: R33 direction sticky — sell attempt throws ──');
let r33Caught = null;
try {
  setConvoStateLock(peer, { direction: 'sell', qty: 10 });
} catch (e) { r33Caught = e; }
check('R33 throws on direction flip', r33Caught != null);
check('R33 err.code = CONVO_STATE_DIRECTION_LOCK', r33Caught?.code === 'CONVO_STATE_DIRECTION_LOCK');
check('R33 err.locked_direction = buy', r33Caught?.locked_direction === 'buy');
check('R33 err.attempted_direction = sell', r33Caught?.attempted_direction === 'sell');

console.log('\n── Test 6: setConvoStateLock same direction OK + field update ──');
const s2 = setConvoStateLock(peer, {
  direction: 'buy',
  qty: 5,  // same
  conditions: { limit_price: 0.033 },
  lifecycle_phase: 'preview_shown',
});
check('same-direction update OK', s2 != null);
check('lifecycle_phase advanced to preview_shown', s2?.lifecycle_phase === 'preview_shown');
check('locked = true post preview_shown', s2?.locked === true);
check('conditions.limit_price persisted', s2?.conditions?.limit_price === 0.033);

console.log('\n── Test 7: shouldDeterministicFire R33 cross-direction gating ──');
check('SELL_REGEX gated when direction=buy', shouldDeterministicFire(peer, 'SELL_REGEX', '想卖') === false);
check('PRICE_QUERY gated when direction=sell — but state is buy so allowed', shouldDeterministicFire(peer, 'PRICE_QUERY', '价格?') === true);
check('BUY_REGEX allowed when direction=buy', shouldDeterministicFire(peer, 'BUY_REGEX', '买 5 KAS') === true);

console.log('\n── Test 8: llmSystemPromptStateLock ──');
const sysLock = llmSystemPromptStateLock(peer);
check('returns non-null systemAppend', sysLock != null);
check('contains direction=buy', sysLock?.includes('buy') === true);
check('contains qty=5', sysLock?.includes('5') === true);
check('CRITICAL framing for locked state', sysLock?.includes('CRITICAL') === true);

console.log('\n── Test 9: detectAddrChangeAttempt — change keyword ──');
const a1 = detectAddrChangeAttempt(peer, '改地址 0xDEADBEEF1234567890DEADBEEF1234567890DEAD');
check('detects change keyword', a1.attempt === true);
check('reason = change_keyword', a1.reason === 'change_keyword');

console.log('\n── Test 10: detectAddrChangeAttempt — differing addr ──');
const a2 = detectAddrChangeAttempt(peer, '我要改成 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
check('detects differing addr proposal', a2.attempt === true);

console.log('\n── Test 11: validateLlmReply — opposite direction Chinese ──');
const v1 = await validateLlmReply(peer, '好的, 你想卖出 KAS, 数量多少?');
check('validateLlmReply detects opposite direction (zh natural)', v1.ok === false);
check('violations contain R33-direction-natural-zh', v1.violations.some(s => s.includes('R33-direction-natural-zh')));

console.log('\n── Test 12: resetConvoState → cancelled, getConvoState null ──');
resetConvoState(peer, 'user_cancel');
check('getConvoState null after cancel', getConvoState(peer) === null);

console.log('\n── Test 13: post-reset, new direction OK ──');
const s3 = setConvoStateLock(peer, {
  direction: 'sell',
  qty: 50,
  pay_chain: 'bnb',
  recv_address: '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
});
check('post-reset SELL accepted (cancelled order excluded from active)', s3?.direction === 'sell');
check('post-reset state qty=50', s3?.qty === 50);
check('post-reset recv_address persisted', s3?.recv_address?.toLowerCase() === '0x1417cfdad7a5be7d3d28350010194cfcabf2596d');

console.log('\n── Test 14: _testForceExpire ──');
const exp = _testForceExpire(peer);
check('_testForceExpire ok', exp.ok === true);

console.log('\n── Test 15: B\' regression — setConvoStateLock(peer, {conditions}) without direction (no existing) ──');
const orphanPeer = 'kaspa:qz_smoke_taskb_orphan_' + Date.now();
let orphanRes = null;
let orphanThrew = null;
try {
  orphanRes = setConvoStateLock(orphanPeer, { conditions: { limit_price: 0.033 } });
} catch (e) { orphanThrew = e; }
check('partial-state first call returns null (not throw)', orphanThrew === null);
check('return value is null no-op', orphanRes === null);

console.log('\n── Test 16: B\' regression — getConvoState includes paid/executing states (R31 lifecycle full) ──');
const lifecyclePeer = 'kaspa:qz_smoke_taskb_lc_' + Date.now();
const sLc = setConvoStateLock(lifecyclePeer, {
  direction: 'sell', qty: 100, pay_chain: 'bsc',
  recv_address: '0xCAFEBABE12345678901234567890ABCDEFCAFEBA',
});
check('lifecycle peer initial state created', sLc != null);
// Manually advance state to 'paid'
sqlite.prepare(`UPDATE retail_dex_orders SET state='paid' WHERE user_kasia_address=?`).run(lifecyclePeer);
const lcPaid = getConvoState(lifecyclePeer);
check('getConvoState returns row for state=paid (R31 still locks addr)', lcPaid != null);
check('paid state still has recv_address (post-payment lock)', lcPaid?.recv_address?.toLowerCase() === '0xcafebabe12345678901234567890abcdefcafeba');
check('lifecycle_phase = paid', lcPaid?.lifecycle_phase === 'paid');
// Advance to 'executing'
sqlite.prepare(`UPDATE retail_dex_orders SET state='executing' WHERE user_kasia_address=?`).run(lifecyclePeer);
check('getConvoState returns row for state=executing', getConvoState(lifecyclePeer) != null);
// Advance to 'completed' — should NOT return (terminal state)
sqlite.prepare(`UPDATE retail_dex_orders SET state='completed' WHERE user_kasia_address=?`).run(lifecyclePeer);
check('getConvoState returns null for terminal state=completed', getConvoState(lifecyclePeer) === null);

console.log('\n── Test 17b: R45 regression (J2 53c1630b8 catch) — direction-only first call (qty=null) INSERT works ──');
// 真因: retail_dex_orders.qty TEXT NOT NULL — INSERT 当 fields.qty=null 时触 NOT NULL throw, row 永不创建.
// J2 53c1630b8 fix: 当 qty=null 时 INSERT '0' placeholder. T2 user '50 个' UPDATE 真 qty 覆盖.
const directionOnlyPeer = 'kaspa:qz_smoke_taskb_donly_' + Date.now();
let directionOnlyThrew = null;
let directionOnlyState = null;
try {
  directionOnlyState = setConvoStateLock(directionOnlyPeer, { direction: 'sell' });
} catch (e) { directionOnlyThrew = e; }
check('direction-only first call does NOT throw (qty=null + qty=0 placeholder)', directionOnlyThrew === null);
check('direction-only state created', directionOnlyState != null);
check('direction-only direction=sell', directionOnlyState?.direction === 'sell');
const rawDirOnlyRow = sqlite.prepare(`SELECT qty FROM retail_dex_orders WHERE user_kasia_address=?`).get(directionOnlyPeer);
check('retail_dex_orders.qty TEXT NOT NULL satisfied (placeholder "0")', rawDirOnlyRow?.qty === '0' || rawDirOnlyRow?.qty === 0);
// T2 user '50 个' UPDATE qty=50 should work
const dirT2 = setConvoStateLock(directionOnlyPeer, { qty: 50 });
check('subsequent UPDATE qty=50 works (placeholder overwritten)', dirT2?.qty === 50);
sqlite.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address=?`).run(directionOnlyPeer);

console.log('\n── Test 17: B\' regression — detectAddrChangeAttempt works post-payment ──');
sqlite.prepare(`UPDATE retail_dex_orders SET state='paid' WHERE user_kasia_address=?`).run(lifecyclePeer);
const swapAttempt = detectAddrChangeAttempt(lifecyclePeer, '改地址 0xDEADBEEF1234567890ABCDEF1234567890DEADBE');
check('detectAddrChangeAttempt fires post-payment (R31 lifecycle full)', swapAttempt.attempt === true);
check('swapAttempt reason = change_keyword', swapAttempt.reason === 'change_keyword');

// Cleanup orphan + lifecycle peers
sqlite.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qz_smoke_taskb_orphan_%' OR user_kasia_address LIKE 'kaspa:qz_smoke_taskb_lc_%'`).run();

console.log('\n── Cleanup ──');
sqlite.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qz_smoke_taskb_%'`).run();
console.log('  ✓ test rows cleaned');

console.log(`\n══════════════════════════════════`);
console.log(`Summary: ${pass} PASS / ${fail} FAIL / ${pass+fail} total`);
console.log(`══════════════════════════════════`);
process.exit(fail > 0 ? 1 : 0);
