// 救援 Eric 1 USDC (offer 6af5b074, J1 真测付了 1.01 USDT 但 broker 卡 verified 没发 USDC)

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { decrypt } from '../src/services/crypto.js';

const ERIC_BSC = ethers.getAddress('0x94053e04fee8d863cfa29df10938a7a2e2b71d74');
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const OFFER_ID = '6af5b074-5d41-4e9a-8384-5c26fff32b4a';
const PAID_USDT = 1.01;
const SEND_USDC = 1.0;
const PAY_TX = '0x1cd6765a829a64eec126c2664ddc1b7f2240f159d27442210b84a26d8d152f0e';

const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const db = new Database('C:/kanet/kasia-console/data/console.db', { readwrite: true });
const now = new Date().toISOString();

console.log('=== 救援 Eric 1 USDC (offer 6af5b074) ===');
console.log(`Eric BSC: ${ERIC_BSC}`);
console.log(`broker 真发 ${SEND_USDC} USDC (Eric 真付 ${PAID_USDT} USDT, 1:1.01 等比例 严标准)\n`);

const wallet = db.prepare(`SELECT address, privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
if (!wallet?.privkey_encrypted) { console.error('❌ broker BSC wallet not found'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(BSC_RPC);
const usdcRead = new ethers.Contract(USDC_BSC, ERC20_ABI, provider);
const usdcPre = parseFloat(ethers.formatUnits(await usdcRead.balanceOf(wallet.address), 18));
console.log(`broker BSC USDC pre: ${usdcPre.toFixed(6)}`);
if (usdcPre < SEND_USDC) { console.error(`❌ broker USDC 不足: ${usdcPre} < ${SEND_USDC}`); process.exit(1); }

const signer = new ethers.Wallet(decrypt(wallet.privkey_encrypted), provider);
const usdcSign = new ethers.Contract(USDC_BSC, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
const amtWei = ethers.parseUnits(SEND_USDC.toFixed(6), 18);

console.log(`\n>>> broker 真发 ${SEND_USDC} USDC → Eric ${ERIC_BSC} <<<`);
const tx = await usdcSign.transfer(ERIC_BSC, amtWei);
const receipt = await tx.wait();
console.log(`tx: ${tx.hash} gas=${receipt.gasUsed} status=${receipt.status}`);

await new Promise(r => setTimeout(r, 5000));
const usdcPost = parseFloat(ethers.formatUnits(await usdcRead.balanceOf(wallet.address), 18));
console.log(`broker BSC USDC post: ${usdcPost.toFixed(6)} (Δ -${(usdcPre - usdcPost).toFixed(6)})`);

// SQL update offer → completed + audit
const offer = db.prepare('SELECT verification_meta FROM exchange_offers WHERE id=?').get(OFFER_ID);
const meta = JSON.parse(offer?.verification_meta || '{}');
meta.rescue_delivery_tx = tx.hash;
meta.rescue_delivery_amount = SEND_USDC;
meta.rescue_at = now;
meta.rescue_note = `J2 #3 救援 2026-04-27 (Owner 自决 钦定): J1 真测 USDC e2e Phase 2 partial — preview/pay/verify ✓, delivery silent fail (root: accept_v1 receive_address 字段 set 成 user kasia 不是 EVM, broker 用 kasia 当 EVM 真 invalid silent fail). 真 manual rescue: broker 真发 ${SEND_USDC} USDC to Eric BSC (1:1.01 严比例). 真 fix 真 wire 真 v1.2 spec 中.`;

db.prepare(`UPDATE exchange_offers SET delivery_tx=?, protocol_status='completed', delivering_at=?, completed_at=?, verification_meta=?, updated_at=? WHERE id=?`)
  .run(tx.hash, now, now, JSON.stringify(meta), now, OFFER_ID);
console.log(`✓ offer 6af5b074 verified → completed`);

// fund_lock
const fl = db.prepare(`UPDATE fund_locks SET status='spent', released_at=? WHERE order_id=? AND status='locked'`).run(now, OFFER_ID);
console.log(`✓ fund_lock spent (${fl.changes} rows)`);

// chain_event audit
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'manual_rescue_usdc', ?, ?, ?)`)
  .run(crypto.randomUUID(), tx.hash, wallet.address, ERIC_BSC,
    JSON.stringify({
      offer_id: OFFER_ID,
      give_asset: 'USDC', give_chain: 'bnb', give_amount: SEND_USDC,
      eric_paid_usdt: PAID_USDT, payment_tx: PAY_TX,
      ratio: '1:1.01 严比例 (Eric 1.01 USDT → broker 1 USDC)',
      reason: 'J1 03:13 真测 USDC e2e Phase 2 — preview/pay/verify ✓, delivery silent fail (accept_v1 receive_address 字段没区分 kasia vs EVM)',
      eric_bsc: ERIC_BSC,
    }),
    'rescue_j2_3_2026-04-27_eric_usdc_delivery_silent_fail', now);
console.log(`✓ chain_event audit inserted`);

provider.destroy?.();
db.close();

console.log('\n=== ✅ Eric 1 USDC 救援完成 ===');
console.log(`tx: ${tx.hash}`);
console.log(`查 BSC: https://bscscan.com/tx/${tx.hash}`);
