// smoke-broker-ux.mjs — Broker 粘合体验压测 (only parseIntent + 状态机, 不启动 monitor)
//
// 目标: 模拟用户 DM broker, 观察粘合能力 (意图解析 / offer 选择 / quote / 错误提示 / 小额边界)
// 不触发真实付款, 不启动 orderMonitorTick, 不跑 LLM 对话层 (qwen 当前未启动)
//
// Run: cd kasia-console && DB_PATH=./data/console.db node scripts/smoke-broker-ux.mjs

import { randomBytes } from 'crypto';
import { sqlite } from '../src/db/client.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'; // Trader-B

function mkUserAddr() {
  // 造测试地址: kaspa:q + 64 hex
  return 'kaspa:q' + randomBytes(32).toString('hex');
}

function banner(t) {
  console.log('\n' + '─'.repeat(70));
  console.log(t);
  console.log('─'.repeat(70));
}

function summary(label, reply, order) {
  console.log(`[${label}]`);
  console.log('  reply:', (reply || '').replace(/\n/g, ' ↵ ').slice(0, 280));
  if (order) {
    console.log(`  order: ${order.id.slice(0,8)} state=${order.state} side=${order.side} qty=${order.qty} price=${order.price} quoted_usdt=${order.quoted_usdt} agent_pay_addr=${(order.agent_pay_addr||'').slice(0,24)}... offer=${(order.exchange_offer_id||'').slice(0,8)} err=${order.error_reason||''}`);
  }
}

async function run() {
  const { handleDm, selectBestOffer, parseIntent } = await import('../src/services/retail-dex.js');

  banner('STEP 0 · 市场当前 offers (what broker has to pick from)');
  const opens = sqlite.prepare(`
    SELECT substr(id,1,8) id, give_asset, give_amount, want_asset, want_amount, maker,
           CAST(want_amount AS REAL)/CAST(give_amount AS REAL) AS unit_price,
           verification_meta
    FROM exchange_offers WHERE protocol_status='open'
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    ORDER BY unit_price
  `).all();
  for (const o of opens) {
    let meta; try { meta = JSON.parse(o.verification_meta || '{}'); } catch { meta = {}; }
    const chains = (meta.accepted_chains || []).map(c => c.chain).join(',');
    const nameRow = sqlite.prepare('SELECT name FROM relay_nodes WHERE address=?').get(o.maker);
    const who = nameRow?.name || 'EXTERNAL';
    console.log(`  ${o.id} ${who.padEnd(12)} ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset} @ ${o.unit_price.toFixed(6)} chains=[${chains||'NONE'}]`);
  }

  banner('STEP 1 · parseIntent 覆盖矩阵 (纯文本解析)');
  const intentTests = [
    '买5 KAS', '买 5 KAS', '买5个KAS', '买5只KAS', '买5kas', 'buy 5 KAS',
    '买50 KAS @ 0.03', '买50 KAS @0.03', 'buy 50 KAS @ 0.03 USDT',
    '卖30 KAS', 'sell 30 KAS @ 0.04',
    '能买点 KAS 吗', '买一些KAS', '买几个KAS', '买半个KAS',
    '买5 KAS BSC', // 这会失败吗? intent 不解析 chain
  ];
  for (const t of intentTests) {
    const r = parseIntent(t);
    console.log(`  "${t}".padEnd(28) → ${JSON.stringify(r)}`);
  }

  banner('STEP 2 · 小额买场景 (1-5 KAS, 最小可卖边界)');
  for (const qty of ['1', '3', '5', '10']) {
    const user = mkUserAddr();
    const reply = await handleDm(user, `买${qty} KAS`, BROKER_RELAY_ID);
    const ord = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=?').get(user);
    summary(`buy${qty}`, reply, ord);
  }

  banner('STEP 3 · 中额场景 (25-50 KAS, 应该能匹配)');
  for (const qty of ['25', '50']) {
    const user = mkUserAddr();
    const reply = await handleDm(user, `买${qty} KAS`, BROKER_RELAY_ID);
    const ord = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=?').get(user);
    summary(`buy${qty}`, reply, ord);
  }

  banner('STEP 4 · 超额/边界 (100+ KAS, 应触发超额保护)');
  for (const qty of ['100', '200', '1000']) {
    const user = mkUserAddr();
    const reply = await handleDm(user, `买${qty} KAS`, BROKER_RELAY_ID);
    const ord = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=?').get(user);
    summary(`buy${qty}`, reply, ord);
  }

  banner('STEP 5 · 限价买 (走 _triggerBuyPublication + seeder)');
  const user5 = mkUserAddr();
  const reply5 = await handleDm(user5, '买50 KAS @ 0.03', BROKER_RELAY_ID);
  const ord5 = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=?').get(user5);
  summary('limit_50@0.03', reply5, ord5);
  const pub = sqlite.prepare('SELECT id, state, seeder_relay_id, total_usdt FROM retail_dex_buy_publications WHERE user_kasia_address=?').get(user5);
  console.log('  pub:', pub);

  banner('STEP 6 · 多轮对话 (用户先下单, 再发别的 message)');
  const user6 = mkUserAddr();
  console.log('  TURN 1:');
  const t1 = await handleDm(user6, '买5 KAS', BROKER_RELAY_ID);
  const o1 = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=?').get(user6);
  summary('turn1', t1, o1);
  console.log('  TURN 2 (发随意文本):');
  const t2 = await handleDm(user6, '啊这个订单我看看', BROKER_RELAY_ID);
  const o2 = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=? ORDER BY created_at DESC LIMIT 1').get(user6);
  summary('turn2', t2, o2);
  console.log('  TURN 3 (确认):');
  const t3 = await handleDm(user6, 'YES', BROKER_RELAY_ID);
  const o3 = sqlite.prepare('SELECT * FROM retail_dex_orders WHERE user_kasia_address=? ORDER BY created_at DESC LIMIT 1').get(user6);
  summary('turn3', t3, o3);

  banner('STEP 7 · selectBestOffer 直接观察 (对不同 qty 选哪家)');
  for (const qty of ['3', '10', '25', '50', '100']) {
    const fake = { side: 'buy_kas', pay_chain: 'bnb', qty };
    const best = selectBestOffer(fake);
    if (best) {
      const nameRow = sqlite.prepare('SELECT name FROM relay_nodes WHERE address=?').get(best.maker);
      const who = nameRow?.name || 'EXTERNAL';
      const price = parseFloat(best.want_amount) / parseFloat(best.give_amount);
      console.log(`  qty=${qty.padStart(4)} → ${who.padEnd(12)} offer=${best.id.slice(0,8)} ${best.give_amount} KAS @ ${price.toFixed(6)} USDT/KAS`);
    } else {
      console.log(`  qty=${qty.padStart(4)} → NO MATCH`);
    }
  }

  banner('STEP 8 · 清理本次测试订单');
  const deleted = sqlite.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:q%' AND created_at > datetime('now','-10 minutes')`).run();
  console.log('  deleted:', deleted.changes, 'test orders');
  const pubDel = sqlite.prepare(`DELETE FROM retail_dex_buy_publications WHERE user_kasia_address LIKE 'kaspa:q%' AND created_at > datetime('now','-10 minutes') AND state='awaiting_deposit'`).run();
  console.log('  deleted:', pubDel.changes, 'test publications');

  banner('DONE');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
