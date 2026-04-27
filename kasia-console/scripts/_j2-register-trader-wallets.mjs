// J2 #3 真 register Trader-A + Trader-B 9 chain × wallets (Owner 23:36 钦定不要等)
// 真 production prerequisite — broker 真接 7 EVM × USDT/USDC publish 真需要 receive address per chain
// 不真 fund (broker_dynamic 模式: user 真转 USDT 进 broker, broker 真发 KAS 出. broker 库存 KAS+BSC USDT/USDC 已 ready).

const TRADER_A = 'df8cd0f9-27e7-45c6-bbea-2fa11a1ff1cd';
const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

// chains.js CHAIN_META 真 source — 9 non-Kaspa chains (kaspa wallet relay 自带):
const CHAINS = ['bnb', 'eth', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base', 'sol', 'tron'];

async function register(relayId, chain, traderName) {
  const url = `http://127.0.0.1:3100/api/relay/${relayId}/wallets`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain, label: `${traderName} ${chain.toUpperCase()} (auto v1.1)` }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function existing(relayId) {
  const url = `http://127.0.0.1:3100/api/relay/${relayId}/wallets`;
  const r = await (await fetch(url)).json();
  const chains = (r.chains || []).map(c => c.chain);
  return new Set(chains);
}

console.log('=== J2 #3 真 register Trader-A + Trader-B 全 chain wallets (Owner 钦定不要等) ===\n');

for (const [relayId, name] of [[TRADER_A, 'Trader-A'], [TRADER_B, 'Trader-B']]) {
  console.log(`--- ${name} (${relayId.slice(0,8)}) ---`);
  const ex = await existing(relayId);
  console.log(`  existing chains: [${[...ex].join(',') || '(none)'}]`);

  for (const chain of CHAINS) {
    if (ex.has(chain)) {
      console.log(`  ${chain}: skip (already)`);
      continue;
    }
    const r = await register(relayId, chain, name);
    if (r.status === 200 || r.status === 201) {
      console.log(`  ${chain}: ✓ ${r.body?.address?.slice(0,40)}... (status ${r.status})`);
    } else {
      console.log(`  ${chain}: ✗ status=${r.status} body=${JSON.stringify(r.body).slice(0,200)}`);
    }
    await new Promise(rs => setTimeout(rs, 500));
  }
  console.log('');
}

console.log('=== 真 verify post-register ===');
for (const [relayId, name] of [[TRADER_A, 'Trader-A'], [TRADER_B, 'Trader-B']]) {
  const ex = await existing(relayId);
  console.log(`${name}: ${ex.size} wallets [${[...ex].sort().join(',')}]`);
}
