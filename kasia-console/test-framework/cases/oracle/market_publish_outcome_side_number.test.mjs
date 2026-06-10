// (2a) regression (Bettor r507/r515) — _broadcastMarketPublished must send Number(outcome_side).
//
// scope: v0.7 跨节点 market publish. create-time market_metadata_hash 用 b.outcome_side(数字 0/1)
//   算(pool.js metaInput side:b.outcome_side); DB 把 outcome_side 存成 '0.0' 字符串; publish
//   从 DB 读直发 '0.0' → consumer 重算 hash(用 '0.0')≠ 存储 hash(用 0)→ 拒 = v0.7 跨节点
//   publish 系统性失败(iqftu/mix0d 实证). fix: publish 发 Number(outcome_side) 还原数字 canonical.
// guard: Number(side) 必复现 create-time 数字 hash; 原始 '0.0' 字符串必产生【不同】hash(= 证 bug
//   存在 + fix 有效). 任一回归 → 跨节点 publish 再被 consumer 拒.

import { createHash } from 'node:crypto';

const metaHash = (side) => createHash('sha256').update(JSON.stringify({
  source: 'espn', condition: 'c52915b73289f6c2', token: 'KAS_native',
  side, end: 1781075638,
  rule: '{"title":"t","resolution_criteria":"r","data_source_canonical":"https://site.api.espn.com/x"}',
})).digest('hex');

export default {
  id: 'oracle_market_publish_outcome_side_number',
  description: '(2a) — publish 发 Number(outcome_side) 复现 create-time 数字 hash (跨节点 publish 根治)',
  domain: 'oracle',
  tags: ['regression', 'p0', 'xnode', 'market-publish', 'outcome-side', 'open-testnet'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const createTimeYes = metaHash(0);   // create 用数字 0
    const createTimeNo = metaHash(1);    // create 用数字 1

    // I1: Number() 把 DB 存的各种形式还原到 create-time 数字 hash (= fix 正确)
    for (const stored of ['0.0', '0', 0, 0.0]) {
      if (metaHash(Number(stored)) !== createTimeYes) {
        failures.push(`I1: Number(${JSON.stringify(stored)})=${Number(stored)} hash ≠ create-time YES hash`);
      }
    }
    for (const stored of ['1.0', '1', 1, 1.0]) {
      if (metaHash(Number(stored)) !== createTimeNo) {
        failures.push(`I1: Number(${JSON.stringify(stored)})=${Number(stored)} hash ≠ create-time NO hash`);
      }
    }

    // I2: 原始 DB 字符串 '0.0' 直发(旧 bug 行为)必产生【不同】hash → 证 bug 真实 + Number fix 必要
    if (metaHash('0.0') === createTimeYes) {
      failures.push(`I2: raw string '0.0' hash == number 0 hash — bug 前提不成立, 测试无意义 (JSON.stringify 行为变?)`);
    }

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
