// J2 #3 真烧 swap — 1 USDT → ~1 USDC PancakeSwap V2 (Owner 不要假测试)
// 真上链, 真烧 broker BSC USDT, 真 chain_event audit
// 不 dry-run 不 quote 不 mock — 真 execute

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { decrypt } from '../src/services/crypto.js';
import { swapUsdtToUsdc, quoteUsdtToUsdc } from '../src/services/broker-swap.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const SWAP_AMOUNT_USDT = 1.0;

const BSC_RPC = 'https://bsc-dataseed1.binance.org';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const db = new Database('C:/kanet/kasia-console/data/console.db');

console.log('=== J2 #3 真烧 swap 1 USDT → ~1 USDC (Owner 训不要假测试, 真上链) ===\n');

// 1. Get broker BSC wallet
const wallet = db.prepare(`SELECT address, privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
if (!wallet?.privkey_encrypted) { console.error('❌ broker BSC wallet not found'); process.exit(1); }
console.log(`broker BSC: ${wallet.address}`);

// 2. Pre-swap balance check (REAL on-chain query)
const provider = new ethers.JsonRpcProvider(BSC_RPC);
const usdtC = new ethers.Contract(USDT_BSC, ERC20_ABI, provider);
const usdcC = new ethers.Contract(USDC_BSC, ERC20_ABI, provider);
const usdtPre = parseFloat(ethers.formatUnits(await usdtC.balanceOf(wallet.address), 18));
const usdcPre = parseFloat(ethers.formatUnits(await usdcC.balanceOf(wallet.address), 18));
console.log(`Pre-swap (真链上 balanceOf):  USDT=${usdtPre.toFixed(6)}  USDC=${usdcPre.toFixed(6)}`);

if (usdtPre < SWAP_AMOUNT_USDT) {
  console.error(`❌ broker USDT 不足: ${usdtPre.toFixed(6)} < ${SWAP_AMOUNT_USDT}`);
  process.exit(1);
}

// 3. Execute REAL swap (REAL on-chain tx, REAL gas, REAL USDT burn)
console.log(`\n>>> 真烧 swap ${SWAP_AMOUNT_USDT} USDT → USDC PancakeSwap V2 (slippage 0.5%) <<<`);
const swapStart = Date.now();
const result = await swapUsdtToUsdc(wallet.privkey_encrypted, SWAP_AMOUNT_USDT, 0.5);
const swapMs = Date.now() - swapStart;
console.log(`swap result (${swapMs}ms):`, JSON.stringify(result));

if (!result.ok) {
  console.error(`\n❌ SWAP FAILED — ${result.error}`);
  process.exit(1);
}

// 4. Post-swap balance check (REAL on-chain query)
console.log(`\nPost-swap (真链上 balanceOf, ~6s wait for indexer):`);
await new Promise(r => setTimeout(r, 6000));
const usdtPost = parseFloat(ethers.formatUnits(await usdtC.balanceOf(wallet.address), 18));
const usdcPost = parseFloat(ethers.formatUnits(await usdcC.balanceOf(wallet.address), 18));
console.log(`  USDT=${usdtPost.toFixed(6)} (Δ ${(usdtPost-usdtPre).toFixed(6)})`);
console.log(`  USDC=${usdcPost.toFixed(6)} (Δ +${(usdcPost-usdcPre).toFixed(6)})`);

const usdtBurned = usdtPre - usdtPost;
const usdcReceived = usdcPost - usdcPre;
const realSlippagePct = ((usdtBurned - usdcReceived) / usdtBurned) * 100;
console.log(`\n真 burn USDT: ${usdtBurned.toFixed(6)}`);
console.log(`真 receive USDC: ${usdcReceived.toFixed(6)}`);
console.log(`真 slippage: ${realSlippagePct.toFixed(4)}%`);

// 5. Chain event audit
const now = new Date().toISOString();
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'broker_swap', ?, ?, ?)`)
  .run(crypto.randomUUID(), result.txHash, wallet.address, wallet.address,
    JSON.stringify({
      swap_dex: 'pancakeswap_v2',
      router_address: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      give_asset: 'USDT', give_chain: 'bnb', give_amount: usdtBurned.toFixed(6),
      receive_asset: 'USDC', receive_chain: 'bnb', receive_amount: usdcReceived.toFixed(6),
      real_slippage_pct: realSlippagePct.toFixed(4),
      gas_used: result.gasUsed,
      reason: 'J2_3_v1.1_USDC_funding_real_swap_2026-04-27_owner_no_fake_test',
      pre_balance: { usdt: usdtPre.toFixed(6), usdc: usdcPre.toFixed(6) },
      post_balance: { usdt: usdtPost.toFixed(6), usdc: usdcPost.toFixed(6) },
    }),
    'broker_swap_j2_3_real', now);
console.log(`\n✓ chain_events 'broker_swap' inserted (真 audit trail)`);

provider.destroy?.();
db.close();

console.log('\n=== ✅ 真烧 swap 完成 ===');
console.log(`tx: ${result.txHash}`);
console.log(`查 BSC: https://bscscan.com/tx/${result.txHash}`);
console.log(`gas: ${result.gasUsed}`);
console.log(`USDT burn: ${usdtBurned.toFixed(6)}`);
console.log(`USDC received: ${usdcReceived.toFixed(6)}`);
console.log(`real slippage: ${realSlippagePct.toFixed(4)}%`);
