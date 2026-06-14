// J2-tn #27c regression — pool-auto-better env config parse falsy-bug fix
//
// scope: Bettor r529/r532 sprint #27c + NWT r1167 attack-verify matrix.
// bug: `Number(env.AUTO_BET_TICK_MS) || 20_000` (Number('0')=0 falsy → 退 20000, AUTO_BET_TICK_MS=0
//      永无法 disable, startAutoBetterCron L187 ===0 成死码) + `env.AUTO_BET_RELAYS || default`
//      (空字符串 falsy → 退默认, 无法清空)。
// fix: parseTickMs = (isFinite && >=0) ? n : 20000 ; parseRelays = (raw ?? default).split.filter(Boolean)
//
// 真调生产 export 函数 (= feedback_mutation_test_real_invoke: import production module + invoke real
// exported fn, 非拷贝逻辑)。production 改 = 必加 regression (= feedback_post_fix_real_chain_regression).
// 注: parseRelays 默认串内容 (含/不含 oracle testers) 是 KANet-UI #27b 域 — 本测只验 #27c falsy 逻辑
//     (unset→非空默认 / ''→空), 用 length 判使其对 #27b 改默认值 robust, 不锁死具体 6 个。
//
// run: node test-framework/standalone/test_autobet_config_parse.mjs  (exit 0 = PASS, 1 = FAIL)

import { parseTickMs, parseRelays } from '../../src/services/pool-auto-better.js';

let fails = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`PASS ${name}`); }
  else { fails++; console.error(`FAIL ${name}: ${detail}`); }
}
function eqNum(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function eqArr(name, got, want) {
  const ok = Array.isArray(got) && got.length === want.length && got.every((v, i) => v === want[i]);
  check(name, ok, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// --- TICK matrix (NWT r1167: {0→停, unset→20s, 负→20s}) ---
eqNum('tick "0" → 0 (disable, L187 ===0 reachable)', parseTickMs('0'), 0);
eqNum('tick 0 (number) → 0 (disable)', parseTickMs(0), 0);
eqNum('tick unset → 20000 default', parseTickMs(undefined), 20_000);
eqNum('tick "-5" → 20000 (negative rejected)', parseTickMs('-5'), 20_000);
eqNum('tick "abc" → 20000 (NaN rejected)', parseTickMs('abc'), 20_000);
eqNum('tick "5000" → 5000 (valid passthrough)', parseTickMs('5000'), 5000);

// --- RELAYS matrix (NWT r1167: {''→[], unset→default, 'a,b'→2}) ---
eqArr('relays "" → [] (empty clears)', parseRelays(''), []);
check('relays unset → non-empty default', parseRelays(undefined).length > 0,
  `got len ${parseRelays(undefined).length} want > 0 (default applied, content = #27b 域)`);
eqArr('relays "a,b" → ["a","b"]', parseRelays('a,b'), ['a', 'b']);
eqArr('relays " a , , b " → ["a","b"] (trim + drop blanks)', parseRelays(' a , , b '), ['a', 'b']);

if (fails) { console.error(`\n${fails} assertion(s) FAILED`); process.exit(1); }
console.log('\nALL PASS (10 assertions) — #27c falsy-disable fix verified');
process.exit(0);
