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
import { getSidesByShard } from './pool-bettor-sides-query.mjs';
import { computeBetsRoot } from './pool-payout-root.mjs';

// ── ZK_GATE(J1 firm 16:50/16:52·gate-verify EXIT=0 实证·定版常量)──────────────
// gate redeem = prefix(1B 0x20 = push32)‖ journal_hash(32B·per-settle 变)‖ suffix(800B)。
// gate_tmpl_hash = blake2b(prefix‖suffix)(固定-per-image_id·烤进 CloseZk ctor·covenant 自省比对·目前本文件内未被
//   实际引用/校验,留待 zk_close 组装真正用到 CloseZk ctor 时接线,不在这次修法范围)。
// prefix/suffix 的实字节 = builder 在建 close_attest_zk tx 时从 zk-sdk
//   commit_to_groth16_with_fixed_journal(imageId, journalHash).finalize_with_proof(receipt) 取(作 witness·非烤)。
// 🔴 修复(2026-07-07, Bettor 裁定 #afw8pg): imageId 之前是更早版本 guest 遗留的陈旧值(335cae6c...),既不等于
// J1机器也不等于J2机器今天的真实编译产物——canonical 值 = c9918501...(J1机器自 2026-07-06 晚首次真实 groth16
// proof 起持续沿用, 今天 3o6cs 真实 receipt 同款, 见 zk-payout-guest/proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.summary.json)。
// J2 机器今天独立编译同一份 guest 源码(sha256 逐字节相同)却产出不同 image_id(04be05f2...)——根因非源码差异,是
// RISC0 image_id 对编译产物(含全部依赖树)敏感,而 Cargo.lock 被 .gitignore 排除 → 跨机 cargo resolve 未锁定依赖
// 版本 → 编译产物不可复现。Phase2 补课项(挂账): 提交 J1 机器产出的 Cargo.lock(root+methods/guest 两份,канonical
// 出证机那份, 不是 J2 的), 换 docker 固定镜像 build 达成真正可复现构建。
// 🔴 修复(2026-07-08, Bettor 门②诊断 #cbjvjq): 7/7 imageId 335cae6c→c9918501 那次裁定(#afw8pg)只改了
// imageId, gateTmplHash 没跟着同步更新——半更新残留旧 imageId(335cae6c)配对的锚值, pxvml genesis 因此
// 烤进一个跟当前 guest binary 不匹配的 gateTmplHash, zk_close 的 require(blake2b(prefix‖suffix)==gateTmplHash)
// 物理不可能通过(门②ре-broadcast dry-run 正确拦下, 0 成本; scratch/_bettor_pxvml_gate_tmplhash_diag.mjs
// 独立重算 + 链上已注资 gate 地址逐字节吻合双证)。新值绑定当前 imageId=c9918501, 后续改 imageId 必须同步改这个。
// 🔴 根修(2026-07-09, docs/2026-07-08-gate-tmplhash-live-derive-design.md 落码): gateTmplHash 不再是纯手工
// 配对的孤立常量——gate-tmpl-hash.mjs 的 ensureGateTmplHashFresh() 在 ZK_PROVE_WORKER_ENABLED=1 时会现场
// 从 imageId 程序化推导并跟这里烤死的值比对,漂移直接 fail-loud(调用点: zk-prove-worker.mjs
// zkProveWorkerTick / zk-close-dispatch.mjs rebuildZkCloseGateWitness,详见该文件头注)。此常量本身仍需
// 手动维护(改 imageId 必须同改这个),但下次半更新会在下次真实使用时立刻被抓,不会再潜伏。
export const ZK_GATE = {
  imageId: 'c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30',     // 结算 guest image_id(改 guest=改此=新 covenant)
  gateTmplHash: '4ec7ca3d46db552d87f90636ebefe681f9995249423d52ac30b8c7f258043ac7', // blake2b(prefix‖suffix), 绑定上面这个 imageId(改一个必须同改另一个)
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

// ── 稳定层: journal_hash(外层 sha256·命门字节·2026-07-07 J2/NWT/Bettor 用 3o6cs 真实guest输出定框架)──────────
// journal_hash = sha256(bets_root(32B) ‖ attested_winner(1B) ‖ payout_root(32B))  (RISC0 journal digest·raw sha256非blake2b)
// 🔴 修复(2026-07-07, 之前 betsRoot‖payoutRoot‖winner 顺序错——NWT 用3o6cs真实guest输出核对时发现算不出实
// journal_digest, 拦下命门②误报): 框架从 zk-payout-guest/host/src/main.rs 源码逐字节读出(非凑数字):
// `journal_bytes[0..32]=bets_root`, `journal_bytes[32]=attested_winner`, `journal_bytes[33..65]=payout_root`,
// `journal_digest = risc0_zkvm::sha::Impl::hash_bytes(journal_bytes)`(= 标准 raw sha256, 无 RISC0 envelope/padding)。
// 双证:①源码字节切片顺序 ②用3o6cs真实值(betsRoot=9a92dcd1.../winner=1/payoutRoot=7674d6c2...)算出的sha256跟J1真实
// guest 输出的journal_digest(50c26d35...)逐字节一致。
export function computeJournalHash(betsRootHex, payoutRootHex, attestedWinner) {
  const winnerByte = Buffer.from([attestedWinner & 0xff]);
  const pre = Buffer.concat([Buffer.from(betsRootHex, 'hex'), winnerByte, Buffer.from(payoutRootHex, 'hex')]);
  return createHash('sha256').update(pre).digest('hex');
}

// ── 稳定层: gather-ordered-bets(命门=absorb 序)──────────────────────────────────
// bets_root hash-chain 的 absorb 序 = register_append 序 = 注册序。pool_bettor_sides ORDER BY id ASC = 插入序。
// ⚠ 命门: 链上 bets_root absorb 序 = register_append TX **落链序**。demo 单片顺序注册→DB id 序==落链序;
//   production 必从链上 register 序列(chain_events/kaspa_tx_log)派生·不可只信 DB id(若 TX 乱序落链)。本 demo 用 id 序+下方校验。
// 🔴 W2(J2 2026-07-07·Bettor 钉): 单节点 driver-gather 用本地 id 序尚可(单点无跨节点分叉风险),但committee
//   侧独立重算(bshard-close-enforce.mjs enforceCloseAttestV2)必须用链锚序(否则 5 委员各自不同 DB 插入序 →
//   各自算出不同 betsRoot → 凑不齐签名)——已建 pool-payout-root.mjs canonicalBetOrder(side_lock_daa ASC +
//   side_lock_tx tiebreak)。**W4(relay/prove-path 接线, J1 域)把本函数接进真实 prove 流程时,必须切到调用
//   canonicalBetOrder 而非这里的 id ASC**,不能留两套序并存(Bettor 单一定义单一实现钉子)——本轮(W2/committee
//   域)不动这个函数本体(风险面限定在新增 committee 路径,不碰已有 driver-gather 行为)。
// payout-leaf cap(NWT 攻击#5 第2路·B2·golden-ref depth-10 merkle = 1024 leaf 上限·winners>1024 guest 抛)。
// cheap pre-check(Bettor 授权"现在加"): projected payout-leaves = bettors(winners≤bettors) + fee-leaves reserve。
// 超 → overCap=true → zkCloseTick 不进 prove·直接 escape 退款(bets>0 走 refund_draw·见 §8.B2)。
const ZK_MAX_PAYOUT_LEAVES = 1024;
const ZK_FEE_LEAVES_RESERVE = 8; // broker/oracle/node/intro fee-leaf 上限保守预留(实 4-6)
export function gatherOrderedBets(logicalMarketId) {
  // 🔴 ZK gather = bshard SHARD 的 register_append 押注(covenant bets_root 吸收的就是 shard 押注)。
  // ⚠ 不用 getSidesByLogicalMarket(它聚合 logical market_id 行 + shard 行)——logical market_id 下的行**非 covenant
  //   吸收链**(杂质)。实证 ext-..bh01w(2026-06-28 verify-before-act): logical 下 2 杂质 f5bb64c6(dup-pk·非 shard)
  //   + shard 真押注 2 → getSidesByLogicalMarket 误得 4·而 on-chain bets_root 只 fold shard 2。必只取 shard。
  const shards = sqlite.prepare(
    'SELECT shard_market_id, shard_index FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC',
  ).all(logicalMarketId);
  if (!shards.length) {
    // 无 shard = 非 bshard → ZK-settle 只 fit bshard(设计 scope)→ 非 ZK-eligible·拒(非 0-bet·别误退)。
    return { bets: [], betsRootHex: null, betCount: 0, overCap: false, daaOrderMatchesId: true, notBshard: true };
  }
  if (shards.length > 1) {
    // 多片 rolling shard: per-shard betsRoot → fold(FoldNode→PoolRoot)合并 global = production 路。
    // demo 单片(golden-ref: 单片 betsRoot 直接=global inputs_commit)。多片直接拒(防错算 global·非 0-bet)。
    return { bets: [], betsRootHex: null, betCount: 0, overCap: false, daaOrderMatchesId: true, multiShardTodo: shards.length };
  }
  // 单片: 该 shard 的 register_append 押注·按 id ASC = absorb(append)序(= 链上 continuation-spend 链序·单节点顺序注册)。
  const rows = getSidesByShard(shards[0].shard_market_id, sqlite).sort((a, b) => a.id - b.id);
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

// 读链上 ctor-baked bets_root(CloseZk genesis redeem code-body)。
// ⚠ offset 随 .sil 版本变: J1 17:36 = @280; **J1 18:14 version-prefix fix(expectedSpk 漏 0x0000 2B)后 = @290(PUSH32@289)**。
// 与 attested_winner(state region @53·fix 不变)同一 self-fetch redeem → verify-value-source(链上自取·非 caller-fed)。
// gate_tmpl_hash@231 / verdict_oracle_pk@后(本函数只读 bets_root)。值无关·fixed .sil 新 genesis 同 offset。
const _CZGEN = { BETSROOT_PUSH: 289, BETSROOT_VAL: 290 };
export function readOnChainBetsRootFromGenesis(genesisRedeemHex) {
  if (typeof genesisRedeemHex !== 'string' || !/^[0-9a-fA-F]+$/.test(genesisRedeemHex)) {
    throw new Error('readOnChainBetsRootFromGenesis: redeem 非 hex');
  }
  const r = Buffer.from(genesisRedeemHex, 'hex');
  if (r.length < _CZGEN.BETSROOT_VAL + 32) throw new Error(`CloseZk genesis redeem 太短 len=${r.length} < ${_CZGEN.BETSROOT_VAL + 32}`);
  if (r[_CZGEN.BETSROOT_PUSH] !== 0x20) throw new Error(`CloseZk layout mismatch: bets_root PUSH32@${_CZGEN.BETSROOT_PUSH}=0x${r[_CZGEN.BETSROOT_PUSH].toString(16)}≠0x20`);
  return r.subarray(_CZGEN.BETSROOT_VAL, _CZGEN.BETSROOT_VAL + 32).toString('hex');
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
  // 3. gather ordered bets(链序·只取 shard 押注=covenant 吸收链)+ fold betsRoot。
  const g = gatherOrderedBets(market.id);
  if (g.notBshard) return { abort: '非 bshard market(无 shard)→ ZK-settle 只 fit bshard·不处理' };
  if (g.multiShardTodo) return { abort: `多片 market(${g.multiShardTodo} shards)→ per-shard fold production 路·demo 单片·不处理` };
  if (g.betCount === 0) return ctx.escapeRefund(market, '0-bet ZK market → refund_maker_unjoined(B2)');
  // 4. B2 escape pre-prove: bets 投影超 1024 payout-leaf cap → 禁 prove·refund_draw。
  if (g.overCap) return ctx.escapeRefund(market, `bets>1024 cap(count=${g.betCount})→refund_draw(B2)`);
  // 5. C1 predict-then-verify: 我 fold betsRoot == 链上 ctor-baked bets_root 才放行(序错立抓·prove 前廉价守门)。
  //    on-chain bets_root 从同一 self-fetch redeem code-body 直接 byte-decode(redeem[280:312])·verify-value-source。
  const onChainBetsRoot = readOnChainBetsRootFromGenesis(cont.redeemHex);
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
