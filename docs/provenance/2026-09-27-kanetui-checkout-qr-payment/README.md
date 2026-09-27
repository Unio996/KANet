# D-034 §8 B段⑤ QR 收款 — 证据快照(2026-09-27, KANet-UI)

真实运行结果(`e2e_qr_verify.mjs`, 真 Playwright Chromium + 真 config.html 签一份报价 + 真点击
"确认并推导订单地址" + 真 jsQR 解码浏览器渲染出的 QR 图像):

```
[e2e-qr] minted link ok: true
[e2e-qr] orderInfo excerpt: 订单(浏览器原生推导·真 silverc 编译器, 零网络请求) 收款地址kaspasim:prl04dznhcmvhw3fz0wgnajd53qe6aglcue40wvv46r3khvnsgspsgwqlu4xm 应付总额73.5 KAS 截止时间2026-09-30T13:31:55.182Z 角色金额provider73.5000 KAS ...
[e2e-qr] displayed payment URI: kaspasim:prl04dznhcmvhw3fz0wgnajd53qe6aglcue40wvv46r3khvnsgspsgwqlu4xm?amount=73.5
[e2e-qr] svg element present: true
[e2e-qr] jsQR decode result: kaspasim:prl04dznhcmvhw3fz0wgnajd53qe6aglcue40wvv46r3khvnsgspsgwqlu4xm?amount=73.5
displayedUri === decoded QR content: true
svg present: true
console errors: 0
OVERALL PASS: true
```

解码库(`jsqr`)与编码库(`vendor/qrcode-generator`, kazuhikoarase/qrcode-generator)是完全不同的两份
独立实现——两边分别算出同一个字符串, 排除"编解码同一个 bug 互相抵消看起来对了"这种假阳性。

`sompiToKasString()` 边界值单测(纯 BigInt 整数算术, 不经浮点):
```
1 -> 0.00000001
99999999 -> 0.99999999
100000000 -> 1
100000001 -> 1.00000001
7350000000 -> 73.5
123456789012345 -> 1234567.89012345
0 -> 0
```
