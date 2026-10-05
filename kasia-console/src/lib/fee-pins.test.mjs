// fee-pins.test.mjs — 账本1855 A: console 侧 fee UTXO 钉住。Run: cd kasia-console && node src/lib/fee-pins.test.mjs
// 零 RPC/零 DB 客户端(伪 db 只验派生逻辑)。relay 侧过滤器另见 kasia-relay/src/lib/utxo-pin.test.mjs。
const { deriveClosePins, resyncClosePins, pinFeeUtxo, unpinFeeUtxo, CLOSE_PIN_TTL_MS } = await import('./fee-pins.mjs');
const { resolveMaxLiveMarkets, liveMarketCapReached } = await import('./mainnet-no-kas-stake-gate.mjs');
let fails = 0; const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const H = (c) => c.repeat(32);
const meta = (fee) => JSON.stringify({ bshard_close_request_v2: { closeInputs: { payoutshard: {}, fee } } });
const fakeDb = (rows) => ({ prepare: () => ({ all: () => rows }) });
const origErr = console.error; let errLines = [];
const quiet = (f) => async () => { console.error = (...a) => errLines.push(a.join(' ')); try { return await f(); } finally { console.error = origErr; } };

console.log('[test] deriveClosePins');
{
  const rows = [
    { id: 'm-good-1', metadata: meta({ address: 'kaspa:x', outpointTxid: H('aa'), index: 0 }) },
    { id: 'm-bad-json', metadata: '{not json' },
    { id: 'm-no-fee', metadata: JSON.stringify({ bshard_close_request_v2: { closeInputs: {} } }) },
    { id: 'm-bad-txid', metadata: meta({ outpointTxid: 'zz', index: 0 }) },
    { id: 'm-bad-index', metadata: meta({ outpointTxid: H('bb'), index: -1 }) },
    { id: 'm-good-2', metadata: meta({ address: 'kaspa:y', outpointTxid: H('CC'), index: 2 }) },   // 大写 ⇒ 规整为小写
  ];
  errLines = [];
  const r = await quiet(async () => deriveClosePins(fakeDb(rows)))();
  ok(r.pins.length === 2 && r.pins[0].txid === H('aa') && r.pins[1].txid === H('cc') && r.pins[1].index === 2, '好盘全部派生(大写 txid 规整为小写)');
  ok(r.held.length === 4 && ['m-bad-json', 'm-no-fee', 'm-bad-txid', 'm-bad-index'].every((id) => r.held.some((h) => h.marketId === id)), '坏盘只 HOLD 该盘, 不影响其余(其余盘仍被 pin)');
  ok(errLines.length === 4 && errLines.every((l) => /🔴/.test(l) && /HOLD/.test(l)), '每个坏盘都 LOUD 一行(🔴 + HOLD)');
}

console.log('[test] resyncClosePins / pinFeeUtxo / unpinFeeUtxo');
{
  const sent = [];
  const send = async (c) => { sent.push(c); return { ok: true }; };
  const rows = [{ id: 'm1', metadata: meta({ outpointTxid: H('aa'), index: 0 }) }, { id: 'm2', metadata: 'bad' }, { id: 'm3', metadata: meta({ outpointTxid: H('dd'), index: 1 }) }];
  const holds = [];
  const r = await quiet(() => resyncClosePins({ db: fakeDb(rows), send, onHold: (id, why) => holds.push(id) }))();
  ok(r.pinned === 2 && r.held === 1 && r.failed === 0 && holds.join() === 'm2', 'resync: 2 pinned / 1 held(m2), onHold 回调只给坏盘');
  ok(sent.length === 2 && sent.every((c) => c.type === 'pin_utxo' && c.ttl_ms === CLOSE_PIN_TTL_MS && /^[0-9a-f]{64}$/.test(c.txid)), '只发 pin_utxo(不发任何选币/花费类命令), 带 TTL');
  // relay 报错/抛错 ⇒ 不 throw, 计 failed, 其余照常
  let n = 0; const flaky = async () => { n++; if (n === 1) throw new Error('Relay not running'); return { ok: false, error: 'invalid command' }; };
  const r2 = await quiet(() => resyncClosePins({ db: fakeDb(rows.slice(0, 1).concat(rows.slice(2))), send: flaky }))();
  ok(r2.pinned === 0 && r2.failed === 2, 'relay 抛错/拒绝 ⇒ failed 计数, 不 throw');
  ok((await quiet(() => pinFeeUtxo(async () => { throw new Error('boom'); }, { txid: H('aa'), index: 0 }))()).ok === false, 'pinFeeUtxo 失败不 throw');
  ok((await unpinFeeUtxo(send, { txid: H('aa'), index: 0 })).ok === true && sent.at(-1).type === 'unpin_utxo', 'unpin 发 unpin_utxo');
  // 关闭开关 ⇒ 全 no-op(负对照用)
  process.env.ZK_FEE_PINS_DISABLED = '1'; const before = sent.length;
  const r3 = await resyncClosePins({ db: fakeDb(rows), send });
  const r4 = await pinFeeUtxo(send, { txid: H('aa'), index: 0 });
  ok(r3.skipped === 'disabled' && r4.skipped === 'disabled' && sent.length === before, 'ZK_FEE_PINS_DISABLED=1 ⇒ 零命令(仅测试负对照用)');
  delete process.env.ZK_FEE_PINS_DISABLED;
}

console.log('[test] ZK_MAX_LIVE_MARKETS');
{
  const e = (v) => resolveMaxLiveMarkets(v === undefined ? {} : { ZK_MAX_LIVE_MARKETS: v });
  ok(e(undefined) === 1 && e('') === 1 && e('0') === 1 && e('-1') === 1 && e('abc') === 1 && e('2.5') === 1 && e('101') === 1, '未设/非法/越界 ⇒ 1(fail-closed)');
  ok(e('5') === 5 && e('100') === 100 && e(' 3 ') === 3, '合法值采纳(1..100)');
  const db = (n) => ({ prepare: () => ({ all: () => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, protocol_status: 'pending_bettors', metadata: '{}' })) }) });
  ok(liveMarketCapReached(db(2), { ZK_MAX_LIVE_MARKETS: '3' }) === null, '2/3 ⇒ 未满');
  const full = liveMarketCapReached(db(3), { ZK_MAX_LIVE_MARKETS: '3' });
  ok(full && full.live === 3 && full.cap === 3 && full.ids.length === 3, '3/3 ⇒ 已满(带清单)');
  ok(liveMarketCapReached(db(1), {})?.cap === 1, '未设 + 已有 1 ⇒ 1/1 已满(原一次一盘)');
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
