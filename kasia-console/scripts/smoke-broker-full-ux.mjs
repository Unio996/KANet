// smoke-broker-full-ux.mjs — 全面摸排 broker 粘合能力 (多轮/状态推进/取消/确认/卖场景/收货地址)
// 通过 Console /api/agent/reply 走真 LLM + 真状态机, 不做真付款

import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';

const CONSOLE = 'http://127.0.0.1:3100';
const BROKER = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });

function mkUser() { return 'kaspa:q' + randomBytes(32).toString('hex'); }

async function dm(peer, msg) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${CONSOLE}/api/agent/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: BROKER, peer, message: msg }),
      signal: AbortSignal.timeout(90_000),
    });
    const d = await r.json();
    return { ms: Date.now() - t0, reply: d.reply || '<empty>' };
  } catch (e) { return { ms: Date.now() - t0, reply: 'ERR: ' + e.message }; }
}

function ord(user) {
  return db.prepare('SELECT substr(id,1,8) id, state, side, qty, price, pay_chain, pay_address, quoted_usdt, exchange_offer_id, error_reason FROM retail_dex_orders WHERE user_kasia_address=? ORDER BY created_at DESC LIMIT 1').get(user);
}

async function conv(label, turns) {
  const u = mkUser();
  console.log('\n━━━ ' + label + ' ━━━  user=' + u.slice(-12));
  for (const t of turns) {
    const r = await dm(u, t);
    console.log(`USR: ${t}`);
    console.log(`BRK (${r.ms}ms): ${String(r.reply).replace(/\n/g, ' ↵ ').slice(0,300)}`);
  }
  const o = ord(u);
  if (o) console.log(`STATE: ${o.id} ${o.state} qty=${o.qty} chain=${o.pay_chain||'null'} usdt=${o.quoted_usdt||'null'} offer=${(o.exchange_offer_id||'null').slice(0,8)} err=${o.error_reason||'none'}`);
}

async function run() {
  console.log('开始全面摸排\n');

  // ── A 组: 用户表达方式的覆盖 ──
  await conv('A1 精准格式', ['买 50 KAS']);
  await conv('A2 口语 — 玩玩', ['想买点 KAS 玩玩']);
  await conv('A3 错别字', ['我要买5个 kas']);
  await conv('A4 带中文链名', ['买 50 KAS, 币安链付款']);
  await conv('A5 英文 BSC', ['buy 50 KAS, BSC network']);
  await conv('A6 拼音', ['wo yao mai 50 kas']);

  // ── B 组: 金额边界 ──
  await conv('B1 0.1 KAS (亚小额)', ['买 0.1 KAS']);
  await conv('B2 100 KAS (边界)', ['买 100 KAS']);
  await conv('B3 101 KAS (超 MAX)', ['买 101 KAS']);
  await conv('B4 10000 KAS (远超)', ['买 10000 KAS']);

  // ── C 组: 完整闭环对话 (推到 confirming) ──
  await conv('C1 完整 BSC 买单', ['买 50 KAS', 'BSC', 'YES']);
  await conv('C2 完整 ETH 买单', ['buy 20 KAS', 'Ethereum', 'confirm']);
  await conv('C3 错选链 (Base)', ['买 50 KAS', '我用 Base 链']);
  await conv('C4 不存在的链 (LTC)', ['买 50 KAS', '用 LTC 链付']);

  // ── D 组: 取消场景 ──
  await conv('D1 中文取消', ['买 50 KAS', '算了不买了']);
  await conv('D2 英文 cancel', ['buy 50 KAS', 'cancel it']);
  await conv('D3 中文反悔', ['买 50 KAS', '等等, 我再想想']);

  // ── E 组: 卖场景 (sell_kas 需收货地址) ──
  await conv('E1 卖 50 KAS BSC', ['卖 50 KAS']);
  await conv('E2 卖 KAS 带地址', ['卖 50 KAS, 收 USDT 到 0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe BSC']);

  // ── F 组: 信息查询类 (不下单) ──
  await conv('F1 问价格', ['KAS 现在什么价？']);
  await conv('F2 问 broker 是谁', ['你是谁？']);
  await conv('F3 问 fee', ['手续费多少？']);
  await conv('F4 问支持什么链', ['支持什么网络？']);

  // ── G 组: 限价相关 ──
  await conv('G1 限价标准', ['买 50 KAS, 心理价 0.03']);
  await conv('G2 限价过低 (0.001)', ['买 50 KAS, 限价 0.001']);
  await conv('G3 限价过高 (100)', ['买 50 KAS, 限价 100']);

  // ── H 组: 攻击/异常 ──
  await conv('H1 空消息', ['']);
  await conv('H2 乱码', ['@#$%^&*()']);
  await conv('H3 SQL 注入', ["买 50 KAS'; DROP TABLE retail_dex_orders;--"]);
  await conv('H4 超长输入', ['买' + 'KAS'.repeat(500) + ' 50']);

  console.log('\nDONE');
}

run().catch(e => { console.error(e); process.exit(1); });
