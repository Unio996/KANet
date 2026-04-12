/**
 * Aave V3 Client — Arbitrum deployment
 *
 * Pure ethers.js contract calls. No DB, no Mind, no business logic.
 * Caller handles error recording, UI display, etc.
 *
 * Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD (Arbitrum)
 * Docs: https://docs.aave.com/developers/core-contracts/pool
 */

import { ethers } from 'ethers';
import { getConfig } from '../data/settings/configs.js';

// ── Constants ────────────────────────────────────────────────

const DEFAULT_RPC = 'https://arb1.arbitrum.io/rpc';
const POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

const ASSETS = {
  usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  weth: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
  usdt: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
};

const POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)',
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// ── Helpers ──────────────────────────────────────────────────

async function getRpc() {
  const custom = await getConfig('aave_rpc_url');
  return custom || DEFAULT_RPC;
}

function resolveAsset(assetName) {
  const key = assetName.toLowerCase();
  const info = ASSETS[key];
  if (!info) throw new Error(`Unknown asset: ${assetName}. Available: ${Object.keys(ASSETS).join(', ')}`);
  return info;
}

function getProvider(rpcUrl) {
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getSigner(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider);
}

// ── Core Operations ─────────────────────────────────────────

/**
 * Supply (deposit) asset into Aave to earn interest.
 * @param {string} privateKey - Wallet private key
 * @param {string} assetName - 'usdc' | 'weth' | 'usdt'
 * @param {number} amount - Human-readable amount (e.g. 50 for 50 USDC)
 * @returns {{ ok, txHash, amount, asset }}
 */
export async function supply(privateKey, assetName, amount) {
  const rpcUrl = await getRpc();
  const asset = resolveAsset(assetName);
  const provider = getProvider(rpcUrl);
  const signer = getSigner(privateKey, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);
  const token = new ethers.Contract(asset.address, ERC20_ABI, signer);

  const amountWei = ethers.parseUnits(String(amount), asset.decimals);

  // Approve pool to spend tokens (large approval to avoid repeated approve TXs)
  const allowance = await token.allowance(signer.address, POOL_ADDRESS);
  if (allowance < amountWei) {
    const approveAmt = ethers.parseUnits('10000', asset.decimals); // approve 10000 at once
    const approveTx = await token.approve(POOL_ADDRESS, approveAmt > amountWei ? approveAmt : amountWei);
    await approveTx.wait();
  }

  // Supply
  const tx = await pool.supply(asset.address, amountWei, signer.address, 0);
  const receipt = await tx.wait();

  return { ok: true, txHash: receipt.hash, amount, asset: assetName, block: receipt.blockNumber };
}

/**
 * Withdraw asset from Aave.
 * @param {string} privateKey
 * @param {string} assetName
 * @param {number} amount - Use Infinity or very large number for max withdrawal
 * @returns {{ ok, txHash, amount, asset }}
 */
export async function withdraw(privateKey, assetName, amount) {
  const rpcUrl = await getRpc();
  const asset = resolveAsset(assetName);
  const provider = getProvider(rpcUrl);
  const signer = getSigner(privateKey, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

  const amountWei = amount >= 1e15
    ? ethers.MaxUint256  // withdraw all
    : ethers.parseUnits(String(amount), asset.decimals);

  const tx = await pool.withdraw(asset.address, amountWei, signer.address);
  const receipt = await tx.wait();

  return { ok: true, txHash: receipt.hash, amount, asset: assetName, block: receipt.blockNumber };
}

/**
 * Borrow asset from Aave (requires existing collateral).
 * @param {string} privateKey
 * @param {string} assetName
 * @param {number} amount
 * @param {number} rateMode - 2 = variable (default, stable generally disabled on V3)
 * @returns {{ ok, txHash, amount, asset }}
 */
export async function borrow(privateKey, assetName, amount, rateMode = 2) {
  const rpcUrl = await getRpc();
  const asset = resolveAsset(assetName);
  const provider = getProvider(rpcUrl);
  const signer = getSigner(privateKey, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

  const amountWei = ethers.parseUnits(String(amount), asset.decimals);
  const tx = await pool.borrow(asset.address, amountWei, rateMode, 0, signer.address);
  const receipt = await tx.wait();

  return { ok: true, txHash: receipt.hash, amount, asset: assetName, block: receipt.blockNumber };
}

/**
 * Repay borrowed asset.
 * @param {string} privateKey
 * @param {string} assetName
 * @param {number} amount - Use Infinity for max repay
 * @param {number} rateMode - Must match borrow rate mode
 * @returns {{ ok, txHash, amount, asset }}
 */
export async function repay(privateKey, assetName, amount, rateMode = 2) {
  const rpcUrl = await getRpc();
  const asset = resolveAsset(assetName);
  const provider = getProvider(rpcUrl);
  const signer = getSigner(privateKey, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);
  const token = new ethers.Contract(asset.address, ERC20_ABI, signer);

  const amountWei = amount >= 1e15
    ? ethers.MaxUint256
    : ethers.parseUnits(String(amount), asset.decimals);

  // Approve pool to pull tokens for repay (including max repay)
  const approveAmount = amountWei === ethers.MaxUint256 ? ethers.MaxUint256 : amountWei;
  const allowance = await token.allowance(signer.address, POOL_ADDRESS);
  if (allowance < approveAmount) {
    const approveTx = await token.approve(POOL_ADDRESS, approveAmount);
    await approveTx.wait();
  }

  const tx = await pool.repay(asset.address, amountWei, rateMode, signer.address);
  const receipt = await tx.wait();

  return { ok: true, txHash: receipt.hash, amount, asset: assetName, block: receipt.blockNumber };
}

// ── Query ───────────────────────────────────────────────────

/**
 * Get user's Aave account data (collateral, debt, health factor).
 * @param {string} address - Wallet address (no private key needed)
 * @returns {{ totalCollateralUSD, totalDebtUSD, availableBorrowUSD, ltv, liquidationThreshold, healthFactor }}
 */
export async function getAccountData(address) {
  const rpcUrl = await getRpc();
  const provider = getProvider(rpcUrl);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);

  const data = await pool.getUserAccountData(address);

  return {
    totalCollateralUSD: parseFloat(ethers.formatUnits(data.totalCollateralBase, 8)),
    totalDebtUSD: parseFloat(ethers.formatUnits(data.totalDebtBase, 8)),
    availableBorrowUSD: parseFloat(ethers.formatUnits(data.availableBorrowsBase, 8)),
    ltv: Number(data.ltv) / 100,  // basis points → percentage
    liquidationThreshold: Number(data.currentLiquidationThreshold) / 100,
    healthFactor: data.totalDebtBase > 0n
      ? parseFloat(ethers.formatUnits(data.healthFactor, 18))
      : Infinity,
  };
}

/**
 * Get token balance on Arbitrum.
 * @param {string} address
 * @param {string} assetName
 * @returns {number}
 */
export async function getTokenBalance(address, assetName) {
  const rpcUrl = await getRpc();
  const asset = resolveAsset(assetName);
  const provider = getProvider(rpcUrl);
  const token = new ethers.Contract(asset.address, ERC20_ABI, provider);
  const bal = await token.balanceOf(address);
  return parseFloat(ethers.formatUnits(bal, asset.decimals));
}
