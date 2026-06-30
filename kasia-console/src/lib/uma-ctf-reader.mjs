// uma-ctf-reader.mjs — 线2 UMA judge production reader: read Polymarket ConditionalTokens (CTF) resolution
//   by conditionId. J1 slice-3 (2026-06-30, Owner 钦定 UMA 接上 + Bettor ACK CTF 统一读).
//
// 🔑 为何读 CTF(非 OO/adapter 直读): 标准(UmaCtfAdapter)和 neg-risk(NegRiskAdapter)两类 adapter 都把最终判定
//   `ctf.reportPayouts(questionId, payouts)` 写进【同一个 ConditionalTokens(CTF)】→ 读 CTF.payoutNumerators/
//   payoutDenominator(conditionId) **统一覆盖所有市场类型·无需多-adapter 路由/无需 questionId ingestion**(直接用
//   我们已有的 conditionId = pool_markets.outcome_condition_id 66-char 0x bytes32·三源 verify-value-source 实证)。
//   CTF payouts = adapter 从 UMA OO bonded resolution 写入 = 链上 bonded 判定(非 gamma 中心化 price·守 Bettor 源铁律 #50).
//   live-object 验过(2026-06-30·真 resolved 盘 neg-risk+standard 两类 CTF==gamma-outcome 对死·polygon-bor-rpc.publicnode.com).
//
// 红队轴(继承 OO reader): finality(payoutDenominator>0 才认·==0→ABSTAIN·fail-closed) / determinism(固定 atBlock blockTag·
//   跨委员同读·payouts resolved 后不可变=天然确定) / value-mapping([1,0]=YES/[0,1]=NO/[1,1]/异常=ABSTAIN·冻结) /
//   RPC-trust(multi-RPC cross-check·全源同值才认·单源不信) / ancillary(按 conditionId 读·错 id→未 resolved/异常→ABSTAIN).

import { createHash } from 'node:crypto';

const _CTF_POLYGON = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';  // Polymarket ConditionalTokens (Polygon mainnet·live-verified)
const _CTF_ABI = [
  'function payoutDenominator(bytes32) view returns (uint256)',
  'function payoutNumerators(bytes32, uint256) view returns (uint256)',
];

export const CTF_ABSTAIN = 'ABSTAIN';
export const __CTF_EVIDENCE_FIELDS__ = ['resolved_outcome', 'num_yes', 'num_no', 'condition_id'];

// value-mapping (冻结·NWT GAP-B 同精神): CTF binary payouts [yes,no] → 'YES'|'NO'|ABSTAIN. 任何意外组合→ABSTAIN(abstain-not-guess).
function _payoutsToOutcome(yes, no) {
  if (yes === 1n && no === 0n) return 'YES';
  if (yes === 0n && no === 1n) return 'NO';
  return CTF_ABSTAIN;                                   // [1,1] 50/50 / [0,0] / 异常 → 弃权不猜
}

// determinism 源轴: field_hash = sha256(固定 4 字段 canonical) 跨委员 byte-equal (复用 OO extractor 模式).
function _ctfFieldHash(fields) {
  return createHash('sha256').update(JSON.stringify([
    ['resolved_outcome', fields.resolved_outcome],
    ['num_yes', fields.num_yes], ['num_no', fields.num_no], ['condition_id', fields.condition_id],
  ])).digest('hex');
}

/**
 * makeCtfReader — 真 ethers + Polygon multi-RPC·读 CTF.payout* by conditionId.
 * @param {{ rpcs: string[], ctfAddress?: string }} o  rpcs = Polygon RPC URL[](≥2 防单点·RPC-trust); ctfAddress 默认 Polymarket CTF.
 * 返 { readResolution(conditionId, atBlock?) → { final:'YES'|'NO'|'ABSTAIN', fields:object|null, field_hash:string|null } }.
 *   atBlock 可选(determinism 锚·各委员同 Polygon block; 省略=latest·resolved payouts 不可变故 latest 亦稳).
 */
export function makeCtfReader({ rpcs, ctfAddress = _CTF_POLYGON } = {}) {
  if (!Array.isArray(rpcs) || rpcs.length < 2) throw new Error('makeCtfReader: rpcs needs ≥2 Polygon RPC URLs (single-source 无 cross-check)');
  return {
    async readResolution(conditionId, atBlock = null) {
      const abstain = { final: CTF_ABSTAIN, fields: null, field_hash: null };
      if (!conditionId || !/^0x[0-9a-fA-F]{64}$/.test(conditionId)) return abstain;  // 错/缺 conditionId → ABSTAIN
      const { ethers } = await import('ethers');
      const overrides = atBlock != null ? { blockTag: Number(atBlock) } : {};
      // multi-RPC cross-check (RPC-trust): 每 RPC 读同 conditionId@同 block.
      const reads = await Promise.all(rpcs.map(async (url) => {
        try {
          const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });
          const ctf = new ethers.Contract(ctfAddress, _CTF_ABI, provider);
          const den = BigInt(await ctf.payoutDenominator(conditionId, overrides));
          if (den === 0n) return { resolved: false, outcome: CTF_ABSTAIN };           // finality: 未 resolved → ABSTAIN
          const yes = BigInt(await ctf.payoutNumerators(conditionId, 0, overrides));
          const no = BigInt(await ctf.payoutNumerators(conditionId, 1, overrides));
          return { resolved: true, outcome: _payoutsToOutcome(yes, no), yes: yes.toString(), no: no.toString() };
        } catch { return null; }                                                       // RPC fail → null (fail-closed)
      }));
      // finality + RPC-trust: 须【≥2 成功源 + 所有成功源同 resolved 且同 outcome 且 definitive(YES/NO 非 ABSTAIN)】才认.
      //   容忍部分 RPC down(filter null·单 RPC 宕不堵结算)·但 <2 成功源 → ABSTAIN(无 cross-check 不信单源)·成功源分歧 → ABSTAIN(有源说谎/stale).
      const ok = reads.filter(Boolean);
      if (ok.length < 2) return abstain;
      const first = ok[0];
      const agree = ok.every((r) => r.resolved === first.resolved && r.outcome === first.outcome);
      if (!agree || !first.resolved || first.outcome === CTF_ABSTAIN) return abstain;
      const fields = { resolved_outcome: first.outcome, num_yes: first.yes, num_no: first.no, condition_id: conditionId };
      return { final: first.outcome, fields, field_hash: _ctfFieldHash(fields) };
    },
  };
}
