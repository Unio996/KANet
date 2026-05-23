/**
 * Multi-chain token balance query service.
 *
 * Supports 9 chains: bnb, eth, polygon, arbitrum, optimism, avalanche, base, sol, tron.
 * Reuses RPC/token tables from cross-chain-verify.mjs.
 *
 * Export: async function getTokenBalance(chain, address, tokenSymbol = 'usdt')
 * Returns: { balance: Number, decimals: Number, tokenAddress: String|null, error?: String }
 */

import { EVM_RPC, EVM_TOKENS, SOL_RPC, SOL_TOKENS, TRON_RPC, TRON_TOKENS } from './cross-chain-verify.mjs';

const EVM_CHAINS = new Set(['bnb', 'eth', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base']);
const SOL_CHAIN = 'sol';
const TRON_CHAIN = 'tron';

// ── EVM: ethers ERC-20 balanceOf ──────────────────────────────────────────

async function _evmBalance(chain, address, tokenSymbol) {
  const { ethers } = await import('ethers');
  const rpcUrl = EVM_RPC[chain];
  const token = EVM_TOKENS[chain]?.[tokenSymbol];
  if (!rpcUrl || !token) return { balance: 0, error: `no_${tokenSymbol}_on_${chain}` };

  const signal = AbortSignal.timeout(10000);
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  try {
    const erc20 = new ethers.Contract(
      token.address,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const raw = await erc20.balanceOf(address, { signal });
    const balance = parseFloat(ethers.formatUnits(raw, token.decimals));
    return { balance, decimals: token.decimals, tokenAddress: token.address };
  } catch (err) {
    return { balance: 0, error: err.message || 'evm_query_failed' };
  } finally {
    try { provider.destroy?.(); } catch {}
  }
}

// ── Solana: SPL token balance (pure RPC, no native bindings) ──────────────

async function _solBalance(chain, address, tokenSymbol) {
  if (chain !== SOL_CHAIN) return { balance: 0, error: `unsupported_chain` };

  const rpcUrl = SOL_RPC;
  const tokenMint = SOL_TOKENS[tokenSymbol];
  if (!rpcUrl || !tokenMint) return { balance: 0, error: `no_${tokenSymbol}_on_${chain}` };

  const signal = AbortSignal.timeout(10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  async function rpcCall(method, params) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal,
    });
    const data = await res.json();
    clearTimeout(timer);
    if (data.error) throw new Error(data.error.message || 'sol_rpc_error');
    return data;
  }

  try {
    // Step 1: find all token accounts for this owner
    const resp = await rpcCall('getTokenAccountsByOwner', [
      address,
      { mint: tokenMint },
      { encoding: 'jsonParsed' },
    ]);

    const accounts = resp.result?.value || [];
    if (accounts.length === 0) {
      return { balance: 0, decimals: 6, tokenAddress: tokenMint };
    }

    const first = accounts[0];
    const uiAmount = first?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    const decimals = first?.account?.data?.parsed?.info?.tokenAmount?.decimals || 6;
    return { balance: uiAmount, decimals, tokenAddress: tokenMint };
  } catch (err) {
    return { balance: 0, error: err.message || 'sol_query_failed' };
  }
}

// ── TRON: raw RPC triggerConstantContract balanceOf (no TronWeb API-key dependency) ──

async function _tronBalance(chain, address, tokenSymbol) {
  if (chain !== TRON_CHAIN) return { balance: 0, error: `unsupported_chain` };

  const rpcUrl = TRON_RPC;
  const token = TRON_TOKENS[tokenSymbol];
  if (!rpcUrl || !token) return { balance: 0, error: `no_${tokenSymbol}_on_${chain}` };

  // Encode balanceOf(address) function selector: 0x70a08231
  const balanceOfSelector = '70a08231';
  // Pad address to 64 chars (prepend 48 zeros for 24-byte offset in TRON ABI encoding)
  const addrHex = address.slice(2).toLowerCase().padStart(64, '0');
  const data = balanceOfSelector + addrHex;

  async function rpcCall(method, params) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = await res.json();
    return data;
  }

  try {
    // Try free endpoint first, then try with API key
    const endpoints = [rpcUrl, 'https://api.trongrid.io'];
    for (const ep of endpoints) {
      try {
        const resp = await rpcCall('triggerConstantContract', {
          address: token,
          owner_address: address,
          function_selector: 'function balanceOf(address) view returns (uint256)',
          parameter: data,
          visible: true,
        });

        if (resp.result?.result && resp.result.result.success) {
          const rawHex = resp.result.ret[0]?.data || '';
          const balance = parseInt(rawHex, 16) / 1e6;
          return { balance, decimals: 6, tokenAddress: token };
        }
        // If API key needed, retry with key header
        if (resp.error && resp.error.message && resp.error.message.includes('401')) {
          // retry with API key
          const res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'TRON-PRO-API-KEY': '' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'triggerConstantContract', params: {
              address: token,
              owner_address: address,
              function_selector: 'function balanceOf(address) view returns (uint256)',
              parameter: data,
              visible: true,
            }}),
          });
          const data2 = await res.json();
          if (data2.result?.result && data2.result.result.success) {
            const rawHex = data2.result.ret[0]?.data || '';
            const balance = parseInt(rawHex, 16) / 1e6;
            return { balance, decimals: 6, tokenAddress: token };
          }
        }
      } catch (e) {
        if (ep === endpoints[0]) continue;
        return { balance: 0, error: e.message || 'tron_query_failed' };
      }
    }

    return { balance: 0, error: 'tron_query_failed' };
  } catch (err) {
    return { balance: 0, error: err.message || 'tron_query_failed' };
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function getTokenBalance(chain, address, tokenSymbol = 'usdt') {
  const c = (chain || '').toLowerCase();
  try {
    if (EVM_CHAINS.has(c)) return await _evmBalance(c, address, tokenSymbol);
    if (c === SOL_CHAIN) return await _solBalance(c, address, tokenSymbol);
    if (c === TRON_CHAIN) return await _tronBalance(c, address, tokenSymbol);
    return { balance: 0, error: 'unsupported_chain' };
  } catch (err) {
    return { balance: 0, error: err.message || 'query_failed' };
  }
}
