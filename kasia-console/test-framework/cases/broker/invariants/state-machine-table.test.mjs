// SA-1 — 表层 invariant assertion (QA hat 第一份产物)
//
// 验 ALLOWED_TRANSITIONS / TX_REQUIRED / STATES 表本身的不变量, **不依赖 helper 实现**.
// helper 实现错也仍该过, 表错能抓.
//
// 4 条 assertion (from PZ-STATE-MACHINE-shipA.md SA-1 spec):
//   A1: 任何 terminal state 没有出边 (TERMINAL ∩ ALLOWED_TRANSITIONS 全 empty Set)
//   A2: 任何 active state 至少有 1 出边到 terminal (防死循环)
//   A3: TX_REQUIRED key set ⊇ ALLOWED_TRANSITIONS 所有 to set (转换表 to 必有 TX 配置)
//   A4: 所有 state 集合 ⊆ STATES 7 个 (无未知 state)
//
// Mode: 用 expect.must.query_db assertion 内联跑 SQL pass=1/0 invariant_pass row.
//   pass=1 → assertion pass; pass=0 → assertion fail (errors join 进 case msg + trace).
// 这样不改 runner.mjs / assertion library — 仅复用现有 query_db assertion + sleep action.
//
// Source: docs/STATE-MACHINES.md v0.2 + tasks/PZ-STATE-MACHINE-shipA.md SA-1

import {
  ALLOWED_TRANSITIONS,
  TX_REQUIRED,
  STATES,
  TERMINAL_STATES,
  ACTIVE_STATES,
} from '../../../../src/services/broker-state-machine.js';

const errors = [];

// ── A1: terminal state 没出边 ──
for (const t of TERMINAL_STATES) {
  const out = ALLOWED_TRANSITIONS[t];
  if (out === undefined) {
    errors.push(`A1: terminal '${t}' 缺 ALLOWED_TRANSITIONS 配置`);
  } else if (out.size !== 0) {
    errors.push(`A1: terminal '${t}' 有出边 [${[...out].join(',')}] 违反 terminal 不可逆`);
  }
}

// ── A2: active state 至少 1 出边到 terminal (防死循环) ──
for (const a of ACTIVE_STATES) {
  const outs = ALLOWED_TRANSITIONS[a];
  if (!outs) {
    errors.push(`A2: active '${a}' 缺 ALLOWED_TRANSITIONS 配置`);
    continue;
  }
  const hasTerminal = [...outs].some(o => TERMINAL_STATES.has(o));
  if (!hasTerminal) {
    errors.push(`A2: active '${a}' 无 terminal 出边 = 死循环 risk`);
  }
}

// ── A3: TX_REQUIRED key set ⊇ ALLOWED_TRANSITIONS 所有 to set ──
for (const [from, toSet] of Object.entries(ALLOWED_TRANSITIONS)) {
  for (const to of toSet) {
    if (!(to in TX_REQUIRED)) {
      errors.push(`A3: transition ${from}→${to} 缺 TX_REQUIRED 配置`);
    }
  }
}

// ── A4: 所有 state 集合 ⊆ STATES (7 个) ──
const allStates = new Set([
  ...Object.keys(ALLOWED_TRANSITIONS),
  ...Object.values(ALLOWED_TRANSITIONS).flatMap(s => [...s]),
]);
if (allStates.size > 7) {
  errors.push(`A4: state 总数 ${allStates.size} > 7 违反 v0.1 states`);
}
for (const s of allStates) {
  if (!STATES.has(s)) {
    errors.push(`A4: unknown state '${s}' 不在 STATES`);
  }
}

const passed = errors.length === 0;
const errMsg = passed ? 'ok' : errors.join(' || ').slice(0, 400);

export default {
  id: 'state_machine_table_invariants',
  description: 'SA-1 表层 invariant: 状态机转换表本身合法 (4 条 — terminal 无出边/active 至少 terminal 出边/TX_REQUIRED 配对/state 集合 ⊆ STATES)',
  domain: 'broker',
  tags: ['invariant', 'state-machine', 'sa-1'],
  steps: [
    {
      action: 'sleep',
      ms: 1,
      expect: {
        must: {
          query_db: {
            sql: `SELECT ${passed ? 1 : 0} AS invariant_pass, ? AS errors`,
            params: [errMsg],
            expected_row: { invariant_pass: 1 },
          },
        },
      },
    },
  ],
};
