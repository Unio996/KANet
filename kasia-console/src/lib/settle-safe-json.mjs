// settle-safe-json.mjs — sign_input_for_settle 的 tx_obj → safe_json 单源转换 (2026-07-18 J1tn 提取)
//
// 来源: c8188d98 (2026-06-28 J1/NWT/J2 co-diagnose 8h, jepu1 verify-failed 根因修复) 在
// bettor-prediction-voter.js 内新增的 toSettleSafeJsonTxHex——本次(jepu1 重签设计
// docs/2026-07-18-jepu1-stale-sig-resign-design.md 步1)发现 trade-protocol-filter.js 的
// handlePoolOracleTxSignReq 第三签名站点漏修, 按 ANTI-PATTERNS 规则 64(修并行实现必枚举全部拷贝+单源)
// 把 helper 提到本文件, 三个站点共用同一份, 不再各持拷贝。函数体与 c8188d98 版逐字节一致(纯搬迁零改动)。
//
// 根因回顾(c8188d98 commit message): relay sign_input_for_settle 默认路用
// `new Transaction(JSON.parse(plain))` 重建 tx 给 createInputSignature → 新 kaspa-wasm 下 plain-object
// scriptPublicKey 不被正确注入 sighash → 委员算的 sighash ≠ 节点 checkSig 算的 → validSigs<4 →
// settle "script ran, verification failed"。修法 = 发 sign 命令前无条件转 safe_json
// (serializeToSafeJSON·spk 以 flat-hex 全保) + safe_json:true → relay 走 deserializeFromSafeJSON 路
// (bshard proven·relay.mjs L647; bshard-close-voter.js:376/:497 同款硬编码常态)。
// ⚠ bigint rehydration 必须和 relay.mjs L646-666 完全一致(否则 serialize 出的 safeJson 与 relay live 路不符)。

export async function toSettleSafeJsonTxHex(txObj) {
  const { Transaction } = await import('kaspa-wasm');
  const parsed = JSON.parse(JSON.stringify(txObj)); // deep copy — 不污染 metadata 里的 plain phase2_tx_obj
  parsed.lockTime = BigInt(parsed.lockTime || 0);
  parsed.gas = BigInt(parsed.gas || 0);
  if (Array.isArray(parsed.inputs)) {
    parsed.inputs = parsed.inputs.map(i => ({
      ...i,
      sequence: BigInt(i.sequence || 0),
      sigOpCount: Number(i.sigOpCount || 0),
      utxo: i.utxo ? {
        ...i.utxo,
        amount: BigInt(i.utxo.amount || 0),
        blockDaaScore: BigInt(i.utxo.blockDaaScore || 0),
      } : undefined,
    }));
  }
  if (Array.isArray(parsed.outputs)) {
    parsed.outputs = parsed.outputs.map(o => ({ ...o, value: BigInt(o.value || 0) }));
  }
  return new Transaction(parsed).serializeToSafeJSON();
}
