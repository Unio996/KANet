#!/usr/bin/env node
// j2-cohort-export.cjs -- Codex "Required next evidence ①": per-row cohort export for the 125 sides.
// READ-ONLY. Opens the live DB with readonly:true. No writes, no chain calls, no signing.
//
// WHY THIS SCRIPT EXISTS (2026-08-05):
//   I told the channel the per-row export was "structurally undeliverable" because the settler's
//   backlog predicate contains `pm.id IN (${ph})` where ph comes from `_p1BacklogIds`, which lives
//   only in process memory. That is true of ONE of the three OR-branches. The other two are pure
//   SQL over persisted columns. So the honest question is not "can it be rebuilt" but
//   "how much of the population does the un-rebuildable branch contribute" -- which is measurable.
//
// The predicate below is transcribed from pool-market-settler.js:361-386 (reportUnauthorizedRefundBacklog).
// The three NULL-safety branches are kept EXACTLY as written there: json_extract returning NULL makes
// `NULL IN (...)` and `NULL NOT IN (...)` both NULL, and WHERE only accepts TRUE -- that is the bug
// that made this backlog read 0 on 2026-08-04.
// 【怎么跑 —— 完整命令, 照抄即可】
//   cd <repo>/kasia-console && node test-framework/standalone/p1_cohort_export.cjs
//   输出: <repo>/scratch/j2-cohort-rows.csv (行级数据【故意不入库】, 见文件尾说明)
//   覆盖路径: KANET_ROOT=<repo> 或 KANET_SCRATCH=<dir>
//
// 🔴 路径必须走 KANET_ROOT, 不许硬编码绝对路径(CLAUDE.md:242 既有约定)。
//    v1 写死 `D:/kanet-tn12/…` —— 那让"把脚本入库以求可复现"这件事自相矛盾:
//    入了库, 而别人机器上跑不起来 = 换个地方的同一个问题。
const path = require('path');
const ROOT = process.env.KANET_ROOT || path.resolve(__dirname, '../../..');
const SCRATCH = process.env.KANET_SCRATCH || path.join(ROOT, 'scratch');
const Database = require(path.join(ROOT, 'kasia-console/node_modules/better-sqlite3'));

const DB = path.join(ROOT, 'kasia-console/data/console.db');
const db = new Database(DB, { readonly: true, fileMustExist: true });

const WHITELIST = ['bettors_absent', 'committee_affirmative_unjudgeable',
  'structurally_invalid_market', 'pool_below_minimum', 'owner_authorized'];
const IN_LIST = WHITELIST.map(v => `'${v}'`).join(',');
const nowSec = Math.floor(Date.now() / 1000);

// The authorization half of the predicate -- identical in every arm below.
const NO_AUTH = `(
       json_valid(pm.metadata) = 0
    OR json_extract(pm.metadata, '$.refund_authorization') IS NULL
    OR json_extract(pm.metadata, '$.refund_authorization') NOT IN (${IN_LIST})
  )`;
const TAIL = `AND pm.deadline <= ${nowSec}
  AND pbs.side_lock_tx IS NOT NULL
  AND pbs.claim_txid IS NULL
  AND ${NO_AUTH}`;

// The three OR-branches, measured SEPARATELY. Branch B is the runtime-only one.
const ARMS = {
  'A_v05_or_null_version': `(pm.protocol_version IS NULL OR pm.protocol_version = 'v0.5')`,
  'C_cancelled_refunded_v06_v07': `(pm.protocol_status IN ('cancelled','refunded') AND pm.protocol_version IN ('v0.6','v0.7'))`,
  'A_or_C_union': `((pm.protocol_version IS NULL OR pm.protocol_version = 'v0.5')
                    OR (pm.protocol_status IN ('cancelled','refunded') AND pm.protocol_version IN ('v0.6','v0.7')))`,
};

console.log('== OFFLINE REPRODUCTION OF THE BACKLOG COHORT ==');
console.log('db=%s  readonly=true  nowSec=%d', DB, nowSec);
console.log('predicate transcribed from pool-market-settler.js:361-386\n');

for (const [name, arm] of Object.entries(ARMS)) {
  const r = db.prepare(`
    SELECT COUNT(*) AS sides, COUNT(DISTINCT pm.id) AS markets,
           COALESCE(SUM(pbs.stake_amount),0) AS stake_sompi
    FROM pool_bettor_sides pbs JOIN pool_markets pm ON pm.id = pbs.market_id
    WHERE ${arm} ${TAIL}`).get();
  // Not console.log('%-30s', ...): Node's util.format has no width/justify specifiers, so %-30s
  // is emitted literally and every argument shifts one slot right. The numbers stayed readable
  // only by luck of ordering -- a formatting bug that silently relabels columns is the same
  // family as reading a field from the wrong place.
  console.log('  ' + name.padEnd(30) + ' sides=' + String(r.sides).padEnd(5) +
    ' markets=' + String(r.markets).padEnd(4) + ' stake=' + (r.stake_sompi / 1e8).toFixed(1) + ' KAS');
}

// Per-row export. No head/tail/LIMIT anywhere: if it is long, it is long -- a truncated
// enumeration is exactly the failure mode that put a wrong "closed chain" on an Owner card today.
const rows = db.prepare(`
  SELECT pm.id AS market_id, pm.protocol_version AS ver, pm.protocol_status AS status,
         pm.deadline, pbs.rowid AS side_rowid, pbs.bettor_pk, pbs.stake_amount,
         pbs.side_lock_tx, pbs.claim_txid,
         json_extract(pm.metadata,'$.refund_authorization') AS auth,
         -- 🔴 refund_txid is a COLUMN on pool_markets, NOT a metadata key. v1 of this script read
         -- json_extract(metadata,'$.refund_txid') and got NULL for all 125 -- a legal-looking empty
         -- answer that nearly became "no refund tx was ever produced". Bettor hit the identical
         -- field-location error the same hour and caught it with a positive control. Same lesson:
         -- when a "field missing everywhere" result would be load-bearing, check that the field is
         -- where you think it is. refund_tx_obj (metadata) and refund_txid (column) are two
         -- different records of the same refund; both are exported here on purpose.
         -- (No backticks in this comment: it lives inside a JS template literal, and a backtick
         --  here terminates the string. Registered trap, hit again anyway on the first try.)
         pm.refund_txid                                     AS refund_txid_col,
         json_extract(pm.metadata,'$.refund_dispatched_at') AS dispatched_at,
         (json_extract(pm.metadata,'$.refund_tx_obj') IS NOT NULL) AS has_refund_tx_obj,
         json_extract(pm.metadata,'$.refund_reason')        AS refund_reason,
         json_extract(pm.metadata,'$.refund_amount')        AS refund_amount,
         json_valid(pm.metadata) AS md_valid
  FROM pool_bettor_sides pbs JOIN pool_markets pm ON pm.id = pbs.market_id
  WHERE ${ARMS['A_or_C_union']} ${TAIL}
  ORDER BY pm.deadline, pm.id, pbs.rowid`).all();

console.log('\n== PER-ROW EXPORT: %d rows ==', rows.length);
const fs = require('fs');
// 🔴 输出【故意留在 scratch/(gitignored)】: 每行含 bettor_pk / side_p2sh / txid ——
//    origin 是公开仓库, 入库即永久发布, 而"是否发布行级数据"是 Owner 决策, 不是本脚本的。
//    ⇒ 入库的是【方法】(本文件), 不是【数据】。别人跑一次就得到同样的 CSV。
const out = path.join(SCRATCH, 'j2-cohort-rows.csv');
const cols = Object.keys(rows[0] || { market_id: 1 });
fs.writeFileSync(out, cols.join(',') + '\n' +
  rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(',')).join('\n'));
console.log('written: %s', out);

// Distribution over the axes Codex's 6-bucket classification needs as input.
const tally = (fn) => rows.reduce((m, r) => (m[fn(r)] = (m[fn(r)] || 0) + 1, m), {});
console.log('\nby version+status :', JSON.stringify(tally(r => `${r.ver}/${r.status}`)));
console.log('by refund_txid    :', JSON.stringify(tally(r => r.refund_txid_col ? 'has_txid_col' : 'no_txid_col')));
console.log('by auth label     :', JSON.stringify(tally(r => r.auth === null ? 'NULL' : String(r.auth))));
console.log('by metadata valid :', JSON.stringify(tally(r => `json_valid=${r.md_valid}`)));
console.log('distinct bettor_pk:', new Set(rows.map(r => r.bettor_pk)).size);
db.close();
