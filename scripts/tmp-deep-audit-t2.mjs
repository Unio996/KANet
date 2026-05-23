// tmp-deep-audit-t2.mjs — Opus 多角度深审
import { getTokenBalance } from '../kasia-console/src/services/chain-balance.js';

async function q(chain, addr, token, desc) {
  const r = await getTokenBalance(chain, addr, token);
  console.log(`${chain.padEnd(8)} ${token.padEnd(5)} ${desc.padEnd(36)} bal=${r.balance} err=${r.error || 'ok'}`);
  return r;
}

console.log('=== 1. sol USDT + USDC 双测 Binance hot ===');
// Binance Solana: 5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9 (more canonical)
await q('sol', '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'usdt', 'Binance Solana v2');
await q('sol', '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', 'usdc', 'Binance Solana USDC');
// 原 smoke 的地址
await q('sol', 'CoREENxT6tfrYE6dNBymwnu5Dy4PfgGn4dXs2Ct9tBJX', 'usdt', '原 smoke SOL addr USDT');
await q('sol', 'CoREENxT6tfrYE6dNBymwnu5Dy4PfgGn4dXs2Ct9tBJX', 'usdc', '原 smoke SOL addr USDC');

console.log('\n=== 2. tron 真实地址 ===');
// Justin Sun: TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9 (should have USDT)
await q('tron', 'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9', 'usdt', 'Justin Sun TRON');
// Binance TRON: TAzsQ9Gx8eqFNFSKbeXrbi45CuVPHzA8wr
await q('tron', 'TAzsQ9Gx8eqFNFSKbeXrbi45CuVPHzA8wr', 'usdt', 'Binance TRON v2');

console.log('\n=== 3. eth 不同 RPC 覆盖 ===');
// llamarpc 挂 — 我换个 RPC 跑一次看是不是 chain-balance.js 的问题还是 RPC 问题
// 用现有 EVM_RPC 跑一次重测
await q('eth', '0xF977814e90dA44bFA03b6295A0616a897441aceC', 'usdt', 'Binance ETH retry');
await q('eth', '0x28C6c06298d514Db089934071355E5743bf21d60', 'usdt', 'Binance ETH 2');

console.log('\n=== 4. base 逻辑核对 ===');
// Base 没 USDT, 但有 USDC
await q('base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'usdc', 'Base USDC contract USDC');
await q('base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'usdt', 'Base 查 USDT (预期 no_usdt_on_base)');
