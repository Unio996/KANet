# 商品佣金计划 + 多渠道归因 · 设计稿 v0.1

> **Status**: DRAFT · 待 NWT 攻击面审
> **作者**: J2 · **派工**: Bettor（转述 Owner，D-034 §8，账本 1693-1707）
> **依赖**: `docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md`（已 NWT 两轮审 + 实现 diff 审 + PMT 修复复核零 MUST，已合入 `bshard-m3-deploy` @ `f83f6b6e`）
> **范围**: 只交设计稿，不写生产代码；不做部署。条件分账（D-034 §4 模板 B）与预言机不在本稿范围。

---

## 0. 一句话目标（D-034 §8 原话收敛）

商家定一份带渠道预算的佣金计划（报价），邮件/视频/网站等任意渠道用同一种归因链接分发，消费者点开归因链接下单，一笔链上强制分账自动把钱分给商家/broker/引荐渠道，未归因的份额按报价规则并入指定方——**任何人拿着开源组件就能快速部署、快速使用**，不需要我们的服务器、数据库或授权。

---

## ① 查现成（D-031 最低范围：kasia-console/src/services/ 全目录 + index.js 注册 + 主网在跑 + 能力清单 + 刚合入的 InstantSplit）

### 1.1 刚合入的 InstantSplit（`f83f6b6e`）—— 本设计的直接地基，不是参照对象

InstantSplit.sil/`instant-split-sdk.mjs` 已解决的问题，本设计**逐字复用，不重做**：
- 一次性终态纯 P2SH（无 State/covenant 续约）、`tx.inputs.length==1` 防合并销毁、`hasChange` 两分支按真实超额互斥穷尽、`refund` 用 `temporal()` + 现查节点 PMT（不是墙钟/tip）判断到期、KCC-01 witness 编码（`generic-entry-witness.mjs`）、§4.5 六步法真实测量手续费上限的方法论。
- **本设计与它的唯一实质差异**：InstantSplit 是**固定 3 个具名角色**（商家/broker/可选引荐人），本设计要**N 个角色 + 任意脚本地址**（D-034 §8 放宽方向）。这是对同一个合约骨架的**推广**（把 3 个具名 `pubkey` ctor 槽位改成一个 `byte[][]`/循环结构的 N 槽位，把 `ScriptPubKeyP2PK` 现场构造改成直接比对 ctor 烤死的完整 scriptPubKey 字节），**不是另起一个不相关的合约**——§6 给出推广后的规格。
- InstantSplit 的 P2PK-专属地址处理（`pubkey` ctor + `new ScriptPubKeyP2PK(pk)`）在本设计里**不能直接照搬**（D-034 §8 明确要求"收款地址不限 P2PK"）——§6.2 给出通用方案，且**已用真实 simnet 广播验证**（见 §6.2 脚注），不是猜测。

### 1.2 `packages/fee-split`（= `kasia-console/src/lib/fee-split.mjs`，镜像不重复维护）

`feeSplit`/`validateFeeRules`/`canonicalizeFeeRules`/`computeFeeRulesCommit` 上一份设计稿（即时分账 v0.1 §1.3）已详细核过，本稿只标注**本设计新用到、上次没用到的部分**：
- `validateFeeRules` 硬编码 `PROVIDER_MIN_BPS=5000`（provider 角色 ≥50%）与 `ROLE_MAX_BPS=5000`（单角色 ≤50%）——D-034 §8 要求这两条从硬限改成**可配置的默认护栏**。本设计不改变默认值本身，只把它们从模块内常量改成**可选传入参数**（不传时 = 今天的行为，向后兼容，见 §6.3）。
- `optional` 角色语义（无地址 ⇒ 整条从输出跳过，`fee-split.mjs:195`）不满足 D-034 §8"未归因份额并入指定方"的要求——`feeSplit` 本身**不需要改**，"并入"逻辑在调用 `feeSplit` **之前**、由本设计新增的 SDK 层完成（把渠道角色的 bps 在没有归因时重新分配给报价里指定的"未用佣金去向"角色，再把改写后的规则喂给 `feeSplit`）——见 §6.4，这是新增一层，不是改 `fee-split.mjs`。

### 1.3 `kasia-console/src/services/` 全目录 + `index.js` 注册（D-031 强制扫描）

延续即时分账设计稿的结论：**没有任何现成的"归因链接"/"报价签名"/"静态结账页"机制**。全仓搜索确认：
- `kasia-console/src/ui/*.eta` 现有 65 页里没有任何"渠道归因"相关页面；`tg-bot/`（既有的电报 broker）没有类似机制（D-024 暂停执行，且是完全不同的托管钱包模型，不适用）。
- `kanet-broker.js`/`broker.js`（券商集成 API，9/19 端点）与本设计**同名易混但无关**——那是股票/加密货币交易所账户对接，不是分润协议。
- 现有"签名报价"最接近的先例是 `escrow.js`（P2SH 托管，签名放钱模型）——已在即时分账设计稿 §1 判定"信任模型不对"（需要受信第三方签字），本设计的报价签名**不是**"谁签字谁放钱"，是"证明这份报价条款确实来自商家本人"（签名只用于**真实性验证**，不参与任何链上放钱逻辑），两者不是同一件事，不冲突。

### 1.4 主网在跑 / 能力清单

`docs/2026-09-20-kanet-capability-asset-inventory-v0.1.md` 全篇无归因/渠道相关记录，本设计是全新能力，不是被漏掉的已有件。

---

## ② 报价 JSON（商家签名）

```json
{
  "schema_v": 1,
  "quote_id": "商家自定，任意字符串，仅用于商家自己的对账，不参与地址推导",
  "merchant_pubkey_hex": "32字节hex",
  "price_sompi": "1000000000",
  "canonical_rules": {
    "schema_v": 1,
    "roles": [
      { "name": "provider",  "bps": 8000, "address": "商家自己或指定收款脚本地址" },
      { "name": "broker",    "bps": 500,  "address": "..." },
      { "name": "channel",   "bps": 1500, "fold_to": "provider" }
    ]
  },
  "unused_commission_fold_to": "provider",
  "valid_from_ms": 1790000000000,
  "valid_until_ms": 1798000000000,
  "channel_whitelist": null,
  "require_channel_deposit": false,
  "min_deposit_sompi": "100000000",
  "max_split_fee_sompi": "40000000",
  "max_refund_fee_sompi": "10000000",
  "deadline_offset_ms": 259200000,
  "signature_hex": "65字节 schnorr 签名(merchant_pubkey_hex 对本对象除 signature_hex 外全部字段的 canonical JSON 序列化字节的签名)"
}
```

逐字段说明（与既有约定对齐处标注复用来源）：
- `canonical_rules`：**直接复用 `packages/fee-split` 的 `feeRules` schema**（`{schema_v, roles:[{name,bps,address?,derive?,optional?}]}`），不新造格式。新增字段 `fold_to`（本设计新增，`fee-split.mjs` 本身不认识这个字段——见 §6.4，SDK 在调用 `canonicalizeFeeRules`/`feeSplit` 之前会把它转换成标准 `roles` 数组，`fold_to` 本身不出现在喂给 `feeSplit` 的最终规则里）。
- `unused_commission_fold_to`：默认兜底目标（当某个带 `fold_to` 的角色本身也没被归因时，最终归属谁——通常等于报价里某个必然存在的角色，如 `provider`）。
- `channel_whitelist`：`null` = 不限制（默认，D-034 §8"默认无需注册"）；非空时为渠道地址（或渠道 pubkey）列表。
- `require_channel_deposit`：默认 `false`（D-034 §8"默认不要求"）；`true` 时结账页需要核验渠道地址有活押金（§7）才接受归因。
- `max_split_fee_sompi`/`max_refund_fee_sompi`：复用即时分账 §4.5 六步法产出（同一套合约、同一套 mass 数字，不需要为本设计重新测——N 收款方的 mass 数字见 §6.1，超出 InstantSplit 原始 3 角色数字时用 §6.1 的新数字）。
- `signature_hex`：商家用**同一把私钥**（`merchant_pubkey_hex` 对应）对本 JSON 除签名字段外的 canonical 序列化字节做 Schnorr 签名——验证用标准 `checkSig` 数学（kaspa-wasm 已有），不新造签名方案。canonical 序列化**复用 `fee-split.mjs` 内部 `_canonicalJson` 同一套排序键约定**（不新造第二种序列化规则，理由同即时分账设计稿 §2.6 对 `rule_commit` 的处理——两处用同一个约定，防止"同一份数据两种序列化各判各的"）。

**验证**：任何人拿到报价 JSON，用商家公开的 `merchant_pubkey_hex` 独立验证 `signature_hex`——不需要问我们，不需要商家在线。

---

## ③ 归因链接格式 + "归因不可被结账方抹掉"论证

### 3.1 链接格式（邮件/视频/网站三种渠道共用）

```
https://<任意结账页域名>/checkout?q=<quote_id 或完整报价JSON的base64>&ch=<渠道地址hex或pubkey hex>
```

- 邮件渠道：HTML 卡片里的按钮/链接直接指向上面这个 URL。
- 视频渠道：简介栏贴同一个 URL（或短链跳转到它）。
- 网站渠道：嵌入的 JS 组件/iframe 的 `src` 就是同一个 URL，或组件内部用同样的 `q`/`ch` 两个参数调用同一份开源 SDK。

三种渠道**没有三套机制**，只有一套 URL 参数格式 + 一份开源静态页/组件，这是 D-034 §8"邮件/视频/网站共用同一格式"的字面落实。

### 3.2 "归因不可被结账方抹掉"的论证

核心机制：**订单地址是 `quote` 与 `ch`（渠道地址）两个输入的确定性函数**（§4/§6，`address = f(quote, channel_address_or_absent)`）。这意味着：

- 一个恶意/被入侵的结账页想要"抹掉"渠道归因（把渠道的份额悄悄改发给别人或折算给别的角色），**唯一能做的操作**是：要么（a）用一个跟链接里 `ch` 参数**不同**的地址去算 ctor（结果是一个**不同的**订单地址，跟链接原本应该指向的地址对不上）；要么（b）就用链接给的 `ch` 地址算出正确的订单地址，但那个地址的合约里渠道的份额本来就是正确烤给这个渠道的——**无法在保持地址不变的前提下改变份额分配**，因为份额分配本身是烤进 ctor、进而决定地址的输入之一。
- **谁能发现篡改**：① 渠道自己——渠道知道自己的 `ch` 地址，随时可以用同一份开源 SDK（离线，不需要问我们或商家）拿报价 JSON + 自己的地址重算一遍订单地址，对比结账页实际展示/引导付款的地址是否一致；不一致 = 证据确凿的篡改，且是**可公开验证**的证据（任何第三方拿同样两个输入也能复现同一计算）。② 消费者/任何审计者——同样可以独立复算，不依赖信任任何一方。
- **残余风险（如实标注，不是零风险声明）**：这套论证的前提是"消费者/渠道确实拿到了正确的 `quote` JSON 和正确的 `ch` 参数"——如果攻击发生在**链接分发**这一步之前（比如攻击者伪造了一整条邮件，用自己的 `ch` 冒充成某个渠道的链接），这不是"抹归因"，是钓鱼/冒充，超出本设计能解决的范围（同任何公开协议的钓鱼防护边界，靠域名/证书/邮件签名等传统手段，不是分润协议的职责）。本设计能保证的是："同一个 quote，同一个渠道地址，任何人在任何地方独立算出的订单地址必须一致；一旦某个结账页展示的地址跟这个复算结果不一致，篡改就有了不可抵赖的证据"——这是**可验证性**，不是**不可能发生篡改**，两者不能混为一谈（同即时分账设计稿 §5 对"共识拒绝"与"审计层发现"两类判据的区分纪律）。

---

## ④ 开源纯静态结账页

### 4.1 职责边界

**只做**：① 解析 URL 的 `q`/`ch` 参数；② 用开源 SDK（§8）本地计算订单地址+ctor（含把 `ch` 代入报价的 `channel` 角色，处理 `fold_to`/白名单/有效期/押金核验，见 §6.4）；③ 展示收款地址 + 二维码 + 倒计时（`deadline_ms`）；④ 轮询公开 RPC（不是我们的服务器）显示付款状态；⑤ 付款后提供"分账"按钮（构造并广播 `split`，零签名，见即时分账设计稿 §2.3）与超时后的"退款"按钮。

**不做**：不托管任何密钥、不需要登录、不需要数据库、不需要跟我们的服务器通信一次。**纯静态**指页面本身（HTML+JS，可托管在任意静态文件服务，GitHub Pages/IPFS/本地文件皆可）不含任何服务端逻辑；页面运行时当然需要连一个 Kaspa 节点 RPC（公开的或消费者/商家自己的，见 §8），但那不是"我们的后端"，是协议本身要求的最小外部依赖。

### 4.2 供应链完整性（如实标注的已知限制）

纯静态页仍然是"托管方提供的一份 JS"——如果托管方（不管是我们提供的参考实现还是任何第三方复制品）**篡改了它托管的那份 JS 本身**（不是篡改链接参数，是篡改客户端计算逻辑本身），理论上可以让浏览器端算出"看起来正确"但实际错误的地址。缓解手段（本版只做到"标注清楚"，不做完整方案）：① 开源仓库发布带 tag 的版本 + 构建产物哈希，供自托管者核对；② 建议渠道方/审计方优先自托管而非依赖别人提供的公开实例；③ 未来可加 Subresource Integrity（SRI）标签，若嵌入方式是 `<script src=... integrity=...>`。这是**软件供应链完整性**的通用问题，不是本设计独有，同任何"开源客户端连公开协议"系统面临的问题一样，如实标注不夸大也不隐瞒。

---

## ⑤ 无代码配置页范围说明（本轮不实现）

面向商家的最小配置页需要：① 表单填价格/角色/比例/未用佣金去向/有效期/白名单/是否要求押金；② 本地用商家私钥（浏览器扩展钱包，或本机 SDK 命令行）对上面 ②生成的 JSON 签名；③ 一键生成可分发的归因链接模板（渠道地址留空占位，实际分发前替换）；④ 展示当前有效报价列表 + 历史订单（纯客户端读链，不需要我们的数据库）。**本轮只给这个范围描述，不写代码**——同即时分账设计稿 §7.3 网页组件的处理方式一致。

---

## ⑥ 放宽（不破 D-034 §7 三条验收为界）

### 6.1 N 收款方——真实 mass 测量给出的上限，不是拍脑袋数字

复用即时分账设计稿 §4 的存储质量公式（`storage_mass = max(0, C·Σ(1/amount_i) − C·p_in²/amount_in)`，`C=10¹²`，网络硬上限 500,000）。本设计用 `kasia-relay/src/lib/tx-mass-ub.mjs` 对不同 N 与不同金额分布**真实测量**（非公式代入估算）：

| 场景 | N | 结果 mass |
|---|---|---|
| 全部收款人都卡在运营下限（0.1 KAS） | 2 | 160,000 |
| 同上 | 3 | 271,429 |
| 同上 | 4 | 377,778（硬上限 500,000 的 75.6%，留 24% 余量） |
| 同上 | 5 | 481,819（余量仅 3.6%，不建议） |
| 同上 | 6 | **584,616（超过硬上限，共识层直接拒绝，无论手续费怎么调都救不了）** |
| 1 个大份额(5 KAS) + N-1 个卡在下限 | 5 | 400,166 |
| 同上 | 10 | 900,320（**超限**） |
| 同上 | 20 | 1,900,562（**超限**） |

**结论（如实表述，不是一个固定"最大 N"）**：mass 的真正约束变量是"**同时有多少个收款人的份额卡在运营下限附近**"，不是收款人总数——一个远高于下限的份额（比如 5 KAS）对 storage mass 的贡献可以忽略不计（该项 `C/amount` 只有 2000 量级）。**运营规则**：一份报价里"份额落在运营下限（0.1 KAS）附近"的角色数量**不得超过 4 个**（对应 mass=377,778，留 24% 安全余量，与即时分账设计稿 §4.5 的安全倍数哲学一致——不是"卡着硬上限走"）；份额明显高于下限（本设计建议 ≥1 KAS 视为"明显高于"，此时单项贡献 `C/amount≤1000`，10 个这样的角色总贡献才 10,000，可忽略）的角色数量**不设固定上限**，只要整笔交易的 Σ(1/amount_i) 累计仍在预算内——SDK 在构造具体订单时必须对**当次实际参与结算的角色集合**做一次真实 mass 估算（复用 `tx-mass-ub.mjs`，不能只看角色数量做启发式判断），超限则拒绝构造并给出"哪几个角色份额太小需要合并"的具体提示（同即时分账 SDK 的 `MIN_RECIPIENT_SOMPI` 拦截模式，§4.4）。

**待实现阶段确认**（"待定"项，不阻塞本设计稿交付）：合约层的 N-recipient 循环用 SilverScript `for(i,start,end,MAX)`（TUTORIAL.md 已文档化、PayoutShard 的 `scanOwnedTokenInputs` 已实证），`MAX`（编译期常量上界）建议定为 **8**（覆盖"4 个下限角色 + 若干大角色"的实际场景，同时对齐 PayoutShard 现有的 `MAX_INS_SCAN=8` 先例，不另造一个新的界，D-031 一致性）。

### 6.2 收款地址不限 P2PK——真实验证过的通用机制

即时分账 InstantSplit 用 `pubkey` ctor + 合约内 `new ScriptPubKeyP2PK(pk)` 现场构造，**只支持 P2PK**。本设计需要支持任意脚本地址（包括 P2SH，比如收款方本身是另一个合约地址），机制改为：**ctor 直接烤收款方完整序列化的 scriptPubKey 字节（`version`(2字节 LE)`++script`字节），与 `tx.outputs[i].scriptPubKey` 直接按 `byte[]` 比较，不用任何 `ScriptPubKeyPxx` 构造原语**。

🔴 **这个格式已用真实 simnet 广播验证，不是猜测**：直接烤 34 字节纯 script（不含版本前缀）—— 广播被拒（`"script ran, but verification failed"`）；烤 36 字节（2 字节版本 + 34 字节 script）—— **广播被接受**。即 `tx.outputs[i].scriptPubKey` 内省读到的值 = 完整序列化 scriptPubKey（含版本前缀），不是裸 script 字节——这与 kaspa-wasm 的 `payToAddressScript`/`payToScriptHashScript` 返回值 `{version, script}` 拼接方式完全对应（`Buffer.concat([versionLE2Bytes, scriptBytes])`），SDK 侧直接用这个拼接结果做 ctor 输入即可，不需要区分地址类型（P2PK/P2SH 用同一套拼接逻辑，SDK 不用识别地址是哪种类型）。

### 6.3 fee-split 比例护栏可配置化——具体改法

`validateFeeRules(feeRules, opts={})` 新增可选 `opts.providerMinBps`（默认 5000，向后兼容）与 `opts.roleMaxBps`（默认 5000，向后兼容）；不传时行为与今天逐字一致（**所有现有 5 个调用点零改动**）。本设计的报价 JSON 可以在 `canonical_rules` 里加一个平级的 `guardrails: {provider_min_bps, role_max_bps}`（缺省=不传，即默认值），传给 `validateFeeRules` 时读取。**这是对 `fee-split.mjs` 的一处新增可选参数，不是重写算法**——实现阶段需要 NWT 确认这条改动不影响任何现有调用点的行为（可用现有 5 处调用点各自的既有测试作回归证据）。

### 6.4 "未归因份额并入指定方"——新增的 SDK 层逻辑，不改 fee-split

给定报价的 `canonical_rules`（含 `fold_to` 扩展字段）与"本次实际归因到的渠道地址"（可能为 `null`，即无归因）：

```
function resolveRulesForOrder(quote, channelAddr) {
  const roles = quote.canonical_rules.roles.map(r => ({ ...r }));
  for (const r of roles) {
    if (r.fold_to) {
      if (channelAddr && r.name === 'channel') {
        r.address = channelAddr;   // 有归因: 渠道拿到自己那份
        delete r.fold_to;
      } else {
        // 无归因(或角色本身就没被这次订单用上): 把这条的 bps 转给 fold_to 目标角色
        const target = roles.find(x => x.name === (r.fold_to === true ? quote.unused_commission_fold_to : r.fold_to));
        target.bps += r.bps;
        roles.splice(roles.indexOf(r), 1);
      }
    }
  }
  return { schema_v: quote.canonical_rules.schema_v, roles };
}
```

产出的 `roles` 是一份**标准、不含 `fold_to` 扩展字段**的 `feeRules`，直接喂给 `validateFeeRules`/`canonicalizeFeeRules`/`feeSplit`——**这三个函数完全不需要认识"归因"这个概念，合约也完全不感知归因**（D-034 §8 原话"合约不感知归因"的直接实现）。

---

## ⑦ 渠道押金 covenant（可选，默认不要求）

### 7.1 目的与形态（逐字对齐 D-034 §8）

**用途 = 门槛与防刷（防批量造假地址抢归因），不是手续费储备**（订单手续费仍由订单资金自负）。每个渠道一个独立押金 covenant 地址，默认 **1 KAS**，可退回，**只有押金人本人能取回**，任何人可核验其存在（查询该地址余额，标准 RPC，不需要索引器）。

### 7.2 ctor 与入口

```
contract ChannelDeposit(pubkey depositor_pk, int max_withdraw_fee) {
    pubkey d_pk = depositor_pk;
    int max_fee = max_withdraw_fee;

    entry withdraw(sig s) {
        require(checkSig(s, d_pk));
        require(tx.inputs.length == 1);
        byte[36] d_spk = new ScriptPubKeyP2PK(d_pk);
        require(tx.outputs.length == 1);
        require(tx.outputs[0].scriptPubKey == byte[](d_spk));
        require(tx.outputs[0].value >= tx.inputs[this.activeInputIndex].value - max_fee);
    }
}
```

- **与 InstantSplit 的 split/refund 不同，`withdraw` 要求签名**——因为这里没有"任何人都该能触发"的业务需求（只有押金人自己有理由拿回自己的钱），`checkSig` 是最简单、最少假设的门禁，不需要 InstantSplit 那种"零签名+输出约束"的复杂机制。
- **地址可推导**：`address = f(depositor_pk)`——任何人拿渠道的公开 pubkey 就能算出这个押金地址，核验余额。
- **不设锁定期**：本版无罚没机制（D-034 §8 原话"本版无罚没"），押金人随时可以取回——门槛效果来自"要维持归因有效必须持续锁着这笔钱"，不是靠不能取回强制。
- **罚没条件本版不设计**（D-034 §8 明确留白，"作弊判定需另行设计"）：本设计**不**在 `ChannelDeposit` 合约里预留任何"仲裁/罚没"入口——那需要一个作弊判定机制（谁判定、判定标准是什么），属于 D-034 模板 B（条件分账+事实源）范畴，本稿明确不做。

### 7.3 报价里的押金核验

`require_channel_deposit: true` 时，结账页/SDK 在把某个渠道地址代入 `channel` 角色之前，先查询 `f(channel_pubkey)` 这个押金地址是否有 ≥`min_deposit_sompi` 的余额；没有则视为"无有效归因"（走 §6.4 的"无归因"折算路径，不是报错拒绝整个订单——保持"拿来即用"，押金要求不应该让消费者的购买流程卡住，只影响渠道能不能拿到那份佣金）。

---

## ⑧ SDK 节点配置

### 8.1 多节点支持

SDK 所有函数（`createSplitProtocol`/`buildSplitTx`/`buildRefundTx`/`verifyReceipt`，以及本设计新增的 `resolveRulesForOrder`/`verifyQuoteSignature`/`checkChannelDeposit`）都接受一个**调用方注入的 `rpc` 客户端**（已连接的 `kaspa-wasm RpcClient` 实例），SDK 自己不内置任何"默认节点地址"——不同渠道方、不同消费者可以各自连自己信任的节点，或商家提供的公开节点，SDK 不假设唯一权威节点。

### 8.2 节点资格核验（SDK 启动时应做的检查，非共识规则，是"用户体验早失败"）

- **版本**：`getServerInfo().serverVersion` 必须 `>= "2.0.0"`（D-019 pin 的 silverc v1.0.0 编译产物依赖协议原生 covenant 机制，`covenant` 字段是 v2.0.0+ 才有的能力——低于此版本的节点即使连得上也无法正确解析/验证本设计的交易，SDK 应在连接时就检查并给出清晰错误，不要留到广播失败才发现）。
- **`hasUtxoIndex`**：`getServerInfo().hasUtxoIndex` 必须为 `true`——`getUtxosByAddresses` 是本设计从"报价+链接"推出地址后**查询该地址是否已付款**的唯一手段，没有 utxoindex 的节点这个 RPC 不可用（SDK 应在连接时检查，不是等查询失败）。
- **`networkId`**：必须与调用方声明的目标网络（`mainnet`/`testnet-12`/`simnet`）完全一致，防止"以为连了主网结果连到了测试网"这类致命的静默错配（同即时分账测试脚本里反复用到的 `if (info.networkId !== expected) throw` 纪律，搬进正式 SDK）。

### 8.3 确认深度

结账页展示"已付款"状态前，建议等待 **≥10 个确认区块**（DAA 深度）才认定资金已稳定落地——数值待实现阶段用真实 simnet 分叉/剪枝实测校准（本设计不凭空定数字，与即时分账设计稿"数值来自实测不是猜测"的纪律一致），10 是起点参考值（较保守，比多数中心化交易所的确认要求更高，因为本设计没有中心化兜底）。

### 8.4 PMT 口径（复用即时分账 SDK 已修复的教训，不重复踩坑）

`buildRefundTx` 沿用即时分账 SDK 的签名（要求调用方传入**现查的节点 `pastMedianTime`**，不是墙钟/tip——见 `docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md` §4.6 的完整推导与 rusty-kaspa 源码依据）。本设计不重复推导，直接引用该文档为准。

### 8.5 回执自带交易与上链证明（抗剪枝）

`verifyReceipt` 的回执格式（对齐即时分账设计稿 §3.2，扩展一项）：除 `{order_address, ctor_params, canonical_rules, funding_txid, split_txid, refund_txid}` 外，本设计要求回执**额外自带**：① 落地那笔交易的**完整原始字节**（`getTransaction` 的返回值本身，不只是 txid）；② 该交易所在区块的**区块哈希 + DAA score**。理由：Kaspa 是会剪枝的链（`docs` 已有的"TN12 剪枝墙"相关记录——旧区块在剪枝点之后对标准 RPC 不可见），一份只含 txid 的回执在剪枝窗口过后可能**查不到**（不是没发生过，是节点本地已经不保留那段历史了）；回执自带完整交易字节 + 区块坐标，即使未来某个节点已经剪枝掉了那个高度，回执本身仍然是**自包含的证据**（交易字节可以离线重新计算 txid 验证一致性，只是不能再问"这个节点现在还认不认这笔交易"——那本来就不是回执该回答的问题，回执回答的是"这笔交易确实存在过、内容是什么"）。

---

## ⑨ 对抗测试清单（与即时分账 §5 衔接，只列本设计新增的部分，不重复 N-recipient 篡改/篡改比例/双花等已在 InstantSplit 覆盖的项）

| # | 攻击/场景 | 期望 |
|---|---|---|
| C1 | 结账页用与链接 `ch` 参数不同的地址构造订单 | 生成地址与渠道/任意第三方独立复算的地址不一致（可检测，非共识拒绝——§3.2 已说明这是审计层判据） |
| C2 | 伪造报价签名（用假私钥签，或篡改报价内容后签名对不上） | SDK `verifyQuoteSignature` 本地拒绝，不构造任何交易 |
| C3 | 押金冒领（非押金人试图 `withdraw`） | 链上拒绝（`checkSig` 失败），simnet 真实广播验证 |
| C4 | 要求押金但渠道地址无押金/押金不足 `min_deposit_sompi` | SDK 视为无归因，走 §6.4 折算路径，不报错卡单 |
| C5 | 渠道地址不在白名单（`channel_whitelist` 非空时） | 同上，视为无归因折算，不卡单 |
| C6 | 报价已过 `valid_until_ms` | SDK 本地拒绝构造新订单（对已构造的订单不追溯失效——地址一旦生成、资金一旦进入，退款/分账仍按原 ctor 走完，不能"报价过期就冻结已有资金"） |
| C7 | 同一份报价 + 同一个渠道地址，两次独立计算 | 地址必须逐字节一致（确定性验证，D-025 地址可推导判据的直接测试） |
| C8 | N 收款方里有一个份额被压到运营下限以下（硬阈值以下） | 复用即时分账 §5 #13 的共识层拒绝机制（storage mass 超限），本设计只需确认 N>3 时同样成立 |
| C9 | 押金 covenant 的 `withdraw` 被要求 `tx.outputs.length==1`，攻击者附加第二个输出 | 拒绝（同即时分账 #7 的"部分/多余输出"模式） |

**不做链上测试的项**（同即时分账 §5 #9 的处置方式）：结账页本身被"供应链攻击"篡改 JS 逻辑（§4.2 已标注为已知限制，不是链上可验证的问题）。

---

## 待定 + 默认值 汇总

1. N-recipient 循环上界 `MAX`——默认 8（对齐 PayoutShard 现有 `MAX_INS_SCAN=8`）。
2. 确认深度——默认起点 10 个 DAA 确认，待实现阶段实测校准。
3. `fee-split.mjs` 的 `providerMinBps`/`roleMaxBps` 可配置化——默认值不变（5000/5000），只是从硬编码改成可覆盖参数。
4. 押金默认额度——1 KAS（D-034 §8 原话给定）。
5. 报价签名的 canonical 序列化——复用 `fee-split.mjs` 的 `_canonicalJson` 约定，不新造。
