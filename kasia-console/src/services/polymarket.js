/**
 * Polymarket Trading Service — 预测市场交易接口
 *
 * 通过 Polymarket CLOB API 在 Polygon 链上交易预测市场合约。
 * 使用 EIP-712 签名认证，USDC 结算。
 *
 * 交易流程：
 *   1. 创建 Polygon 钱包（复用 EVM 钱包生成）
 *   2. 充值 USDC 到 Polygon 钱包
 *   3. Approve USDC 给 Polymarket CTF Exchange 合约
 *   4. 通过 CLOB API 下限价单
 *
 * 数据来源：Gamma API（行情）+ CLOB API（交易）
 */
import { ethers } from 'ethers';
import { sqlite } from '../db/client.js';
import { decrypt } from './crypto.js';
import { withProvider } from './chains.js';

const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const POLYGON_RPC = 'https://polygon-bor-rpc.publicnode.com';
const CHAIN_ID = 137; // Polygon mainnet

// Polymarket exchange 合约 — 下不同市场需要 approve 不同 spender:
//  - CTF Exchange (V1): binary YES/NO 市场，2026-04-28 后被 V2 替代
//  - Neg Risk CTF Exchange (V1): multi-outcome 互斥市场，同上 V2 替代
//  - Neg Risk Adapter: Neg Risk 市场结算/赎回路径（V1+V2 通用）
//  - CTF Exchange V2: 2026-04-28 cutover 后所有 binary 下单走这里
//  - Neg Risk CTF Exchange V2: 同上, NegRisk 市场
// 全部 approve 才能覆盖新老市场下单 + 老市场赎回.
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const CTF_EXCHANGE_V2 = '0xE111180000d2663C0091e4f400237545B87B996B';
const NEG_RISK_CTF_EXCHANGE_V2 = '0xe2222d279d744050d28e00520010520000310F59';
// V1 path: spenders draw USDC.e directly. V2 spenders draw pUSD instead, so
// they belong in POLYMARKET_PUSD_SPENDERS, not here.
const POLYMARKET_SPENDERS = [
  { name: 'CTF Exchange', address: CTF_EXCHANGE },
  { name: 'Neg Risk CTF Exchange', address: NEG_RISK_CTF_EXCHANGE },
  { name: 'Neg Risk Adapter', address: NEG_RISK_ADAPTER },
];
const POLYMARKET_PUSD_SPENDERS = [
  { name: 'CTF Exchange V2', address: CTF_EXCHANGE_V2 },
  { name: 'Neg Risk CTF Exchange V2', address: NEG_RISK_CTF_EXCHANGE_V2 },
  // V2 NegRisk markets route fills through the NegRiskAdapter, which also
  // pulls pUSD; without this approve CLOB rejects with `allowance is not
  // enough -> spender: 0xd91E80...` even though the V2 exchange is approved.
  { name: 'Neg Risk Adapter (pUSD)', address: NEG_RISK_ADAPTER },
];
// USDC.e on Polygon
const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_DECIMALS = 6;
// V2 collateral: pUSD wraps USDC.e 1:1 via CollateralOnramp (no fee).
const PUSD_TOKEN = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const COLLATERAL_ONRAMP = '0x93070a847efEf7F70739046A929D47a521F5B8ee';

const TIMEOUT = 10000;

/**
 * 获取 Agent 的 Polygon 钱包
 */
export function getPolygonWallet(relayNodeId) {
  const wallet = sqlite.prepare(
    "SELECT id, address, chain FROM agent_wallets WHERE relay_node_id = ? AND chain = 'polygon' LIMIT 1"
  ).get(relayNodeId);
  return wallet;
}

/**
 * 获取 Polygon 钱包的 USDC 余额
 */
export async function getUsdcBalance(address) {
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const usdc = new ethers.Contract(USDC_POLYGON, [
        'function balanceOf(address) view returns (uint256)'
      ], provider);
      const balance = await usdc.balanceOf(address);
      return parseFloat(ethers.formatUnits(balance, USDC_DECIMALS));
    });
  } catch (e) {
    console.error('[polymarket] USDC balance error:', e.message);
    return null;
  }
}

/**
 * 获取 Polygon 钱包的 pUSD 余额 (Polymarket V2 抵押 token, 1:1 USDC wrap)
 */
export async function getPusdBalance(address) {
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const pusd = new ethers.Contract(PUSD_TOKEN, [
        'function balanceOf(address) view returns (uint256)'
      ], provider);
      const balance = await pusd.balanceOf(address);
      return parseFloat(ethers.formatUnits(balance, USDC_DECIMALS));
    });
  } catch (e) {
    console.error('[polymarket] pUSD balance error:', e.message);
    return null;
  }
}

/**
 * 创建 CLOB API 密钥（L2 认证）
 * 需要用钱包私钥签名一个注册消息
 */
export async function createApiKey(privateKey) {
  try {
    const v2 = await import('@polymarket/clob-client-v2');
    return await withProvider(POLYGON_RPC, async (provider) => {
      const wallet = new ethers.Wallet(privateKey, provider);
      // V2 SDK accepts ethers v5/v6 signers via the EthersSigner interface
      // (needs _signTypedData + getAddress). ethers v6 renamed signTypedData,
      // so monkey-patch _signTypedData onto the wallet for compat.
      if (!wallet._signTypedData && wallet.signTypedData) {
        wallet._signTypedData = wallet.signTypedData.bind(wallet);
      }
      const client = new v2.ClobClient({ host: CLOB_BASE, chain: CHAIN_ID, signer: wallet });

      // 先尝试 derive（如果之前创建过），失败再 create
      let creds;
      try {
        creds = await client.createOrDeriveApiKey();
      } catch (e) {
        // fallback: 直接 create
        creds = await client.createApiKey();
      }

      const apiKey = creds?.apiKey || creds?.key;
      if (!apiKey) return { ok: false, error: 'API returned empty credentials' };
      return { ok: true, apiKey, secret: creds.secret, passphrase: creds.passphrase };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 获取市场详情（含 CLOB token IDs）
 */
export async function getMarketDetails(conditionId) {
  try {
    const res = await fetch(`${GAMMA_BASE}/markets?conditionId=${conditionId}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'KANet/1.0' },
    });
    if (!res.ok) return null;
    const markets = await res.json();
    return markets[0] || null;
  } catch { return null; }
}

/**
 * 获取订单簿
 */
export async function getOrderBook(tokenId) {
  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${tokenId}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * 查询持仓 — 走 data-api（CLOB API 没 /positions 端点; data-api 才是真相）
 */
export async function getPositions(walletAddress) {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/positions?user=${walletAddress.toLowerCase()}&limit=200`,
      { signal: AbortSignal.timeout(TIMEOUT) }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/**
 * 检查 USDC Allowance — 并行查 3 个 Polymarket spender.
 * 任一 RPC 查询失败视为 0, 不阻塞其他. 总超时 5s 保证 UI 不卡死.
 * approved=true 仅当 3 个都 >0.
 */
export async function checkAllowance(address) {
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const usdc = new ethers.Contract(USDC_POLYGON, [
        'function allowance(address owner, address spender) view returns (uint256)'
      ], provider);
      const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('rpc timeout')), ms))]);
      const results = await Promise.all(POLYMARKET_SPENDERS.map(async s => {
        try {
          const raw = await timeout(usdc.allowance(address, s.address), 5000);
          return { name: s.name, amount: parseFloat(ethers.formatUnits(raw, USDC_DECIMALS)) };
        } catch (e) {
          console.warn(`[polymarket] allowance ${s.name} failed:`, e.message);
          return { name: s.name, amount: 0, error: e.message };
        }
      }));
      const perSpender = {};
      let minAmount = Infinity;
      for (const r of results) {
        perSpender[r.name] = r.amount;
        if (r.amount < minAmount) minAmount = r.amount;
      }
      return {
        approved: minAmount > 0,
        allowance: minAmount,
        perSpender,
      };
    });
  } catch (e) {
    console.error('[polymarket] allowance check error:', e.message);
    return { approved: false, allowance: 0, perSpender: {}, error: e.message };
  }
}

/**
 * Approve USDC 给所有 Polymarket exchange 合约
 * (CTF Exchange + Neg Risk CTF Exchange + Neg Risk Adapter).
 * 覆盖 binary + neg risk 所有市场下单路径.
 * 幂等: 已 approve 过的 spender 会再次 approve MaxUint, 无副作用只多一点 gas.
 *
 * @param {string} privateKey — Agent 的 Polygon 钱包私钥
 * @returns {{ ok, txHashes: {spender: txHash}, error? }}
 */
/**
 * Polymarket V2 onboard: approve USDC→Onramp, wrap all USDC into pUSD,
 * approve pUSD→V2 exchanges. Idempotent (skips already-approved spenders
 * and wraps zero if no USDC). Required because Polymarket migrated CLOB
 * to V2 on 2026-04-28 with pUSD as the new collateral token.
 *
 * @param {string} privateKey
 * @param {bigint} [wrapAmount] — USDC base units to wrap. Defaults to ALL.
 */
export async function migrateToV2(privateKey, wrapAmount) {
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const wallet = new ethers.Wallet(privateKey, provider);
      const max = ethers.MaxUint256;
      const usdc = new ethers.Contract(USDC_POLYGON, [
        'function approve(address,uint256) returns (bool)',
        'function allowance(address,address) view returns (uint256)',
        'function balanceOf(address) view returns (uint256)',
      ], wallet);
      const pusd = new ethers.Contract(PUSD_TOKEN, [
        'function approve(address,uint256) returns (bool)',
        'function allowance(address,address) view returns (uint256)',
        'function balanceOf(address) view returns (uint256)',
      ], wallet);
      const onramp = new ethers.Contract(COLLATERAL_ONRAMP, [
        'function wrap(address asset, address to, uint256 amount) external',
      ], wallet);
      const txHashes = {};
      const skipped = {};

      // 1) Approve USDC.e → Onramp (so wrap() can pull funds)
      const onrampAllow = await usdc.allowance(wallet.address, COLLATERAL_ONRAMP);
      if (onrampAllow === 0n) {
        const tx = await usdc.approve(COLLATERAL_ONRAMP, max);
        console.log(`[polymarket-v2] approve USDC→Onramp TX: ${tx.hash}`);
        await tx.wait();
        txHashes['USDC→Onramp'] = tx.hash;
      } else {
        skipped['USDC→Onramp'] = ethers.formatUnits(onrampAllow, USDC_DECIMALS);
      }

      // 2) Wrap USDC → pUSD
      const usdcBal = await usdc.balanceOf(wallet.address);
      const amount = wrapAmount && wrapAmount > 0n ? (wrapAmount < usdcBal ? wrapAmount : usdcBal) : usdcBal;
      if (amount > 0n) {
        const tx = await onramp.wrap(USDC_POLYGON, wallet.address, amount);
        console.log(`[polymarket-v2] wrap ${ethers.formatUnits(amount, USDC_DECIMALS)} USDC→pUSD TX: ${tx.hash}`);
        await tx.wait();
        txHashes['wrap'] = tx.hash;
      } else {
        skipped['wrap'] = '0 USDC available';
      }

      // 3) Approve pUSD → V2 exchanges (collateral side — buy)
      for (const s of POLYMARKET_PUSD_SPENDERS) {
        const cur = await pusd.allowance(wallet.address, s.address);
        if (cur > 0n) {
          skipped[`pUSD→${s.name}`] = ethers.formatUnits(cur, USDC_DECIMALS);
          continue;
        }
        const tx = await pusd.approve(s.address, max);
        console.log(`[polymarket-v2] approve pUSD→${s.name} TX: ${tx.hash}`);
        await tx.wait();
        txHashes[`pUSD→${s.name}`] = tx.hash;
      }

      // 4) setApprovalForAll CTF → V2 exchanges (operator side — sell existing 1155 positions)
      // Without this, SELL orders fail with "allowance: 0, spender: CTF_EXCHANGE_V2"
      const CTF_CONTRACT_ADDR = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
      const ctf = new ethers.Contract(CTF_CONTRACT_ADDR, [
        'function setApprovalForAll(address operator, bool approved) external',
        'function isApprovedForAll(address account, address operator) view returns (bool)',
      ], wallet);
      for (const s of POLYMARKET_PUSD_SPENDERS) {
        const approved = await ctf.isApprovedForAll(wallet.address, s.address);
        if (approved) {
          skipped[`CTF→${s.name}`] = 'already approved';
          continue;
        }
        const tx = await ctf.setApprovalForAll(s.address, true);
        console.log(`[polymarket-v2] setApprovalForAll CTF→${s.name} TX: ${tx.hash}`);
        await tx.wait();
        txHashes[`CTF→${s.name}`] = tx.hash;
      }

      const finalPusd = await pusd.balanceOf(wallet.address);
      return {
        ok: true,
        txHashes,
        skipped,
        pusdBalance: ethers.formatUnits(finalPusd, USDC_DECIMALS),
      };
    });
  } catch (e) {
    console.error('[polymarket-v2] migrateToV2 error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function approveUsdc(privateKey) {
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const wallet = new ethers.Wallet(privateKey, provider);
      const usdc = new ethers.Contract(USDC_POLYGON, [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)'
      ], wallet);
      const maxUint = ethers.MaxUint256;
      const txHashes = {};
      const skipped = {};
      for (const s of POLYMARKET_SPENDERS) {
        // 已 approve 过就跳过, 省 gas
        const current = await usdc.allowance(wallet.address, s.address);
        if (current > 0n) {
          skipped[s.name] = ethers.formatUnits(current, USDC_DECIMALS);
          console.log(`[polymarket] approve skip ${s.name} (already ${skipped[s.name]})`);
          continue;
        }
        const tx = await usdc.approve(s.address, maxUint);
        console.log(`[polymarket] approve ${s.name} TX sent: ${tx.hash}`);
        // Must wait for confirmation before next approve — otherwise mempool nonce
        // hasn't incremented and next iteration submits the same nonce → NONCE_EXPIRED.
        await tx.wait();
        console.log(`[polymarket] approve ${s.name} confirmed`);
        txHashes[s.name] = tx.hash;
      }
      // 兼容旧返回: 提供 txHash = 第一个新发的 TX (若有)
      const firstTx = Object.values(txHashes)[0] || null;
      return { ok: true, txHash: firstTx, txHashes, skipped };
    });
  } catch (e) {
    console.error('[polymarket] Approve error:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * 检查 Approve TX 是否已确认
 */
export async function checkTxStatus(txHash) {
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return { confirmed: false, status: 'pending' };
      return {
        confirmed: true,
        status: receipt.status === 1 ? 'success' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
      };
    });
  } catch (e) {
    return { confirmed: false, status: 'error', error: e.message };
  }
}

/**
 * 赎回已结算的预测市场持仓 — 将赢的 outcome tokens 兑换为 USDC
 *
 * Polymarket 有两类市场，赎回路径不同：
 *   - 标准 binary 市场：走 CTF.redeemPositions(USDC, 0x0, conditionId, [1,2])
 *   - NegRisk 市场（neg_risk=true）：走 NegRiskAdapter.redeemPositions(conditionId, [yesAmount, noAmount])
 *     NegRisk 市场的 outcome token_id ≠ CTF 从 (conditionId, indexSet) 派生的 positionId，
 *     所以调错合约会静默 no-op —— TX 成功但烧 0 token、付 0 USDC、只扣 gas。
 *
 * 通过 CLOB API 的 /markets/{conditionId} 的 neg_risk 字段判断类型。
 *
 * @param {string} privateKey — Agent 的 Polygon 钱包私钥
 * @param {string} conditionId — 市场的 conditionId (0x...)
 * @returns {{ ok, txHash?, error?, gasUsed?, usdcDelta?, method? }}
 */
export async function redeemPositions(privateKey, conditionId) {
  const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
  const CTF_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
    'function balanceOf(address owner, uint256 id) view returns (uint256)',
    'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
    'function isApprovedForAll(address account, address operator) view returns (bool)',
    'function setApprovalForAll(address operator, bool approved) external',
  ];
  const NEG_RISK_ADAPTER_ABI = [
    'function redeemPositions(bytes32 _conditionId, uint256[] _amounts) external',
  ];
  const USDC_ABI = ['function balanceOf(address) view returns (uint256)'];

  // Detect NegRisk + resolve Yes/No token_ids via CLOB API
  let isNegRisk = false;
  let yesTokenId = null;
  let noTokenId = null;
  try {
    const mres = await fetch(`${CLOB_BASE}/markets/${conditionId}`, { signal: AbortSignal.timeout(5000) });
    if (mres.ok) {
      const md = await mres.json();
      isNegRisk = !!md.neg_risk;
      for (const t of (md.tokens || [])) {
        const o = (t.outcome || '').toLowerCase();
        if (o === 'yes') yesTokenId = t.token_id;
        else if (o === 'no') noTokenId = t.token_id;
      }
    }
  } catch (e) {
    console.warn(`[polymarket] market metadata fetch failed: ${e.message} — assuming standard CTF`);
  }

  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const wallet = new ethers.Wallet(privateKey, provider);
      const ctf = new ethers.Contract(CTF_CONTRACT, CTF_ABI, wallet);
      const usdc = new ethers.Contract(USDC_POLYGON, USDC_ABI, provider);

      // USDC balance snapshot — verify the redeem actually paid out
      const usdcBefore = await usdc.balanceOf(wallet.address);

      const feeData = await provider.getFeeData();
      const gasOpts = {
        maxFeePerGas: (feeData.maxFeePerGas || 50000000000n) * 2n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || 30000000000n) * 2n,
      };

      let tx;
      let method;
      if (isNegRisk) {
        method = 'negRiskAdapter';
        if (!yesTokenId || !noTokenId) {
          return { ok: false, error: 'NegRisk market: Yes/No token_ids not resolvable from CLOB' };
        }
        const [yesBal, noBal] = await Promise.all([
          ctf.balanceOf(wallet.address, yesTokenId),
          ctf.balanceOf(wallet.address, noTokenId),
        ]);
        if (yesBal === 0n && noBal === 0n) {
          return { ok: false, error: 'No outcome tokens to redeem (both Yes and No balance are zero)' };
        }
        // NegRiskAdapter 要从钱包 safeTransferFrom outcome tokens → 需要 ERC-1155 operator approval
        // 和 USDC.approve 是两套权限，第一次赎 NegRisk 必须先 setApprovalForAll
        const approved = await ctf.isApprovedForAll(wallet.address, NEG_RISK_ADAPTER);
        if (!approved) {
          console.log(`[polymarket] setApprovalForAll(NegRiskAdapter) — first NegRisk redeem on this wallet`);
          const approveTx = await ctf.setApprovalForAll(NEG_RISK_ADAPTER, true, gasOpts);
          await approveTx.wait();
          console.log(`[polymarket] approval set TX: ${approveTx.hash}`);
        }
        const adapter = new ethers.Contract(NEG_RISK_ADAPTER, NEG_RISK_ADAPTER_ABI, wallet);
        console.log(`[polymarket] NegRisk redeem condition=${conditionId.slice(0,16)}... yes=${yesBal} no=${noBal}`);
        tx = await adapter.redeemPositions(conditionId, [yesBal, noBal], gasOpts);
      } else {
        method = 'ctf';
        const denom = await ctf.payoutDenominator(conditionId);
        if (denom === 0n) {
          return { ok: false, error: 'Market not yet resolved (payoutDenominator=0)' };
        }
        console.log(`[polymarket] CTF redeem condition=${conditionId.slice(0,16)}...`);
        tx = await ctf.redeemPositions(USDC_POLYGON, ethers.ZeroHash, conditionId, [1, 2], gasOpts);
      }

      console.log(`[polymarket] Redeem TX: ${tx.hash} (${method})`);
      const receipt = await tx.wait();
      const usdcAfter = await usdc.balanceOf(wallet.address);
      const usdcDelta = usdcAfter - usdcBefore;
      const deltaFmt = ethers.formatUnits(usdcDelta, USDC_DECIMALS);
      console.log(`[polymarket] Redeem confirmed block=${receipt.blockNumber} gas=${receipt.gasUsed} usdcDelta=${deltaFmt}`);

      // TX 成功但 USDC 没增加 = 合约静默 no-op（之前 NegRisk 走错合约就是这症状）
      if (usdcDelta === 0n) {
        return {
          ok: false,
          error: `Redeem TX landed but paid 0 USDC — tokens may not be redeemable via ${method} (market type misdetected?)`,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed?.toString(),
          usdcDelta: '0',
          method,
        };
      }

      return {
        ok: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
        usdcDelta: usdcDelta.toString(),
        usdcDeltaFormatted: deltaFmt,
        method,
      };
    });
  } catch (e) {
    console.error(`[polymarket] Redeem error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Sweep USDC from Polymarket wallet to a destination address.
 * Transfers the FULL USDC balance (no partial — used by logout/exit flow).
 *
 * @param {string} privateKey  Polygon wallet private key (raw hex, decrypted)
 * @param {string} toAddress   Destination EOA (0x...)
 * @returns {Promise<{ok:true, txHash:string, amount:string} | {ok:false, error:string}>}
 */
export async function sweepUsdc(privateKey, toAddress) {
  try {
    if (!ethers.isAddress(toAddress)) {
      return { ok: false, error: `Invalid destination address: ${toAddress}` };
    }
    return await withProvider(POLYGON_RPC, async (provider) => {
      const signer = new ethers.Wallet(privateKey, provider);
      const usdc = new ethers.Contract(USDC_POLYGON, [
        'function balanceOf(address) view returns (uint256)',
        'function transfer(address,uint256) returns (bool)',
      ], signer);
      const balance = await usdc.balanceOf(signer.address);
      if (balance === 0n) {
        return { ok: false, error: 'USDC balance is zero, nothing to sweep' };
      }
      const feeData = await provider.getFeeData();
      const tx = await usdc.transfer(toAddress, balance, {
        maxFeePerGas: (feeData.maxFeePerGas || 50000000000n) * 2n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || 30000000000n) * 2n,
      });
      console.log(`[polymarket] Sweep USDC ${ethers.formatUnits(balance, USDC_DECIMALS)} → ${toAddress.slice(0,10)}... TX: ${tx.hash}`);
      const receipt = await tx.wait();
      return {
        ok: true,
        txHash: tx.hash,
        amount: ethers.formatUnits(balance, USDC_DECIMALS),
        blockNumber: receipt.blockNumber,
      };
    });
  } catch (e) {
    console.error(`[polymarket] sweepUsdc error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Check redeem status for a settled market.
 *
 * Caller must pass the outcome token IDs from CLOB trades (trade.asset_id) —
 * we do NOT compute positionId locally because Gnosis CTF getCollectionId
 * uses BN254 curve point hashing, not keccak256. Self-computed IDs are wrong
 * and produce false balance=0 readings, which used to get misreported as
 * "already redeemed". Source of truth: the asset_id returned by CLOB trades.
 *
 * Returns: { resolved, redeemable, balance }
 * - resolved: market has a result (payoutDenominator > 0)
 * - redeemable: user holds outcome tokens that can be redeemed
 * - balance: total outcome token balance across provided asset_ids
 */
export async function checkRedeemStatus(walletAddress, conditionId, assetIds = []) {
  const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
  const CTF_ABI = [
    'function balanceOf(address owner, uint256 id) view returns (uint256)',
    'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
  ];
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const ctf = new ethers.Contract(CTF_CONTRACT, CTF_ABI, provider);

      const denom = await ctf.payoutDenominator(conditionId);
      const resolved = denom > 0n;

      let totalBalance = 0n;
      for (const assetId of assetIds) {
        try {
          const bal = await ctf.balanceOf(walletAddress, assetId);
          totalBalance += bal;
        } catch { /* skip this asset */ }
      }

      return { resolved, redeemable: resolved && totalBalance > 0n, balance: totalBalance.toString() };
    });
  } catch (e) {
    return { resolved: false, redeemable: false, balance: '0', error: e.message };
  }
}

/**
 * Pull full user activity (TRADE + REDEEM) from Polymarket data-api.
 * Returns entries in chronological order.
 */
export async function fetchUserActivity(walletAddress) {
  const all = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    try {
      const r = await fetch(
        `https://data-api.polymarket.com/activity?user=${walletAddress.toLowerCase()}&limit=100&offset=${offset}`,
        { signal: AbortSignal.timeout(TIMEOUT) }
      );
      if (!r.ok) break;
      const j = await r.json();
      if (!Array.isArray(j) || j.length === 0) break;
      all.push(...j);
      if (j.length < 100) break;
    } catch { break; }
  }
  all.sort((a, b) => a.timestamp - b.timestamp);
  return all;
}

/**
 * Current account value from Polymarket data-api.
 * This is outcome-token value only (does NOT include idle USDC balance).
 */
export async function fetchAccountValue(walletAddress) {
  try {
    const r = await fetch(
      `https://data-api.polymarket.com/value?user=${walletAddress.toLowerCase()}`,
      { signal: AbortSignal.timeout(TIMEOUT) }
    );
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j?.[0]?.value || 0);
  } catch { return 0; }
}

/**
 * Resolve winner for a market via on-chain payoutNumerators.
 * Uses polymarket_market_results cache — once resolved, result never changes.
 * Returns { winner: 'Yes'|'No'|null, resolved: boolean } (null winner if unresolved or split).
 */
export async function getMarketWinner(conditionId) {
  const cached = sqlite.prepare(
    'SELECT winner_outcome FROM polymarket_market_results WHERE condition_id = ?'
  ).get(conditionId);
  if (cached?.winner_outcome) {
    return { winner: cached.winner_outcome, resolved: true, cached: true };
  }

  const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
  const CTF_ABI = [
    'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
    'function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)',
  ];
  try {
    return await withProvider(POLYGON_RPC, async (provider) => {
      const ctf = new ethers.Contract(CTF_CONTRACT, CTF_ABI, provider);
      const denom = await ctf.payoutDenominator(conditionId);
      if (denom === 0n) return { winner: null, resolved: false };
      const yesPayout = await ctf.payoutNumerators(conditionId, 0);
      const noPayout = await ctf.payoutNumerators(conditionId, 1);
      const winner = yesPayout > noPayout ? 'Yes' : noPayout > yesPayout ? 'No' : null;
      try {
        sqlite.prepare(`
          INSERT OR REPLACE INTO polymarket_market_results
            (condition_id, winner_outcome, payout_numerators, payout_denominator, resolved_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(conditionId, winner, JSON.stringify([yesPayout.toString(), noPayout.toString()]), denom.toString());
      } catch { /* cache write best-effort */ }
      return { winner, resolved: true };
    });
  } catch (e) {
    return { winner: null, resolved: false, error: e.message };
  }
}

