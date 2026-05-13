# INVARIANTS — cross-chain bridge + multichain agent 经济 v0.5

**版本**: v0.5 · **作者**: NWT (architect mode, cross-hat per Owner 5/13 钦定) · **创建**: 2026-05-13
**状态**: 🟢 active spec, 等 J2 T0 grep verify
**前置**: DEV-ROLES.md / COLLAB-REFORM.md / INVARIANTS.md v0.1 / INVARIANTS-broker-dual-path-v0.4.md / SHIP-CHECKLIST.md / bridge-router.js v0.1.1 production ship

---

## 1. Context (5/13 Owner 钦定演化)

5/12 BSC 1 chain real e2e PASS (J2 #326) 证 single-chain agent-to-agent exchange production grade.

5/13 Owner 钦定扩 multichain (4 chain agent-to-agent e2e):
- "跨链做好了对 KANet 未来一样很有用" — production bridge, 不 throwaway
- 走 v0.1.1 (LZ V2 OptionsType3 native drop) — 破解 Gate.io 白名单 24h cooldown 死锁
- Phase 2 β scope: bnb regression + polygon/arb/op/base (跳 eth/avalanche/sol/tron)

5/13 ship 结果:
- bridge-router.js production v0.1 (Stargate V2 LayerZero OFT) + v0.1.1 (LZ V2 native drop encoding)
- 4 chain (polygon/arb/op/base) full agent-to-agent e2e PASS
- 真投入 ~$77 lock + ~$7-8 burn
- 2 个 architect spec 错位 J2 catch (Polygon pool addr typo + asset 透传 protocol-wide audit)

本文档 sediment **cross-chain 7 个 invariant** + **multichain bridge architecture 真相源**.

---

## 2. Invariant 表 (each 严守, breaks invariant = re-design)

### Layer 1: bridge 协议层 (单一真相源)

- **I-N1** 所有 cross-chain transfer 走 `kasia-console/src/services/bridge-router.js`, 任何 agent 不直 ethers.Stargate 调用
  - 现 export (实证 grep): `bridgeAsset` / `quoteBridge` / `buildLzV2Options` (helper)
  - L? `STARGATE_POOLS` const 派生 5 chain mainnet pool (J2 #330 triple-verified against Stargate V2 gitbook docs)
  - 加 chain = 加 STARGATE_POOLS entry + STARGATE_EIDS entry, 不动 bridgeAsset signature

- **I-N2** `bridge_initiated` chain_events row 必 source TX confirmed 后入账 (`await tx.wait(1)`)
  - NO TX NO STATE CHANGE 铁律
  - dest chain TX 后续 LZ scan webhook (v0.2) OR manual poll surface bridge_completed
  - 违反 = source TX revert / not mined 时不能 sediment bridge state

- **I-N3** LZ V2 OptionsType3 encoding **派生 from canonical helper** `buildLzV2Options(lzReceiveGas, nativeDropAmount, nativeDropTo)`, 不 hardcode bytes
  - 跟 LZ V2 ExecutorOptions.sol 实证对齐 (J2 #332 triple-verified)
  - byte layout: TYPE_3 header (2B) + LZ_RECEIVE option (20B: 1+2+1+16 worker+size+type+gas) + NATIVE_DROP option (52B: 1+2+1+16+32 worker+size+type+amount+receiver) = 74B total when drop > 0
  - 修 encoding spec 必 byte-by-byte verify (NWT spec off-by-2 KI 第 6 次复刻警示)

### Layer 2: cross-chain asset 透传 (protocol-wide consistency)

- **I-N4** Asset 透传 protocol-wide audit: publish / accept / autoPay / autoSettle / verify / broadcast **6 path** asset/chain 参数必一致
  - 现实证 path:
    - L132 `/api/exchange/publish` (verification_meta.accepted_chains[].asset OR want_asset)
    - L347 `/api/exchange/accept` (selected_chain + payment_asset 派生)
    - trade-protocol-filter `_autoPayExchange` L1376 (transferUsdt + asset 透传)
    - trade-protocol-filter `_autoSettleAsset` L1488 (settler-router sendAsset)
    - exchange-machine `processPaymentSubmit` L748 (payment_asset → meta.payment_asset)
    - trade-protocol-filter `handleExchangePaid` L1088 + broadcast L1404 (msg.payment_asset)
  - 违反 = Sub #4.b base USDC dispute pattern (asset 默 'usdt' verify side, transfer 实际 USDC, 0 found)
  - KI 第 7 次复刻警示: architect spec 含 asset param 透传 必 6 path 全 grep audit

- **I-N5** 同 asset cross-chain bridge only (Stargate V2 limitation), cross-asset bridge (USDT BSC → USDC base) 走 broker-swap intermediate
  - 现实证: BSC → polygon/arb/op/base v0.1+v0.1.1 全 same-asset (USDT/USDC)
  - base 链 cross-asset 实施: broker BSC swap USDT → USDC (PCS V2 broker-swap.js) + bridge BSC USDC → base USDC
  - v0.3 backlog: Squid Router cross-asset bridge 1 step (BSC USDT → base USDC 单 tx)

- **I-N6** 同 chain swap 走 PancakeSwap V2 (BSC only currently), 跨链 swap 走 Squid Router (v0.3 待 spec)
  - 现实证: broker-swap.js PCS V2 BSC USDT/USDC pair (J2 #3 a58158f37a)
  - 注意 PCS V2 swapExactTokensForETH 撞 BSC USDT revert, 用 swapExactTokensForETHSupportingFeeOnTransferTokens 变种 (NWT operator 5/13 实证)

### Layer 3: bridge native gas (跨链 chicken-and-egg 破解)

- **I-N7** dest chain native gas 必 via LZ V2 OptionsType3 NATIVE_DROP encoding (source 付费)
  - 替代: CEX 提币 (Gate.io 24h 白名单 cooldown) — production blocker
  - 替代 II: source chain swap → bridge → DEX swap (chicken-and-egg, no native gas to DEX)
  - **LZ V2 native drop 是唯一 production grade 解** (5/13 实证)

- **I-N8** native drop amount 估算 = dest chain ERC20 tx gas × 2 (broker self-tx + broker → taker prefund)
  - polygon ~0.05 MATIC (~$0.03, 足跑 60 polygon tx)
  - arbitrum ~0.0005 ETH (~$1.75, 足跑 35 arb tx)
  - optimism ~0.0001 ETH (~$0.35, 足跑 7 op tx)
  - base ~0.0002 ETH (~$0.7, 足跑 14 base tx)

---

## 3. multichain agent 经济架构 (5/13 实证 production 状态)

### 3.1 Trader-B (broker) + Trader-A (taker) 各 chain 配置

| chain | broker addr | taker addr | broker fund | taker fund | native |
|---|---|---|---|---|---|
| kaspa | (relay address) | (relay address) | 1851 KAS | 9.49 KAS | n/a |
| bnb | 0xaD12544E... | 0x83f65EED... | 0.56 USDT + 0.5 USDC | 0.96 USDT | 0.0005 BNB (low after Sub #3 ops) |
| polygon | 0xf5A95fE5... | 0x17b15321... | 13.99 USDT | 2.00 USDT | 0.05 MATIC each |
| arbitrum | 0xba0146d7... | 0x57EACB47... | 13.99 USDT | 2.00 USDT | 0.0005 ETH each |
| optimism | 0x3783A516... | 0x798Da96f... | 13.99 USDT | 1.00 USDT | 0.0001 ETH each |
| base | 0x498853Dc... | 0x661FfAf9... | 13.99 USDC | 1.00 USDC | 0.0002 ETH each |
| sol | 9MUju5sW... | CFxnrSWSj... | 0 (Wormhole v0.3) | 0 | 0 |
| tron | TWQt5ofSc... | TWhK3YjPT... | 0 (β skip) | 0 | 0 |

### 3.2 cross-chain settlement flow (实证 5/13)

```
1. broker SELL KAS want USDT/USDC on chain X (publish via /api/exchange/publish, verification='cross_chain_tx')
   payload: accepted_chains=[{chain: X, address: broker.X.addr}], want_asset=USDT/USDC

2. taker accept (POST /api/exchange/accept, selected_chain=X, payment_asset 派生)
   _autoPayExchange triggered (verification='cross_chain_tx' + taker local agent)

3. _autoPayExchange L1376:
   transferUsdt(X, taker.privkey, broker.X.addr, want_amount, want_asset)
   → 路由 (Sub #1 ship):
     - isEvmChain(X) → transferERC20(X, ..., asset) [7 EVM chain]
     - X='sol' → transferSolUsdt (USDT only, v0.3 Wormhole 加 cross-chain)
     - X='tron' → transferTronUsdt (USDT only)
   → 真链 ERC20 transfer 0.05 USDT/USDC taker → broker

4. broadcast kanet_exchange_paid_v1 含 payment_asset (offer.want_asset)

5. handleExchangePaid L1088 → processPaymentSubmit({offer_id, payment_tx, payment_chain, payment_asset})
   (Sub #4.b hotfix: payment_asset 透传 ✓)

6. processPaymentSubmit L748:
   meta.payment_asset = payment_asset || offer.want_asset
   transition open → verifying

7. _verifyAndComplete L831:
   paymentAsset = meta.payment_asset || 'usdt'
   verifyCrossChainTx({txHash, chain: X, expectedAmount, expectedTo, paymentAsset})
   → _verifyEvm STABLECOINS[X][paymentAsset.toLowerCase()] → ERC20 Transfer event scan
   → confirmed=true if amount match + ≥ confirmations threshold

8. transition verifying → delivering → _autoSettleAsset L1488
   broker 真链 send 1 KAS to taker via settler-router.sendAsset (kasia settler send_kas command)

9. transition delivering → completed
   chain_events 完整 trace: tx (publish) + exchange_matched + broker_chunk_filled + exchange_paid + exchange_completed
```

### 3.3 bridge prefund flow (实证 5/13 NWT operator)

```
Gate.io USDT → broker BSC (1 笔 60 USDT withdraw, fee 0.5 USDT)
→ broker BSC swap USDT → USDC (PCS V2, base 链需 USDC supply, 0.08% slippage)
→ broker BSC swap USDT → BNB (PCS V2 SupportingFeeOnTransfer, source native gas 备)
→ broker BSC USDT/USDC source → 4 chain via bridgeAsset (Stargate V2 LZ OFT)
  - polygon broker + taker each (4 USDT + 2 USDT) + 0.05 MATIC drop each
  - arbitrum broker + taker each (4 USDT + 2 USDT) + 0.0005 ETH drop each
  - optimism broker + taker each (4 USDT + 1 USDT) + 0.0001 ETH drop each
  - base broker + taker each (4 USDC + 1 USDC) + 0.0002 ETH drop each
→ 12 bridges total (4 v0.1 broker only + 8 v0.1.1 broker+taker × native drop)
→ LZ V2 confirm < 60s 全到 dest chain
→ broker + taker 4 chain 全 USDT/USDC + native gas ready
→ Sub #4 真链 e2e 4 chain run PASS
```

### 3.4 总成本实证 (5/13)

| 类 | amount |
|---|---|
| Gate.io withdraw fee | 0.5 USDT |
| broker BSC swap slippage (USDT → USDC × 2 + USDT → BNB × 2) | ~$0.06 |
| v0.1 bridges fee | ~$0.22 (BNB) |
| v0.1.1 bridges fee + native drop value | ~$5.5 (BNB) |
| **总 burn fee** | **~$6-7** |
| broker 投入 (lock 各 chain wallet) | ~$77 |
| 真 e2e 实施 4 chain × 0.05 USDT/USDC + 4 KAS settlement | ~$0.6 |

---

## 4. v0.2+ backlog (out of v0.1.1, KANet long-term)

- **v0.2 LZ scan webhook listener**: bridge_completed dest chain TX surfacing (替代 manual poll)
- **v0.2 conditional skip framework feature**: prefund_check_or_skip action + ctx.skip handler (J2 Sub #2.b defer)
- **v0.3 Squid Router cross-asset bridge**: USDT BSC → USDC base 单 tx (替代 broker-swap intermediate)
- **v0.3 Wormhole / Allbridge for SOL/TRON**: EVM ↔ Solana/TRON cross-chain (Stargate V2 不 cover)
- **v0.3 avalanche/ethereum pool 加入** (β path 跳了 eth gas $5+, avalanche 可选)
- **v0.4 auto multichain rebalance**: broker 自动 detect 各 chain USDT 不足, auto bridge from source (替代 NWT operator manual fire)

---

## 5. 与现有 INVARIANTS 关系

| 文档 | scope | 关系 |
|---|---|---|
| INVARIANTS.md v0.1 (5/3) | KANet 工程文化通用 (17 KI + 6 反模式) | 本文档继承 Architect mode invariants |
| INVARIANTS-broker-dual-path-v0.4.md (5/6) | broker 双路 + 协议层汇聚 | 本文档继承 I-1 (单一真相源 endpoint) |
| INVARIANTS-cross-chain-v0.5.md (本) | bridge + multichain | 8 个 cross-chain specific invariant |
| STATE-MACHINES.md v0.3 | exchange + broker state machine | 本文档 §3.2 引用 (open→verifying→delivering→completed) |
| ANTI-PATTERNS.md 规则 43/44/45 (5/13) | architect spec mainnet addr + byte arithmetic + asset 透传 sweep | KI 第 6+7 次复刻 sediment, 反向规则 |

---

## 6. 修订规则

修订必带版本号 + 修订人 mode + 修订理由. 本 v0.5 → v0.6 trigger:
- v0.2 LZ webhook listener ship 后, I-N2 dest TX surfacing 改 webhook-driven
- v0.3 Squid integration 后, I-N5 cross-asset 改 1-step (替代 broker-swap intermediate)
- 任何新 chain 加入 (eth/avalanche/sol/tron) 后, §3.1 表格扩

---

*本文档自身是 architect mode 的产物 (NWT cross-hat per Owner 5/13 钦定 "跨链做好了对 KANet 未来一样很有用"). 修订时请保持 architect 视角, 不退化成 implementor checklist.*

*版本 v0.5 — 2026-05-13. 后续修订必带版本号 + 修订人 mode + 修订理由.*
