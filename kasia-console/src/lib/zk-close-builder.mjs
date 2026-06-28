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
import { computeBetsRoot } from './pool-payout-root.mjs';

// ── ZK_GATE(J1 firm 16:50/16:52·gate-verify EXIT=0 实证·定版常量)──────────────
// gate redeem = prefix(1B 0x20 = push32)‖ journal_hash(32B·per-settle 变)‖ suffix(800B)。
// gate_tmpl_hash = blake2b(prefix‖suffix)(固定-per-image_id·烤进 CloseZk ctor·covenant 自省比对)。
// prefix/suffix 的实字节 = builder 在建 close_attest_zk tx 时从 zk-sdk
//   commit_to_groth16_with_fixed_journal(imageId, journalHash).finalize_with_proof(receipt) 取(作 witness·非烤)。
const ZK_GATE = {
  imageId: '335cae6c34c5d4049f92b8fd33da491de2a11d321cbaf5a543a0490977328c7d',     // 结算 guest image_id(改 guest=改此=新 covenant)
  gateTmplHash: 'b9d56ce469c375c139bae90f5dd409d79807b81c69027a3d44c31bd6a74bdbd5', // blake2b(prefix‖suffix)·烤 CloseZk ctor
};

// ── INTERFACE STUB(proveZkClose·契约已 firm·transport 待定·见下）─────────────────
// ③ guest prove API 契约(J1 firm 16:52):
//    proveZkClose({ bets:[{pk:hex32,stake:u64,dir:0|1}], winner:0|1, feeConfig, marketId })
//      flat input = [n:4LE][n×(pk32 ‖ stake8LE ‖ dir1)][winner:1]
//      → { receiptGroth16:hex(borsh·482B), journalHash:hex32(=sha256(journal)), betsRoot:hex32, payoutRoot:hex32, imageId }
// transport(Bettor 裁 16:54): 今晚 demo = Option ② **receipt-injection**(J1 手动 prove over ACTUAL gathered bets →
//   receipt borsh hex 注入)。production = Option ① :3300 programmatic prove service(下个 pass)。
// 口径: operator-driven 手动·NOT 全自动·prover 仍真 guest 算真盘 payout·链上 0xa6 covenant 仍密码学验·
//   journal.inputs_commit 必==链上 baked bets_root 否则拒 → manual 注入偷不了钱(covenant 兜底)·机制不打折。
// flat input = [n:4LE][n×(pk32 ‖ stake8LE ‖ dir1)][winner:1] → journal[65]=bets_root‖payout_root‖winner。
async function proveZkClose({ bets, winner, feeConfig, marketId }, opts = {}) {
  const { injectedReceipt } = opts;
  if (!injectedReceipt) {
    throw new Error('proveZkClose: 今晚 demo=receipt-injection·需 opts.injectedReceipt(J1 手动 prove 的 receipt);production :3300 prove service 待下个 pass');
  }
  const { receiptGroth16, journalHash, betsRoot, payoutRoot, imageId } = injectedReceipt;
  // 自核①: imageId 必 == 钉死结算 guest(改 guest=改 image_id=新 covenant·防换电路)。
  if (imageId !== ZK_GATE.imageId) {
    throw new Error(`proveZkClose: receipt imageId=${String(imageId).slice(0, 16)}≠钉死 ${ZK_GATE.imageId.slice(0, 16)}`);
  }
  // 自核②: journal_hash 三层 byte-equal(我 computeJournalHash(betsRoot,payoutRoot,winner) == receipt.journalHash·漂则停)。
  const recomputed = computeJournalHash(betsRoot, payoutRoot, winner);
  if (recomputed !== journalHash) {
    throw new Error(`proveZkClose: journal_hash 漂! 我算=${recomputed.slice(0, 16)} receipt=${String(journalHash).slice(0, 16)}(winner=${winner})`);
  }
  // 注: bets_root == 链上 ctor-baked bets_root 由 P3 covenant 兜底验(非本函数·manual 注入偷不了钱)。
  //     强化(可选·TODO): 从我 gatherOrderedBets 的 bets 独立重算 bets_root == receipt.betsRoot(确保 J1 prove 的就是我这盘 bets)。
  return { receiptGroth16, journalHash, betsRoot, payoutRoot, imageId };
}

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
  // canonical bets(直接喂 guest flat-input 用·field 名 direction 对齐 golden-ref/computeBetsRoot)。
  const bets = rows.map(r => ({ pk: String(r.bettor_pk), stake: String(r.stake_amount), direction: Number(r.direction) }));
  // C1 predict-then-verify(命门·prove 前廉价守门·J1 17:17 锚): 按 gather 序 fold betsRoot →
  //   必 == on-chain bets_root(烤在 leaf continuation redeem·offset J1 给)。mismatch=序错立刻抓·拒 prove。
  //   单源 lib computeBetsRoot(与 guest byte-equal·golden-ref 9/9 自测)·gather 序写错=betsRoot 漂=此处抓。
  const betsRootHex = computeBetsRoot(bets).toString('hex');
  return {
    bets,              // [{pk,stake,direction}] in gather(absorb)序
    betsRootHex,       // 按 gather 序算的 betsRoot → zkCloseTick 必对 on-chain bets_root(C1 predict-then-verify)
    daaOrderMatchesId, // false → 命门告警: DB id 序 ≠ 落链 daa 序·gather 序可能不符 on-chain bets_root → 拒 prove
    overCap,           // true → bets 投影超 1024 payout-leaf cap → 禁进 prove·escape 退款(bets>0=refund_draw·B2)
    betCount: rows.length,
  };
}

// C1 predict-then-verify 门(zkCloseTick prove 前调): gather 序算的 betsRoot == 链上烤死 bets_root 才放行。
// onChainBetsRootHex = J1 phase1 烤进 leaf/CloseZk continuation redeem 的 bets_root(relay self-fetch·非 caller-fed)。
export function verifyGatherOrderAgainstChain(betsRootHex, onChainBetsRootHex) {
  const ok = typeof onChainBetsRootHex === 'string'
    && betsRootHex.toLowerCase() === onChainBetsRootHex.toLowerCase();
  return { ok, gatherBetsRoot: betsRootHex, onChainBetsRoot: onChainBetsRootHex };
}

// ── 稳定层: phase 检测(两阶段编排·continuation-chain 天然保序)───────────────────
// phase1 oracle_attest_verdict 落链 → PS UTXO state closed=1 + attested_winner。phase2 zk_close 花该 UTXO。
// ❶(NWT)天然满足: zk_close 花 phase1 continuation UTXO → phase1 必已落链(UTXO 存在才能花)。
// B1(NWT BLOCKING·Bettor ACCEPT·零-DB·verify-value-source): attested_winner 必从【链上 PS UTXO redeem state 区】
// byte-decode·禁从任何 DB 表读(pool_markets.winning_side/execution_states/任何 sqlite)·恶意 settler 改不了链上 UTXO。
// J1 firm layout(16:55·CloseZk redeem·state_start=1·bshard 编码 int=[0x08]+8B LE / byte32=[0x20]+32B):
//   consolidated_pool 9B(push@1·val@2-9)· closed 9B(push@10·val@11-18)
//   · payoutRoot 33B(push@19=0x20·val@20-51)· attested_winner 9B(push@52=0x08·val@53-60·8B LE)
//   → winner = redeem 绝对 offset 53 起 8B LE 的低字节(0x00=YES→0 / 0x01=NO→1)。
// psRedeemHex = phase2 即将花费的 phase1 continuation UTXO 的 redeem(relay 自取·非 caller-fed·同 covenant readInputState)。
const _PSZK = { CONSOL_PUSH: 1, CLOSED_PUSH: 10, PAYOUTROOT_PUSH: 19, AW_PUSH: 52, AW_VAL: 53 };
export function readAttestedWinnerFromState(psRedeemHex) {
  if (typeof psRedeemHex !== 'string' || !/^[0-9a-fA-F]+$/.test(psRedeemHex)) {
    throw new Error('readAttestedWinnerFromState: psRedeemHex 非 hex');
  }
  const r = Buffer.from(psRedeemHex, 'hex');
  if (r.length < _PSZK.AW_VAL + 8) throw new Error(`readAttestedWinnerFromState: redeem 太短 len=${r.length} < ${_PSZK.AW_VAL + 8}`);
  // 结构校验(verify-value-source: 切点对不上 = 拒·绝不解码垃圾): 4 field push 标记必匹配 J1 layout。
  if (r[_PSZK.CONSOL_PUSH] !== 0x08) throw new Error(`PS layout mismatch: consolidated_pool push@${_PSZK.CONSOL_PUSH}=0x${r[_PSZK.CONSOL_PUSH].toString(16)}≠0x08`);
  if (r[_PSZK.CLOSED_PUSH] !== 0x08) throw new Error(`PS layout mismatch: closed push@${_PSZK.CLOSED_PUSH}=0x${r[_PSZK.CLOSED_PUSH].toString(16)}≠0x08`);
  if (r[_PSZK.PAYOUTROOT_PUSH] !== 0x20) throw new Error(`PS layout mismatch: payoutRoot push@${_PSZK.PAYOUTROOT_PUSH}=0x${r[_PSZK.PAYOUTROOT_PUSH].toString(16)}≠0x20`);
  if (r[_PSZK.AW_PUSH] !== 0x08) throw new Error(`PS layout mismatch: attested_winner push@${_PSZK.AW_PUSH}=0x${r[_PSZK.AW_PUSH].toString(16)}≠0x08`);
  // attested_winner = val@53-60 8B LE·winner=低字节·高 7 字节必 0(winner∈{0,1})。
  const aw = r.subarray(_PSZK.AW_VAL, _PSZK.AW_VAL + 8);
  const winner = aw[0];
  for (let i = 1; i < 8; i++) if (aw[i] !== 0) throw new Error(`attested_winner 高字节非0 (aw=${aw.toString('hex')}) — winner 应∈{0,1}`);
  if (winner !== 0 && winner !== 1) throw new Error(`attested_winner 低字节=${winner} 非 0/1(0x00=YES/0x01=NO)`);
  return winner; // 0=YES, 1=NO
}

// ── phase2 编排(J2 域·per J1 ③-C 17:23 分工: 我 gather+order+fold 自验+dispatch+LAND 验; J1 prove+gate+2-input build+broadcast)──
// J2 不碰链·不组 scriptSig·不 prove → 全走 ctx hook(relay/db boundary)。只调 J1 unlockBshardZkClose builder。
// ctx hooks(J1/relay/db 提供·签名见各处注释):
//   ctx.fetchCloseZkContinuation(market) → { outpoint:{txid,index}, redeemHex, valueSompi } | null
//        — relay self-fetch CloseZk continuation UTXO(closed=1)·B1 call-site 命门: redeem 从链上自取·非 caller-fed。
//        — null = phase1 未产/未落链(continuation UTXO 不存在)→ skip(天然保序: 花它必先有它)。
//   ctx.readOnChainBetsRoot(redeemHex) → hex32  — 从 CloseZk redeem code-body 读 ctor-baked bets_root(J1 offset)。
//   ctx.dispatchUnlockZkClose({ marketId, orderedBets, betsRoot, continuationOutpoint, attestedWinner }) → { ok, txid, error }
//        — sendCommandAsync → J1 unlockBshardZkClose handler(prove+gate+FUND+2-input build+broadcast)。
//   ctx.checkLanded(txid) → bool  — relay check_utxo_landed(NO TX NO STATE)。
//   ctx.escapeRefund(market, reason) → { escaped }  — B2: bets>0→refund_draw / 0-bet→refund_maker_unjoined·绝不回委员路·绝不 status-cancel。
//   ctx.reconcile(market, { txid, winner, betsRoot }) → void  — 仅 LAND 后: closed=2 + settle_evidence(metadata·非 status-cancel)。
export async function zkClosePhase2(market, ctx) {
  // 1. fetch CloseZk continuation UTXO(closed=1)·B1 call-site self-fetch(链上自取·非 caller-fed)。
  const cont = await ctx.fetchCloseZkContinuation(market);
  if (!cont || !cont.redeemHex) return { skip: 'no CloseZk continuation UTXO(phase1 未产/未落链)' };
  // 2. attested_winner W ← 链上 redeem byte-decode(B1·offset 53·零 DB·verify-value-source)。
  const attestedWinner = readAttestedWinnerFromState(cont.redeemHex);
  // 3. gather ordered bets(链序)+ fold betsRoot。
  const g = gatherOrderedBets(market.id);
  if (g.betCount === 0) return ctx.escapeRefund(market, '0-bet ZK market → refund_maker_unjoined(B2)');
  // 4. B2 escape pre-prove: bets 投影超 1024 payout-leaf cap → 禁 prove·refund_draw。
  if (g.overCap) return ctx.escapeRefund(market, `bets>1024 cap(count=${g.betCount})→refund_draw(B2)`);
  // 5. C1 predict-then-verify: 我 fold betsRoot == 链上 ctor-baked bets_root 才放行(序错立抓·prove 前廉价守门)。
  const onChainBetsRoot = ctx.readOnChainBetsRoot(cont.redeemHex);
  const v = verifyGatherOrderAgainstChain(g.betsRootHex, onChainBetsRoot);
  if (!v.ok) return { abort: `betsRoot mismatch(gather 序错·不 prove): fold=${v.gatherBetsRoot.slice(0, 12)} chain=${String(onChainBetsRoot).slice(0, 12)}` };
  // 6. dispatch J1 unlockBshardZkClose(J1: prove over 真 bets→gate→FUND→2-input build→broadcast)。我不组 scriptSig。
  const r = await ctx.dispatchUnlockZkClose({
    marketId: market.id, orderedBets: g.bets, betsRoot: g.betsRootHex,
    continuationOutpoint: cont.outpoint, attestedWinner,
  });
  // 7. prove/build-fail: 不推进·不回委员路(Bettor 红线)·交 B2 deadline escape(retry/refund)。
  if (!r || !r.ok || !r.txid) return { fail: `unlockBshardZkClose: ${r?.error || 'no txid'}`, proveOrBuildFailed: true };
  // 8. NO TX NO STATE: LAND 验过才推进本地状态。
  const landed = await ctx.checkLanded(r.txid);
  if (!landed) return { fail: `close_zk ${String(r.txid).slice(0, 12)} 广播但未 LAND — NO TX NO STATE·不推进` };
  // 9. reconcile(仅 LAND 后): closed=2 + settle_evidence。
  await ctx.reconcile(market, { txid: r.txid, winner: attestedWinner, betsRoot: g.betsRootHex });
  return { ok: true, txid: r.txid, winner: attestedWinner, betsRoot: g.betsRootHex };
}

// ── settler tick 扫描包装(扫 ready ZK 盘 → 逐盘 zkClosePhase2)──────────────────────
// ctx.scanReadyZkMarkets() → [market]  (单片 + ZK-aware + closed==1 phase1 已产 + 未 ZK-closed)。settler 集成点。
export async function zkCloseTick(ctx) {
  const markets = await ctx.scanReadyZkMarkets();
  const out = [];
  for (const m of markets) {
    try { out.push({ marketId: m.id, ...(await zkClosePhase2(m, ctx)) }); }
    catch (e) { out.push({ marketId: m.id, error: e.message }); }
  }
  return out;
}
