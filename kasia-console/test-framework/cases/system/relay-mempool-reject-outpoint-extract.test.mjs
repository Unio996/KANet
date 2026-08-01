/**
 * Regression test — mempool-reject outpoint extraction (relay.mjs send_broadcast)
 *
 * Bug (2026-08-01, J1 实测坐实):
 *   relay.mjs 的 mempool-reject 补救路径靠正则从 RPC 报错串里抽 outpoint, 再调
 *   markUtxoSpentByOutpoint() 把它排除, 好让下一次重试挑别的 UTXO。
 *   原正则 /\(([a-f0-9]{64}):?(\d*)\)/ 只认 `(txid)` / `(txid:0)`,
 *   而 kaspad 【实际】吐的是逗号+空格: `output (<txid>, 0) already spent by ...`
 *   ⇒ match === null ⇒ markUtxoSpentByOutpoint 从部署起一次都没被调用过。
 *
 *   失败方式是【静默】的: 不匹配不抛错, 日志照打 "mempool reject, sleep..retry",
 *   看起来在处理, 实则 4 次重试把同一个 UTXO 又挑了 4 遍(选币挑最大, 而最大那个正是被占的)。
 *   实证: J1tn 有 3447 个 UTXO 却连续广播失败 90 分钟, 直到本修复。
 *
 * 同族前科: kasia-relay/src/lib/transaction.mjs L53-58 —— entry.outpoint 嵌套读不到,
 *   key 恒 ':0', 同一个 shadow-tracking「从部署以来就是死代码」。这是第二次发作。
 *
 * 🔨 本用例守的判据(比这一个 bug 大):
 *   **「从报错串里抽字段」的补救, 必须拿【真实报错串】测过才算实现 —— 不能照注释里的格式写。**
 *   所以下面用的是逐字抄的真实 kaspad 报错, 不是构造的样例。
 *
 * Run: node --test kasia-console/test-framework/cases/system/relay-mempool-reject-outpoint-extract.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELAY = join(__dirname, '../../../../kasia-relay/src/relay.mjs');
const SRC = readFileSync(RELAY, 'utf-8');

// 逐字抄自 2026-08-01 J1tn relay 日志(kaspad TN12 RPC 原文), 未做任何改写
const REAL_REJECT_MSG =
  'RPC Server (remote error) -> Rejected transaction ' +
  '4ac09259dc58aadee277d1775bf08823fb000d9de52662f610bfd39e0d25aaf9: output ' +
  '(a9850a3d31db821bb2e5bb795785b6f96b9efbcb873b54e449dda70e881e92cc, 0) ' +
  'already spent by transaction ' +
  '8ce100a1e875170afd72c2eeee339b2d749448ab7987e459d5f8bf85feaaf207 in the mempool';

const EXPECT_TXID = 'a9850a3d31db821bb2e5bb795785b6f96b9efbcb873b54e449dda70e881e92cc';

/** 从源码里取出在役的那条 outpoint 抽取正则, 而不是在测试里另写一份。 */
function extractOutpointRegexFromSource() {
  const m = SRC.match(/bcastErrMsg\.match\((\/.+?\/[a-z]*)\)/);
  assert.ok(m, 'relay.mjs 里找不到 bcastErrMsg.match(<regex>) —— 抽取逻辑被挪走或改名了');
  const body = m[1].replace(/^\//, '').replace(/\/([a-z]*)$/, '');
  const flags = (m[1].match(/\/([a-z]*)$/) || [, ''])[1];
  return new RegExp(body, flags);
}

test('在役正则能从【真实】kaspad 报错串里抽出 outpoint(逗号+空格格式)', () => {
  const re = extractOutpointRegexFromSource();
  const m = REAL_REJECT_MSG.match(re);
  assert.ok(m, '真实报错串没被匹配到 —— markUtxoSpentByOutpoint 不会被调用, 重试会一直挑同一个 UTXO');
  assert.equal(m[1], EXPECT_TXID, '抽出的 txid 不对');
  assert.equal(Number(m[2] || 0), 0, '抽出的 output index 不对');
});

test('向后兼容: 冒号格式与裸 txid 格式仍能匹配', () => {
  const re = extractOutpointRegexFromSource();
  const colon = `output (${EXPECT_TXID}:1) already spent by transaction deadbeef in the mempool`;
  const bare = `output (${EXPECT_TXID}) already spent by transaction deadbeef in the mempool`;
  const mc = colon.match(re);
  assert.ok(mc, '冒号格式 (txid:1) 不再匹配 —— 修正则时把旧格式弄丢了');
  assert.equal(mc[1], EXPECT_TXID);
  assert.equal(Number(mc[2] || 0), 1);
  const mb = bare.match(re);
  assert.ok(mb, '裸 (txid) 格式不再匹配');
  assert.equal(mb[1], EXPECT_TXID);
});

test('isMempoolReject 判定本身对真实报错串成立(否则根本进不到抽取那一步)', () => {
  const m = SRC.match(/const\s+isMempoolReject\s*=\s*(\/.+?\/[a-z]*)\.test\(/);
  assert.ok(m, 'relay.mjs 里找不到 isMempoolReject 的判定正则');
  const body = m[1].replace(/^\//, '').replace(/\/([a-z]*)$/, '');
  const flags = (m[1].match(/\/([a-z]*)$/) || [, ''])[1];
  assert.ok(new RegExp(body, flags).test(REAL_REJECT_MSG), 'isMempoolReject 对真实报错串判 false');
});

test('抽到 outpoint 后确实调用 markUtxoSpentByOutpoint(抽了不用 = 白抽)', () => {
  assert.ok(
    /markUtxoSpentByOutpoint\(\s*m\[1\]/.test(SRC),
    'relay.mjs 没有用抽出的 m[1] 调 markUtxoSpentByOutpoint —— 抽取结果没被用来阻止动作'
  );
});
