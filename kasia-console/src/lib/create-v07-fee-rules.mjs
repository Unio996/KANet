// create-v07-fee-rules.mjs — create-v07 端点专用 fee_rules 构造 glue(B线深化件2, Bettor 裁"(a)接通不新造"
// #hkgnxl.2)。此前 pool.js create-v07 硬编码只喂 brokerPk 一路给 buildPredictionV1InterimRules(该函数
// 组件层早已支持 introducerPk, 端点没接 caller 供的 introducer_pk 字段——"第三方可用"在入口处断头)。
//
// 边界(不进 packages/fee-split): 本文件是 KANet HTTP 请求体字段名(introducer_pk 原始 caller 输入)到
// 组件调用的适配层, 非通用第三方原语——留在 kasia-console 本地, 不污染 packages/fee-split 的零依赖边界
// (R-FEE-SPLIT-PKG-DRIFT 同步护栏只守组件本体, 此文件不必/不该同步)。
import { buildPredictionV1InterimRules } from './fee-split.mjs';

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * buildFeeRulesForCreateRequest — create-v07 请求体 → fee_rules JSON 构造单源入口。
 * @param {{brokerPk:string, introducerPkRaw?:string|null|undefined}} o introducerPkRaw = 请求体原始值
 *   (undefined/null/'' 视为缺席 → byte-equal 于此前只传 brokerPk 的旧调用; 非空必须 64-hex, 否则 fail-loud)
 * @returns {object} buildPredictionV1InterimRules 产出(已过 validateFeeRules)
 */
export function buildFeeRulesForCreateRequest({ brokerPk, introducerPkRaw }) {
  const provided = !(introducerPkRaw === undefined || introducerPkRaw === null || introducerPkRaw === '');
  if (provided && !HEX64.test(String(introducerPkRaw))) {
    throw new Error(`introducer_pk must be 64-hex x-only pubkey, got '${String(introducerPkRaw).slice(0, 20)}'`);
  }
  return buildPredictionV1InterimRules({ brokerPk, introducerPk: provided ? introducerPkRaw : null });
}
