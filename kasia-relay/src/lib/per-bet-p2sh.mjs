// per-bet-p2sh.mjs — #28 (B) 根治: 每笔押注付款进【独立 per-bet P2SH 地址】·不进 relay 通用 P2PK 选币池
//   → defrag/transfer/全 17 条 relay 选币路【物理碰不到】付款 → 零并发竞态·零 commingle·零 retrofit·零留缝。
//   (替代 (A) "到处守"·Bettor/J2/NWT/J1 四源收敛·root-isolation > guard-everywhere。Owner 钦定"干出东西"。)
//
// 背景(Martin w7lcx 实证): bettor 付款到【共享 gateway relay P2PK 址】·与 relay 运营资金 fungible →
//   confirm 等认领的窗口里·并发 registerBettorOnShard.transfer() 垫注金 / defrag 等任意 relay spend
//   概率性把付款当普通余额花掉 → confirm 按 exact 找不到 → "付了没单"。per-bet P2SH 根上隔离。
//
// 经济(Bettor 读 recordBettorOnShard L148): gateway 用【自己余额】垫 stake 进 leaf·bettor 付款只是"已付"信号
//   + 补偿 gateway。∴ sweep = 【异步报销·非 splice 资金源】: confirm 检测 per-bet P2SH 有付款即可 register
//   (gateway 已垫)·sweep 随后跑·**sweep 失败不 strand bet**·但未 sweep 必追踪重试(防 gateway 慢性失血·J2 piece④ daemon)。
//
// 🔴 spendability gate(§3 命门): 派生有效地址 ≠ 可花。redeem 的 sweep(sign+spend)必【真链测证可花】才准 wire 进
//   prep/confirm——写错 sighash/witness/redeem-reveal = 付款锁死不可花地址 = 比原 bug 更糟(不可逆)。用 relay 现成
//   P2SH-spend 机制(bshard unlock 同款·proven)·真链 sweep 测过才 wire。

import { createHash } from 'node:crypto';

const OP_DROP = 0x75;
const OP_CHECKSIG = 0xac;
const PUSH32 = 0x20;

/**
 * per-bet nonce = sha256(market|bettorPk|direction|payAmountSompi) → 32B。
 *   确定性(同 bet 参数→同 nonce·prep/confirm 跨调一致) + 每注唯一(含 bettorPk → 绝不两注同址=不重引 commingle bug)。
 */
export function perBetNonce({ marketId, bettorPk, direction, payAmountSompi }) {
  return createHash('sha256')
    .update(`${marketId}|${bettorPk}|${direction}|${payAmountSompi}`)
    .digest(); // 32B Buffer
}

/**
 * per-bet redeem = PUSH32 <nonce32> | OP_DROP | PUSH32 <gw_xonly_pubkey32> | OP_CHECKSIG  (68B)
 *   nonce 入 redeem(后 DROP)使 P2SH hash 每注唯一; gw x-only key CHECKSIG → 仅 gateway relay 可 sweep(报销)。
 *   spend witness = [gw_schnorr_sig]; 执行: [sig]→push nonce→DROP→[sig]→push pk→[sig,pk]→CHECKSIG→[true]。
 * @param {Buffer} nonce32       32B per-bet nonce (perBetNonce 产)
 * @param {string} gwXOnlyHex    gateway relay x-only pubkey (64 hex = 32B)
 * @returns {Buffer} 68B redeem script
 */
export function perBetRedeem(nonce32, gwXOnlyHex) {
  if (!Buffer.isBuffer(nonce32) || nonce32.length !== 32) throw new Error('perBetRedeem: nonce must be 32B Buffer');
  const pk = Buffer.from(String(gwXOnlyHex), 'hex');
  if (pk.length !== 32) throw new Error(`perBetRedeem: gw xonly must be 32B (got ${pk.length})`);
  return Buffer.concat([Buffer.from([PUSH32]), nonce32, Buffer.from([OP_DROP, PUSH32]), pk, Buffer.from([OP_CHECKSIG])]);
}

/**
 * per-bet P2SH 地址 = addressFromScriptPublicKey(payToScriptHashScript(redeem))。
 * @param {object} kw            kaspa-wasm 模块 (payToScriptHashScript + addressFromScriptPublicKey)
 * @param {Buffer} redeem        perBetRedeem 产 68B
 * @param {string} networkId     'testnet-12' | 'mainnet'
 * @returns {string} kaspatest:p... / kaspa:p... P2SH 地址
 */
export function perBetAddr(kw, redeem, networkId) {
  const spk = kw.payToScriptHashScript(new Uint8Array(redeem));
  return kw.addressFromScriptPublicKey(spk, networkId).toString();
}

/** 一步: bet 参数 + gw xonly → { nonceHex, redeemHex, address }。prep/sweep 共用单一真相。 */
export function derivePerBet(kw, { marketId, bettorPk, direction, payAmountSompi, gwXOnlyHex, networkId }) {
  const nonce = perBetNonce({ marketId, bettorPk, direction, payAmountSompi });
  const redeem = perBetRedeem(nonce, gwXOnlyHex);
  return { nonceHex: nonce.toString('hex'), redeemHex: redeem.toString('hex'), address: perBetAddr(kw, redeem, networkId) };
}
