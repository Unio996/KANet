// J2 #3 真 fresh swap 1 USDT → ~1 USDC 真 fund broker BSC (J1 24:56 inventory 0.5 strain)
// broker 真持 USDT 6.5932 真足, 真 swap 1 USDT 不影响 USDT inventory
// 真 unlock fresh USDC e2e 真 retry (J1 真等 anti-spam 14min expire 后 trigger)

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { swapUsdtToUsdc } from '../src/services/broker-swap.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const SWAP_USDT = 1.0;

const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const db = new Database('C:/kanet/kasia-console/data/console.db');

console.log('=== J2 #3 fresh swap 1 USDT → ~1 USDC fund broker (J1 inventory strain fix) ===\n');

const wallet = db.prepare(`SELECT address, privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
const provider = new ethers.JsonRpcProvider(BSC_RPC);
const usdt = new ethers.Contract(USDT_BSC, ERC20_ABI, provider);
const usdc = new ethers.Contract(USDC_BSC, ERC20_ABI, provider);

const usdtPre = parseFloat(ethers.formatUnits(await usdt.balanceOf(wallet.address), 18));
const usdcPre = parseFloat(ethers.formatUnits(await usdc.balanceOf(wallet.address), 18));
console.log(`Pre: USDT=${usdtPre.toFixed(6)} USDC=${usdcPre.toFixed(6)}`);

console.log(`\n>>> swap ${SWAP_USDT} USDT → ~${SWAP_USDT} USDC (PancakeSwap V2) <<<`);
const result = await swapUsdtToUsdc(wallet.privkey_encrypted, SWAP_USDT, 0.5);
console.log(`result:`, JSON.stringify(result));
if (!result.ok) { console.error('❌ swap fail'); process.exit(1); }

await new Promise(r => setTimeout(r, 6000));
const usdtPost = parseFloat(ethers.formatUnits(await usdt.balanceOf(wallet.address), 18));
const usdcPost = parseFloat(ethers.formatUnits(await usdc.balanceOf(wallet.address), 18));
console.log(`\nPost: USDT=${usdtPost.toFixed(6)} USDC=${usdcPost.toFixed(6)}`);
console.log(`真 swap: -${(usdtPre-usdtPost).toFixed(6)} USDT, +${(usdcPost-usdcPre).toFixed(6)} USDC`);

// chain_event audit
const now = new Date().toISOString();
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'broker_swap', ?, ?, ?)`)
  .run(crypto.randomUUID(), result.txHash, wallet.address, wallet.address,
    JSON.stringify({
      swap_dex: 'pancakeswap_v2',
      give_asset: 'USDT', give_amount: (usdtPre-usdtPost).toFixed(6),
      receive_asset: 'USDC', receive_amount: (usdcPost-usdcPre).toFixed(6),
      reason: 'J2_3_2026-04-27_fresh_fund_for_USDC_e2e_retry_after_J1_inventory_strain',
      pre_balance: { usdt: usdtPre.toFixed(6), usdc: usdcPre.toFixed(6) },
      post_balance: { usdt: usdtPost.toFixed(6), usdc: usdcPost.toFixed(6) },
    }),
    'broker_swap_j2_3_fresh_fund', now);
console.log(`✓ chain_event audit inserted`);

provider.destroy?.();
db.close();

console.log('\n=== ✅ broker BSC USDC fresh fund done ===');
console.log(`tx: ${result.txHash}`);
console.log(`broker BSC USDC now: ${usdcPost.toFixed(6)} (真够 fresh 1 USDC e2e + reserve)`);
