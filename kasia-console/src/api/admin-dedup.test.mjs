// admin-dedup.test.mjs — hasVerifiedContainer2Evidence 离线回归(J2 2026-07-12, 7pori 容器①执行受阻
// 撞见, Bettor 裁"(a)带交叉核验" #hnppoc.2 后续, NWT 加固建议"refunds 数组与实际 pool_bettor_sides
// 逐笔双向核对, 非只查存在")。零 HTTP/chain, 纯函数单测——覆盖真实 7pori 场景形状 + 五类负例
// (伪造/篡改/遗漏/多报/未完成), 确保这道 guard 不会被摆布, 也不会误伤真正"还有注未退"的盘。
// Run: cd kasia-console && node src/api/admin-dedup.test.mjs
import { hasVerifiedContainer2Evidence } from './admin-dedup.js';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const REAL_CANCEL_TXID = '81c908ded1fac7b64f33f3fd59f8a0ea05ba1195d39eac0097443e658519be71';
const BETTOR_PK = 'e92cf4a304ee15a75015505cdb15d7125cf2d1de65298d222a2ec4cab19de533';
const SIDES = [{ bettor_pk: BETTOR_PK, stake_amount: 6000000000 }];

function marketWith(evidence) {
  return { protocol_status: 'refunded', metadata: JSON.stringify({ refund_evidence: evidence }) };
}

console.log('[test] ① 真实 7pori 场景形状(容器②实际写回的证据) → 通过:');
{
  const ev = { refunded_by: 'J2-manual-cancelMarketLive-container2', cancel_txid: REAL_CANCEL_TXID, refund_root: '9781c937d5e0e9f9ce97f680e867202280ad19fef08f8e5ee2f3ee8fad533d38', refunds: [{ pk: BETTOR_PK, amount: '6000000000', txId: 'cd3f59bc184df3b3acfb67e27f5c96caa71599a32067cd96082376e9d158cab2' }], complete: true };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), SIDES) === true, '真实数据形状通过');
}

console.log('[test] ② 负例: 无 refund_evidence(纯 status=refunded 但从没走过容器②) → 拒:');
{
  ok(hasVerifiedContainer2Evidence({ protocol_status: 'refunded', metadata: '{}' }, SIDES) === false, '空 metadata 拒');
  ok(hasVerifiedContainer2Evidence({ protocol_status: 'refunded', metadata: 'not-json' }, SIDES) === false, '坏 JSON 拒(fail-closed, 不崩)');
}

console.log('[test] ③ 负例: complete!==true(容器②本身没完成) → 拒:');
{
  const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '6000000000' }], complete: false };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), SIDES) === false, 'complete=false 拒');
}

console.log('[test] ④ 负例: cancel_txid 格式非法(占位符/非64-hex) → 拒:');
{
  const ev = { cancel_txid: 'not-a-real-txid', refunds: [{ pk: BETTOR_PK, amount: '6000000000' }], complete: true };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), SIDES) === false, '非64-hex txid 拒');
}

console.log('[test] ⑤ 负例: refunds 里 pk 对不上任何真实 bettor_pk(张冠李戴/伪造条目) → 拒:');
{
  const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: 'ff'.repeat(32), amount: '6000000000' }], complete: true };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), SIDES) === false, '陌生 pk 拒(不是这个市场的 bettor)');
}

console.log('[test] ⑥ 负例: 金额被篡改(pk 对但 amount 不吻合真实 stake_amount) → 拒:');
{
  const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '999999' }], complete: true };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), SIDES) === false, '金额不吻合拒(非"差不多"就行)');
}

console.log('[test] ⑦ 负例: refunds 遗漏部分 bettor(2个真实 side 但 evidence 只报1个) → 拒(防"有注未退盘"被误放行):');
{
  const twoSides = [SIDES[0], { bettor_pk: 'aa'.repeat(32), stake_amount: 3000000000 }];
  const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '6000000000' }], complete: true };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), twoSides) === false, '遗漏一笔真实下注 → 拒(长度不符即挡)');
}

console.log('[test] ⑧ 负例: refunds 重复条目虚报覆盖度(同一 pk 报两次凑数) → 拒:');
{
  const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '6000000000' }, { pk: BETTOR_PK, amount: '6000000000' }], complete: true };
  // SIDES.length===1 但 refunds.length===2 → 长度检查先挡; 额外验证纵深(单纯长度凑够2侧但用重复pk)的场景:
  const twoSides = [SIDES[0], { bettor_pk: 'bb'.repeat(32), stake_amount: 1000000000 }];
  ok(hasVerifiedContainer2Evidence(marketWith(ev), twoSides) === false, '重复 pk 凑数量但实际未覆盖第二笔真实 bettor → 拒');
}

console.log('[test] ⑨ 正例: betCount=0(0-bet 市场) 场景不会误触本函数路径(调用方在 endpoint 里已用 betCount>0 才走这条 override, 这里只测函数本身对空 sides 的行为不崩):');
{
  const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [], complete: true };
  ok(hasVerifiedContainer2Evidence(marketWith(ev), []) === true, '空 sides + 空 refunds → 空集合双向覆盖, 数学上成立(实际 endpoint 不会因为 betCount=0 走到这条 override 分支)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — hasVerifiedContainer2Evidence: 正例真实形状/8类负例(缺失/坏JSON/未完成/假txid/张冠李戴/金额篡改/遗漏/重复凑数) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
