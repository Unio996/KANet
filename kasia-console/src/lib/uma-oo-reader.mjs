// uma-oo-reader.mjs — 线2 UMA Optimistic Oracle (Polygon) on-chain reader: interface + deterministic mock.
// J1 slice-1 (2026-06-28, Bettor GREENLIGHT). Real ethers/Polygon adapter (J1-E multi-RPC + 区块头验) = slice-2.
//
// 读源铁律 (Bettor 命门): 源 = UMA-on-Polygon **on-chain bonded** Optimistic Oracle, **NOT Gamma-API**.
//   gamma = 市场自己价格/共识 = 用市场判市场自己 = 隐性循环 (#50 硬-NO). UMA OO bonded = 独立去中心 oracle
//   (proposer bond + dispute window + DVM token-holder vote) ≠ 市场价格 → 合法独立 ground truth. Polymarket
//   本由 UMA OO 裁决 → 对 mirror 市场, UMA OO 就是该问题的 resolver (设计如此, 非循环).
//
// finality (J1-A / NWT GAP-A): 只消费 **DVM-settled (终局)** 的 resolution; proposed/dispute-window-内 = 未终局
//   → settled=false → 上层 extractor finality gate ABSTAIN (禁 proposed = funds-safe).
// determinism (J1-B / NWT GAP-C): resolution 必读在 **固定 block** (block-anchored, 跨委员 byte-equal). mock 用
//   settled_block 模拟"只在 settle block 起可见"; 真模式 (slice-2) 用 ethers provider.call({ blockTag }).

// UMA YES_OR_NO_QUERY settled-value convention (frozen — NWT GAP-B value-mapping 在 extractor 烤死).
// UMA OO binary 问题 settle 到一个 numeric value: 1e18=YES, 0=NO, 0.5e18=50-50/indeterminate.
export const UMA_YES = 1000000000000000000n;          // 1e18
export const UMA_NO = 0n;
export const UMA_INDETERMINATE = 500000000000000000n; // 0.5e18

/**
 * OoResolution shape (reader 返回, extractor 吃):
 *   { value: BigInt|null, settled: boolean, settled_block: number|null, ancillary_id: string }
 *   settled=false → 未终局 (proposed/disputed/未到 block) → extractor finality gate → ABSTAIN.
 *   settled=true  → bonded DVM-final → consumable.
 *
 * makeMockOoReader — 确定性 mock OO reader (slice-1). 给 fixtures, 返一个 { readOoResolution } reader。
 *   block-anchored: resolution 只在 atBlock >= settled_block 时可见 (模拟链上"settle block 起才有值")。
 * @param {Map<string, {value: BigInt, settled: boolean, settled_block: number}>} fixtures
 */
export function makeMockOoReader(fixtures) {
  return {
    readOoResolution(ancillaryId, atBlock) {
      const f = fixtures.get(ancillaryId);
      const miss = { value: null, settled: false, settled_block: null, ancillary_id: ancillaryId };
      if (!f) return miss;
      // 错绑/未知 ancillary_id → miss → ABSTAIN (J1-C ancillary_data 绑定: 错绑不猜).
      // block-anchored finality: 读在 settle block 之前 = 还没终局 → 未 settled.
      if (atBlock != null && f.settled_block != null && Number(atBlock) < Number(f.settled_block)) {
        return miss;
      }
      return { value: f.value, settled: !!f.settled, settled_block: f.settled_block ?? null, ancillary_id: ancillaryId };
    },
  };
}

// ── slice-2 (J1, 2026-06-30, Bettor GREENLIGHT mainnet read-only) ─────────────────────────────────
// 真读路径 (查码定·非 OO-V3-bool): Polymarket 市场结果 = **UmaCtfAdapter.getExpectedPayouts(questionId)**
//   → uint256[2] [YES,NO]: [1,0]=YES / [0,1]=NO / [1,1]=50-50/UNKNOWN→ABSTAIN. (OO V3 getAssertion 返
//   settlementResolution=bool 是"断言是否成立"·非 YES/NO·对二元市场不够 → 读 adapter 的 resolved payouts 才是真结果.)
//   verified: UmaCtfAdapter v3.0 @ 0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49 (Polygon mainnet, chain 137).
//   ancillaryId 参 = questionId (bytes32 hex; = keccak256(appendAncillaryData(adapterCreator, ancillaryData))).
//   ⚠ ingestion 前置 (J2 实证 uma_assertion_id 现空): condition_id_mapping 须先 populate 该 questionId — 另起 slice.
//
// 红队 5 轴 (J1):
//   - finality (A): 只消费 definitive [1,0]/[0,1]; [1,1]/revert/未 resolved → ABSTAIN (settled=false).
//     ★ 硬化 TODO: 加 questions(questionId).resolved==true 双确认 (现 fail-closed: 非 definitive payout 即不消费).
//     finality 基线 = 读在【已 final 的 Polygon block】(atBlock 选在市场预期 resolve + UMA dispute 窗之后) + definitive payout.
//   - determinism (B): 全 RPC 读【同一 atBlock】(blockTag); 任一 RPC 值不一致 → settled=false (不信单源).
//   - ancillary (C): 按 questionId 读, 错 id → adapter 返非 definitive / revert → ABSTAIN (reader + extractor 双守).
//   - value-mapping: payouts→{UMA_YES/UMA_NO/UMA_INDETERMINATE} (喂 slice-1 extractor 不变; 冻结映射).
//   - RPC-trust (E): rpcs 多源并读 cross-check (公共+provider). 单 RPC 撒谎 → 与他源不符 → 不信.

const _UMA_CTF_ADAPTER_MAINNET = '0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49'; // Polygon v3.0 (WebFetch-verified)
const _ADAPTER_ABI = [
  'function getExpectedPayouts(bytes32 questionID) view returns (uint256[])',
];

// payouts [YES,NO] → reader value (slice-1 extractor 数值约定). null = 非 definitive (未 resolved / 50-50 / 异常) → ABSTAIN.
function _payoutsToValue(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const yes = BigInt(p[0]), no = BigInt(p[1]);
  if (yes === 1n && no === 0n) return UMA_YES;
  if (yes === 0n && no === 1n) return UMA_NO;
  if (yes === 1n && no === 1n) return UMA_INDETERMINATE; // 50-50/unknown → extractor ABSTAIN
  return null;                                            // 异常/未 resolved → ABSTAIN (abstain-not-guess)
}

/**
 * makeRpcOoReader — 真 ethers + Polygon mainnet multi-RPC, 读 UmaCtfAdapter.getExpectedPayouts.
 * @param {{ rpcs: string[], adapterAddress?: string }} o  rpcs = Polygon RPC URL 数组 (≥2 防单点); adapterAddress 默认 mainnet v3.0.
 * 返 { readOoResolution(questionId, atBlock) → OoResolution }. atBlock 必传 (determinism 锚, 各委员同 block).
 */
export function makeRpcOoReader({ rpcs, adapterAddress = _UMA_CTF_ADAPTER_MAINNET } = {}) {
  if (!Array.isArray(rpcs) || rpcs.length === 0) throw new Error('makeRpcOoReader: rpcs (Polygon RPC URL[]) required');
  return {
    async readOoResolution(questionId, atBlock) {
      const miss = { value: null, settled: false, settled_block: null, ancillary_id: questionId };
      if (!questionId || atBlock == null) return miss; // determinism: 无 block 锚 → 不读 (各委员须同 block)
      const { ethers } = await import('ethers');
      const blockTag = Number(atBlock);
      // multi-RPC cross-check (RPC-trust 轴): 每 RPC 读同 questionId@同 blockTag.
      const reads = await Promise.all(rpcs.map(async (url) => {
        try {
          const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });
          const adapter = new ethers.Contract(adapterAddress, _ADAPTER_ABI, provider);
          const payouts = await adapter.getExpectedPayouts(questionId, { blockTag }); // revert(未resolved) → catch
          return _payoutsToValue(payouts.map((x) => BigInt(x)));
        } catch { return null; } // revert / RPC fail → 该源 null (finality: 未 resolved 即 ABSTAIN)
      }));
      // finality + RPC-trust: 须【所有源都成功且同值且 definitive(非 null)】才消费; 任一不符 → ABSTAIN (fail-closed).
      const first = reads[0];
      const allAgree = first !== null && reads.every((r) => r === first);
      if (!allAgree) return miss;
      return { value: first, settled: true, settled_block: blockTag, ancillary_id: questionId };
    },
  };
}
