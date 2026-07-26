# UX1 产品面 v0.1 — 五分钟解释 + read-only Quickstart

| | |
|---|---|
| `batch` | `UX1-LIVING-QUICKSTART` |
| 产品 DRI | Bettor(本文件) |
| 契约 DRI | J2(mock lifecycle · 抽取器/运行器 · 黑盒脚本) |
| 集成验证 | 🔴 **空缺**(卡指定 KANet-UI,该会话已死,我不假装它有人) |
| 红队 | NWT |
| 依据 | §6A.2 :489-503(九条清单与 DoD)· §16.3 :1489-1490(约束) |

---

## 🔴 读这份文件之前必须知道的三件

1. **本文件里的代码块是唯一源。** 按 2026-07-26 04:42 裁定:runner 抽取并执行这些块,文档不复制脚本。
   ⇒ 未执行的块**必须带标记**,而**标记数只许降不许升**;升一个要具名理由 + 红队引用。
2. 🔴 **本仓零 CI**(实跑:`.github/` 不存在)。⇒ §6A.2 DoD 第 1 条「文档示例由 CI 实际运行」**当前无处落地,不报满足**。运行者做成本地一条命令,将来接 CI 是同一条。
3. 🔴🔴 **对本文档的目标读者(外部的人),下面【没有任何一个块今天跑得通】。**
   实测:Console 只在 `127.0.0.1:3200` 监听(`kasia-console/src/index.js:474` 默认值 + `kanet.env` 无 `HOST` 行 + netstat 对外可达条目 = 0)⇒ **外部机器连 TCP 都连不上。**
   ⚠️ 步骤 1 仅对**已经在本机上的人**可跑。
   🔴 **v0.1 的这一条原文写的是「下面只有一个块今天真能跑」 —— 那句是错的**:它把「我这台能跑」当成了「能跑」。
   🔵 而摘要句错的代价特别大 —— **引用的人只带走摘要,正文里的例外不会跟着走。**

---

## 一、五分钟解释:KANet 为谁解决什么

> **以下这段是 Owner 于 2026-07-26 04:03 亲口订死的唯一权威文本。逐字,不许任何人改动一个字。**
> 出处:`docs/2026-07-26-kanet-official-external-description.md`

<!-- ux1:non-exec reason=owner-ratified-prose-not-code -->
```text
KANet 是一条给程序用的信任通道。
接进来的程序,能拿到三样东西:可信的身份、加密的通信、链上的结算 —— 全部记在 Kaspa 链上,任何人都能自己验。
现在是测试网。
```

### 这句话对谁有用

**Broker / 撮合方** —— 你把两边接上,而你不想碰钱。
今天你只有两个选择:**要么托管用户资金**(于是背上密钥保管、合规与赔付),**要么不管结算**(于是你的撮合只值一次介绍费)。
KANet 想给的是第三个:**不碰钱,而结算照样发生,并且出了事有据可依。**

### 🔴 而这句话今天在哪些地方【还不成立】—— 写在同一页,不另开文档

| | 现状 |
|---|---|
| 「接进来的程序」 | 🔴 **外部程序今天接不进来**:onboarding 仍要求 `bot_token`(`kasia-console/src/api/kanet-broker.js:264-270`)。这是主干模块化正在做的事 |
| 「链上的结算…都能自己验」 | 🔴 **五条结算路径里两条做不到**:`bettor-prediction-settler`(零引用落地校验)、`exchange-machine.js:826-829`(手工造 `confirmed:true`)。今晚定性为钱路阻塞 |
| 「任何人都能自己验」 | ⚠️ **没有网页版浏览器**(实跑:`explorer-tn12.kaspa.org` 域名不存在)。**凭据我们每笔都给,而"点开看"这件事今天要自己接节点** |

🔵 **为什么把这张表放在正文而不是附录**:分开放的话,**读到承诺的人读不到差口**。

---

## 二、read-only Quickstart

### 步骤 1 —— 拿到一条带链上凭据的记录　🔴 对外部读者 `NOT_AVAILABLE`(仅本机可跑,零认证)

<!-- ux1:executable -->
```bash
curl -s "http://<KANET_HOST>:3200/api/public/channel/kanet-spec/messages?limit=2"
```

**实跑结果**(2026-07-26 04:49,`<KANET_HOST>`=`127.0.0.1`,HTTP 200):

```json
{"messages":[{
  "id": "3ce1387a-e2da-4119-91d8-0e4900e8b41b",
  "sender_address": "kaspatest:qqvax2yukqzxe8lrt0nxk30vm6enc2wse90sqn47373u9m5uxtdzw0gn8whkz",
  "message_text": "[SILENT]",
  "txid": "da6e2595ac21032523974f3af0b80448c2b40eb1756ef166cdcbdbdbf1ad3b91",
  "timestamp": "2026-06-16T02:58:06.984Z"
}]}
```

🔵 **这一步就是那句承诺的最小实例**:每条记录带一个 `txid`,**那是链上的、你可以拿去自己核的凭据** —— 不是我们的数据库 id。
响应头还会带 `x-kanet-disclaimer: testnet-only-no-investment-advice`。

⚠️ **这一步的三个边界,现在说清**:
- 只返回 `visibility='public'` 的记录。**内部协作频道对这个端点返回空,那是设计,不是坏了。**
- `limit` 被硬钳在 200(`chat.js:139`),**而响应体里没有 `total` / `hasMore` / `truncated` 任何标记** ⇒ 拿满 200 = 必须继续用 `since` 翻页,否则你不知道自己只拿到了一个窗口。
- 🔴 **拿到 `txid` 之后怎么验**,见步骤 2 —— **而步骤 2 今天走不通。**

### 步骤 2 —— 用 txid 自己核这笔上没上链　🔴 `NOT_AVAILABLE`

<!-- ux1:non-exec reason=no-public-explorer-and-no-public-proof-endpoint -->
```text
(空缺 — 本步骤今天没有可执行的调用)
```

🔴 **缺什么,逐条**:
- 没有公网 explorer(实跑 2026-07-26 04:00:`nslookup` ⇒ `Non-existent domain`;`curl` ⇒ `http_code=000`)
- 现有的两个链上证明端点**今天都是 500**(实跑 04:49):
  - `/api/oracle-pool/merkle-root` ⇒ `chain_view empty + LEGACY FALLBACK removed …` —— 它自己的错误文本说这要么是 scanner 异常、要么链上无 enrollments
  - `/api/oracle-pool/chain-snapshot` ⇒ `Offset is outside the bounds of the DataView` —— 🔴 **这不是"没数据",这是一个未处理的越界异常**
- ⇒ **今天唯一的验法是自己接一个 TN12 节点**,那不是 Quickstart 该要求的门槛。

### 步骤 3 —— 拿到 caller identity / capability　🔴 `NOT_AVAILABLE`

<!-- ux1:non-exec reason=onboarding-requires-bot-token -->
```text
(空缺 — 本步骤今天没有可执行的调用)
```
🔴 `kanet-broker.js:264-270` 要求 `bot_token`(长度 ≥ 20)。**这一条就是"外部程序接不进来"的那一行。**

### 步骤 4 —— mock 走一遍 `Intent → Agreement → Value Event → Settlement → Claim/Exit`

🔴 **本步骤的能力状态【不在本文件里写】** —— 由 J2 的单一来源清单渲染(`ux1-capability-manifest.mjs`,`lifecycle_mock` 当前为 `MOCK_ONLY`)。
⚠️ **v0.1 我在这里写了「⏳ 建设中」** —— 那既是**卡定义的三个 token 之外的第四个词**,也与那份清单**给出了不同的答案**(它说 mock 已有、能走)。
🔴 **⇒ 双权威源从两个半张卡之间长了回来。** 本文件此后凡涉及能力状态,一律渲染那份清单,不自己写词。
🔨 归 @J2(契约面)。**在 M0b manifest 落地之前,它的能力清单不是同源生成的,而那件事必须在运行时自己喊出来。**

---

## 三、⚠️ 本文件自身的边界(强度逐条)

- ✅【实跑 2026-07-26 04:49】步骤 1 的 curl、返回体、响应头;`kanet-spec` 有 535 条 public 记录
- ✅【实跑 04:49】步骤 2 里那两个 500 及其错误原文
- ✅【实跑 04:00】explorer 域名不存在(`nslookup` + `curl`)
- ✅【实读】`chat.js:551-571`(public 端点按 `visibility='public' AND status!='local'` 过滤)、`chat.js:139`(limit 钳位)、`kanet-broker.js:264-270`
- 🔴【转述·未自核】五条结算路径里"两条做不到"—— 来自 J1/J2 今晚的实读报告,**我没有自己 grep 过那两处**
- ✅【实跑 v0.1a 补测】那一格已经不是「未做」了:**Console 只绑 loopback,对外不可达**(`src/index.js:474` + `kanet.env` 无 `HOST` + netstat 对外条目 0)
  🔴 **⇒ 而这条超出本卡**:「外部程序接不进来」有**两个独立原因**,而全队整晚只在谈其中一个(onboarding 要 `bot_token`)。**就算那道门拆了,TCP 也连不上。**
  ⚠️ **不许任何人现在去改绑定** —— 把 live 服务从回环口放到 `0.0.0.0` 是安全面的决定,要走设计 + 红队 + Owner 批
- 🔴【未做】我没有让任何外部的人读过这份文档

📌 **⇒ 本稿是材料,不是"Quickstart 已验证可走通"。** 按 NWT 的判据:即使 runner 全绿,它证的也只是**其中可执行的那些块能跑**,不是**照它做的人能成功**。
