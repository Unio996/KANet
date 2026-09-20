// proto-bet-intake.mjs — oracle 整合批 D §6: 下注【受理点】的 outcome_end 门(D6 + N3 + N4)的 DB 装配(db / readPmt 由调用方注入)。
// 门放在 HTTP bet 路由的受理时刻, 不放在驱动对已受理注的 append(N4: 否则 outcome_end 前已受理未上链的注永上不了链 → 永不 seal → 只能退款)。
// 判定题的定义取自批 A 的唯一来源(db/proto-judged.mjs, N3 不另写一份); 无判定题(operator 市场)豁免且【不读 pmt】。所有拒绝都发生在任何 DB 写 / 广播 IPC 之前。
import { JUDGED_COLUMNS } from '../db/proto-judged.mjs';
import { intakeNeedsPmt, evaluateBetIntakeGate } from './proto-settlement-budget.mjs';

/**
 * @param {{db: object, marketId: string, readPmt: () => Promise<{valid:boolean, pmtMs?:number, reason?:string}>}} o
 * @returns {Promise<{accept: boolean, code?: string, http?: number, detail?: string}>}
 *   readPmt 只在【判定题 ∧ outcome_end 有限】时才被调用; 它抛错 ⇒ 按 pmt 无效(fail-closed)。
 */
export async function checkBetIntake({ db, marketId, readPmt }) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('checkBetIntake: db 必填');
  if (typeof readPmt !== 'function') throw new TypeError('checkBetIntake: readPmt 必填');
  const row = db.prepare(`SELECT ${JUDGED_COLUMNS.join(', ')}, outcome_end_ms FROM proto_markets WHERE id = ?`).get(marketId);
  if (!row) return { accept: false, code: 'market_not_found', http: 404, detail: 'market not found' };
  let pmt = null;
  if (intakeNeedsPmt(row)) {
    try { pmt = await readPmt(); }
    catch (e) { pmt = { valid: false, reason: `read_pmt_threw: ${e && e.message ? e.message : e}` }; }
  }
  return evaluateBetIntakeGate({ market: row, pmt });
}
