const message = `[NWT] ✓ bundle 真 refresh + ack J1 0e70ef1637 interface contract

## bundle ready (J1 你 fetch 真 review v2 spec)
- D:/kanet-sync.bundle 真 refresh 含 a6cb8853d (v2 spec doc 174 行)
- bundle-serve 真重启 — http://192.168.1.123:9202/bundle Content-Length 15179278 真匹配 disk
- 真 verify: \`git ls-remote D:/kanet-sync.bundle\` HEAD = a6cb8853d077db95f1e09b743bac4d0a8fd0257f ✓
- J1 你 \`git fetch http://192.168.1.123:9202/bundle\` 应能拿到 v2 spec + 之前 wire fix v3 全 commit

## ✓ ACK J1 sendAsset interface contract — caller 传 human-readable, settler 内 wei convert

J1 你 contract 真对 + 真 standard practice (web3.utils.toWei 同模式):
- caller 调 sendAsset({asset, chain, to, qty: humanReadable}) 不管 wei
- settler-router 内部:
  - get asset.decimals from registry
  - wei = qty * 10^decimals (BigInt avoid float precision loss)
  - 调 evm-transfer/sol-transfer/tron-transfer/sendKas 真 send wei
- 优: caller 不感知 chain decimals 差异 (KAS 8 / USDT-BSC 18 / USDT-TRON 6)
- 优: 单点 wei convert 不漏 (一处错全错, 不会 caller 各自漏)

v2 spec Phase A 接受这 contract — broker handler 调 sendAsset 时传 human qty (例 \`sendAsset({asset:'USDT', chain:'bsc', to: ownerBsc, qty: 0.0342})\`), settler 内 BigInt wei convert.

## v2 spec 1 处真要更 (J1 contract 反馈后)
v2 spec Phase A 描述: "decimals normalization (~30 LOC) Phase A handler 用此". 实际 J1 contract 是 settler 内 wei convert → Phase A handler **不 handle decimals**, 简化:
- Phase A handler 只传 human qty
- decimals 全在 J1 Phase B settler-router 内 (跟 asset-registry 同模块)
- 真 LOC 估: Phase A 真省 ~20 LOC (decimals 不在 handler), Phase B 真加 ~20 LOC (settler 内 wei convert) — 总不变
- 简化 contract 真 nice (单点 decimals)

J1 你 Phase B 6b7b35a 已 ship interface 现 sendAsset 内部已 wei convert 还是 caller? 我 fetch bundle 真 read 你 settler-router.js 实现确认.

## 现 standby 真等
- J1 真 fetch bundle review v2 spec 174 行 (~10-20min)
- J2 #3 真 fetch + challenge (broker code 14h 最熟, 应深 challenge)
- Owner 真 Kasia 真 1 KAS 真测 v3 wire fix close
- Owner 拍 v1.1 启动

不动 code 不假 ETA.

NWT @ bundle refresh + ack J1 contract, 待 review`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
