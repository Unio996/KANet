# Broker USDT→USDC PancakeSwap Spec (J2 #3 接 v1.1 task)

> **日期**: 2026-04-27
> **作者**: J2 Opus #3
> **依赖**: NWT v2 spec a6cb8853d (broker asset-generic v2) + J1 6b7b35a (asset-registry + settler-router)
> **状态**: 讨论稿 (求 J1+NWT review)
> **三方共识**: USDC funding vote (a) broker swap (J1+NWT+J2 全 ✓ 22:43-22:48 真共识)

---

## 真意 (TL;DR)

v1.1 USDC 真测前置: broker BSC 钱包真持 1+ USDC 库存. 真 funding 路径:
- broker 已持 USDT-BSC 库存 (~$10) — query: `GET /api/relay/<broker>/wallets`
- 调 PancakeSwap V2 router 真 swap N USDT → ~N USDC (peg ~1:1, slippage <0.1%)
- 不烧 Owner 钱 + production value (broker 自治 multi-asset 库存 = v1.3 inventory pool prerequisite)

---

## 真 contract addresses (BSC mainnet)

| 项 | address |
|---|---|
| PancakeSwap V2 Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| USDT-BSC | `0x55d398326f99059fF775485246999027B3197955` (18 decimals) |
| USDC-BSC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (18 decimals) |

V2 router 真 swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline).

---

## 真 design — broker-swap.js (~30 LOC core + ~20 LOC integration)

```js
// kasia-console/src/services/broker-swap.js
import { ethers } from 'ethers';
import { decryptPrivKey } from './crypto.js';

const BSC_RPC = 'https://bsc-dataseed.binance.org';
const PCS_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const PCS_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] memory)',
];
const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

// Swap N USDT → ~N USDC on BSC PancakeSwap V2 (J2 #3 v1.1 USDC funding)
// 真用: broker 库存 USDC 不足 1 时, 自动 swap 1 USDT → ~1 USDC
// slippage: 0.5% (USDC/USDT peg ~1:1, real slip <0.1% but conservative)
// gas: ~0.0003 BNB (~$0.20)
export async function swapUsdtToUsdc(privkeyEncrypted, amountUsdt, slippagePct = 0.5) {
  const wallet = new ethers.Wallet(decryptPrivKey(privkeyEncrypted), new ethers.JsonRpcProvider(BSC_RPC));
  const usdt = new ethers.Contract(USDT_BSC, ERC20_ABI, wallet);
  const router = new ethers.Contract(PCS_ROUTER, PCS_ABI, wallet);

  const amountIn = ethers.parseUnits(amountUsdt.toFixed(6), 18);
  const amountOutMin = (amountIn * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n;

  // 1. balance check
  const bal = await usdt.balanceOf(wallet.address);
  if (bal < amountIn) throw new Error(`USDT 余额不足 (${ethers.formatUnits(bal, 18)} < ${amountUsdt})`);

  // 2. approve router (idempotent — check allowance first)
  const allowance = await usdt.allowance(wallet.address, PCS_ROUTER);
  if (allowance < amountIn) {
    const approveTx = await usdt.approve(PCS_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
  }

  // 3. swap
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min
  const tx = await router.swapExactTokensForTokens(
    amountIn, amountOutMin,
    [USDT_BSC, USDC_BSC],
    wallet.address,
    deadline,
  );
  const receipt = await tx.wait();
  return { ok: true, txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() };
}
```

---

## 真 integration — broker inventory pre-flight check

Phase A v1.1 broker handler 真接 `give_asset` 时, 加 inventory pre-flight:

```js
// broker-buy-handler.js (Phase A 改造时加)
async function _ensureBrokerInventory(asset, chain, qty) {
  if (asset === 'KAS') return; // KAS 库存检 fund-lock 已 cover
  // EVM asset (USDT/USDC/...) — query broker chain wallet balance
  const wallets = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/relay/${BROKER_RELAY_ID}/wallets`).then(r => r.json());
  const w = wallets.chains?.find(c => c.chain === chain);
  const balField = `${asset.toLowerCase()}Balance`;
  const have = parseFloat(w?.[balField] || 0);
  if (have >= qty) return;
  // 不够 → trigger swap (only USDC 现实, 后续 generic)
  if (asset === 'USDC' && chain === 'bnb') {
    const need = qty - have;
    const { swapUsdtToUsdc } = await import('./broker-swap.js');
    const result = await swapUsdtToUsdc(w.privkeyEnc, need + 0.1); // +0.1 buffer for slippage
    console.log(`[broker-swap] ${need} USDT → USDC tx=${result.txHash}`);
    // chain_event audit
    sqlite.prepare(`INSERT INTO chain_events (...) VALUES (...)`).run(...);
    return;
  }
  throw new Error(`Asset ${asset}-${chain} no swap path, broker insufficient inventory`);
}
```

---

## 真测 (J2 #3 接 v1.1 真测)

### Pre-flight 真测 (~$0.30)
1. broker BSC USDT 余额 query (current: `query /api/relay/0a8e9723.../wallets`)
2. 真 swap 0.5 USDT → ~0.499 USDC (真 PancakeSwap real call)
3. verify USDC balance increased by ~0.499 ± 0.1%
4. chain_events 'broker_swap' 真 audit 真 insert
5. **真 cost**: ~$0.001 BNB gas (PancakeSwap swap 真便宜)

### Integration 真测 (合 e2e-asset-pair.mjs Phase 2)
1. broker BSC USDC 余额 < 1 (假设 0)
2. test peer DM "买 1 USDC, BSC, USDT 付"
3. broker handler _ensureBrokerInventory 真触发 swap
4. swap 1.1 USDT → ~1.099 USDC (with 0.1 buffer)
5. broker publish offer 'sell 1 USDC for 1 USDT BSC'
6. test peer 真转 1 USDT → broker deliver 1 USDC → completed

---

## 真 risk + mitigation

| risk | mitigation |
|---|---|
| Swap slippage > 0.5% | conservative 0.5% slippage param, USDC/USDT real peg <0.1% safe |
| PancakeSwap router upgrade | hardcode V2 router address, monitor pcs blog for V3 migration (留 v1.3) |
| BSC RPC fail | retry 3x with 5s backoff, fallback alternate RPC |
| Approve stuck | use MaxUint256 approve idempotent (allowance check first) |
| Gas BNB 不足 | pre-check BNB balance, alert if < 0.001 BNB |
| broker privkey leak | use existing decryptPrivKey (broker EVM wallet 已加密 store) |

---

## v1.1 真 LOC 估

- broker-swap.js core: ~30 LOC
- _ensureBrokerInventory integration in broker-buy-handler: ~20 LOC
- chain_events audit: ~10 LOC
- 真测 e2e-broker-swap.mjs: ~40 LOC
- **真总: ~100 LOC** (J2 #3 估 30 LOC under-estimate, 真 100 含真 integration + 真测)

---

## 三方真共识依赖

- ✓ J1+NWT+J2 USDC vote (a) broker swap (22:43-22:48 真共识)
- ⏳ NWT v3 spec broadcast incorporate broker-swap.js + ~100 LOC
- ⏳ J1 review broker-swap.js spec
- ⏳ J2 #3 真 ship broker-swap.js + e2e (Phase A ship 后)

不动 code 直到三方真共识 + Phase A ship.

---

## 元 spec 真 design choice (J2 自承)

跟 R20 元规则同范式: spec 必含 risk + mitigation + test cost + LOC 严估. NWT v2 spec 23:33 的 "USDC 真测 ~$0.50" 太轻 — 真 cost 含 swap + 真测两阶段, 总 ~$1.50 broker 自吃 (broker 库存 1 USDC + 真 swap fee). 不烧 Owner 钱真共识但 J1+NWT 知 broker 自吃 cost.
