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

// makeRpcOoReader (slice-2 STUB) — 真 ethers + Polygon/Amoy RPC → OptimisticOracleV2/V3 + DVM。
//   契约同 mock: readOoResolution(ancillaryId, atBlock) → OoResolution。slice-2 实现:
//   - multi-RPC cross-check + 区块头验 (J1-E): 多 RPC 读同 blockTag, 值不一致/区块头不一致 → settled=false (不信).
//   - finality: 查 OO request state == Settled (非 Proposed/Disputed) + dispute window 过 + 保守 margin.
//   现 slice-1: throw (未实现, 防误用真路径).
export function makeRpcOoReader(/* { rpcs, ooAddress, dvmAddress } */) {
  return {
    readOoResolution() {
      throw new Error('uma-oo-reader: RPC reader is slice-2 (ethers + multi-RPC + 区块头验); slice-1 mock-only');
    },
  };
}
