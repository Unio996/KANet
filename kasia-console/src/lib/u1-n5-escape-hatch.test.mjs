// N5 · 两个逃逸口的**负测试**(spec v1.2-rc §4 的 **V9**)。
// 「N5 是条款，**没有负测试的条款等于注释**」—— 这份就是那句话的兑现。
//
// 判据来源: A2 spec `docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md` §N5
// 读数来源: @J1tn `8969aca7`(四臂真执行) + 他 21:12Z 的「互斥必须双向」
//
// 🔴 **这份不 spawn relay、不碰链、不碰密钥** —— 测的是**决定 env 的那段纯逻辑**与**fork 的 env 语义**。
//    (真 relay 起停归重启窗与域主; 这里先把"逻辑对不对"钉死, 免得窗里才发现。)
import assert from 'node:assert';
import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRelayKeyEnv } from './u1-relay-key-env.mjs';
import { resolveAccountIndex } from '../../../kasia-relay/src/lib/wallet.mjs';

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── V9-① 逃逸口①: 互斥必须【双向】 ──────────────────────────────────────────
await t('V9-①a · mnemonic 型 ⇒ 必须把继承来的 KASPA_PRIVKEY 抹掉', async () => {
  const r = buildRelayKeyEnv({ privkey: null, mnemonic: 'seed words' });
  assert.strictEqual(r.KASPA_MNEMONIC, 'seed words');
  assert.strictEqual(r.KASPA_PRIVKEY, undefined,
    '继承来的 privkey 没被抹 ⇒ wallet.mjs 先读它命中即 return ⇒ 签名身份被整个替换');
  assert.ok('KASPA_PRIVKEY' in r, '必须【显式】给出该键(值 undefined), 否则 Object.assign 覆盖不到继承值');
});

await t('V9-①b · privkey 型 ⇒ 必须把继承来的 KASPA_MNEMONIC 抹掉(第二向, 别只做一半)', async () => {
  const r = buildRelayKeyEnv({ privkey: 'deadbeef', mnemonic: 'seed words' });
  assert.strictEqual(r.KASPA_PRIVKEY, 'deadbeef');
  assert.strictEqual(r.KASPA_MNEMONIC, undefined,
    '今天它惰性只因 wallet.mjs 的一处优先级; 那处一改它就活, 且是静默的');
  assert.ok('KASPA_MNEMONIC' in r);
});

// 🔴 这一格守的是上面两格【赖以成立的机制】: `undefined` 在 fork 的 env 里等于"删掉"。
//    我落码前实测过它成立 —— 但**实测过一次 ≠ 有人守着**, 所以钉成用例:
//    哪天 Node 改语义 / 有人把 undefined 换成 ''，这格会红, 而不是等到某个 relay 用错身份签名。
await t('V9-①c · 机制守卫: fork 的 env 里 undefined 值【确实等于变量不存在】', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'n5-env-'));
  const child = join(dir, 'child.cjs');
  writeFileSync(child, "process.stdout.write(JSON.stringify({PK: process.env.KASPA_PRIVKEY ?? null}));");
  const env = { ...process.env, KASPA_PRIVKEY: 'inherited-should-be-gone' };
  Object.assign(env, buildRelayKeyEnv({ privkey: null, mnemonic: 'seed words' }));
  const out = await new Promise((res, rej) => {
    const c = fork(child, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let s = ''; c.stdout.on('data', (d) => { s += d; });
    c.on('exit', () => res(s)); c.on('error', rej);
  });
  rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(JSON.parse(out || '{}').PK, null,
    `子进程仍看得到继承来的 privkey(${out}) ⇒ undefined 不再等于删除, 必须改用显式 delete`);
});

// ── V9-② 逃逸口②: account index 不许走继承, 坏值必须抛 ──────────────────────
await t('V9-②a · console 侧显式传 index ⇒ 切断继承向', async () => {
  assert.strictEqual(buildRelayKeyEnv({ mnemonic: 'm' }).KASPA_ACCOUNT_INDEX, '0');
  assert.strictEqual(buildRelayKeyEnv({ privkey: 'p' }).KASPA_ACCOUNT_INDEX, '0');
});

await t('V9-②b · relay 侧: 合法值照收(缺省/空串 = 0)', async () => {
  assert.strictEqual(resolveAccountIndex(undefined), 0);
  assert.strictEqual(resolveAccountIndex(''), 0);
  assert.strictEqual(resolveAccountIndex('0'), 0);
  assert.strictEqual(resolveAccountIndex('3'), 3);
});

await t('V9-②c · relay 侧: 坏值一律【抛】, 不许静默取一个别的数', async () => {
  // 🔴 这四个正是旧 parseInt 会静默吃掉的形状(其中 NaN 支 @J1tn 标过"未验, 别当已知")
  for (const bad of ['1e3', ' 7x', 'abc', '-1']) {
    assert.throws(() => resolveAccountIndex(bad), /KASPA_ACCOUNT_INDEX 非法/,
      `坏值 ${JSON.stringify(bad)} 没抛 ⇒ 它会静默变成另一个 index ⇒ 同一助记词派生到另一把钥匙`);
  }
  // 对照: 旧 parseInt 对这些的行为(证明"坏值静默"不是我编的风险)
  assert.strictEqual(parseInt('1e3', 10), 1, '对照臂: parseInt 会把 1e3 读成 1');
  assert.strictEqual(parseInt(' 7x', 10), 7, '对照臂: parseInt 会把 " 7x" 读成 7');
  assert.ok(Number.isNaN(parseInt('abc', 10)), '对照臂: parseInt("abc") = NaN');
});

console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-n5-escape-hatch: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
