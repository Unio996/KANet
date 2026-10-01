# KANet-UI 阻塞：订单#1 到期退款做不了——订单随机数（nonce）没存，地址无法重建

出处：Bettor 派工（订单#1 到期退款）。06:26Z 到点后动手，**在广播前停手**；零广播、零花费。

## 事实（独立 RPC 核）
- 锁着 1.0 KAS 的是第一次尝试的订单，地址 `kaspa:prgpkha4pz6ljuqmtsl8qa9zpq2rtrwsf5gwxlw8dy9ctxfd9v0ksxkp2qmau`，
  1 个 UTXO（付款 txid `0d4491200c95…`，100000000 sompi），截止 2026-10-01T06:24:17.857Z，节点 PMT 已过期。
- 我交接文件里写的 `pq6d5la2…` 是**写错的地址**：那是第二次尝试的订单，已被 24f07ace 分账花掉，现 0 UTXO。

## 为什么退不了
- 订单地址由 ctor 参数决定，其中含 **16 字节随机 orderNonce**（`resolve-order-wasm.js:58` 每次推导都 `crypto.getRandomValues`），
  截止时间在页面没给时也取 `Date.now()+偏移`。
- 我用原链接重新推导，得到的是新地址 `kaspa:pzjq3mk0…`（截止 10-04），≠ prgpkha4，脚本按预定判据停手。
- 当时那次推导的 nonce 只存在已关闭的浏览器内存里；扫了全部 scratch 日志、docs，**没有任何地方记录过 nonce / redeem script**。
  16 字节随机数不可穷举。
- 这就是 (1776) 里 Codex R11 第①条：浏览器端不能"按已出订单重建地址"（Node 版 `commission-plan-sdk.mjs:465` 已支持传 orderNonceHex，浏览器两份没跟上）——这回真咬到了人。
- 交接文件里"换任一包重新推导就是同一个地址"的假设**被实测推翻**。

## 我没做
未广播任何交易，未碰私钥，未改生产检出/env，未重启 console。无新增花费。

## 需要 Bettor 定
这 1.0 KAS 属于"我们自己的测试金"，且这个订单合约的出口只有分账/到期退款，两条都要 nonce。就目前所知它**取不回**，建议按永久损失记账（本金 1.0 KAS，已计入 (1770) 的未收回部分）。是否记入账本由你定。
另：若要避免再发生，需 Owner 批的是"浏览器端推导时把 nonce+deadline 显示/可导出"之类改动——属 D-034 范围内的结账页小改，但我不自行动手，只供你判断。
