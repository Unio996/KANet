// round-trip 四件套 · **B-2 差分**(判据 `3b395e6c` §4)
//   要求: `state_start=1` 与 `=0` 各一例, 在可区分 fixture 上**确定性地**产出不同地址或失败。
//
// 🔴 **B-2 存在的理由(别把它读成"多测一个参数")**:
//    退款支吃默认 start, 而当前模板 `start=1` **恰好等于默认** ⇒ 「传了 1」与「吃默认 1」
//    **产出逐字节相同的地址** ⇒ 光比地址**永远分不开这两者**(@J1 21:41Z 自纠, Codex 采纳)。
//    ⇒ **`start=0` 那一格才是让"默认值"现形的唯一办法** —— 它证明这个参数**真的参与**了地址推导,
//      于是 A 那格「与链上逐字节相同」才有信息量; 少了这一臂, A 绿了也可能只是"我和它算得一样"。
//
// 🔵 **import 的是实符号**(`p2sh.mjs` 的 `_continuationAddress` / `_serializeRootStateHex`,
//    为可测性加的 export, 行为零改动) —— 判据一票否决线: **抄 helper 副本 = 不算**。
// ⚠ 本用例**不连链、不发交易、不碰密钥**: 纯字节推导。
import assert from 'node:assert';
import { _continuationAddress, _serializeRootStateHex } from '../../../kasia-relay/src/lib/p2sh.mjs';

let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// ── fixture: 一份可区分的 PoolRoot redeem ────────────────────────────────────
// 🔴 **必须"可区分"**: state 区前后的字节要不同, 否则把 state splice 到 offset 0 与 offset 1
//    有可能产出同一段字节 ⇒ 那样 B-2 会"通过"却什么也没证明(坏时输出=已知答案)。
//    这里前导用 0x51(selector dispatch, 与生产 start=1 同形), 尾部填一段与前导不同的字节。
// 🔴 字段名/序**逐字对着生产 `_serializeRootStateHex` 抄下来的**, 不是我编的:
//    local_yes · local_no · count · pool_value · closed · winningSide · payoutRoot(PUSH32)
//    (第一版我写成 `payout_root` 且漏了 `winningSide` ⇒ 序列化当场抛, 四格全红 —— 那是好事:
//     **夹具形状对不上生产声明序时, 用例应当红在夹具上, 而不是绿着钉住我的发明。**)
const ROOT_STATE = {
  local_yes: '11', local_no: '22', count: '3', pool_value: '444',
  closed: '0', winningSide: '0', payoutRoot: 'ab'.repeat(32),
};
const stateHex = (() => {
  try { return _serializeRootStateHex(ROOT_STATE); }
  catch (e) { return null; }
})();

t('前置 · 实符号可用且 state 序列化出可用长度(否则下面每格都无意义)', () => {
  assert.ok(typeof _continuationAddress === 'function', '_continuationAddress 必须是 import 到的实符号');
  assert.ok(stateHex, `_serializeRootStateHex 抛了 —— fixture 字段形状与生产声明序对不上, 先修 fixture: ${stateHex}`);
  assert.match(stateHex, /^[0-9a-f]+$/i);
});

// state 区长度决定 redeem 至少要多长; 前导 1B + state + 一段不同的尾巴
const stateLen = stateHex ? stateHex.length / 2 : 0;
const REDEEM_HEX = stateHex
  ? ('51' + stateHex + 'ff'.repeat(8))          // [0]=0x51 前导 · [1..] = state 区 · 尾部 0xff…
  : null;

t('B-2 · start=1 与 start=0 ⇒ **确定性地**产出不同地址(证明该参数真的参与推导)', () => {
  assert.ok(REDEEM_HEX, '前置未过, 本格跳过即无意义');
  const at1 = _continuationAddress(REDEEM_HEX, stateHex, 'testnet-12', 1);
  const at0 = _continuationAddress(REDEEM_HEX, stateHex, 'testnet-12', 0);
  assert.match(at1, /^kaspatest:/, `start=1 没产出地址: ${at1}`);
  assert.match(at0, /^kaspatest:/, `start=0 没产出地址: ${at0}`);
  assert.notStrictEqual(at1, at0,
    '🔴 两个 start 产出【同一个地址】⇒ 该参数没参与推导, 或 fixture 不可区分 ⇒ B-2 与 A 都失去信息量');
});

t('B-2-bis · 同一 start 两次 ⇒ 逐字节相同(确定性, 排除"每次都不同"这种假差分)', () => {
  assert.ok(REDEEM_HEX);
  assert.strictEqual(
    _continuationAddress(REDEEM_HEX, stateHex, 'testnet-12', 1),
    _continuationAddress(REDEEM_HEX, stateHex, 'testnet-12', 1),
    '同输入两次不同 ⇒ 上一格的"不同"可能只是随机, 不是 start 造成的',
  );
});

t('B-2-ter · 默认参数 == 显式传 1(这正是"传了1/吃默认1"分不开的【机制来源】)', () => {
  assert.ok(REDEEM_HEX);
  const explicit1 = _continuationAddress(REDEEM_HEX, stateHex, 'testnet-12', 1);
  const defaulted = _continuationAddress(REDEEM_HEX, stateHex, 'testnet-12');   // 不传 ⇒ 吃默认
  assert.strictEqual(defaulted, explicit1,
    '默认值不等于 1 了? 那 @J1 21:41Z 那条自纠的前提变了, 上游判据要重读');
  // 🔨 这一格是**故意钉住那个"坏消息"**: 它证明输出侧确实分不开两者,
  //    从而说明 B-1(调用点变异)不是可选项 —— 没有它, 这个参数在生产路径上就是无人观察的。
});

console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-continuation-statestart (B-2): ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
