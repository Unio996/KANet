# 机制A G2(custodial_transfer 绑定器：relay 侧+gateway 侧)— NWT 整体 diff 审 verdict

> **Status**: NWT 整体 diff 审 **GREEN**（2026-07-24）· J1 relay 侧(8862f7f1)+J2 gateway 侧+reconcile+M0a manifest 全闭合于 `a613844a`。
> **审对象**：`a613844a`（reconcile 后完整 commit）——`kasia-relay/src/lib/app-envelope.mjs`（J1 §3.3a v0.4 binder）+`kasia-console/src/api/capability.js`（J2 G2 gateway 侧 earlyRejectCheck+deriveCustodialExecFields+dispatch）+`shared/lib/app-envelope-canonical.mjs`（G1/G2 共享纯函数扩展）+`scripts/m0a-exception-manifest.json`/`m0a-lib.mjs`（MRC-capability-gateway-wallet-transfer 条目，NWT 本轮批准）。
> **立场**：红队默认 refute。这是机制A 唯一钱路命令(custodial_transfer)的真实落码，逐点独立验证，不信任何报值。

---

## ① J1 relay 侧 binder（app-envelope.mjs）— GREEN

- **PER_TYPE_EXCLUDE_FIELDS 真 per-type 门控**（非全局字段名黑名单，我 v0.3 implementation-note 钉死的要求）：`extraExclude = PER_TYPE_EXCLUDE_FIELDS[cmdType]`，非 `custodial_transfer` 类型时恒 `undefined`，`!(extraExclude && extraExclude.has(k))` 恒真 = 不排除任何字段。独立读代码确认。
- **ctx.network 真调用**（非 v0.3 MUST-FIX 修正前的 `cmd.network` 残留）：`KaspaWallet.fromPrivateKey(cmd.privkeyHex, ctx.network).getAddress()`。
- **intent.network===env.network 真接线**：`checkCustodialTransferBinding` 第一行即此检查，真进 `verifyAppEnvelope` 主流程（`checkIntentBindsCmd` 之后、`checkIntentWithinGrant` 之前）。
- **no-key-leak**：三条 deny reason 逐条读过，均不含 `cmd.privkeyHex` 本身；catch 块显式注释"不 echo"。
- **装载安全性两个 claim 独立坐实**：`tg-wallet.js:126-131` 真传 `fromAddress: w.kaspa_address` + 真标 `'legacy-unmigrated'`（非 `'app'`）——现网唯一 `custodial_transfer` 调用方不经这条新代码路径，零现网影响属实。
- **门⑤ harness 独立重跑**：9/9 PASS 无劣化。

## ② reconcile 字节存活确认

`app-envelope.mjs` 这次 reconcile diff 只新增 `shared/lib` import（`kasToSompiBig`/`parseJsonStringArray`）+ 删本地重复定义——**`checkIntentBindsCmd`/`checkCustodialTransferBinding`/`PER_TYPE_EXCLUDE_FIELDS`/`ctx.network` 派生调用全部原样保留，一个字符没被 reconcile 碰**。J1 的 binder 核心安全逻辑完好。`shared/lib` 新增两函数源码逐字节比对与原实现一致（零行为变化）。

## ③ J2 gateway 侧（capability.js）— GREEN

- **cheap-to-expensive 顺序正确**：结构 → 协议/domain/version → intent_type → grant 存在/吊销/有效期（cheap DB 查询）→ 签名验证 MUST（真调 `kaspa.verifyMessage`，非跳过）→ amount cap（BigInt 比较）→ **到此才触发解密**（Bettor 钦定顺序，防无效签名/超额请求白白触发 AES 解密）。
- **verify-value-source 好**：`deriveCustodialExecFields(fromAddress)` 是网关自己查 `tg_custodial_wallets`（UNIQUE 索引）派生 `privkeyHex`，**不是从 request.body 读的**——独立确认 `cmd.privkeyHex` 用的是 `derived.privkeyHex`，攻击者塞任何 `body.privkeyHex` 都不会被使用。
- **cmd 字段集与 intent 字段集匹配** J1 binder 的 `checkIntentBindsCmd` 要求（排除 `CMD_INFRA_FIELDS`+`PER_TYPE_EXCLUDE_FIELDS` 后恰好对应 `{fromAddress,target,amount,network}`）。
- **origin='app' 唯一铸造点独立 grep 确认**：全仓恰好 1 处真调用（`capability.js:161`），无第二处。
- **decrypt/privKeyHexFromMnemonic 确认真复用 tg-wallet.js 既有函数**（同款 import，非重造密码学）。
- **no-key-leak**：成功回执只回 `txId`/`amount`/`target`/`fromAddress`（公开信息）；失败分支逐条读过，不含 `privkeyHex`。
- **relayId 不从 body 取**：`CUSTODIAL_RELAY_ID()` 硬编码走 env，符合 §3.4 设计。

## 2 note（非 blocker·跨模块/既有代码·记账）

- **N1**：`relay.mjs` 命令处理顶层 catch（`:1295-1298`）只传 `err.message`，本身干净；但 `custodialSendKaspa`/`_sendKaspaInner` 内部实现是否会意外把 `privkeyHex` 编码进 `Error.message` 是**独立既有风险面**（非本次引入，`legacy-unmigrated` 路径今天已在跑同样代码，机制A 没让它变差）——建议单独审一次该函数的异常构造路径，低优先级。
- **N2**：Console 侧网关用的是既有全局 `sqlite` client（非 relay 那种独立 `readOnly` 通道）——既有 TCB 边界（Console 本来就有完整 DB 权限），非新引入问题。

## ④ M0a manifest 闸批准（MRC-capability-gateway-wallet-transfer）

- **受控非裸连语义判断 = 通过**：feature-flag default-off fail-closed + 签名验证 MUST + intent_type 路由锁死 + grant 吊销/有效期/amount cap 早拒验 + origin 强制覆写 + cmd 字段严格构造（非透传 body 任意字段）+ relayId 不从 body 取，七层约束组合，非 `relay.js:1726` 那种裸转发反例。
- **content_digest round-trip 双重验证**：①批准前独立算 staged 内容 sha256 = `19c020682d08648847c8598e2c9d8b827aee5e1127e5930e8b48e4a030a024cd` ②commit 后独立算 `HEAD:capability.js` sha256 = **同一值**，与 manifest 条目里锚的 digest 完全一致。TOCTOU 防御闭环。
- **白名单扩张 1 文件**（`capability.js`，`CONTROLLED_FUNNEL_ALLOWLIST` 注释里早预留"capability-gateway.js 能力网关等"——符合既定规划，非临时拍脑袋）。

## 独立回归验证（不信报值，全部自己跑）

- `node scripts/lint-kanet.mjs`（5 文件）：**0 errors**，`R-M0A-BARE-IMPORT-DIFF` 已解。
- `node scratch/m0c1-app-provision-selftest.mjs`：**PASS 26/FAIL 2**（既有失败，零新增，与 G1/relay-only 批次基线一致）。

## 判据

**GREEN**：J1 relay 侧 binder + reconcile 字节存活 + J2 gateway 侧 + M0a manifest 批准，全部独立核实通过。2 note 归入后续独立审查项（非阻塞）。**装载状态诚实**：`ADMIN_CAPABILITY_GATEWAY_ENABLED` 未设恒 503，零新增暴露面——激活归 Owner Path A/B + containment 清单，另一个闸，不在本批范围。

**关联**：`docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（§3.3a v0.4 设计，本批落码对象）、`docs/2026-07-23-NWT-diff-m0c-1-app-provision-code.md`（app-envelope.mjs 母卡实现 GREEN）、`scripts/m0a-lib.mjs`（`m0c-controlled-relay-endpoint` capability 机制）。
