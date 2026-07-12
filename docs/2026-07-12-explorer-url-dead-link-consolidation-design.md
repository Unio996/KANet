> **Status**: CURRENT

# explorer 死链全库收敛设计

**作者**: KANet-UI（2026-07-12，Bettor 派工 #hhxb4x.2，owner=UI/tg-bot 域，J2 辅 console 侧）
**v1.1 更正（NWT 红队 31eade42 H1，GREEN-with-MUST-FIX 已折入）**：全库 grep `buildExplorerUrl`/`buildExplorerAddressUrl` 确认零现有调用方（风险全在本设计即将新建的调用点）。发现 `exchange-machine.js:1097`/`broker-v2/router.js:105,108`/`broker-state-authority.js:42,47`（5 处，3 文件）跟 `chains.js` 同款结构缺口——**从未 network-aware**，非三元类型，若照原文本"改成 import 调用替代内联"字面执行会产出 `"查看: https://explorer.kaspa.org/txs/null"` 类崩溃输出。已在 §2 拆成组 A/组 B 明确不同迁移形态，见下。
**背景**: `explorer-tn12.kaspa.org` DNS 不存在（Owner 实测 ENOTFOUND），TN12 是 KANet 自建私有测试网，从未有人架设公网 explorer。`/mybets`/`/earnings` 死链已修（v1.2），NWT 主动扩查发现全库还有 **15 处代码命中**（1 个共享 helper 的 2 个函数 4 行 + 13 处独立消费点/硬编码），涉及 services/API/UI 模板/tg-bot 三层。本设计 = 单源根治 + lint 堵复发，不逐个补丁。

## §0 现状诊断（helper 本身也坏）

`kasia-console/src/lib/explorer-url.mjs`（唯一该被强制使用的单源）的 `buildExplorerUrl`/`buildExplorerAddressUrl` 两函数，testnet 分支硬编码 `explorer-tn12.kaspa.org`——helper 本身就是坏的，且**大部分消费点根本没走这个 helper**，是自己内联三元/箭头函数独立拼 URL（`bettor.js:2047`/`pool.js:3516`/`chains.js:31-32` 等）。两层问题：①单源本身坏 ②单源形同虚设（建了没人被强制用）。

## §1 契约改造（根治，先修这里）

`explorer-url.mjs` 两函数 testnet 分支改为**返回 `null`**（诚实契约：TN12 没有 explorer，不是换个域名，是承认没有）；mainnet 分支不变（`explorer.kaspa.org` 真实可达，不动）：

```js
export function buildExplorerUrl(txid, networkId) {
  if (!txid) return null;
  if (String(networkId || '').startsWith('testnet')) return null;  // TN12 无公网 explorer，诚实返回 null
  return `https://explorer.kaspa.org/txs/${txid}`;
}
// buildExplorerAddressUrl 同款改法
```

**新增配套函数**（同文件，给所有消费点复用的展示层）：
```js
// url 为 null 时降级成纯文本凭证（同 /mybets v1.2 已验证的模式），非静默消失
export function formatTxReference(txid, url) {
  if (!txid) return '';
  return url ? url : `TX: ${txid}`;  // 有 explorer 挂链接，没有则纯文本
}
```

## §2 消费点迁移（按层分类，各层修法不同）

**服务端 JS（`api/*.js`/`services/*.js`，7 处独立硬编码，v1.1 按 NWT H1 拆两组）**：改成 `import { buildExplorerUrl, formatTxReference } from '../lib/explorer-url.mjs'`。**强制形态**：任何消费点必须用 `formatTxReference(txid, buildExplorerUrl(txid, networkId))` 包整行降级，**禁止**把 `buildExplorerUrl()` 的返回值直接拼进字符串模板（testnet 返回 `null` 时裸拼会产出 `"查看: null"` 或 `"查看: https://explorer.kaspa.org/txs/null"` 这类比死链更糟的输出）。

- **组 A（原三元类型，已 network-aware 但域名写死）**：`bettor.js:2047`/`pool.js:3516`——原逻辑本身就在判断 mainnet/testnet，改法直接替换整个三元表达式为 `formatTxReference(...)`。
- **组 B（NWT H1 实证：从未 network-aware，非三元，直接字符串模板拼死 mainnet 域名——跟 `chains.js` 同款结构缺口，不是"死链"而是"指错网络"）**：`exchange-machine.js:1097`/`broker-v2/router.js:105,108`/`broker-state-authority.js:42,47`（共 5 处，3 文件）。这组不是简单替换一个三元，是**从零加上 `networkId` 参数传递链路**（消息模板生成函数目前根本不知道当前网络是什么，需要从调用方传入或从 `process.env.KASPA_NETWORK`/`CONFIG.network` 读取），再套 `formatTxReference()` 整行降级。

**`chains.js:31-32` 单独处理（结构性缺口，非同款硬编码）**：这两个箭头函数**从未有 testnet 分支**——不论跑在 mainnet 还是 testnet 都返回 `explorer.kaspa.org` 真实链接，语义错误但不是"死链"（链接可达但指向错误网络的浏览器，用户点开会查不到自己的 tx）。修法：给这个 config 对象加 `networkId` 感知，或干脆改成调用 `buildExplorerUrl`/`buildExplorerAddressUrl`（它们已经是 network-aware 的），消灭这个独立实现。

**`.eta` UI 模板（5 个文件，client-side Alpine.js，不能直接 import ESM 模块）**：路由 handler 侧（server render 阶段）用 `buildExplorerUrl`/`buildExplorerAddressUrl` 算好值，作为字段注入模板数据（如 `explorer_url: null` 或具体 URL 字符串），模板内 `x-show`/三元根据这个字段是否为空决定渲染链接还是纯文本——**不在 .eta 内联域名字符串**。`agent-v2.eta:99`/`predictions-pool-detail.eta:539`/`predictions-pool-create.eta:102`/`onboard.eta:206`/`oracle-home.eta:168,292` 全部走这条（oracle-home.eta 两处都在同一份数据里，可以共用一次注入）。

**tg-bot（2 文件，独立 package，不能 import kasia-console 的 lib）**：`messages.mjs:203` 已被 `/mybets` v1.2 设计覆盖（explorer 变量删除，改 `TX: {txid}` 纯文本）。**新发现同族**：`i18n.mjs:202+569` 的 `wallet_send_done_explorer`（EN/ZH 两条字符串常量）无条件内嵌死链模板——同款改法，i18n key 改成 `TX: {txid}` 纯文本，不带 URL。tg-bot 侧没有 mainnet 场景需要保留链接（KANet 目前只跑 testnet 用户面），故 tg-bot 全部消费点统一降级为纯文本，不需要 network 分支判断。

## §3 lint 堵复发（新规则，同 R-FEE-SPLIT-PKG-DRIFT/R-STATUS-GUARD-BLACKLIST 家族）

`explorer-tn12.kaspa.org` 或 `explorer.kaspa.org` 域名字符串字面量，出现在 `explorer-url.mjs` **以外**的任何 `.js`/`.mjs`/`.eta` 文件 = ERROR。规则命名建议 `R-EXPLORER-URL-BYPASS`。这条堵住"helper 建了没人被强制用"的复发（今晚第三次撞这个模式：反馈工具面/trading.js 状态排除表/处置闸黑名单，现在第四次）。

## §4 明确不做什么

- 不新造 explorer 服务——TN12 没有就是没有，纯文本凭证是诚实的最终状态，不是"临时方案等以后有 explorer 再换回来"。
- mainnet 分支（`explorer.kaspa.org`）不动——它是真实可达的服务，本次收敛只治 testnet 死链。
- `chains.js` 里其它链（非 KAS）的 explorer 配置不在本卡范围——只查 KAS 相关命中。
- 不清理 NWT 发现的旁支重复目录（`D:\kanet-tn12\kanet-tn12\...`）——非本卡范围，另案处理，本设计只提醒一句。

## §5 分工与排期

- **KANet-UI（我）**：§1 契约改造（helper 本身）+ §2 的 UI 模板（5 个 .eta）+ tg-bot（2 文件）。
- **J2（辅）**：§2 的服务端 JS（7 处独立硬编码 + `chains.js`）。
- 排期：非阻塞，可跨班；`/mybets` v1.2 落码后顺路（同一份 helper 契约变更，避免两次改同一文件）。

## §6 落码前置

1. NWT 红队（重点：helper 契约改造是否有隐藏调用方假设"永远返回字符串非 null"而崩溃——落码前搜全部调用点确认容错；lint 规则实落；.eta 模板改法是否遗漏某处内联字符串）。
2. 落码后：mainnet 分支链接仍可点开（回归，不能连累到好的那一半）+ testnet 分支全部降级为纯文本+全库 grep 确认零残留硬编码域名。
