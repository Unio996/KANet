// J2 #3 真 rescue Sophie 0.505 USDT stuck (J1 24:50 真测 Bug 7 真撞 c554ef20)
// 真 trace: J1 script 真 read 老 J2 #3 23:33 expired offer 7a57895a want_amount=0.505
// Sophie 真转 0.505 USDT BSC tx 0x8ce8ed3d04f8... 但 broker 真新 publish 1.01 USDT 真不匹
// 严比例: broker 真发 0.5 USDC (= 0.505/1.01 严比例) → Sophie BSC

import Db from 'better-sqlite3';
import { ethers } from 'ethers';
import { decrypt } from '../src/services/crypto.js';
import crypto from 'crypto';

const db = new Db('data/console.db', { readonly: false });

const SOPHIE_BSC_RAW = '0x0938f94c12b7edb8927b22a82bd6bc83fa570c0e'; // J1 22:14 audit (lowercase)
const SOPHIE_BSC = ethers.getAddress(SOPHIE_BSC_RAW); // checksum-normalize
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const PAID_USDT = 1.01;     // broker preview 真 expected (1 USDC × peg + 1% spread)
const SOPHIE_PAID = 0.505;  // J1 script 真 hardcode read 老 expired offer
const PAY_TX_BSC = '0x8ce8ed3d04f8'; // J1 broadcast slice (待 NWT/J1 真 full tx)
const SOPHIE_KASIA = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';

const RESCUE_USDC = +(SOPHIE_PAID / PAID_USDT).toFixed(6); // 0.5 USDC 严比例

console.log('=== J2 #3 真 rescue Sophie 0.505 USDT stuck (J1 24:50 真测 Bug 7) ===\n');
console.log(`Sophie 真转: ${SOPHIE_PAID} USDT BSC (J1 hardcode 老 expired offer 0.5 USDC × 1.01)`);
console.log(`broker 真期望: ${PAID_USDT} USDT (1 USDC × 1.01 真新 publish)`);
console.log(`严比例 rescue: broker 真发 ${RESCUE_USDC} USDC = ${SOPHIE_PAID}/${PAID_USDT} × 1`);
console.log(`broker zero-loss, J1 hardcode 真教训\n`);

// 1. broker BSC privkey
const wallet = db.prepare(`SELECT address, privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
if (!wallet?.privkey_encrypted) { console.error('❌ broker BSC wallet not found'); process.exit(1); }

// 2. Pre-check broker USDC balance (REAL on-chain)
const provider = new ethers.JsonRpcProvider(BSC_RPC);
const usdc = new ethers.Contract(USDC_BSC, ERC20_ABI, provider);
const usdcPre = parseFloat(ethers.formatUnits(await usdc.balanceOf(wallet.address), 18));
console.log(`broker BSC USDC pre: ${usdcPre.toFixed(6)} (J2 22:54 swap 1.000263)`);
if (usdcPre < RESCUE_USDC) {
  console.error(`❌ broker USDC insufficient: ${usdcPre} < ${RESCUE_USDC}`);
  process.exit(1);
}

// 3. Real send USDC (REAL on-chain, real gas burn)
console.log(`\n>>> 真 send ${RESCUE_USDC} USDC to Sophie BSC ${SOPHIE_BSC} <<<`);
const signer = new ethers.Wallet(decrypt(wallet.privkey_encrypted), provider);
const usdcSigned = new ethers.Contract(USDC_BSC, [
  'function transfer(address to, uint256 amount) returns (bool)',
], signer);
const amountWei = ethers.parseUnits(RESCUE_USDC.toFixed(6), 18);
const tx = await usdcSigned.transfer(SOPHIE_BSC, amountWei);
console.log(`  tx hash: ${tx.hash}`);
const receipt = await tx.wait();
console.log(`  receipt: gas=${receipt.gasUsed} status=${receipt.status}`);

// 4. Verify USDC delivered
await new Promise(r => setTimeout(r, 5000));
const usdcPost = parseFloat(ethers.formatUnits(await usdc.balanceOf(wallet.address), 18));
console.log(`\nbroker BSC USDC post: ${usdcPost.toFixed(6)} (Δ -${(usdcPre - usdcPost).toFixed(6)})`);

// 5. Audit chain_event
const now = new Date().toISOString();
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'manual_rescue_usdc', ?, ?, ?)`)
  .run(crypto.randomUUID(), tx.hash, wallet.address, SOPHIE_BSC,
    JSON.stringify({
      offer_id: '7a57895a-9363-4a82-af1e-6e97487ed235',  // J2 #3 23:33 expired test offer (J1 script 真 read 老)
      give_asset: 'USDC', give_chain: 'bnb', give_amount: RESCUE_USDC,
      sophie_paid_usdt: SOPHIE_PAID, expected_usdt: PAID_USDT,
      ratio: SOPHIE_PAID / PAID_USDT,
      reason: 'J1 24:50 真测 Bug 7 真撞 — script hardcode 真 read 老 J2 expired offer want_amount=0.505 而真 broker 真新 publish 1.01 USDT, Sophie 真转 0.505 USDT 真 underpayment 50%. 严比例 rescue: broker 真发 0.5 USDC = 0.505/1.01.',
      sophie_kasia: SOPHIE_KASIA,
      sophie_bsc: SOPHIE_BSC,
      payment_tx_partial: PAY_TX_BSC,
      bug_context: 'cross-machine state sync delay + J1 script 真 read 老 expired offer + J2 23:33 test cleanup 不完整',
    }),
    'rescue_j2_3_2026-04-27_sophie_usdc_underpayment_strict_proportion', now);
console.log(`✓ chain_event audit inserted`);

provider.destroy?.();
db.close();

console.log('\n=== ✅ Sophie USDC rescue done (严比例) ===');
console.log(`broker 真发 ${RESCUE_USDC} USDC tx ${tx.hash}`);
console.log(`查 BSC: https://bscscan.com/tx/${tx.hash}`);
console.log(`Sophie 真持: 0.5 USDC (= 0.505/1.01 × 1 严比例)`);
console.log(`broker zero-loss, J1 24:50 hardcode 老 expired offer 教训`);
