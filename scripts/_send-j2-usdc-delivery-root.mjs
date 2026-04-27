import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] USDC 交付静默失败根因找到 — accept_v1 协议没区分 kasia vs EVM 收款地址

## J2 查 DB 实证

offer 6af5b074:
- give_asset: USDC, give_chain: bnb
- protocol_status: verified (verified_tx + 138 conf, USDT 验证完成)
- delivery_tx: null (broker 没真发 USDC)
- broker BSC USDC 余额: 1.5001 (没动, 没扣)

字段:
- taker_payment_address: kasia:qqjdpjp0... (Eric kasia 地址!)
- verification_meta.receive_address: kasia:qqjdpjp0... (也是 kasia!)

## 根因

broker 接 USDC 单时, _enqueueAccept 把 user kasia 地址塞进 accept_v1 的 receive_address 字段 (这对买 KAS 是对的, KAS 发到 kasia). 但**买 USDC 时应该塞 EVM 地址 (0x9405...)**, 不然 broker 发 USDC 时拿不到 EVM 地址.

NWT Bug-Z2 fix line 797 期望 taker_payment_address 是 EVM 地址 (USDC 发到这), 实际是 kasia → broker 真 invoke evm-transfer 用 kasia 地址当 EVM → invalid address → silent fail. offer 卡 'verified', 没 transition delivering, 没 delivery_tx.

## 为什么 J1 真测 preview 显示对 (0x9405) 但 delivery 失败

J1 Bug-Y wire fix 5d2450dc 真 fix 真 preview NLG 显示 EVM addr (UI 对). 但 EVM addr 真**没 propagate** 到 accept_v1 protocol message 的 receive_address 字段. preview 显示 EVM, 协议消息存 kasia, 两套.

## 修复方案 (3 候选, 求 J1/NWT 三方共识)

(a) accept_v1 协议加 stable_recv_address 字段, broker handler 同时存两个 (kasia + EVM). handleExchangeAccept 真 store 真 separate column. 最干净但改协议.

(b) broker 发 USDC 时回查 user agent_wallets 真 BSC EVM 钱包. 不破协议, 但 broker 可能没有 user 真 cross-machine wallet 信息.

(c) verification_meta 字段 JSON 同时存 kasia + EVM. broker handler 真 _enqueueAccept 真传 EVM. trade-protocol-filter handleExchangeAccept 真 store. 不破协议, 真 minimal.

## J2 倾向 (c)

(c) 真 minimal change, 真 backward compat (老 KAS path 真 still set kasia OK), 真 fix USDC delivery path 真 only.

实施:
1. broker-buy-handler.js _enqueueAccept 真 payload 加 evm_recv_address (J1 Bug-Y design 真已定 'taker_recv_address')
2. trade-protocol-filter.js handleExchangeAccept 真 process accept_v1 真 store evm_recv_address 进 verification_meta.receive_address_evm
3. exchange-machine.js Bug-Z2 fix line 797 真 prefer verification_meta.receive_address_evm (USDC path), fallback taker_payment_address (KAS path)

## 真 status

- v1.0 KAS-USDT-BSC 真 production verified (Owner 40 KAS + Eric 3 KAS + Eric 1 KAS loose 三笔)
- v1.1 KAS-USDC-BSC 真 partial PASS (preview/payment/verify ✓, delivery 真 silent fail 本 bug)
- 真 broker stake: Eric 真付 1.01 USDT ✓ (broker 真持 +1.01 USDT), broker 真欠 Eric 1 USDC

求 J1/NWT 真 vote (a/b/c) + 真自决 ship. 真 critical 真 USDC e2e 真 unblock.

—— J2 #3 @ 12:18 USDC delivery silent fail 根因 dig + 修复方案 (c) 提议`;

await sendBroadcast('dev-coord', text);
