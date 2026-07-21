// bshard-auto-settler-bond-reclaim.test.mjs — reclaimBshardMakerBond 四闸离线回归(J2 2026-07-13,
// docs/2026-07-13-bshard-poolspine-maker-bond-reclaim-design.md §6, NWT §7.2"test-green-before-load"
// 落码 checklist 项)。零 HTTP/chain/真实 DB——用最小 mock ctx.db(prepare().get()/.all())覆盖①-④
// 四闸的 fail-closed 行为，验证顺序与拒绝原因，不进 buildMakerRefundPreimage/handleRefunding(那需要
// 真 relay IPC，属 §6 的 dry-run/7pori 实跑覆盖范围，非本离线单测范围)。
// Run: cd kasia-console && node src/services/bshard-auto-settler-bond-reclaim.test.mjs
import { reclaimBshardMakerBond } from './bshard-auto-settler.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const MARKET_ID = '__test_bond_reclaim_market__';
const SPINE_P2SH = 'kaspatest:test_spine_p2sh';
const SPINE_TXID = 'ab'.repeat(32);
const BETTOR_PK = 'e92cf4a304ee15a75015505cdb15d7125cf2d1de65298d222a2ec4cab19de533';
const REAL_CANCEL_TXID = '81c908ded1fac7b64f33f3fd59f8a0ea05ba1195d39eac0097443e658519be71';

// mock ctx.db — 最小 prepare().get()/.all() 覆盖 reclaimBshardMakerBond 实际发出的四条查询
// (market 行 / market_shards 存在性 / getSidesByLogicalMarket)。表驱动: 按 SQL 关键字分派。
function mockDb({ marketRow, isBshard, sides = [] }) {
  return {
    prepare(sql) {
      if (sql.includes('FROM pool_markets WHERE id')) {
        return { get: () => marketRow };
      }
      // 顺序注意: getSidesByLogicalMarket 的 SQL 文本里也含 "market_shards WHERE logical_market_id"
      // (子查询)，必须先匹配更具体的 pool_bettor_sides 整句，否则会被下面的 isBshard 分支误吃(返回
      // .get 而非 .all，撞 "db.prepare(...).all is not a function")。
      if (sql.includes('FROM pool_bettor_sides')) {
        return { all: () => sides };
      }
      if (sql.includes('FROM market_shards WHERE logical_market_id')) {
        return { get: () => (isBshard ? { 1: 1 } : undefined) };
      }
      throw new Error(`mockDb: 未覆盖的 SQL 形状(测试范围外): ${sql.slice(0, 60)}`);
    },
  };
}

function baseMarket(overrides = {}) {
  return {
    id: MARKET_ID, spine_p2sh: SPINE_P2SH, spine_lock_tx: SPINE_TXID,
    maker_stake_amount: 10000000000, oracle_bond_amount: 0, miner_fee: 20000,
    protocol_version: 'v0.7', protocol_status: 'refunded',
    metadata: JSON.stringify({}),
    ...overrides,
  };
}

async function run(label, market, { isBshard = true, sides = [], relayLanded = { landed: true, depth: 999 } } = {}) {
  const db = mockDb({ marketRow: market, isBshard, sides });
  const ctx = { db, feeRelay: { id: 'test-fee-relay' }, relayPost: async () => relayLanded, dryRun: true };
  console.log(`[test] ${label}:`);
  return reclaimBshardMakerBond(MARKET_ID, ctx);
}

(async () => {
  {
    const r = await run('① 市场不存在 → 拒', undefined);
    ok(r.ok === false && r.reason === 'market 不存在', '拒绝, reason 精确匹配');
  }

  {
    const r = await run('② 非 bshard 市场(market_shards 无行) → 闸①拒', baseMarket(), { isBshard: false });
    ok(r.ok === false && /非 bshard 市场/.test(r.reason), '闸①拒绝, 提示改走 legacy 路径');
  }

  {
    const r = await run('③ metadata 坏 JSON → fail-closed 拒(不崩)', baseMarket({ metadata: 'not-json' }));
    ok(r.ok === false && /坏 JSON/.test(r.reason), 'fail-closed 拒绝, 不抛异常');
  }

  {
    const r = await run('④ 已收口(幂等闸) → 闸④拒', baseMarket({ metadata: JSON.stringify({ bshard_maker_bond_reclaimed_at: '2026-07-12T00:00:00Z' }) }));
    ok(r.ok === false && r.already === true, '幂等闸拒绝, already=true 供 caller 区分(非错误, 是已完成)');
  }

  {
    const r = await run('⑤ 容器②无 refund_evidence(从没走过容器②) → 闸②拒', baseMarket());
    ok(r.ok === false && /容器②完成证据未通过/.test(r.reason), '闸②拒绝(复用 hasVerifiedContainer2Evidence)');
  }

  {
    const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '6000000000' }], complete: false };
    const r = await run('⑥ 容器②ev.complete=false(未完成) → 闸②拒', baseMarket({ metadata: JSON.stringify({ refund_evidence: ev }) }),
      { sides: [{ bettor_pk: BETTOR_PK, stake_amount: 6000000000 }] });
    ok(r.ok === false && /容器②完成证据未通过/.test(r.reason), '闸②拒绝(complete!==true)');
  }

  {
    const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '999999' }], complete: true };
    const r = await run('⑦ 容器②金额被篡改(pk 对但 amount 不吻合) → 闸②拒', baseMarket({ metadata: JSON.stringify({ refund_evidence: ev }) }),
      { sides: [{ bettor_pk: BETTOR_PK, stake_amount: 6000000000 }] });
    ok(r.ok === false && /容器②完成证据未通过/.test(r.reason), '闸②拒绝(金额不吻合, 非"差不多"就行)');
  }

  {
    const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '6000000000' }], complete: true };
    const r = await run('⑧ 闸②通过但 spine UTXO 浅确认(depth<REORG_SAFE_MIN_DEPTH) → 闸③拒(reorg phantom-leaf 防御, NWT MUST-FIX)',
      baseMarket({ metadata: JSON.stringify({ refund_evidence: ev }) }),
      { sides: [{ bettor_pk: BETTOR_PK, stake_amount: 6000000000 }], relayLanded: { landed: false, depth: 3 } });
    ok(r.ok === false && /reorg-safe 深度确认/.test(r.reason), '闸③拒绝, 不签名广播(唯一重试安全网必须够硬)');
  }

  {
    const ev = { cancel_txid: REAL_CANCEL_TXID, refunds: [{ pk: BETTOR_PK, amount: '6000000000' }], complete: true };
    const r = await run('⑨ 闸②通过但 relayPost 查无此 UTXO(landed=false, 无 depth) → 闸③拒',
      baseMarket({ metadata: JSON.stringify({ refund_evidence: ev }) }),
      { sides: [{ bettor_pk: BETTOR_PK, stake_amount: 6000000000 }], relayLanded: { landed: false } });
    ok(r.ok === false && /reorg-safe 深度确认/.test(r.reason), '闸③拒绝(查无 UTXO, 同样 fail-closed 不放行)');
  }

  console.log(fails === 0
    ? '\n✅✅ ALL PASS — reclaimBshardMakerBond 四闸(①isBshard/②容器②证据/③spine reorg-safe 深度/④幂等) 9 类负例(含不存在/非bshard/坏JSON/已收口/证据缺失/未完成/篡改/浅确认/查无UTXO) 全 fail-closed'
    : `\n❌ ${fails} assertions failed`);
  process.exit(fails === 0 ? 0 : 1);
})();
