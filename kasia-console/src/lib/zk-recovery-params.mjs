// zk-recovery-params.mjs — 账本1861 C 设计 §8(Bettor 批): 把"铸造时的"回收参数写进盘 metadata, 回收枚举器优先用它。
//
// 为什么: KanetTokenClaim / PoolSideTicket 的模板由 ctor 常量(ZK_SYSTEM_SINK_PK / ZK_CLAIM_RETIRE_DAA / ZK_TICKET_SWEEP_DAA)决定; 日后若 env 被改,
//   枚举器按【当前】env 重算 redeem 会与链上已存在的 UTXO 对不上 ⇒ 漏回收(不会错花, 但钱永远锁着)。把铸造那一刻的值写在盘上, 枚举器先用它。
//   CLAIM_OUT_VALUE 不进模板, 但记账/核对 claim 输出面值要用(retire 本身读链上实际面值)。
// 写入点: create-v07(不收 KAS 模式, 该分支本来就 resolveSinkConfig 校验过 env)。首写为准, 不覆盖。
// 漂移: ticket 铸造(register-v07)与 claim 铸造前比对当前 env 与盘上记录——不一致 ⇒ LOUD 警告 + 追加到 metadata.zk_recovery_params_drift(≤5 条), 不阻断(模板 hash 本就按 env 校验)。
import { resolveSinkConfig } from './zk-sink-config.mjs';
import { CLAIM_OUT_VALUE_SOMPI } from './zk-token-claim-orchestrator.mjs';

const KEYS = ['sink_pk', 'retire_daa', 'sweep_daa', 'claim_out_value_sompi'];

/** 当前 env 下的回收参数; env 不全(resolveSinkConfig 抛)⇒ null(调用方决定怎么处理, 本函数不抛)。 */
export function currentRecoveryParams(env = process.env) {
  try {
    const c = resolveSinkConfig({}, env);
    const claimOut = env.ZK_CLAIM_OUT_VALUE_SOMPI ? Number(env.ZK_CLAIM_OUT_VALUE_SOMPI) : CLAIM_OUT_VALUE_SOMPI;
    return { sink_pk: c.sinkPkHex, retire_daa: c.retireDaa, sweep_daa: c.sweepDaa, claim_out_value_sompi: claimOut };
  } catch { return null; }
}

/** 给 metadata 对象补 zk_recovery_params(首写为准; env 不全 ⇒ 原样返回)。 */
export function withRecoveryParams(metaObj, env = process.env, nowIso = new Date().toISOString()) {
  if (metaObj && metaObj.zk_recovery_params) return metaObj;
  const p = currentRecoveryParams(env);
  if (!p) return metaObj;
  return { ...metaObj, zk_recovery_params: { ...p, stamped_at: nowIso, source: 'create-v07' } };
}

const same = (a, b) => KEYS.every((k) => String(a?.[k]) === String(b?.[k]));

/**
 * 比对盘上记录与当前 env。无记录(legacy 盘)⇒ 不判; 一致 ⇒ {drift:false}; 不一致 ⇒ LOUD + 追加 drift 记录。永不抛。
 * @returns {{drift:boolean, stamped?:boolean}}
 */
export function checkRecoveryParamsDrift(db, marketId, site, env = process.env, nowIso = new Date().toISOString()) {
  try {
    const row = db.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
    if (!row) return { drift: false };
    let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { return { drift: false }; }
    const stamped = meta.zk_recovery_params;
    if (!stamped) return { drift: false, stamped: false };
    const cur = currentRecoveryParams(env);
    if (!cur || same(stamped, cur)) return { drift: false, stamped: true };
    const list = Array.isArray(meta.zk_recovery_params_drift) ? meta.zk_recovery_params_drift : [];
    if (!list.some((d) => same(d.current, cur))) {
      list.push({ at: nowIso, site, current: cur });
      meta.zk_recovery_params_drift = list.slice(-5);
      db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), marketId);
    }
    console.warn(`[zk-recovery-params] 🔴 DRIFT market=${String(marketId).slice(-8)} site=${site}: 铸造时记录 ${JSON.stringify(stamped)} ≠ 当前 env ${JSON.stringify(cur)} — 回收枚举器须先用盘上记录(metadata.zk_recovery_params), 别信当前 env`);
    return { drift: true, stamped: true };
  } catch (e) {
    console.warn(`[zk-recovery-params] drift check failed(ignored): ${e.message}`);
    return { drift: false };
  }
}
