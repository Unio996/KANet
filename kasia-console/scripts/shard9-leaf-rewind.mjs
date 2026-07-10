// J1tn·2026-07-10·28mln shard9 phantom-leaf调查
// 用真实bet_sequence(32笔,按id/created_at顺序,已核对总和跟current_leaf_state逐分吻合)
// 从genesis(count=0)正向重放到count=32,每一步都用pool-shard-register.mjs的spliceLeafState
// (逐字节核对过_i64LE/_push8真实实现)算出该步骤对应的covenant地址。
// 目的:交给Bettor独立RPC查每一步地址的UTXO/金额,定位DB记的状态推进在哪一步开始跟链上脱节。
//
// 用法: node scripts/shard9-leaf-rewind.mjs
// 输出: docs/iteration/shard9-leaf-rewind-result.json (33条记录, step 0=genesis .. step 32=当前DB state)

import { readFileSync, writeFileSync } from 'node:fs';
import * as kaspa from 'kaspa-wasm';

const { payToScriptHashScript, addressFromScriptPublicKey } = kaspa;

function _i64LE(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(n));
  return buf;
}
// 逐字节核对过 pool-shard-register.mjs:71 的真实实现: PUSH<len> data = 长度前缀字节+数据本身。
function _push8(buf) {
  return Buffer.concat([Buffer.from([buf.length]), buf]);
}
function spliceLeafState(baseRedeemHex, st) {
  const stateHex = Buffer.concat([
    _push8(_i64LE(st.local_yes)),
    _push8(_i64LE(st.local_no)),
    _push8(_i64LE(st.count)),
    _push8(_i64LE(st.pool_value)),
  ]);
  const redeem = Buffer.from(baseRedeemHex, 'hex');
  return Buffer.concat([redeem.slice(0, 1), stateHex, redeem.slice(1 + stateHex.length)]).toString('hex');
}

const data = JSON.parse(readFileSync('D:/kanet/KANet/docs/iteration/tmp-28mln-shard9-state.json', 'utf8'));
const shard9 = data.shard9;
const finalState = JSON.parse(shard9.current_leaf_state);
const seq = data.bet_sequence; // 已按id/created_at升序

// direction=0 累加到local_yes, direction=1累加到local_no —— 用最终态反推校验过(总和逐分吻合),不是猜的。
const steps = [];
let st = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };

function deriveAddr(state) {
  const redeemHex = spliceLeafState(shard9.shard_redeem_hex, state);
  const spk = payToScriptHashScript(new Uint8Array(Buffer.from(redeemHex, 'hex')));
  return addressFromScriptPublicKey(spk, 'testnet-12').toString();
}

steps.push({ step: 0, after_bet_id: null, state: { ...st }, address: deriveAddr(st) });

for (let i = 0; i < seq.length; i++) {
  const bet = seq[i];
  if (bet.direction === 0) st = { ...st, local_yes: st.local_yes + bet.stake_amount };
  else st = { ...st, local_no: st.local_no + bet.stake_amount };
  st = { ...st, count: st.count + 1, pool_value: st.pool_value + bet.stake_amount };
  steps.push({ step: i + 1, after_bet_id: bet.id, state: { ...st }, address: deriveAddr(st) });
}

// 校验: 最后一步必须跟DB记的current_leaf_state逐字段相等,否则这份重放本身就是错的,不能拿去用。
const last = steps[steps.length - 1].state;
const matches = last.local_yes === finalState.local_yes && last.local_no === finalState.local_no &&
  last.count === finalState.count && last.pool_value === finalState.pool_value;
if (!matches) {
  console.error('!!! 重放结果跟DB current_leaf_state不吻合,数据有问题,不要用这份结果 !!!');
  console.error('重放算出:', last);
  console.error('DB记录:', finalState);
  process.exit(1);
}
console.log('重放校验通过: step32状态逐字段吻合DB current_leaf_state。');
console.log('最终地址:', steps[steps.length - 1].address);
console.log('(应等于已知的 kaspatest:pzv6ttghlfzd6ealvkrudpf85fze6gam2md46ve8zhv4g4autax6ykl5ngvcm)');

const out = {
  shard: 'shard9',
  purpose: 'J1tn为Bettor独立RPC核实准备:逐步重放leaf_state,定位DB状态推进跟链上第一次脱节的步骤',
  verified_against_db_final_state: matches,
  known_current_leaf_outpoint: shard9.current_leaf_outpoint,
  steps,
  generated_at_note: '每条step.address都可独立用getUtxosByAddresses核实是否有UTXO/金额是否≈该step.state.pool_value',
};
writeFileSync('D:/kanet/KANet/docs/iteration/shard9-leaf-rewind-result.json', JSON.stringify(out, null, 2));
console.log('已写入 docs/iteration/shard9-leaf-rewind-result.json, 共', steps.length, '步(step0=genesis .. step32=当前)');
