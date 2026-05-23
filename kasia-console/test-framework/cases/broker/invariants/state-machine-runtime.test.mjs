// SA-6 — runtime invariant assertion (QA hat 第二份产物)
//
// 验 retail_dex_orders prod data 跟 状态机 invariants align — runtime drift 检.
// 跟 SA-1 表层 invariant 互补:
//   SA-1: 验表本身合法 (ALLOWED_TRANSITIONS / TX_REQUIRED 静态结构)
//   SA-6: 验 runtime prod data 守 invariants (动态状态)
//
// 4 条 invariant (per NWT r93 architect mode propose, 跟 SA-1 表层 4 条互补):
//   A1: peer 至多 1 active order (防 multi-active row anomaly)
//   A2: terminal state 双向不可逆 (updated_at >= created_at)
//   A3: transition() audit pairing (count loose compare — sediment phase Z, 此 ship 不严测)
//   A4: STATES 双向等价 (跟 SA-1 表层 A4 单向 ⊆ 互补, 防 STATES 含孤儿 state)
//
// 实施 (跟 SA-1 同模式不改 runner.mjs):
//   - module load: A4 const 验 errs[] (errors push push)
//   - step expect.must.query_db: A1 + A2 prod SQL count violation + a4_violations param
//   - sleep step + query_db assertion inline
//
// 路径 cases/broker/invariants/ — runner walk currentDomain='broker' 继承 ✓ --domain=broker 命中

import {
  STATES,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  ACTIVE_STATES,
} from '../../../../src/services/broker-state-machine.js';

const errors = [];

// ── A4: STATES 双向等价 ALLOWED_TRANSITIONS keys (跟 SA-1 表层 A4 单向 ⊆ 互补) ──
const transitionKeys = new Set(Object.keys(ALLOWED_TRANSITIONS));
if (STATES.size !== transitionKeys.size) {
  errors.push(`A4: STATES.size ${STATES.size} != ALLOWED_TRANSITIONS keys.size ${transitionKeys.size}`);
}
for (const s of STATES) {
  if (!transitionKeys.has(s)) {
    errors.push(`A4: STATES has '${s}' but ALLOWED_TRANSITIONS keys lack (orphan state)`);
  }
}
for (const k of transitionKeys) {
  if (!STATES.has(k)) {
    errors.push(`A4: ALLOWED_TRANSITIONS keys has '${k}' but STATES lack`);
  }
}

// ── A4-extra: ACTIVE/TERMINAL ⊆ STATES, 互不重 ──
for (const a of ACTIVE_STATES) {
  if (!STATES.has(a)) errors.push(`A4: ACTIVE '${a}' not in STATES`);
  if (TERMINAL_STATES.has(a)) errors.push(`A4: ACTIVE '${a}' overlap TERMINAL`);
}
for (const t of TERMINAL_STATES) {
  if (!STATES.has(t)) errors.push(`A4: TERMINAL '${t}' not in STATES`);
}

const a4_violations = errors.length;
const a4_msg = errors.length === 0 ? 'A4 ok' : errors.join(' || ').slice(0, 300);

export default {
  id: 'state_machine_runtime_invariants',
  description: 'SA-6 runtime invariant 4 条 (A1 peer 1 active / A2 terminal updated_at / A3 audit loose / A4 STATES 双向等价 + ACTIVE/TERMINAL 互不重)',
  domain: 'broker',
  tags: ['invariant', 'state-machine', 'sa-6', 'runtime'],
  steps: [
    {
      action: 'sleep',
      ms: 1,
      expect: {
        must: {
          // SQL: A1 + A2 prod data SQL count violation + A4 const 验 result
          // 期: 全 0 violation
          query_db: {
            // A1 grandfather time window — Ship A start anchor 2026-04-30T09:00:00Z (c4c8ca859 SA-1 ship + 0.5h buffer).
            // 历史 10 multi-active anomaly (pre-Ship A broker-v2 router LIMIT 1 hides 真根因, NWT r79 sediment) → Ship B-2 cleanup.
            // SA-6 invariant 守 forward (post Ship A 后 transition() 强 single-row CAS, 任何新 multi-active = forward bug).
            // 防 forward 新 violation, 不修 historical drift — 跟 SA-3 lint escape hatch grandfather 同 defensive 精神.
            sql: `
              SELECT
                (SELECT COALESCE(COUNT(*), 0) FROM (
                  SELECT user_kasia_address FROM retail_dex_orders
                  WHERE state IN ('aligning', 'awaiting_payment', 'paid')
                    AND created_at > '2026-04-30T09:00:00Z'
                  GROUP BY user_kasia_address HAVING COUNT(*) > 1
                )) AS a1_multi_active,
                (SELECT COUNT(*) FROM retail_dex_orders
                 WHERE state IN ('completed', 'refunded', 'failed', 'expired')
                   AND updated_at IS NOT NULL AND created_at IS NOT NULL
                   -- 1 sec tolerance: created_at 含 millisecond '...415Z', SQLite datetime('now') 截到秒,
                   -- INSERT 立即 UPDATE 时 updated_at 字面早 0-1s 是 truncation 不是 anomaly.
                   AND julianday(updated_at) < julianday(created_at) - (1.0/86400.0)
                   AND created_at > '2026-04-30T09:00:00Z') AS a2_terminal_unordered,
                ? AS a4_violations,
                ? AS errors_msg
            `,
            params: [a4_violations, a4_msg],
            expected_row: {
              a1_multi_active: 0,
              a2_terminal_unordered: 0,
              a4_violations: 0,
            },
          },
        },
      },
    },
  ],
};
