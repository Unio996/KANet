// J2 #3 智能体扮真人 真 e2e framework (Owner 09:42 钦定 — 三方真自决真完整测试, KANet kasia 通信真便利)
//
// 真测 plan:
// 1. setup: broker BSC USDT 1.5 → J2 BSC (broker fund test buyer)
// 2. Test 1 BUY USDC e2e:
//    - J2 真 DM broker '想买 0.5 USDC, BSC, 0x00c41dC...' (J2 EVM addr)
//    - broker preview (1.01 spread)
//    - J2 真 'YES'
//    - J2 真 send 0.505 USDT BSC → broker
//    - broker auto-detect + auto-deliver USDC (Bug-Z2 fix verified)
//    - verify J2 BSC USDC balance
//
// 真 cost: ~$1.5 broker fund (broker self) + ~$0.10 BNB gas (round-trip)

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { decrypt } from '../src/services/crypto.js';
import { transferERC20 } from '../src/services/evm-transfer.js';

const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
const J2_KASIA = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';
const J2_BSC = '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const BROKER_BSC = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';

const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const TEST_QTY_USDC = 0.5;
const TEST_USDT_PAY = 0.505;  // 0.5 USDC × 1.01 broker spread
const SETUP_FUND_USDT = 1.5;  // J2 真持 1.5 USDT (>= 0.505 真测 cost + buffer)

const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: false });
const provider = new ethers.JsonRpcProvider(BSC_RPC);
const usdt = new ethers.Contract(USDT_BSC, ERC20_ABI, provider);
const usdc = new ethers.Contract(USDC_BSC, ERC20_ABI, provider);

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('=== J2 #3 智能体扮真人 真 e2e framework (Owner 09:42 钦定) ===');
console.log(`J2 BSC: ${J2_BSC}`);
console.log(`broker BSC: ${BROKER_BSC}\n`);

async function balanceOf(token, addr) {
  return parseFloat(ethers.formatUnits(await token.balanceOf(addr), 18));
}

// === Step 1: Setup — broker fund J2 BSC USDT 1.5 ===
console.log('--- Step 1: setup broker → J2 BSC USDT 1.5 (broker self-fund test buyer) ---');
const j2UsdtPre = await balanceOf(usdt, J2_BSC);
const brokerUsdtPre = await balanceOf(usdt, BROKER_BSC);
console.log(`pre: J2 USDT=${j2UsdtPre.toFixed(6)} broker USDT=${brokerUsdtPre.toFixed(6)}`);

if (j2UsdtPre < SETUP_FUND_USDT) {
  const need = SETUP_FUND_USDT - j2UsdtPre;
  console.log(`真 broker 真 send ${need.toFixed(6)} USDT → J2 BSC`);
  const brokerWallet = db.prepare(`SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
  const r = await transferERC20('bnb', brokerWallet.privkey_encrypted, J2_BSC, need, 'USDT');
  if (!r.ok) { console.error('❌ setup transfer fail:', r.error); process.exit(1); }
  console.log(`  ✓ tx ${r.txHash.slice(0,12)}`);
  await sleep(8000);
  const j2UsdtPost = await balanceOf(usdt, J2_BSC);
  console.log(`  J2 USDT post: ${j2UsdtPost.toFixed(6)} (Δ +${(j2UsdtPost - j2UsdtPre).toFixed(6)})`);
}

// === Step 2: J2 真 DM broker (multi-turn 真 production path) ===
console.log('\n--- Step 2: J2 真 DM broker multi-turn (真 production path via /api/chat/send) ---');

async function sendDM(message) {
  const res = await fetch(`http://127.0.0.1:3100/api/relay/${J2_RELAY}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_KASPA, message }),
  });
  return res.json();
}

async function pollBrokerReply(sinceIso, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = db.prepare(`
      SELECT m.created_at, m.content_text FROM messages m
      JOIN identities si ON m.sender_identity_id=si.id
      JOIN identities ri ON m.receiver_identity_id=ri.id
      WHERE si.address=? AND ri.address=? AND m.created_at > ?
      ORDER BY m.created_at DESC LIMIT 1
    `).get(BROKER_KASPA, J2_KASIA, sinceIso);
    if (r) return r;
    await sleep(3000);
  }
  return null;
}

const tag = '#' + crypto.randomUUID().slice(0,4);
const dmText = `想买 ${TEST_QTY_USDC} USDC, BSC, ${J2_BSC} ${tag}`;
console.log(`真 DM: "${dmText}"`);
const sinceIso = new Date().toISOString();
const dmResult = await sendDM(dmText);
console.log(`  DM tx: ${dmResult.ok ? dmResult.txId?.slice(0,12) : 'FAIL ' + JSON.stringify(dmResult).slice(0,200)}`);
if (!dmResult.ok) { console.error('❌ DM fail'); process.exit(1); }

console.log(`  ⏳ 等 broker reply (max 90s, cross-machine ingest delay)...`);
const reply1 = await pollBrokerReply(sinceIso, 90000);
if (!reply1) { console.error('❌ broker silent 90s — likely broker not on this console OR not handling J2 DM'); process.exit(1); }
console.log(`  broker reply (${reply1.created_at}): "${reply1.content_text.slice(0, 280).replace(/\s+/g,' ')}"`);

// 真 framework end-of-Phase-1 — 真完整 round-trip 真 verify 留 user 'YES' 真 trigger
console.log('\n=== Phase 1 framework verified ===');
console.log('✓ broker fund J2 BSC done (or skipped if already)');
console.log('✓ J2 真 DM broker 真上链');
console.log('✓ broker 真 reply 真 received');
console.log('\n真 next phase (留下次 trigger): J2 真 YES → J2 真 send USDT → broker auto-deliver USDC');
console.log('真 cleanup: 留 broker 真 ready 状态 (no test artifacts to clean)');

provider.destroy?.();
db.close();
