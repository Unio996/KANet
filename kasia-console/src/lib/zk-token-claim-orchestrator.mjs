// zk-token-claim-orchestrator.mjs — 账本 1832 段4: claim 家族(CloseZkV2.claim / CloseZkV2.escape_claim / PayoutShardV2.refund_claim)的 console 侧三阶段编排。
//   relay 构造器(kasia-relay/src/lib/p2sh.mjs _unlockClaimFamily)需要 console 预先算出: ① 池代币 UTXO(owner=self cov) ② KanetTokenClaim 实例 redeem ③ 两枚新 KTT 实例 redeem
//   (tokOut: owner=新 claim 的 covenant id —— 由 relay 的 genesis 组现算, 所以要【先 probe 再回传】; remain: owner=self cov)。
//   阶段A: 只给 self UTXO ⇒ relay 回 selfCovId     阶段B: 加 claim_out ⇒ relay 回 claimCovId     阶段C: 全给 ⇒ 核 owner 后签发。
//   纯编排: 不改任何链上语义; 状态/金额/merkle 证明由调用方(tick/driver)按现读值给出, relay 仍以活 redeem 现读并交叉核对。
import { computeKttTokenArtifact, computeKanetTokenClaimArtifact } from './pool-bshard-artifacts.mjs';
import { settleDispatchTags } from './pool-shard-register.mjs';

// 🔴 KIP-9 存储质量: 5 个输出各 0.2 KAS 时节点实测 storage mass 659134 > 上限 500000(simnet 官方 2.0.1)——新建输出面值必须抬高(质量≈C/面值 逐输出累加)。
// 每个新建输出(claimOut/tokOut/remainTok)取 CLAIM_OUT_VALUE_SOMPI; fee 输入需覆盖 3×该值 + 网络费 − (self+池代币 UTXO 面值), 由 claimFeeInputSompi() 给出。
// 🔴 账本1850 严格零方案: 默认 1.0 → 0.5 KAS。KIP-9 精确公式(rusty-kaspa mass/mod.rs calc_storage_mass; C=1e12, 覆盖 UTXO plurality=2)对 claim 家族非末位交易:
//   0.30 KAS ⇒ 497,620(硬下限, 卡 500k 共识上限); 0.45 ⇒ 385,295; 0.50 ⇒ 364,076(留 27% 余量, 采用); 1.00 ⇒ 277,146(旧值, 与链上实测一致)。证据: docs/provenance/2026-10-05-j2-strict-zero/floor_calc.mjs。
// 这些 KAS 永久进 sink(retire 或 claim 之后无人能取回), 面值越低网关净锁越少。
export const CLAIM_OUT_VALUE_SOMPI = Number(process.env.ZK_CLAIM_OUT_VALUE_SOMPI || 50_000_000);
export const CLAIM_NET_FEE_SOMPI = 40_000_000;
export function claimFeeInputSompi() { return 3 * CLAIM_OUT_VALUE_SOMPI + CLAIM_NET_FEE_SOMPI + 20_000_000; }   // +20M 余量(self/池代币 UTXO 面值另计入 Σin, 此为保守上界)

export const CLAIM_FAMILY = {
  claim:        { cmdType: 'closezk_v2_claim',        tagKey: 'closezk_claim',        expectClosed: 2, selfKey: 'closezk' },
  escape_claim: { cmdType: 'closezk_v2_escape_claim', tagKey: 'closezk_escape_claim', expectClosed: 3, selfKey: 'closezk' },
  refund_claim: { cmdType: 'bshard_refund_claim_v2',  tagKey: 'ps_refund_claim',      expectClosed: 2, selfKey: 'ps' },
};

/**
 * @param {object} o
 * @param {'claim'|'escape_claim'|'refund_claim'} o.kind
 * @param {{redeemHex:string, txid:string, index:number}} o.self   当前活 self UTXO(CloseZkV2 或 PayoutShardV2)
 * @param {string|bigint|number} o.pool     self 当前 consolidated_pool(代币单位, 调用方从活 redeem 现读)
 * @param {string} o.bettorPk               32B hex(x-only)
 * @param {string|bigint|number} o.amount   本次领取量(代币单位)
 * @param {number} o.merkleIndex
 * @param {string[]} o.siblingsHex          恰 10 个
 * @param {{address:string, txid:string, index:number}} o.fee   独立 P2PK fee 输入(≥ ~0.8 KAS: 3 个新 genesis 输出各 0.2 KAS + 网络费)
 * @param {(cmd:object)=>Promise<object>} o.relayCall
 * @param {(redeemHex:string)=>string|Promise<string>} o.p2sh   redeem → P2SH 地址
 * @param {string} o.tokenTmplHash          ZK_TOKEN_TMPL_HASH(32B hex)
 * @param {string} o.claimTmplHash          ZK_CLAIM_TMPL_HASH(32B hex)——KanetTokenClaim 模板 hash 必须与之相等(fail-loud)
 * @param {boolean} [o.dryRun]              true ⇒ 阶段C 带 dry_run(返回逐输入/输出真实字节, 不广播)
 * @param {(cmd:object)=>void} [o.mutateFinal]  仅测试/负向用: 阶段C 发出前改 cmd
 * @param {number} [o.lockTime]             ms-epoch(escape 类需要; claim/refund 不需要)
 * @returns {Promise<object>} relay 阶段C 响应(txId/claimCovId/selfContRedeemHex/isLast/…)
 */
export async function runTokenClaim(o) {
  const fam = CLAIM_FAMILY[o.kind];
  if (!fam) throw new Error(`runTokenClaim: 未知 kind ${o.kind}`);
  const tags = settleDispatchTags();
  const rc = o.relayCall;
  const getUtxos = async (addr) => (await rc({ type: 'get_address_utxos', address: addr }))?.utxos || [];
  const base = { type: fam.cmdType, inputs: { self: { redeem_hex: o.self.redeemHex, outpointTxid: o.self.txid, index: o.self.index } }, witness: {}, outputs: {} };   // relay 命令校验要求 witness/inputs/outputs 三字段都在
  if (o.lockTime) base.lock_time = o.lockTime;

  // 阶段A: selfCovId
  const a = await rc({ ...base });
  if (a?.probe !== 'A' || !a.selfCovId) throw new Error(`runTokenClaim: 阶段A 未返回 selfCovId: ${JSON.stringify(a).slice(0, 200)}`);
  const selfCovId = a.selfCovId;
  const pool = BigInt(o.pool), amount = BigInt(o.amount);
  if (amount < 1n || amount > pool) throw new Error(`runTokenClaim: amount ${amount} 不在 [1, pool=${pool}]`);

  // 池代币 UTXO(确定性地址: amount+owner 唯一确定; 必须恰 1 笔)
  const poolTokArt = computeKttTokenArtifact({ amount: Number(pool), ownerCovIdHex: selfCovId });
  const tokUtxos = await getUtxos(await o.p2sh(poolTokArt.script.toString('hex')));
  if (tokUtxos.length !== 1) throw new Error(`runTokenClaim: 池代币地址上有 ${tokUtxos.length} 笔 UTXO(期望恰 1; amount=${pool}, owner=self cov ${selfCovId.slice(0, 12)}) — 不猜 (fail-closed)`);
  const selfToken = { redeem_hex: poolTokArt.script.toString('hex'), outpointTxid: tokUtxos[0].outpoint.transactionId, index: Number(tokUtxos[0].outpoint.index || 0) };

  // KanetTokenClaim 实例 + 模板 hash 核对
  const claimArt = computeKanetTokenClaimArtifact({ marketCovIdHex: selfCovId, winnerPkHex: o.bettorPk, amount, tokenTmplHashHex: o.tokenTmplHash });
  if (claimArt.templateHashHex.toLowerCase() !== String(o.claimTmplHash).toLowerCase()) {
    throw new Error(`runTokenClaim: KanetTokenClaim 模板 hash ${claimArt.templateHashHex} != claim_tmpl_hash ${o.claimTmplHash} (env/DB 与当前合约不一致, fail-loud)`);
  }
  const fee = { address: o.fee.address, outpointTxid: o.fee.txid, index: o.fee.index };
  const withIn = { ...base, out_value_sompi: CLAIM_OUT_VALUE_SOMPI, fee_sompi: CLAIM_NET_FEE_SOMPI, inputs: { ...base.inputs, self_token: selfToken, fee } };

  // 阶段B: claimCovId
  const b = await rc({ ...withIn, outputs: { claim_out: { redeem_hex: claimArt.script.toString('hex') }, change_address: o.fee.address }, witness: { amount: amount.toString(), merkle_index: o.merkleIndex, siblings_hex: o.siblingsHex } });
  if (b?.probe !== 'B' || !b.claimCovId) throw new Error(`runTokenClaim: 阶段B 未返回 claimCovId: ${JSON.stringify(b).slice(0, 200)}`);

  // 阶段C
  const ktt = computeKttTokenArtifact({ amount: Number(amount), ownerCovIdHex: b.claimCovId });
  const isLast = pool === amount;
  const outputs = { claim_out: { redeem_hex: claimArt.script.toString('hex') }, tok_out: { redeem_hex: ktt.script.toString('hex'), owner_cov_id_hex: b.claimCovId }, change_address: o.fee.address };
  if (!isLast) {
    const remain = computeKttTokenArtifact({ amount: Number(pool - amount), ownerCovIdHex: selfCovId });
    outputs.remain_tok_out = { redeem_hex: remain.script.toString('hex'), owner_cov_id_hex: selfCovId };
  }
  const final = {
    ...withIn, outputs,
    witness: {
      bettor_pk: o.bettorPk, amount: amount.toString(), merkle_index: o.merkleIndex, siblings_hex: o.siblingsHex,
      tok_prefix_hex: ktt.templatePrefix.toString('hex'), tok_suffix_hex: ktt.templateSuffix.toString('hex'),
      claim_prefix_hex: claimArt.templatePrefix.toString('hex'), claim_suffix_hex: claimArt.templateSuffix.toString('hex'),
      dispatch_tag_hex: tags[fam.tagKey],
      token_transfer_dispatch_tag_hex: ktt.entryAbi.dispatch_tag, token_transfer_state_field_count: ktt.stateFieldCount,
    },
  };
  if (o.dryRun) final.dry_run = true;
  if (o.mutateFinal) o.mutateFinal(final);
  const r = await rc(final);
  return { ...r, witnessUsed: final.witness, selfCovId, poolTokenOutpoint: `${selfToken.outpointTxid}:${selfToken.index}`, claimTemplateHash: claimArt.templateHashHex };
}
