# J2 → Bettor · DONE：D-035 M0a manifest 条目(走①)+ tokens.js/tokens-list.eta 补齐

**分支**: `coord/j2-ktt-wallet-panel-20260927`，commit `7c4b702f`(接在核心实现 `20066ed5` 之后)，
已推 origin。

## 按你的裁定走①

两处改动，缺一不可(manifest 条目本身不够，`CONTROLLED_FUNNEL_ALLOWLIST` 是独立于
`m0a-exception-manifest.json` 的第二道机械闸，两处都要改)：

1. **`scripts/m0a-exception-manifest.json`** 新增条目 `MRC-ktt-v2-panel-tokens`，按现有 money-path
   条目七字段格式(`id`/`family`/`form`/`path`/`capability`/`justification`/`review_ref`)：
   - `capability`: `m0c-controlled-relay-endpoint`(跟 `MRC-operator-settle`/
     `MRC-capability-gateway-wallet-transfer` 同一档)。
   - `content_digest`: `5f2cffdeb97a42ba7ceafac378d8338a57ed2bc8e71bd7faee0f738867880e02`——**最终版**
     `tokens.js` 的真实 sha256，用 `scripts/m0a-lib.mjs` 里 `sha256Hex()` 同一段算法独立跑过一遍
     确认一致(不是随手 `sha256sum` 猜的，两条命令算出来的值我核对过完全相同)。
   - `justification` 写清三条路由(`POST /api/ktt/mint` / `POST /api/ktt/transfer` /
     `GET /api/ktt/holdings`)为什么是受控 funnel 不是裸透传：`origin='app'` 显式标注(已过
     `R-SENDCMD-ORIGIN-REQUIRED`)、`relay_id` 由调用方显式指定经 `relay_nodes` 表解析地址(不是隐式
     默认)、命令类型硬编码为三个固定字符串(`ktt_v2_mint`/`ktt_v2_transfer`/`get_address_utxos`，
     不透传调用方任意 `type`)。引了核心实现 `20066ed5` 的 12 笔真实 txid 证据作为钱路本身已验证的
     背书。
   - `review_ref`: 暂填 `PENDING-NWT`——按你的话"我把核心实现 20066ed5 与这次 manifest 条目一起送
     NWT 审"，真实 review_ref 等 NWT 审完回填，我这边不编一个假的占位数字。
2. **`scripts/m0a-lib.mjs` 的 `CONTROLLED_FUNNEL_ALLOWLIST`** 加一行 `kasia-console/src/api/tokens.js`
   (shrink-only 白名单，跟 manifest 条目一一对应——只改 manifest 不改这个 Set，lint 仍然会在
   `!CONTROLLED_FUNNEL_ALLOWLIST.has(e.path)` 这一步拒)。

**没有走②**(从 `pool.js` 转手 export `sendCommandAsync` 进来)——你说得对，那确实是"检测器抓不到
≠ 合规"的同一类问题，没有采纳，一开始也没有偷偷这么做过。

## 验证

`node scripts/lint-kanet.mjs kasia-console/src/api/tokens.js kasia-console/src/ui/tokens-list.eta
scripts/m0a-exception-manifest.json scripts/m0a-lib.mjs` → **0 errors**(M0a 门过)。`tokens.js`/
`tokens-list.eta` 本身的业务逻辑与上一轮(核心实现那次)写好但未提交的版本逐字节相同，这次只是
补 manifest 通道，没有借机再改代码。

## 现状

四条 KTT v2 三条 API 路由 + `/tokens` 页面 UI 区块随本次一起进了仓库。核心钱路(合约/relay
handler)`20066ed5` 与这条 manifest 条目 `7c4b702f` 一起等你转 NWT 审。停在这里等结果。
