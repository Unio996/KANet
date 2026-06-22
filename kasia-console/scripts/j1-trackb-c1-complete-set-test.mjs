// J1 offline self-test: verifyBettorsCompleteFromChain (C1 complete-set, Track B, 2026-06-22).
// 纯逻辑测 (mock chain primitives): 聚合链锚 / anti-omission / anti-dir-tamper / anti-swap / (A)-model gate / fail-loud。
// ⚠ 不测真链路 (无 (A)-model 链上数据 + relay 离线) — 见 lib 顶部诚实分级注释。这里只证【算术+分支逻辑】正确。
import { verifyBettorsCompleteFromChain } from '../src/lib/bshard-close-enforce.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const MID = 'logical-market-X';
// 2-shard honest market: shard0 = 2 YES (100,200), shard1 = 1 NO (150). Σ count=3 yes=300 no=150 pool=450.
const honestShards = () => ([
  { shard_index: 0, shard_market_id: 's0', shard_redeem_hex: 'aa'.repeat(40), current_leaf_outpoint: 'tx0:0',
    current_leaf_state: JSON.stringify({ local_yes: 300, local_no: 0, count: 2, pool_value: 300 }) },
  { shard_index: 1, shard_market_id: 's1', shard_redeem_hex: 'bb'.repeat(40), current_leaf_outpoint: 'tx1:0',
    current_leaf_state: JSON.stringify({ local_yes: 0, local_no: 150, count: 1, pool_value: 150 }) },
]);
const honestRows = {
  s0: [{ bettor_pk: 'aa', direction: 0, stake_amount: 100 }, { bettor_pk: 'bb', direction: 0, stake_amount: 200 }],
  s1: [{ bettor_pk: 'cc', direction: 1, stake_amount: 150 }],
};
const honestLoaded = [
  { pk: 'aa', direction: 0, stake: 100 }, { pk: 'bb', direction: 0, stake: 200 }, { pk: 'cc', direction: 1, stake: 150 },
];

// mock db routing by SQL text
function mockDb({ shards, rows, hasPS = false }) {
  return {
    prepare(sql) {
      if (/FROM market_shards/.test(sql)) return { all: () => shards };
      if (/FROM payout_shards/.test(sql)) return { get: () => (hasPS ? { x: 1 } : undefined) };
      if (/FROM pool_bettor_sides/.test(sql)) return { all: (mid) => rows[mid] || [] };
      return { all: () => [], get: () => undefined };
    },
  };
}
// honest on-chain ticket set = `${pk}:${dir}:${stake}`; checkUtxoLanded false for anything not in it (= swapped/fabricated).
function mockCtx({ shards, rows, hasPS, onChainTickets }) {
  const ticketSet = onChainTickets || new Set(Object.values(rows).flat().map(r => `${r.bettor_pk}:${r.direction}:${r.stake_amount}`));
  return {
    db: mockDb({ shards, rows, hasPS }),
    p2sh: (redeem) => 'L:' + String(redeem).slice(0, 12),                 // leaf addr (chain-anchor mock)
    deriveTicketAddr: ({ bettorPk, direction, stake }) => 't:' + `${bettorPk}:${direction}:${stake}`,
    checkUtxoLanded: async (addr) => {
      if (String(addr).startsWith('L:')) return true;                     // leaf state always landed (honest chain)
      if (String(addr).startsWith('t:')) return ticketSet.has(String(addr).slice(2));
      return false;
    },
  };
}

(async () => {
  console.log('== T1: honest (A) market → ok:true, per-ticket verified ==');
  const r1 = await verifyBettorsCompleteFromChain(MID, honestLoaded, mockCtx({ shards: honestShards(), rows: honestRows }));
  ok(r1.ok === true, `ok (reason=${r1.reason || '-'})`);
  ok(r1.aggregate && r1.aggregate.count === 3 && r1.aggregate.pool === '450', 'aggregate count=3 pool=450');
  ok(r1.perTicketVerified === true && r1.perTicketChecked === 3, 'per-ticket: 3 tickets verified');

  console.log('== T2: anti-omission (settler drops a bettor from loaded) ==');
  const r2 = await verifyBettorsCompleteFromChain(MID, honestLoaded.slice(0, 2), mockCtx({ shards: honestShards(), rows: honestRows }));
  ok(r2.ok === false && /anti-omission|count/.test(r2.reason), `rejected: ${r2.reason}`);

  console.log('== T3: anti-direction-tamper (flip a loaded bettor YES→NO, Σtotal same) ==');
  const flipped = [{ pk: 'aa', direction: 1, stake: 100 }, { pk: 'bb', direction: 0, stake: 200 }, { pk: 'cc', direction: 1, stake: 150 }];
  const r3 = await verifyBettorsCompleteFromChain(MID, flipped, mockCtx({ shards: honestShards(), rows: honestRows }));
  ok(r3.ok === false && /dir-tamper|YES|NO/.test(r3.reason), `rejected: ${r3.reason}`);

  console.log('== T4: anti-swap (equal-stake identity swap: aggregate intact, fabricated ticket) ==');
  // settler swaps real cc(NO,150) → fake zz(NO,150): aggregate identical, but zz ticket not on chain.
  const swapRows = { s0: honestRows.s0, s1: [{ bettor_pk: 'zz', direction: 1, stake_amount: 150 }] };
  const swapLoaded = [{ pk: 'aa', direction: 0, stake: 100 }, { pk: 'bb', direction: 0, stake: 200 }, { pk: 'zz', direction: 1, stake: 150 }];
  // on-chain tickets still hold the REAL cc (zz never registered)
  const onChain = new Set(['aa:0:100', 'bb:0:200', 'cc:1:150']);
  const r4 = await verifyBettorsCompleteFromChain(MID, swapLoaded, mockCtx({ shards: honestShards(), rows: swapRows, onChainTickets: onChain }));
  ok(r4.ok === false && /anti-swap|ticket/.test(r4.reason), `rejected: ${r4.reason}`);

  console.log('== T5: leaf-state chain-anchor fail (DB state tampered, leaf addr not landed) ==');
  const ctx5 = mockCtx({ shards: honestShards(), rows: honestRows });
  ctx5.checkUtxoLanded = async (addr) => !String(addr).startsWith('L:');   // leaf addr NOT landed
  const r5 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx5);
  ok(r5.ok === false && /链锚|篡改/.test(r5.reason), `rejected: ${r5.reason}`);

  console.log('== T6: (A)-model gate — no shards + no PayoutShard → N/A (ok:true, applicable:false) ==');
  const r6 = await verifyBettorsCompleteFromChain(MID, honestLoaded, mockCtx({ shards: [], rows: {}, hasPS: false }));
  ok(r6.ok === true && r6.applicable === false, `N/A: ${r6.reason}`);

  console.log('== T7: (A)-model gate — PayoutShard exists but shards wiped → fail-loud (堵绕 C1) ==');
  const r7 = await verifyBettorsCompleteFromChain(MID, honestLoaded, mockCtx({ shards: [], rows: {}, hasPS: true }));
  ok(r7.ok === false && /缺失|篡改|fail-loud/.test(r7.reason), `fail-loud: ${r7.reason}`);

  console.log('== T8: missing chain primitive (no p2sh) → fail-loud (拒 DB-only 聚合) ==');
  const ctx8 = mockCtx({ shards: honestShards(), rows: honestRows });
  delete ctx8.p2sh;
  const r8 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx8);
  ok(r8.ok === false && /p2sh|checkUtxoLanded|DB-only/.test(r8.reason), `fail-loud: ${r8.reason}`);

  console.log('== T9: no db → fail-loud ==');
  const r9 = await verifyBettorsCompleteFromChain(MID, honestLoaded, {});
  ok(r9.ok === false && /ctx.db/.test(r9.reason), `fail-loud: ${r9.reason}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
