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

// 🔴 B线深化件2 冲突守卫(Bettor 裁, uw8rd 事故坐实#hkpp9r.2·"第三方同款陷阱"): zk_native 缺省=true
// (pool.js L1081-1091, Owner"ZK走到底")与 fee_rules 路径(仅非 zk_native 生效)天然互斥——caller 传了
// introducer_pk(fee_rules 路径专属意图信号, 无其它消费者)却让 zk_native 解析为 true, 此前【静默吞掉
// introducer_pk】建出 fee_rules=NULL 的盘(J2 广播 uw8rd 100KAS 真锁后才发现, DoD 全废)。
//
/**
 * checkIntroducerZkNativeConflict — create-v07 建单前冲突检测(纯函数, 零 HTTP/chain, 可离线单测——
 * Bettor 裁"守卫负例去 test-framework 离线跑, 不许再打 live 钱路端点")。
 * @param {{introducerPkGiven:boolean, zkNative:boolean}} o
 * @returns {{conflict:boolean, reason?:string}}
 */
export function checkIntroducerZkNativeConflict({ introducerPkGiven, zkNative }) {
  if (introducerPkGiven && zkNative === true) {
    return {
      conflict: true,
      reason: `冲突: introducer_pk 已传但 resolution_rule_spec.zk_native=true(fee_rules 路径需 zk_native:false, 否则 introducer_pk 会被静默丢弃建出 fee_rules=NULL 的盘)——显式传 zk_native:false 走 fee_rules 路径, 或去掉 introducer_pk 走 ZK-native 路径`,
    };
  }
  return { conflict: false };
}
