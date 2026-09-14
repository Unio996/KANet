// v0.2 探针向量(Bettor/NWT 1119): 复现 NWT 6da618e8 的具体攻击构造 + 证明遍历方案能挡住它。
//
// 🔴 排查记录(不删, 留证据): readInputStateWithTemplate 的 sigScript 不能只给"00+suffix"这种占位短串
// (第一版撞过 "-42 cannot be used as an array index"——它内部用 sigScript 长度反推 state 起止位置,
// 短串会算出负偏移)。必须给【该实例自己完整编译产物的 bytecode 原样】(= prefix||state||suffix 拼接后
// 的全部字节, 跟 P2SH 花费时真实压栈的 redeem script 一致)——已用 MarketScanProbe2.sil 单独隔离验证过
// 这个修法本身可行(read_one_pass 向量 PASS)。
import fs from 'node:fs';
function fullBytecodeHex(compiledFile) {
  const c = Object.values(JSON.parse(fs.readFileSync(compiledFile, 'utf8')).contracts)[0].compiled;
  return Buffer.from(c.bytecode).toString('hex');
}
const t = JSON.parse(fs.readFileSync('token_stub.derived.json', 'utf8'));
const bcA = fullBytecodeHex('TokenStub_A.compiled.json');
const bcB = fullBytecodeHex('TokenStub_B.compiled.json');
const bcX = fullBytecodeHex('TokenStub_X.compiled.json');
const ctorArgs = JSON.parse(fs.readFileSync('MarketScanProbe.args.json', 'utf8')).map(a => Array.isArray(a.value) ? '0x' + Buffer.from(a.value).toString('hex') : a.value);
const OTHER_SIG = '00' + 'ff'.repeat(20); // 尾部对不上 token_suffix, 不会被当代币

// 🔴 MARKET_COV_ID 必须等于 TokenStub A/B 的 owner ctor 值(0x11*32)——OpInputCovenantId(input0) 读到的
// 就是这笔 tx 里 input0 的 covenant_id 字段本身, 跟 TokenStub 的 owner 是不是"认" market 完全靠这两个值
// 字面相等, 不是靠什么隐式绑定(第一版忘了这茬, MARKET_COV_ID 和 OWNER_A 用了两个不同的值, 撞出下面的坑)。
const MARKET_COV_ID = '0x' + '11'.repeat(32);
const OWNER_A = '0x' + '11'.repeat(32); // TokenStub A/B 的 owner ctor 值(= 本 market, 必须等于 MARKET_COV_ID)
const OWNER_X = '0x' + '22'.repeat(32); // TokenStub X 的 owner ctor 值(= 不是本 market)

function T(name, expect, { inputs, declaredTotal }) {
  return {
    name, function: 'scan_absorb', constructor_args: ctorArgs,
    args: [declaredTotal], expect,
    tx: { active_input_index: 0, inputs, outputs: [{ value: 1, covenant_id: MARKET_COV_ID }] },
  };
}

const tests = [];

// V-scan-1 正: market 自己 + 两笔归自己的代币输入(A=100, B=250), 都被正确扫到、累加、declared_total=350 ⇒ pass。
// 🔴 输入的真实 state 通过 utxo_script_hex(该输入正在花费的 P2SH 锁定脚本原始字节)供 readInputStateWithTemplate
// 解析, 不是 JSON state 字段(那是给"跟当前合约同类型"的续约输入用的; 这里是外部 TokenStub 实例, 必须走真字节)。
tests.push(T('V-scan-1_pass_two_owned_tokens_summed', 'pass', {
  inputs: [
    { utxo_value: 1, covenant_id: MARKET_COV_ID, signature_script_hex: OTHER_SIG },
    { utxo_value: 1, utxo_script_hex: t.A.spk, signature_script_hex: bcA },
    { utxo_value: 1, utxo_script_hex: t.B.spk, signature_script_hex: bcB },
  ],
  declaredTotal: 350,
}));

// V-scan-2 反(复现 NWT 6da618e8 攻击原形): market 自己 + token#1(A=100, 打算被 absorb) + token#2(B=250,
// 攻击者想让它被静默漏过, ctor 里 owner 一样是本 market)。declared_total 只填 100(模拟"只处理 token#1"的
// 旧攻击行为)——遍历会真的扫到 token#2 也归属本 market, 累加总和变成 350 ≠ declared_total(100) ⇒ 必须 fail,
// 证明遍历堵住了这个洞(旧 sum_in>=sum_out 单靠代币合约自己看不出这个问题, 这里改成 market 侧强制核对全部)。
tests.push(T('V-scan-2_fail_silent_second_token_caught_by_scan', 'fail', {
  inputs: [
    { utxo_value: 1, covenant_id: MARKET_COV_ID, signature_script_hex: OTHER_SIG },
    { utxo_value: 1, utxo_script_hex: t.A.spk, signature_script_hex: bcA },
    { utxo_value: 1, utxo_script_hex: t.B.spk, signature_script_hex: bcB },
  ],
  declaredTotal: 100,
}));

// V-scan-3 正: 存在一个"看起来像代币"(sigScript 尾匹配同一模板)但 owner 不是本 market 的输入(X, owner=OWNER_X)——
// 遍历必须【不计入】它(Bettor 1119-补①的具体要求), 只算真正 owner==市场自己的那笔(A=100)。declared_total=100 ⇒ pass。
tests.push(T('V-scan-3_pass_other_owner_same_template_not_counted', 'pass', {
  inputs: [
    { utxo_value: 1, covenant_id: MARKET_COV_ID, signature_script_hex: OTHER_SIG },
    { utxo_value: 1, utxo_script_hex: t.A.spk, signature_script_hex: bcA },
    { utxo_value: 1, utxo_script_hex: t.X.spk, signature_script_hex: bcX },
  ],
  declaredTotal: 100,
}));

// V-scan-4 正: 存在一个 sigScript 尾部完全对不上 token 模板的"正常"输入(比如 fee 输入)——结构匹配阶段就被
// 排除, 从不触发 readInputStateWithTemplate(不会因为它不是 token 而 abort), 只统计真代币输入。
tests.push(T('V-scan-4_pass_non_token_input_safely_skipped', 'pass', {
  inputs: [
    { utxo_value: 1, covenant_id: MARKET_COV_ID, signature_script_hex: OTHER_SIG },
    { utxo_value: 1, covenant_id: '0x' + 'ff'.repeat(32), signature_script_hex: OTHER_SIG }, // fee 输入, 尾部不匹配
    { utxo_value: 1, utxo_script_hex: t.A.spk, signature_script_hex: bcA },
  ],
  declaredTotal: 100,
}));

// V-harness: V-scan-1 的 expect 翻转(必 FAIL), 证明谐波非摆设。
{
  const flip = JSON.parse(JSON.stringify(tests[0]));
  flip.name = 'V-harness_flip_of_V-scan-1_expect_fail';
  flip.expect = 'fail';
  tests.push(flip);
}

fs.writeFileSync('MarketScanProbe.test.json', JSON.stringify({ tests }, null, 2));
console.log('wrote', tests.length, 'vectors');
