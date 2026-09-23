// proto-signing-key-binding.mjs — Codex MUST-PROVE(账本1497/1498, Bettor 2026-09-19 前置①):
// 用私钥给 ticket / claim 相关交易签名【之前】, 必须从该 ticket 自身状态推导出"应签公钥", 并断言与手上私钥的公钥
// 【逐字节相等】; 不等即在任何 IPC 与签名之前 fail-closed。
//
// 为什么需要: v0 生产路径里 bettor_pk === committee_pubkeys_json[0](proto.js:212-215, 账本1354 裁定"复用本市场委员会 pubkey
// 兼任 bettorPk"), 所以"手上有委员私钥就能签所有 ticket"目前恰好成立——但 **当前相等是实现决定, 不是协议保证**: 多用户场景
// (bettorPk 与委员身份分离)会分叉。这个断言是第一道拦截: 私钥来源变了(取错市场的私钥、换了 bettor)时, 在签名前就大声失败,
// 而不是构造出一笔链上必被拒的交易(或更糟: 签出别人的票)。
//
// 推导链(不信 DB 里 bettor_pk 字段本身, 要用链上事实证明它):
//   proto_bets.bettor_pk + side + stake + marketId ──重算 PoolSideTicket 的 ctor 与 P2SH──▶ 必须等于【链上 ticket UTXO 的 spk】
//   ⇒ 证明这个 bettor_pk 确实是烤进该 ticket 的那一把(P2SH 是脚本哈希, 不可能在不同 bettor_pk 下碰撞);
//   再断言 私钥的公钥 == 该 bettor_pk(按字节, 不按字符串: 大小写不同的同一把 hex 视为相等——见记忆 voter_pubkey 大小写 MUSTFIX)。
//
// 错误信息不含私钥值、不含推导出的私钥材料(只含公钥/spk 的短前缀)。

import { computeTicketGenesisArtifact, computeKanetTokenClaimGenesisArtifact } from '../proto-covenant-builder.mjs';

const HEX64 = /^[0-9a-fA-F]{64}$/;
const noPrefixLower = (h) => String(h).replace(/^0x/i, '').toLowerCase();

/** 32 字节 x-only 公钥 hex(小写、无 0x); 非 64 hex 字符即 throw。按字节语义归一, 不做字符串大小写敏感比较。 */
export function normalizePubkeyHex(hex, what = 'pubkey') {
  const h = noPrefixLower(hex ?? '');
  if (!HEX64.test(h)) throw new Error(`${what} 必须是 32 字节 hex(64 个十六进制字符), 实际长度=${h.length}`);
  return h;
}

/** 私钥 → x-only 公钥 hex(小写)。私钥对象用后 free()。 */
export function pubkeyHexOfPrivkey(kaspa, privKeyHex) {
  const pk = new kaspa.PrivateKey(noPrefixLower(privKeyHex));
  try { return pk.toPublicKey().toXOnlyPublicKey().toString().toLowerCase(); } finally { pk.free(); }
}

/**
 * 从 proto_bets 行 + 链上 ticket UTXO 的 spk 推导并【证明】应签公钥。
 * @param {{bettor_pk:string, side:number, stake:number|bigint}} bet  proto_bets 行
 * @param {string} marketId  32 字节 hex(ticket ctor 的 shard_pool_id)
 * @param {string} ticketUtxoSpkHex  链上 ticket UTXO 的 scriptPubKey(带或不带 0x 均可, 不含 version 前缀)
 * @returns {string} 应签公钥(小写 hex)
 */
export function deriveTicketBettorPk({ bet, marketId, ticketUtxoSpkHex }) {
  const bettorPk = normalizePubkeyHex(bet?.bettor_pk, 'proto_bets.bettor_pk');
  const art = computeTicketGenesisArtifact({ bettorPk, direction: Number(bet.side), stake: Number(bet.stake), shardPoolId: marketId });
  const want = noPrefixLower(art.scriptPubKeyHex);
  const got = noPrefixLower(ticketUtxoSpkHex ?? '');
  if (want !== got) {
    throw new Error(`ticket_pk_underivable: fail-closed — 按 proto_bets(bettor_pk=${bettorPk.slice(0, 8)}…, side=${bet.side}, stake=${bet.stake}) 重算的 PoolSideTicket P2SH(${want.slice(0, 12)}…) != 链上 ticket UTXO spk(${got.slice(0, 12)}…): DB 里的 bettor_pk/side/stake 与链上 ticket 不是同一张票, 不能据此推导应签公钥`);
  }
  return bettorPk;
}

/**
 * 断言手上私钥的公钥与"应签公钥"逐字节相等。不等 throw(fail-closed, 在 IPC 与签名之前)。
 * @returns {string} 相等时返回公钥 hex(小写)
 */
export function assertSigningKeyMatchesBinding({ kaspa, privKeyHex, expectedPubkeyHex, label = 'ticket' }) {
  const expected = normalizePubkeyHex(expectedPubkeyHex, `${label} 应签公钥`);
  const actual = pubkeyHexOfPrivkey(kaspa, privKeyHex);
  const a = Buffer.from(actual, 'hex'), e = Buffer.from(expected, 'hex');
  if (a.length !== e.length || !a.equals(e)) {
    throw new Error(`signing_key_mismatch: fail-closed — ${label}: 手上私钥的公钥(${actual.slice(0, 8)}…)与该票自身状态推导出的应签公钥(${expected.slice(0, 8)}…)不相等, 拒绝在 IPC 与签名之前继续。` +
      ' 当前 v0 里两者相等是实现决定(bettor_pk 复用委员公钥), 不是协议保证——多用户场景会分叉, 本断言是第一道拦截。');
  }
  return actual;
}

/** 组合入口: 推导并证明应签公钥, 再断言与私钥逐字节相等。builder/驱动在【任何 IPC 与签名之前】调用。 */
export function assertTicketSigningKey({ kaspa, privKeyHex, bet, marketId, ticketUtxoSpkHex, label = 'ticket' }) {
  const expectedPubkeyHex = deriveTicketBettorPk({ bet, marketId, ticketUtxoSpkHex });
  return assertSigningKeyMatchesBinding({ kaspa, privKeyHex, expectedPubkeyHex, label });
}

/**
 * (批7 withdraw) 从 KanetTokenClaim 自身状态推导并【证明】应签公钥 winner_pk: 按 (market_cov_id, winner_pk, amount) 重算 KanetTokenClaim 的 P2SH,
 * 必须等于链上 claim UTXO 的 spk(P2SH 是脚本哈希, 证明这个 winner_pk 确实是烤进该 claim 的那一把)。
 * @returns {string} 应签公钥(小写 hex)
 */
export function deriveClaimWinnerPk({ marketCovIdHex, winnerPkHex, amount, claimUtxoSpkHex }) {
  const winnerPk = normalizePubkeyHex(winnerPkHex, 'KanetTokenClaim.winner_pk');
  const art = computeKanetTokenClaimGenesisArtifact({ marketCovIdHex: noPrefixLower(marketCovIdHex), winnerPkHex: winnerPk, amount });
  const want = noPrefixLower(art.scriptPubKeyHex), got = noPrefixLower(claimUtxoSpkHex ?? '');
  if (want !== got) {
    throw new Error(`claim_pk_underivable: fail-closed — 按 (market_cov_id=${noPrefixLower(marketCovIdHex).slice(0, 8)}…, winner_pk=${winnerPk.slice(0, 8)}…, amount=${amount}) 重算的 KanetTokenClaim P2SH(${want.slice(0, 12)}…) != 链上 claim UTXO spk(${got.slice(0, 12)}…): 传入的 winner_pk/amount/market_cov_id 与链上 claim 不是同一个, 不能据此推导应签公钥`);
  }
  return winnerPk;
}

/** 组合入口(withdraw 签名前): 推导并证明 winner_pk, 再断言与私钥公钥逐字节相等; 不等在 IPC 与签名之前 fail-closed。 */
export function assertClaimWinnerSigningKey({ kaspa, privKeyHex, marketCovIdHex, winnerPkHex, amount, claimUtxoSpkHex, label = 'withdraw claim' }) {
  const expectedPubkeyHex = deriveClaimWinnerPk({ marketCovIdHex, winnerPkHex, amount, claimUtxoSpkHex });
  return assertSigningKeyMatchesBinding({ kaspa, privKeyHex, expectedPubkeyHex, label });
}
