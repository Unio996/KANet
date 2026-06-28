// zk-close-builder.mjs — P4 ZK-settle settler integration (J2·2026-06-28·Owner 全速并行令)
//
// 两阶段 ZK 结算(bshard 单片首 ship·verdict=委员/payout=ZK·见 docs/2026-06-28-P4-zk-settler-integration-design-draft.md):
//   phase1 oracle_attest_verdict: 委员 attest winningSide → PS continuation state attested_winner(closed 0→1)
//   phase2 zk_close: settler gather bets → proveZkClose(guest→groth16)→ 建 close_attest_zk tx(两输入 gate-spk)→ LAND(closed 1→2)
//
// ⚠ 状态: PRE-WRITE 骨架(Owner 全速并行·Bettor 直令"拿签名 pre-write·prove 一通直接插")。稳定层(编排+gather)已实;
//   易变层(proveZkClose 真 API / RISC0 journal framing / gate prefix-suffix)= INTERFACE STUB·待 J1 firm 对接。
//   **命门绝不 stub**(Bettor 红线): journal.inputs_commit==链上 bets_root / attested_winner 非-witness·这些在 J1 covenant 强制·
//   本 builder 只负责【喂对的 bets(absorb 序)+ 正确拼 journal_hash + 不回委员 fallback】。
//
// 三层 byte-equal 单源: 内层 bets_root/payout_root = blake2b(== golden-ref·guest 算);外层 journal_hash = sha256(J1 RISC0 framing)。

import { sqlite } from '../db/client.js';
import { createHash } from 'node:crypto';
import { getSidesByLogicalMarket } from './pool-bettor-sides-query.mjs';

// ── INTERFACE STUBS(待 J1 firm·prove 一通替换实现)─────────────────────────────
// ③ guest prove API(J1 15:29 预签·真版 prove 通后给):
//    proveZkClose({ bets:[{pk:hex32,stake:u64,dir:0|1}], winner:0|1, feeConfig, marketId })
//      → { receiptGroth16:hex(borsh), journalHash:hex32, betsRoot:hex32, payoutRoot:hex32 }
// 调法待定(CLI 子进程 / WASM / Bonsai)·J1 prover 通后定。
async function proveZkClose(/* { bets, winner, feeConfig, marketId } */) {
  throw new Error('proveZkClose: INTERFACE STUB — 待 J1 firm prover API(Docker/Bonsai groth16 通后对接)');
}
// ② gate prefix/suffix(J1 P1 emit 工具 diff 出·700B groth16 witness 框架·烤 gate_tmpl_hash 32B):
const ZK_GATE = {
  // gateTmplHash: 32B(烤进 close_attest_zk redeem·covenant 自省比对)— J1 给
  // groth16WitnessPrefix / Suffix: 700B 框架(witness·非烤)— J1 emit
  STUB: true,
};

// ── 稳定层: journal_hash(外层 sha256·命门字节·J1 RISC0 framing 锁后核对)──────────
// journal_hash = sha256(bets_root ‖ payout_root ‖ attested_winner)  (RISC0 journal digest·非 blake2b)
// ⚠ 精确 framing(三个 32B 拼接序 + 是否有 RISC0 envelope 前缀)= J1 RISC0 framing 锁后必三层 byte-equal 核。
export function computeJournalHash(betsRootHex, payoutRootHex, attestedWinner) {
  const winnerByte = Buffer.from([attestedWinner & 0xff]); // ⚠ winner 字节宽/位置待 J1 framing 确认(暂 1B)
  const pre = Buffer.concat([Buffer.from(betsRootHex, 'hex'), Buffer.from(payoutRootHex, 'hex'), winnerByte]);
  return createHash('sha256').update(pre).digest('hex');
}

// ── 稳定层: gather-ordered-bets(命门=absorb 序)──────────────────────────────────
// bets_root hash-chain 的 absorb 序 = register_append 序 = 注册序。pool_bettor_sides ORDER BY id ASC = 插入序。
// ⚠ 命门: 链上 bets_root absorb 序 = register_append TX **落链序**。demo 单片顺序注册→DB id 序==落链序;
//   production 必从链上 register 序列(chain_events/kaspa_tx_log)派生·不可只信 DB id(若 TX 乱序落链)。本 demo 用 id 序+下方校验。
// payout-leaf cap(NWT 攻击#5 第2路·B2·golden-ref depth-10 merkle = 1024 leaf 上限·winners>1024 guest 抛)。
// cheap pre-check(Bettor 授权"现在加"): projected payout-leaves = bettors(winners≤bettors) + fee-leaves reserve。
// 超 → overCap=true → zkCloseTick 不进 prove·直接 escape 退款(bets>0 走 refund_draw·见 §8.B2)。
const ZK_MAX_PAYOUT_LEAVES = 1024;
const ZK_FEE_LEAVES_RESERVE = 8; // broker/oracle/node/intro fee-leaf 上限保守预留(实 4-6)
export function gatherOrderedBets(logicalMarketId) {
  // shard-aware(命门·线8 STEP2): bshard bettor 存 shard_market_id·裸按 logical market_id 查不到 → 用 getSidesByLogicalMarket。
  // 该 helper 跨片取但无序 → 这里按 id ASC 排(= pool_bettor_sides 插入序 = register_append 序 = bets_root absorb 序)。
  const rows = getSidesByLogicalMarket(logicalMarketId, sqlite).sort((a, b) => a.id - b.id);
  // 单片 demo 一致性校验: 若有 side_lock_daa(落链 daa)·按它升序应 == id 升序(否则乱序落链·命门告警)
  const withDaa = rows.filter(r => r.side_lock_daa != null);
  const byDaa = [...withDaa].sort((a, b) => Number(a.side_lock_daa) - Number(b.side_lock_daa));
  const daaOrderMatchesId = byDaa.every((r, i) => withDaa[i]?.bettor_pk === r.bettor_pk);
  // B2 cap pre-check: winners≤bettors → 保守用 bettors 数 + fee reserve 投影 payout-leaf 上界。
  const projectedMaxLeaves = rows.length + ZK_FEE_LEAVES_RESERVE;
  const overCap = projectedMaxLeaves > ZK_MAX_PAYOUT_LEAVES;
  return {
    bets: rows.map(r => ({ pk: String(r.bettor_pk), stake: String(r.stake_amount), dir: Number(r.direction) })),
    daaOrderMatchesId, // false → 命门告警: DB id 序 ≠ 落链 daa 序·gather 序可能不符 on-chain bets_root → 拒 prove
    overCap,           // true → bets 投影超 1024 payout-leaf cap → 禁进 prove·escape 退款(bets>0=refund_draw·B2)
    betCount: rows.length,
  };
}

// ── 稳定层: phase 检测(两阶段编排·continuation-chain 天然保序)───────────────────
// phase1 oracle_attest_verdict 落链 → PS UTXO state closed=1 + attested_winner。phase2 zk_close 花该 UTXO。
// ❶(NWT)天然满足: zk_close 花 phase1 continuation UTXO → phase1 必已落链(UTXO 存在才能花)。
export function readAttestedWinnerFromState(/* psRedeemHex */) {
  // attested_winner 在 PS P2SH scriptPubKey/redeem state 区(J1 close_attest_zk validateOutputState 锁)。
  // STUB: 待 J1 PS state layout(closed 字段 offset + attested_winner offset)— 我 byte-read。
  throw new Error('readAttestedWinnerFromState: STUB — 待 J1 PS state layout(attested_winner offset)');
}

// ── 主编排: settler tick(扫 ready 单片 bshard 盘 → 两阶段驱动)───────────────────
// PRE-WRITE: 结构就位·prove/tx-build/.sil-dispatch 接口点待 J1 firm。
export async function zkCloseTick(/* ctx: { dispatchPhase1, dispatchPhase2, landed, p2sh } */) {
  // 1. 扫 ready 单片 bshard 盘(deadline 到 + shard_count=1 + 未 ZK-closed)
  // 2. for each:
  //    a. phase1: 若 PS state closed==0 → dispatch oracle_attest_verdict(委员 attest winner)→ 等 continuation LAND
  //    b. phase2: 若 closed==1(attested_winner 在 state)→
  //         - winner = readAttestedWinnerFromState(...)  ← B1: 必从链上 PS UTXO state byte-decode·零 DB(verify-value-source)
  //         - { bets, daaOrderMatchesId, overCap } = gatherOrderedBets(marketId)
  //         - B2 escape pre-prove: if(overCap) → 禁 prove·escape 退款(bets>0=refund_draw / 0-bet=refund_maker_unjoined·§8.B2)
  //         - if(!daaOrderMatchesId) 拒(命门告警·retry·C1 demo canary)
  //         - { receiptGroth16, journalHash, betsRoot, payoutRoot } = await proveZkClose({ bets, winner, feeConfig, marketId })
  //         - 自核: computeJournalHash(betsRoot, payoutRoot, winner) === journalHash(三层 sha256 对死·漂则停)
  //         - 建 close_attest_zk tx(两输入: PS continuation UTXO + 0xa6 P2SH(ZK_GATE)·gate-spk·witness=groth16 prefix‖receipt‖suffix)
  //         - submit → landed() 才算闭(NO TX NO STATE)
  //    c. prove-fail(infra 宕/guest panic): retry ≤ N_MAX·**绝不回委员路**(Bettor 红线·回 fragile = 假消脆性);
  //       耗尽/到 deadline → escape 退款(B2·bets>0=refund_draw·非 maker-only)·绝不 status='cancelled'(断退款路·教训)
  throw new Error('zkCloseTick: PRE-WRITE 骨架 — 待 J1 firm(proveZkClose / ZK_GATE prefix-suffix / PS state layout / .sil dispatch)对接');
}
