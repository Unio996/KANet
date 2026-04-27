// smoke-broker-multilang.mjs — 通过 Console /api/agent/reply 走真 LLM dialog 层
// 测试 Trader-B 对多语言/模糊表达的粘合能力
// 不动数据库, 每个测试用临时用户地址, 跑完清理

import { randomBytes } from 'crypto';

const CONSOLE = 'http://127.0.0.1:3100';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'; // Trader-B

function mkUserAddr() {
  return 'kaspa:q' + randomBytes(32).toString('hex');
}

async function dm(peer, message) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${CONSOLE}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, peer, message }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json();
    return { ms: Date.now() - t0, status: res.status, reply: data.reply || data.error || '<empty>' };
  } catch (e) {
    return { ms: Date.now() - t0, status: 'ERR', reply: e.message };
  }
}

async function conversation(label, turns) {
  const user = mkUserAddr();
  console.log('\n' + '━'.repeat(76));
  console.log(`▶ ${label}   (user=${user.slice(-12)})`);
  console.log('━'.repeat(76));
  for (const msg of turns) {
    console.log(`USER: ${msg}`);
    const r = await dm(user, msg);
    const preview = String(r.reply).replace(/\n/g, ' ↵ ').slice(0, 400);
    console.log(`BROKER (${r.ms}ms ${r.status}): ${preview}`);
  }
}

async function run() {
  console.log('Broker=Trader-B adapter=NVIDIA qwen3-coder-480b\n');

  // 多语言单轮: 看 LLM 能否听懂 + 回哪种语言
  const quickLangs = [
    ['zh-simple',    '买5 KAS'],
    ['zh-colloquial', '想买点 KAS 玩玩'],
    ['zh-fuzzy',     '给我来50个kas呗'],
    ['en',           'I want to buy 50 KAS'],
    ['ja',           'KASを50個買いたい'],
    ['ko',           'KAS 50개 사고 싶어요'],
    ['fr',           'je voudrais acheter 50 KAS'],
    ['es',           'quiero comprar 50 KAS'],
    ['th',           'ขอซื้อ KAS 50 เหรียญ'],
    ['ru',           'Хочу купить 50 KAS'],
    ['ar',           'أريد شراء 50 KAS'],
  ];
  for (const [lang, msg] of quickLangs) {
    await conversation(`LANG ${lang}`, [msg]);
  }

  // 小额边界: LLM 是否会建议/警告
  await conversation('小额 0.5 KAS (<MIN)', ['买 0.5 个 KAS']);
  await conversation('中额 5 KAS', ['买 5 个 KAS']);
  await conversation('超额 2000 KAS', ['买 2000 个 KAS']);

  // 多轮: 用户只说目的, broker 应追问
  await conversation('多轮中文-逐步', [
    '我想买 KAS',
    '大概 50 个',
    'BSC 网络',
  ]);

  // 多轮英文
  await conversation('多轮英文-逐步', [
    "Hi, I'd like to get some KAS",
    'around 30',
    'I have USDT on Base',
  ]);

  // 取消
  await conversation('取消场景', [
    '买 50 KAS',
    '算了不买了',
  ]);

  console.log('\nDONE');
}

run().catch(e => { console.error(e); process.exit(1); });
