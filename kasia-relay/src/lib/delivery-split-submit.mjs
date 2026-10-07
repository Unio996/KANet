// delivery-split-submit.mjs — 账本1877 步3: 数字商品交付「split 广播」窄入口(relay 是唯一链上出口; console 不碰链)。
//   Bettor 裁定(账本1879 后): 「只接受零签名 split, 输出必须能由订单 ctor 重建, 不给任意广播开口子」。
//   本命令不是通用 submit: 提交前逐条验证 ——
//     ① tx 形状: version 1 / 恰 1 输入 / 零 payload / 零 subnetwork / lockTime 0 / sequence 0(split 入口无时间门);
//     ② 输入 sigScript 末尾 = 对订单 redeem 的一次 push, 且该 redeem 解析为 CommissionSplit ctor(固定偏移读出角色/退款/费用上限, 与 order-template.js CS_FIELDS 同布局, 漂移由测试守);
//     ③ 输出 = ctor 里角色逐个(spk 逐字节 + 金额精确); 可选第 N+1 个找零输出 = refund_spk 且金额落在合约允许区间;
//     ④ 输入 outpoint 必须是链上真实存在、且 P2SH 地址 = payToScriptHash(该 redeem) 的 UTXO, 金额 ≥ 角色合计;
//     ⑤ finalize 后 txid == 调用方给的 expected_txid(防 JSON 内嵌 id 被信)。
//   不持任何私钥、不签名(split 零签名), 因此不触及钱包。
export const SPLIT_MAX_ROLES = 7;
const ROLE_LAYOUT = Array.from({ length: SPLIT_MAX_ROLES }, (_, i) => ({ spk: 11 + 56 * i, len: 49 + 56 * i, amt: 58 + 56 * i }));   // 与 order-template.js CS_FIELDS 同(role1_spk@11, role1_len@49, role1_amt@58, 每角色 +56)
export const CS_LAYOUT = Object.freeze({ role_count: 2, roles: ROLE_LAYOUT, refund_spk: 403, refund_len: 441, deadline_ms: 450, max_split_fee: 459 });
const SPK_SLOT = 37;

const hex2u8 = (h) => { if (!/^(?:[0-9a-f]{2})*$/i.test(h || '')) throw new Error('非法 hex'); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
const u8hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const rdU64 = (b, off) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i]); return v; };

/** 从订单 redeem 字节读 ctor(固定偏移)。长度/角色数/spk 长度异常 ⇒ 抛。 */
export function parseCommissionCtor(redeemHex) {
  const b = hex2u8(redeemHex);
  if (b.length < 560 || b.length > 5000) throw new Error(`redeem 长度 ${b.length} 不像 CommissionSplit`);
  const n = Number(rdU64(b, CS_LAYOUT.role_count));
  if (!Number.isInteger(n) || n < 1 || n > SPLIT_MAX_ROLES) throw new Error(`role_count=${n} 越界`);
  const roles = [];
  for (let i = 0; i < n; i++) {
    const L = ROLE_LAYOUT[i]; const len = Number(rdU64(b, L.len));
    if (len < 4 || len > SPK_SLOT) throw new Error(`role${i + 1}_len=${len} 越界`);
    roles.push({ spkHex: u8hex(b.subarray(L.spk, L.spk + len)), amountSompi: rdU64(b, L.amt) });
  }
  const refundLen = Number(rdU64(b, CS_LAYOUT.refund_len));
  if (refundLen < 4 || refundLen > SPK_SLOT) throw new Error(`refund_len=${refundLen} 越界`);
  return { roles, refundSpkHex: u8hex(b.subarray(CS_LAYOUT.refund_spk, CS_LAYOUT.refund_spk + refundLen)), deadlineMs: rdU64(b, CS_LAYOUT.deadline_ms), maxSplitFee: rdU64(b, CS_LAYOUT.max_split_fee), length: b.length };
}

/** sigScript 末尾是不是对 redeem 的单次 push(PUSHDATA1/2/直接 push 三种头), 且 redeem 就在末尾。 */
export function sigScriptEndsWithRedeemPush(sigScriptHex, redeemHex) {
  const s = String(sigScriptHex || '').toLowerCase(), r = String(redeemHex || '').toLowerCase();
  const n = r.length / 2;
  let header;
  if (n <= 75) header = n.toString(16).padStart(2, '0');
  else if (n <= 255) header = '4c' + n.toString(16).padStart(2, '0');
  else if (n <= 65535) header = '4d' + (n & 0xff).toString(16).padStart(2, '0') + ((n >> 8) & 0xff).toString(16).padStart(2, '0');
  else return false;
  return s.endsWith(header + r);
}

const spkHexOf = (o) => { const v = Number(o.scriptPublicKey.version); const sc = String(o.scriptPublicKey.script); return ((v & 0xff).toString(16).padStart(2, '0') + ((v >> 8) & 0xff).toString(16).padStart(2, '0') + sc).toLowerCase(); };

/**
 * 纯校验(不碰网络): tx(wasm Transaction 对象) + redeemHex ⇒ { ok:true, ctor, outputsOk } | { ok:false, error }。
 * @param {object} tx kaspa-wasm Transaction
 * @param {string} redeemHex
 * @param {{inputAmountSompi?:bigint}} [o] 提供时额外核对找零区间
 */
export function checkSplitTx(tx, redeemHex, o = {}) {
  const fail = (error) => ({ ok: false, error: `delivery_split_submit: ${error}` });
  let ctor; try { ctor = parseCommissionCtor(redeemHex); } catch (e) { return fail(`redeem 解析失败: ${e.message}`); }
  if (Number(tx.version) !== 1) return fail('version 必须为 1');
  if (tx.inputs.length !== 1) return fail('必须恰 1 个输入');
  if (String(tx.payload || '') !== '') return fail('payload 必须为空');
  if (!/^0+$/.test(String(tx.subnetworkId || '0'.repeat(40)))) return fail('subnetwork 必须全零');
  if (BigInt(tx.lockTime) !== 0n) return fail('split 入口 lockTime 必须为 0');
  const inp = tx.inputs[0];
  if (BigInt(inp.sequence) !== 0n) return fail('sequence 必须为 0');
  if (!sigScriptEndsWithRedeemPush(inp.signatureScript, redeemHex)) return fail('sigScript 末尾不是对订单 redeem 的 push');
  const n = ctor.roles.length, outs = tx.outputs;
  if (outs.length !== n && outs.length !== n + 1) return fail(`输出数 ${outs.length} ∉ {${n}, ${n + 1}}(角色数 ${n}${outs.length === n + 1 ? ' + 找零' : ''})`);
  for (let i = 0; i < n; i++) {
    if (BigInt(outs[i].value) !== ctor.roles[i].amountSompi) return fail(`output[${i}] 金额 ${outs[i].value} ≠ ctor 角色金额 ${ctor.roles[i].amountSompi}`);
    if (spkHexOf(outs[i]) !== ctor.roles[i].spkHex.toLowerCase()) return fail(`output[${i}] scriptPubKey ≠ ctor 角色 spk`);
  }
  const recipients = ctor.roles.reduce((a, r) => a + r.amountSompi, 0n);
  if (outs.length === n + 1) {
    if (spkHexOf(outs[n]) !== ctor.refundSpkHex.toLowerCase()) return fail('找零输出 spk ≠ ctor refund_spk');
    if (o.inputAmountSompi !== undefined) {
      const change = BigInt(outs[n].value);
      if (change > o.inputAmountSompi - recipients) return fail('找零超过输入-角色合计');
      if (change < o.inputAmountSompi - recipients - ctor.maxSplitFee) return fail('找零低于 输入-角色合计-max_split_fee(合约下限)');
    }
  } else if (o.inputAmountSompi !== undefined && o.inputAmountSompi - recipients > ctor.maxSplitFee) {
    return fail('无找零但多余金额超过 max_split_fee(应走有找零分支)');
  }
  return { ok: true, ctor, recipients };
}

/**
 * 由命令字段在 relay 本地【自己构造】交易(不收调用方序列化好的 tx: v1 tx 的 SafeJSON 需要 UTXO 条目, 且"调用方给的整笔 tx"本身就是更大的信任面)。
 * cmd: { input:{txid,index}, sig_script_hex, outputs:[{value:string, spk_hex}], redeem_hex, expected_txid }
 * computeBudget 固定 70(= commission-plan-sdk buildCommissionSplitTx); lockTime 0 / sequence 0 / 无 payload / 零 subnetwork 由本函数写死, 不接受调用方参数。
 */
export function buildSplitTxFromCmd(cmd, kaspa) {
  const inp = cmd.input || {};
  if (!/^[0-9a-f]{64}$/.test(String(inp.txid || '')) || !Number.isInteger(inp.index) || inp.index < 0 || inp.index > 0xffff) throw new Error('input 非法');
  if (!/^(?:[0-9a-f]{2})+$/.test(String(cmd.sig_script_hex || '')) || cmd.sig_script_hex.length > 6000) throw new Error('sig_script_hex 非法');
  if (!Array.isArray(cmd.outputs) || cmd.outputs.length < 1 || cmd.outputs.length > SPLIT_MAX_ROLES + 1) throw new Error('outputs 非法');
  const outs = cmd.outputs.map((o, i) => {
    if (!/^(0|[1-9][0-9]{0,18})$/.test(String(o.value))) throw new Error(`outputs[${i}].value 非法`);
    const spk = String(o.spk_hex || '');
    if (!/^(?:[0-9a-f]{2})+$/.test(spk) || spk.length < 8 || spk.length > 2 * SPK_SLOT) throw new Error(`outputs[${i}].spk_hex 非法`);
    const version = parseInt(spk.slice(0, 2), 16) | (parseInt(spk.slice(2, 4), 16) << 8);
    return new kaspa.TransactionOutput(BigInt(o.value), new kaspa.ScriptPublicKey(version, spk.slice(4)));
  });
  return new kaspa.Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: inp.txid, index: inp.index }, signatureScript: cmd.sig_script_hex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '00'.repeat(20), payload: '',
  });
}

/**
 * 构造 + 校验 + 链上核对 + 提交。依赖注入: kaspa(wasm 模块)、rpc(共享 RpcClient)、networkId。
 * @returns {Promise<{ok:true, txId:string}|{ok:false, error:string}>}
 */
export async function submitSplit({ cmd, kaspa, rpc, networkId }) {
  const fail = (error) => ({ ok: false, error });
  if (typeof cmd.redeem_hex !== 'string' || !/^[0-9a-f]+$/.test(cmd.redeem_hex)) return fail('delivery_split_submit: redeem_hex 非法');
  if (!/^[0-9a-f]{64}$/.test(String(cmd.expected_txid || ''))) return fail('delivery_split_submit: expected_txid 必须是 64 位小写 hex');
  let tx;
  try { tx = buildSplitTxFromCmd(cmd, kaspa); } catch (e) { return fail(`delivery_split_submit: ${String(e.message).slice(0, 120)}`); }
  if (String(tx.id) !== cmd.expected_txid) return fail('delivery_split_submit: 本地构造的 txid ≠ expected_txid');
  const shape = checkSplitTx(tx, cmd.redeem_hex);
  if (!shape.ok) return shape;
  // 链上核对: 输入 UTXO 必须真实存在于该 redeem 的 P2SH 地址上
  const addr = kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(hex2u8(cmd.redeem_hex)), networkId).toString();
  const { entries } = await rpc.getUtxosByAddresses([addr]);
  const op = tx.inputs[0].previousOutpoint;
  const hit = (entries || []).find((e) => String(e.outpoint.transactionId) === String(op.transactionId) && Number(e.outpoint.index) === Number(op.index));
  if (!hit) return fail('delivery_split_submit: 输入 UTXO 不在该订单 redeem 的 P2SH 地址上(或已被花)');
  const full = checkSplitTx(tx, cmd.redeem_hex, { inputAmountSompi: BigInt(hit.amount) });
  if (!full.ok) return full;
  if (BigInt(hit.amount) < full.recipients) return fail('delivery_split_submit: 输入金额不足角色合计');
  const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
  return { ok: true, txId: r.transactionId };
}
