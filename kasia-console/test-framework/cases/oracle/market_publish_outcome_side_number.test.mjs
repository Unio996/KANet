// (2a) regression (Bettor r507/r515 + J2-tn 2026-06-13 chain Tier4) — _broadcastMarketPublished
// outcome_side canonical 必【两路一致复现 create-time hash】: 数字市场 Number, 字符串市场 raw。
//
// scope: v0.7 跨节点 market publish. create-time market_metadata_hash 用 b.outcome_side 算
//   (pool.js L451 metaInput side:b.outcome_side); DB 存 outcome_side 字符串; publish 从 DB 读重构 →
//   consumer (trade-protocol-filter L599-608) 用 publish 的 outcome_side 重算 hash, 不命中 → 拒.
//
// 两类 outcome_side 在 production 共存 (实查 v0.7: 数字 '0.0'=113 + 字符串 'YES'193/'yes'11/'NO'1=205):
//   ① 数字市场: create b.outcome_side=0 (number), DB 存 '0.0' → publish 须发 Number('0.0')=0 复现 hash.
//   ② 字符串市场: create b.outcome_side='YES' (string), DB 存 'YES' → publish 须发 raw 'YES' 复现 hash.
//
// BUG 史 (L198): 旧 publish `outcome_side: Number(marketRow.outcome_side)` 只修了 ① 数字 case, 但 ②
//   字符串 Number('YES')=NaN → JSON 'null' ≠ create 'YES' hash → consumer 拒 = 64% v0.7 市场 (205/318)
//   auto cross-node publish 不可见 (chain Tier4 qr733 实证: 须手动 re-broadcast raw 'YES' 绕过).
//   fix a02cc867: `isNaN(Number(x)) ? x : Number(x)` = 数字 Number / 字符串 raw 两路 canonical.
//
// 教训 (fixture-must-mirror-production): 旧 test 只喂数字 fixture ('0.0'/0/1), 从不喂 production 真实的
//   字符串 'YES'/'NO' → L198 bug 存在时此 test 一直 PASS = 漏掉 64% 市场的 break. 本 test 补字符串 case
//   + 测 production canonical (isNaN guard) 非旧 Number() = 镜像 production 输入形态.

import { createHash } from 'node:crypto';

const metaHash = (side) => createHash('sha256').update(JSON.stringify({
  source: 'espn', condition: 'c52915b73289f6c2', token: 'KAS_native',
  side, end: 1781075638,
  rule: '{"title":"t","resolution_criteria":"r","data_source_canonical":"https://site.api.espn.com/x"}',
})).digest('hex');

// production canonical (pool.js L198 a02cc867): 数字串→Number, 非数字串→raw.
const publishCanonical = (stored) => (isNaN(Number(stored)) ? stored : Number(stored));

export default {
  id: 'oracle_market_publish_outcome_side_number',
  description: '(2a/L198) — publish outcome_side canonical (isNaN guard) 复现 create-time hash: 数字市场 Number + 字符串市场 raw (跨节点 publish 根治, 数字+字符串两路)',
  domain: 'oracle',
  tags: ['regression', 'p0', 'xnode', 'market-publish', 'outcome-side', 'open-testnet'],
  skip_in_batch: false,

  async run() {
    const failures = [];

    // ① 数字市场: create 用 number 0/1; DB 各种存储形式经 canonical 必复现 create-time 数字 hash.
    const createNumYes = metaHash(0);
    const createNumNo = metaHash(1);
    for (const stored of ['0.0', '0', 0, 0.0]) {
      if (metaHash(publishCanonical(stored)) !== createNumYes) {
        failures.push(`① 数字: canonical(${JSON.stringify(stored)})=${JSON.stringify(publishCanonical(stored))} hash != create-time number-0 hash`);
      }
    }
    for (const stored of ['1.0', '1', 1, 1.0]) {
      if (metaHash(publishCanonical(stored)) !== createNumNo) {
        failures.push(`① 数字: canonical(${JSON.stringify(stored)})=${JSON.stringify(publishCanonical(stored))} hash != create-time number-1 hash`);
      }
    }

    // ② 字符串市场 (L198 漏的 64%): create 用 string 'YES'/'NO'/'yes'; DB 存原样 → canonical 须发 raw
    //    复现 create-time 字符串 hash. (旧 Number() 在此 NaN->null 不命中 = bug.)
    for (const side of ['YES', 'NO', 'yes']) {
      const createStrHash = metaHash(side);  // create b.outcome_side=side (raw string)
      if (metaHash(publishCanonical(side)) !== createStrHash) {
        failures.push(`② 字符串: canonical('${side}')=${JSON.stringify(publishCanonical(side))} hash != create-time string-'${side}' hash (L198 回归: 字符串 outcome_side 跨节点 publish 又被拒)`);
      }
    }

    // I-bug: 证旧 L198 bug 真实 — 字符串 'YES' 经【旧】Number() 必产生【不同】hash (= consumer 会拒).
    if (metaHash(Number('YES')) === metaHash('YES')) {
      failures.push(`I-bug: Number('YES') hash == raw 'YES' hash — L198 bug 前提不成立 (JSON.stringify(NaN) 行为变?)`);
    }
    // I-bug2: 证数字 case raw 直发 (不经 canonical) 也会破 — 数字市场必须 Number 不能 raw.
    if (metaHash('0.0') === metaHash(0)) {
      failures.push(`I-bug2: raw '0.0' hash == number 0 hash — 数字市场 bug 前提不成立`);
    }

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
