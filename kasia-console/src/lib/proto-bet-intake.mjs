// proto-bet-intake.mjs — oracle 整合批 D §6: 下注【受理点】的 outcome_end 门(D6 + N3 + N4)的 DB 装配(db / readPmt 由调用方注入)。
// 门放在 HTTP bet 路由的受理时刻, 不放在驱动对已受理注的 append(N4: 否则 outcome_end 前已受理未上链的注永上不了链 → 永不 seal → 只能退款)。
// 判定题的定义取自批 A 的唯一来源(db/proto-judged.mjs, N3 不另写一份); 无判定题(operator 市场)豁免且【不读 pmt】。所有拒绝都发生在任何 DB 写 / 广播 IPC 之前。
import { JUDGED_COLUMNS } from '../db/proto-judged.mjs';
import { intakeNeedsPmt, evaluateBetIntakeGate } from './proto-settlement-budget.mjs';
import { judgedMarketAllowedHere } from './proto-oracle-policy.mjs';
import { checkSideLabel } from './proto-oracle-spec.mjs';
import { isJudgedMarket } from '../db/proto-judged.mjs';

/**
 * @param {{db: object, marketId: string, readPmt: () => Promise<{valid:boolean, pmtMs?:number, reason?:string}>, nowMs?: () => number}} o
 * @returns {Promise<{accept: boolean, code?: string, http?: number, detail?: string}>}
 *   readPmt 只在【判定题 ∧ outcome_end 有限 ∧ 墙钟尚未过 outcome_end】时才被调用; 它抛错 ⇒ 按 pmt 无效(fail-closed)。
 */
export async function checkBetIntake({ db, marketId, readPmt, nowMs = Date.now, network, env = process.env, betRequest }) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('checkBetIntake: db 必填');
  if (typeof readPmt !== 'function') throw new TypeError('checkBetIntake: readPmt 必填');
  const row = db.prepare(`SELECT ${JUDGED_COLUMNS.join(', ')}, outcome_end_ms, token_def_id FROM proto_markets WHERE id = ?`).get(marketId);
  if (!row) return { accept: false, code: 'market_not_found', http: 404, detail: 'market not found' };
  if (isJudgedMarket(row)) {
    // B5 三处强制谓词之②(纵深): 主网 + 非零价值白名单代币的判定题市场一律拒受理(创建入口已拒, 这里防直接写库 / 旧数据)。network 缺省取配置(未配 ⇒ fail-closed 拒)。
    let net = network; if (net === undefined) { try { net = (await import('../../../shared/lib/kaspa-network.mjs')).configuredNetwork(); } catch { net = null; } }
    const allowed = judgedMarketAllowedHere({ network: net, tokenDefId: row.token_def_id, env });
    if (!allowed.allowed) return { accept: false, code: 'judged_market_not_allowed_here', http: 403, detail: allowed.reason };
    // 缺 outcome_end ⇒ 先于 side_label 与 pmt(N3)
    if (!(typeof row.outcome_end_ms === 'number' && Number.isFinite(row.outcome_end_ms))) return evaluateBetIntakeGate({ market: row, pmt: null });
    // C1: 判定题下注必带 side_label, 与 side_map 换算不一致 ⇒ 400(在读 pmt 之前, 坏请求不占 IPC)
    // 判定题【必须】过 side_label 校验: 调用方没传 betRequest 也按"缺 side_label"拒(fail-closed; 不留 `if (betRequest)` 绕过口, 将来第二个调用方漏传也不会放行)
    const br = betRequest && typeof betRequest === 'object' ? betRequest : {};
    const sl = checkSideLabel({ specRaw: row.resolution_rule_spec, direction: br.direction, sideLabel: br.sideLabel }); if (!sl.ok) return { accept: false, code: sl.code, http: sl.http, detail: sl.detail };
  }
  const wallMs = nowMs();                       // M2: 门取 max(墙钟, pmt); 墙钟已过 outcome_end 时不必再读 pmt
  let pmt = null;
  if (intakeNeedsPmt(row, wallMs)) {
    try { pmt = await readPmt(); }
    catch (e) { pmt = { valid: false, reason: `read_pmt_threw: ${e && e.message ? e.message : e}` }; }
  }
  return evaluateBetIntakeGate({ market: row, pmt, wallMs });
}
