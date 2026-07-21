# NWT 红队 — explorer 死链全库收敛设计(53c2e291)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-explorer-url-dead-link-consolidation-design.md(KANet-UI)
> **verdict**: **GREEN-with-MUST-FIX——契约改造方向对(null 诚实契约+formatTxReference 降级);发现具体崩溃场景(非假设,读代码实证): 3 文件 5 处若机械迁移会显示"查看: null"给用户;这 3 处实为 chains.js 同款"从未有 testnet 分支"结构缺口,非死链 ternary 类型,设计 §2 分类需精确化**

---

## 核心检查(KANet-UI 点名重点): 隐藏调用方假设——CONFIRMED 零现有调用方,风险全在本设计新建的调用点

`grep buildExplorerUrl|buildExplorerAddressUrl` 全库:**只有两个函数定义本身,零现有调用方**(§0 诊断"大部分消费点没走 helper"其实是"100% 没走")。∴"契约改造崩溃现有调用方"这个风险目前不存在——**风险全部在本设计即将新建的调用点**,我把审查重心放这里。

## H1 🔴 MUST-FIX(具体崩溃场景,非假设): 3 文件 5 处若裸用 `buildExplorerUrl()` 会显示"查看: null"

设计 §2 把 `exchange-machine.js:1097`/`broker-v2/router.js:105,108`/`broker-state-authority.js:42,47` 归进"服务端 JS(7 处独立硬编码)"一类,和 `bettor.js:2047`/`pool.js:3516` 同款处理("改成 import 调用替代内联三元")。**我读了这三个文件的实际代码,它们不是三元/箭头函数,是直接字符串模板拼接**:

```js
// exchange-machine.js:1097
message: `...\nTX: ${deliveryTxId}\n查看: https://explorer.kaspa.org/txs/${deliveryTxId}\n\n感谢使用 KANet broker.`
// broker-v2/router.js:105,108
return `✓ ...\nTX: ${recent.refund_tx_hash.slice(0,16)}...\n查看: https://explorer.kaspa.org/txs/${recent.refund_tx_hash}`;
// broker-state-authority.js:42,47
`查看: https://explorer.kaspa.org/txs/${realTxId}`,
```

**关键发现①**:这 5 处**从来没有 testnet 分支**——不像 `bettor.js`/`pool.js` 那样有 `network==='mainnet'?A:B` 三元,这 5 处永远硬编码 `explorer.kaspa.org`(mainnet 域名),不管实际跑在哪个网络。**这是设计 §2 专门给 `chains.js` 定性的"结构性缺口非同款硬编码"(链接可达但指向错误网络,查无此 tx,比死链更迷惑)——同一个 bug 类型,但设计文本没把这 3 个文件归进这一类**,而是混在"死链 ternary"那组里。分类不准确不影响最终都要修,但影响"修完后 DoD 验证该测什么"的精确性(死链类验证"变纯文本",错网络类验证"变纯文本**且**以前指错网络这件事本身要被记账,不能被'反正现在也是纯文本了'糊弄过去当作从来没发生过)。

**关键发现②(具体崩溃场景)**:若这 5 处机械"改成 import 调用替代内联"——即把 `https://explorer.kaspa.org/txs/${txid}` 直接换成 `${buildExplorerUrl(txid, networkId)}`(裸用返回值,不经过 `formatTxReference`)——由于这些是**字符串模板内联拼接**(`` `查看: ${...}` ``)而非"先算 url 变量再判断是否显示"的模式,**testnet 时 `buildExplorerUrl` 返回 `null`,模板字面量会把它转成字符串 `"null"`,用户会看到"查看: https://explorer.kaspa.org/txs/null"或干脆"查看: null"**——这是一个我在设计文本层面预见到、但需要在这三个具体文件上明确钉死的坑,设计 §2 只说"调用替代"没有明确这三处必须走 `formatTxReference()` 整行降级(把"TX: xxx\n查看: url"两行结构在 url 为 null 时收缩成"TX: xxx"一行,或至少不拼出字面 "null")。

**修法**:§2 服务端 JS 部分明确写死这 3 文件 5 处的迁移目标形态——不是"把内联三元换成 import 调用"(那是 bettor.js/pool.js 的形态,它们本来就有变量+条件判断结构),而是"把整个 message 拼接逻辑改成先算 `formatTxReference(txid, buildExplorerUrl(txid, networkId))`,拼接结果本身就是'TX: xxx'或'TX: xxx\n查看: url'的完整可用文本,不在模板字面量里假设 url 非空"。

## 其余核点(过)

- **§1 null 诚实契约**:核心思路对,`formatTxReference` 的 `url ? url : 'TX: ${txid}'` 是 null-safe 的正确降级模式(同 /mybets v1.2 已验证形状复用,非重造)。
- **chains.js 定性准确**(除了上面说的另外 3 个文件也该同归类):区分"死链"(曾经有效今天失效)vs"从未网络感知"(结构缺口)是对的技术判断,只是分类范围该扩大。
- **lint 规则 R-EXPLORER-URL-BYPASS**:同 R-FEE-SPLIT-PKG-DRIFT/R-STATUS-GUARD-BLACKLIST 家族,方向对——域名字面量出现在 helper 外一律 ERROR,机制堵"建了没人被强制用"复发,这是今晚第四次同类模式,家族化处理正确。
- **§4 不做什么**:mainnet 分支不动/不清理旁支重复目录(转给我说的那条,正确留待另案)——边界清楚。
- **§5 分工**:KANet-UI 域(helper+UI+tg-bot)/J2 辅(服务端 JS+chains.js)——上面 H1 提到的 3 个文件在"服务端 JS"范围内,归 J2 辅这条线,设计 §2 修正后 J2 接手时就有明确目标形态可循。

## 结论

方向 GREEN,`formatTxReference` 降级模式设计对、lint 堵复发到位。**H1 是具体读代码实证的崩溃场景**(非"可能会"的假设性担忧)——3 个文件 5 处若照设计现有文本"改成 import 调用替代内联"的字面指示机械执行,大概率会在 testnet 产出"查看: null"这类用户可见的丑陋文本,比迁移前的"指错网络但至少像样"更糟。修法已给(整行 `formatTxReference` 降级,不裸拼 `buildExplorerUrl` 返回值),折入后落码 GO。另外 Bettor 方向审提到 diff 未落库(J1 那条是 portfolio 修复,与本设计无关,不要混淆——explorer-url 收敛设计本身也只是设计稿阶段,尚未落码,DoD 里的"NWT 红队"这轮我已完成,落码后我再审 diff)。

— NWT 2026-07-12
