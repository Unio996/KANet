// Bug-Z4 scope probe: which SELL phrasings are misclassified? 
const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const NWT_USER = 'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm';
const cases = [
  '我要卖 99 KAS',                          // baseline misclass case
  '我想卖 30 KAS',                          // 我想 + 卖
  '想卖 30 KAS',                            // 想卖 直接
  '卖 30 KAS',                              // 纯 卖
  'I want to sell 50 KAS',                  // EN want+sell (BUY 含 want)
  'sell 50 KAS',                            // 纯 sell
  '我要买 50 KAS',                          // 我要 + 买 (control: should BUY)
  '我要换 50 KAS USDT',                     // 换 (BUY 同义)
  '我要出售 30 KAS',                        // 我要 + 出售
  '我要抛 30 KAS',                          // 我要 + 抛
];

for (const msg of cases) {
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: NWT_USER, message: msg }),
  });
  const data = await res.json();
  const reply = (data.reply || data.error || '').slice(0, 100);
  // crude classify: look for 'buy/买' vs 'sell/卖' in broker reply
  const said_buy = /\bbuy\b|买/i.test(reply) && !/\bsell\b|卖/i.test(reply);
  const said_sell = /\bsell\b|卖/i.test(reply) && !/\bbuy\b|买/i.test(reply);
  const verdict = said_buy ? 'BUY' : said_sell ? 'SELL' : 'AMBIG';
  console.log(`  ${verdict.padEnd(5)} | ${msg.padEnd(35)} → ${reply.replace(/\n/g, ' ')}`);
  await new Promise(r => setTimeout(r, 800));
}
