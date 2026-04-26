#!/usr/bin/env node
// NWT broker multi-turn probe — 真用户 4 步对话模拟 (UTF-8 安全 Node fetch)
// 用 J2 broker-probe.mjs 同范式, 加 multi-turn (turn1 意图 → turn2 链 → turn3 YES → turn4 我付了)
//
// 用法:
//   node scripts/nwt-broker-multiturn.mjs            # 默认 5 个完整对话场景
//   node scripts/nwt-broker-multiturn.mjs '中文'      # 只跑中文 2 个
//   node scripts/nwt-broker-multiturn.mjs '英文' '西文' # 多语言

const BROKER_RELAY = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

async function send(peer, msg) {
  const r = await fetch(`${URL}/api/agent/reply`, {
    method: 'POST', headers: {'Content-Type':'application/json; charset=utf-8'},
    body: JSON.stringify({relayNodeId: BROKER_RELAY, peer, message: msg}),
    signal: AbortSignal.timeout(45000),
  });
  return r.json().catch(() => ({}));
}

const SCENARIOS = {
  '中文-1': [
    { msg: '想买 50 KAS', expect: '问链' },
    { msg: 'BSC', expect: '复述确认' },
    { msg: '对', expect: 'finalize_order maker 地址' },
    { msg: '我付了 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd', expect: 'tx 兜底回复 (J2 R4)' },
  ],
  '中文-2 (口语)': [
    { msg: '搞 30 个 kas', expect: '问链' },
    { msg: '币安链', expect: '复述确认' },
    { msg: '可以', expect: 'finalize' },
  ],
  '英文': [
    { msg: 'I want to buy 100 KAS', expect: 'ask chain' },
    { msg: 'BSC', expect: 'recap confirm' },
    { msg: 'yes', expect: 'finalize' },
  ],
  '西文': [
    { msg: 'comprar 25 KAS', expect: 'ask chain' },
    { msg: 'BSC', expect: 'recap' },
    { msg: 'sí', expect: 'finalize' },
  ],
  '中文 卖路径': [
    { msg: '想卖 5 KAS', expect: '问链 + 收款地址' },
    { msg: 'BSC, 收款 0xACbCC246F230aEA51543E13cC8E8eD42c0F92D58', expect: '复述确认' },
    { msg: 'YES', expect: 'finalize_sell' },
  ],
};

const wantedKeys = process.argv.slice(2);
const toRun = wantedKeys.length === 0 ? Object.keys(SCENARIOS)
  : Object.keys(SCENARIOS).filter(k => wantedKeys.some(w => k.includes(w)));

console.log(`NWT multi-turn probe — ${toRun.length} scenario(s) on ${URL}\n`);

for (const key of toRun) {
  const scenario = SCENARIOS[key];
  const peer = `kaspa:mt_${key.replace(/[^a-z0-9]/gi,'')}_${Date.now().toString(36)}`;
  console.log(`━━━━━ ${key} (peer=${peer.slice(-12)}) ━━━━━`);
  for (let i = 0; i < scenario.length; i++) {
    const turn = scenario[i];
    const t0 = Date.now();
    const r = await send(peer, turn.msg);
    const dt = Date.now() - t0;
    const reply = (r.reply || r.error || '').slice(0,150);
    console.log(`  T${i+1} [${dt}ms] USER: "${turn.msg}"`);
    console.log(`        BOT : "${reply}"`);
    console.log(`        EXPECT: ${turn.expect}`);
    if (i < scenario.length - 1) await new Promise(r => setTimeout(r, 800));
  }
  console.log();
}
console.log('=== DONE ===');
