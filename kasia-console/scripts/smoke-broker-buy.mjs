// smoke-broker-buy.mjs — Phase 4 A 模式撮合 smoke (T-J2-08)
// 造 1 open KAS sell offer + 1 user → DM "买 50 KAS" → 报价 → "YES" → broadcastAccept

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'crypto';

process.env.DB_PATH = process.env.DB_PATH || 'C:/kanet/kasia-console/data/console.db';
const db = new Database(process.env.DB_PATH);

const sent = [];
const fakeSend = async (relayId, cmd) => {
  sent.push({ relayId, ...cmd });
  return { ok: true, txId: 'smoke_' + randomBytes(8).toString('hex') };
};

const mkPeer = () => 'kaspa:q' + randomBytes(32).toString('hex');

function injectOffer({ giveKas, wantUsdt, makerAddr, payChain = 'bnb' }) {
  const id = randomUUID();
  const meta = JSON.stringify({ accepted_chains: [{ chain: payChain, address: '0xfA0eDb7C39c789bb000000000000000000d0E001' }] });
  db.prepare(`
    INSERT INTO exchange_offers (id, broadcast_tx_id, message_index, give_asset, give_amount, want_asset, want_amount, maker, market_key, protocol_status, verification, verification_meta, expires_at, created_at, updated_at)
    VALUES (?, ?, 0, 'KAS', ?, 'USDT', ?, ?, 'sell_kas_bnb', 'open', 'cross_chain_tx', ?, ?, ?, ?)
  `).run(
    id, 'smoke_offer_' + id.slice(0, 8),
    String(giveKas), String(wantUsdt), makerAddr, meta,
    new Date(Date.now() + 3600_000).toISOString(),
    new Date().toISOString(), new Date().toISOString()
  );
  return id;
}

function cleanup() {
  db.prepare(`DELETE FROM exchange_offers WHERE broadcast_tx_id LIKE 'smoke_offer_%'`).run();
}

async function run() {
  cleanup();
  const mod = await import('../src/services/broker-buy-handler.js');
  mod._testInjectSendCommand(fakeSend);
  mod._clearQuotes();

  const user = mkPeer();
  const makerAddr = mkPeer();

  // Inject 1 open offer (better price)
  const offerId = injectOffer({ giveKas: '50', wantUsdt: '1.7000', makerAddr });
  console.log('injected offer:', offerId.slice(0, 8));

  // Step 1: user "买 50 KAS"
  const r1 = await mod.handleBuyIntent(user, '买 50 KAS');
  console.log('Step1 reply:', (r1 || '').replace(/\n/g, ' ↵ ').slice(0, 200));
  const has = mod._hasQuote(user);

  // Step 2: user "YES"
  const r2 = await mod.handleBuyIntent(user, 'YES');
  console.log('Step2 reply:', (r2 || '').replace(/\n/g, ' ↵ ').slice(0, 200));

  // Step 3: 不相关消息 (cancel quote 已被消耗)
  const r3 = await mod.handleBuyIntent(user, 'hello world');

  // Step 4: 取消场景
  const u2 = mkPeer();
  await mod.handleBuyIntent(u2, '买 50 KAS');
  const r4cancel = await mod.handleBuyIntent(u2, '取消');

  // Step 5: 无匹配 offer (qty 太大)
  const u3 = mkPeer();
  const r5 = await mod.handleBuyIntent(u3, '买 999999 KAS');

  const checks = [
    [r1?.includes('报价') && r1?.includes('1.700000'), 'Case 1 报价含单价'],
    [has, 'Case 1 quote 存内存'],
    [sent.some(s => s.type === 'send_broadcast' && s.channel === 'kanet-exchange'), 'Case 2 YES → 广播 accept_v1'],
    [r2?.includes('已上链'), 'Case 2 reply 含上链证据'],
    [r3 === null, 'Case 3 不相关消息 (quote 已消耗) → null'],
    [r4cancel?.includes('取消报价'), 'Case 4 取消文本'],
    [r5?.includes('无') && r5?.includes('卖单'), 'Case 5 无匹配 → 友好提示'],
  ];
  let ok = 0;
  for (const [p, l] of checks) { console.log(`${p ? '✓' : '✗'} ${l}`); if (p) ok++; }
  console.log(`\n${ok}/${checks.length} PASS${ok === checks.length ? ' ✓' : ' ✗'}`);

  cleanup();
  mod._testResetSendCommand();
  mod._clearQuotes();
  process.exit(ok === checks.length ? 0 : 1);
}

run().catch(e => { console.error('SMOKE ERR:', e.stack || e.message); cleanup(); process.exit(1); });
