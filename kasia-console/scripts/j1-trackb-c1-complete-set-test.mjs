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
// cross-node snapshot ctx (no db; ctx.shards snapshot per-shard bettors + psConsolidatedPool 链锚)。
const SEED = 20000000;
const snapshotShards = () => ([
  { ...honestShards()[0], shard_pool_id: 'sp0', bettors: [{ pk: 'aa', direction: 0, stake: 100 }, { pk: 'bb', direction: 0, stake: 200 }] },
  { ...honestShards()[1], shard_pool_id: 'sp1', bettors: [{ pk: 'cc', direction: 1, stake: 150 }] },
]);
function crossNodeCtx({ shards, psConsolidatedPool, onChainTickets }) {
  const ticketSet = onChainTickets || new Set([['aa', 0, 100], ['bb', 0, 200], ['cc', 1, 150]].map(([p, d, s]) => `${p}:${d}:${s}`));
  return {
    shards, psConsolidatedPool,   // snapshot, NO db (cross-node)
    p2sh: (redeem) => 'L:' + String(redeem).slice(0, 12),
    deriveTicketAddr: ({ bettorPk, direction, stake }) => 't:' + `${bettorPk}:${direction}:${stake}`,
    checkUtxoLanded: async (addr) => {
      if (String(addr).startsWith('L:')) return true;
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

  console.log('== T10: 级2-B silent-skip regression (级2-A pass 但缺 ticket primitive → 必 fail-loud, 非 ok:true) ==');
  // 我 8f633291 引入的洞 (Bettor A1 红队抓): canTicket=false 时旧码静默返 ok:true → identity-swap 漏过。修后必 ok:false。
  const ctx10 = mockCtx({ shards: honestShards(), rows: honestRows });
  delete ctx10.deriveTicketAddr;   // 只剩级2-A primitive (p2sh+checkUtxoLanded), 无 ticket addr 派生 → canTicket=false
  const r10 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx10);
  ok(r10.ok === false && r10.perTicketVerified === false && /级2-B|ticket primitive/.test(r10.reason), `fail-loud (非 silent-skip): ${r10.reason}`);

  console.log('== T11: cross-node snapshot (ctx.shards 无 db) + PS-pool honest → ok ==');
  const r11 = await verifyBettorsCompleteFromChain(MID, honestLoaded, crossNodeCtx({ shards: snapshotShards(), psConsolidatedPool: SEED + 450 }));
  ok(r11.ok === true && r11.perTicketVerified === true && r11.perTicketChecked === 3, `cross-node ok (reason=${r11.reason || '-'})`);

  console.log('== T12: PS-pool 链锚 omit-shard 变体① (consolidated_pool 含漏片但 loaded 不含 → BUST) ==');
  const r12 = await verifyBettorsCompleteFromChain(MID, honestLoaded, crossNodeCtx({ shards: snapshotShards(), psConsolidatedPool: SEED + 600 }));
  ok(r12.ok === false && /PS-pool/.test(r12.reason), `omit-shard 变体① BUST: ${r12.reason}`);

  // ── level2-A landed-in-history (ozzeu live-catch fix 2026-06-23) ──
  //    (A)-model close 先 consolidate (spend ShardLeaf→PS) → enforce 时 leaf UTXO spent → checkUtxoLanded(unspent) false
  //    → 委员诚实拒签 (pipeline 0/4)。fix: ctx.readOutpointCreatedAddr (创建-tx output 地址, 与 spent 无关) 做 landed-in-history。
  //    leafAddr 与 lib 完全同算 (镜像 _spliceLeafState + mock p2sh = 'L:'+spliced.slice(0,12))。
  const _pushI64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return Buffer.concat([Buffer.from([0x08]), b]); };
  const _spliceLeafStateTest = (baseHex, st) => {
    const stateHex = Buffer.concat([_pushI64LE(st.local_yes), _pushI64LE(st.local_no), _pushI64LE(st.count), _pushI64LE(st.pool_value)]);
    const r = Buffer.from(baseHex, 'hex');
    return Buffer.concat([r.slice(0, 1), stateHex, r.slice(1 + stateHex.length)]).toString('hex');
  };
  const _leafAddrFor = (sh) => 'L:' + _spliceLeafStateTest(sh.shard_redeem_hex, JSON.parse(sh.current_leaf_state)).slice(0, 12);
  const honestLeafAddrByOutpoint = { 'tx0:0': _leafAddrFor(honestShards()[0]), 'tx1:0': _leafAddrFor(honestShards()[1]) };
  // leaf 已 spent (consolidate 后): checkUtxoLanded 对 leaf(L:) 返 false, ticket(t:) 仍按真链。
  const spentLeafLanded = (ticketSet) => async (addr) => {
    if (String(addr).startsWith('L:')) return false;                         // leaf spent (post-consolidate)
    if (String(addr).startsWith('t:')) return ticketSet.has(String(addr).slice(2));
    return false;
  };
  const honestTickets = new Set(['aa:0:100', 'bb:0:200', 'cc:1:150']);

  // J2 hook 签名: ctx.readTxOutput(txid, idx) -> {address, amount_sompi} | null (查 kaspa_tx_log.outputs_json[idx])。
  const honestReadTxOutput = async (txid, idx) => {
    const a = honestLeafAddrByOutpoint[`${txid}:${idx}`];
    return a ? { address: a, amount_sompi: '0' } : null;
  };

  console.log('== T13: landed-in-history — leaf SPENT (post-consolidate) 但创建-tx output[idx] 地址对 → ok ==');
  const ctx13 = mockCtx({ shards: honestShards(), rows: honestRows });
  ctx13.checkUtxoLanded = spentLeafLanded(honestTickets);
  ctx13.readTxOutput = honestReadTxOutput;
  const r13 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx13);
  ok(r13.ok === true && r13.perTicketVerified === true, `leaf spent + readTxOutput landed-in-history → ok: ${r13.reason || '-'}`);

  console.log('== T14: forge-leaf — 创建-tx output 地址 != p2sh(spliceLeafState) (假 state/swap) → BUST (provenance 不丢) ==');
  const ctx14 = mockCtx({ shards: honestShards(), rows: honestRows });
  ctx14.checkUtxoLanded = spentLeafLanded(honestTickets);
  ctx14.readTxOutput = async () => ({ address: 'L:FORGED_WRONG', amount_sompi: '0' });  // 指向别处 forge 的同址 leaf → 不符
  const r14 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx14);
  ok(r14.ok === false && /链锚|landed-in-history/.test(r14.reason), `forge-leaf BUST: ${r14.reason}`);

  console.log('== T15: 无 readTxOutput + leaf spent → fail-loud (unspent-fallback false, 不静默过) ==');
  const ctx15 = mockCtx({ shards: honestShards(), rows: honestRows });
  ctx15.checkUtxoLanded = spentLeafLanded(honestTickets);                    // 无 readTxOutput → 回退 unspent → false
  const r15 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx15);
  ok(r15.ok === false && /链锚|unspent-fallback|landed-in-history hook/.test(r15.reason), `无 hook + spent leaf fail-loud: ${r15.reason}`);

  console.log('== T16: readTxOutput 返 null (创建-tx 不在本地 indexer) → fail-loud BUST (不盲信) ==');
  const ctx16 = mockCtx({ shards: honestShards(), rows: honestRows });
  ctx16.checkUtxoLanded = spentLeafLanded(honestTickets);
  ctx16.readTxOutput = async () => null;                                     // indexer 查不到 → 不可链锚
  const r16 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx16);
  ok(r16.ok === false && /链锚|landed-in-history/.test(r16.reason), `readTxOutput null → BUST: ${r16.reason}`);

  console.log('== T17: leaf outpoint idx 非法 (无 :idx) → fail-loud ==');
  const ctx17 = mockCtx({ shards: [{ ...honestShards()[0], current_leaf_outpoint: 'tx0' }, honestShards()[1]], rows: honestRows });
  ctx17.checkUtxoLanded = spentLeafLanded(honestTickets);
  ctx17.readTxOutput = honestReadTxOutput;
  const r17 = await verifyBettorsCompleteFromChain(MID, honestLoaded, ctx17);
  ok(r17.ok === false && /idx 非法|链锚/.test(r17.reason), `idx 非法 fail-loud: ${r17.reason}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
