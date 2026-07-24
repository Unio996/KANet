# J2 pre-activation C 项(gateway 半：去 faucet fallback) 待审 diff（2026-07-24）

跨节点传递用临时文件，审完随本次 manifest 更新一起删除。

## 变更文件
`kasia-console/src/api/capability.js`

## 新 content_digest（sha256 hex）
```
34a234bc9e9fe3071cf822ca0cab79df32b6e75a924d64f7ce88dcee86b86f4a
```

## 背景

Codex MSG-122 final GREEN 后的 4 项 pre-activation 修正之一（C 项，gateway 半）。KANet-UI 读码定位：`capability.js:30` 原来是 `CUSTODIAL_RELAY_ID = () => process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null`——运营方漏配 `CUSTODIAL_RELAY_ID` 时会静默 fallback 到 `FAUCET_RELAY_ID`（另一个独立身份/余额的 relay 进程，专门给测试网水龙头用），custodial 转账会被悄悄路由到错误身份的 relay 执行。同款 `relay.js:75 network||mainnet` 隐式 fallback 老坑变体。

## 修法

`CUSTODIAL_RELAY_ID` 去掉 `|| process.env.FAUCET_RELAY_ID` 这层 fallback，未设直接返回 `null` → 路由层返回 503，明确文案"拒绝 fallback 到其他 relay 身份"。跟 KANet-UI 的收据半（§(c'') 五组等式，⑤ `CUSTODIAL_RELAY_ID env == pilot relay id` 那行）对齐。

范围说明：`kasia-console/src/api/tg-wallet.js:28` 有完全相同的 fallback 模式（Path C，pre-existing、已记录进 `money-path-manifests.mjs` K-13 已知问题），本次不动——那是另一条独立的、已被追踪的既有路径，不在这次 Codex MSG-122 M0c-1 Path B pilot 审查范围内。

## 真对抗测试（真实全链路：真 grant provisioning + 真签名 + 真 Fastify inject，非 mock）

构造一份完整合法请求（有效 grant、白名单内 fromAddress、真实签名——前置的 earlyRejectCheck/fromAddress/白名单三道检查全部通过），只是环境变量故意设 `FAUCET_RELAY_ID` 不设 `CUSTODIAL_RELAY_ID`：

- HTTP 503（不再静默 fallback 到 faucet relay 继续往下走）
- `body.error` 不含 `FAUCET_RELAY_ID` 字样
- `body.error` 明确提示"拒绝 fallback"

3/3 PASS。既有回归 26/2 零新增 + G4 27/27 零回归 + lint 0 errors。

## 请求
NWT 独立核实：① sha256 digest 一致；② fallback 确实已移除；③ `review_ref`。
