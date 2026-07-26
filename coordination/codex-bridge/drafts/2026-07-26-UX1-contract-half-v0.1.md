# UX1 契约面 v0.1 —— 外部程序今天能做的事

| | |
|---|---|
| 卡 | `c45acd37` v1.2 §6A.2 UX1-LIVING-QUICKSTART · **契约 DRI = J2** |
| 产品面 | `2026-07-26-UX1-product-half-v0.1.md`（Bettor） |
| 能力状态唯一来源 | `ux1-capability-manifest.mjs`（本文第三节整块由它**渲染**，不手写） |
| 评分器 | `node ux1-doc-runner.mjs <本文件> [--http --host H]` |

🔴 **本文只写【今天真实存在】的东西。**（Owner 2026-07-26 05:11 收敛令：不要的、多余的直接剥离，先搞主体骨干。）
⇒ 卡里原列的 **费用 / 超时 / 错误码 / 重试 / 撤销 / sandbox 凭证** 六项，**本版一律不写** ——
**不是省略，是那些能力今天一项都不存在**，把不存在的能力写成文档就是又一轮梳理。见第三节。

---

## 一、今天你能做的，只有一件

**读一个频道的消息，每条带一个 `txid`。** 就这一件。

<!-- ux1:executable -->
```bash
curl -s "http://<KANET_HOST>:3200/api/public/channel/kanet-spec/messages?limit=1"
```

<!-- ux1:non-exec reason=observed-response-not-a-command -->
```json
{"messages":[{
  "id": "3ce1387a-e2da-4119-91d8-0e4900e8b41b",
  "sender_address": "kaspatest:qqvax2yukqzxe8lrt0nxk30vm6enc2wse90sqn47373u9m5uxtdzw0gn8whkz",
  "message_text": "[SILENT]",
  "txid": "da6e2595ac21032523974f3af0b80448c2b40eb1756ef166cdcbdbdbf1ad3b91",
  "timestamp": "2026-06-16T02:58:06.984Z"
}],"channel":"kanet-spec"}
```

**响应头**：`x-kanet-disclaimer: testnet-only-no-investment-advice` · `content-type: application/json; charset=utf-8`

**顶层只有两个键**：`messages` · `channel`。**没有** `total` / `has_more` / `next_cursor` / `error` —— 不要为它们写解析分支。

| 字段 | 类型 | 说明 |
|---|---|---|
| `txid` | string | 🔵 **这一个就是那句承诺的最小实例** —— 链上的、你能自己核的凭据，不是我们的数据库 id |
| `id` | string | 我们的数据库 id。**不是链上的东西**，别拿它去核链 |
| `sender_address` | string | 🔴 广播消息的发送方地址**可伪造**，不要当身份凭据用 |
| `message_text` | string | 明文正文 |
| `timestamp` | string | ISO 8601 |

⚠️ **`txid` 拿到之后怎么核**：TN12 **没有公网 explorer**（`explorer-tn12.kaspa.org` 域名不存在，实测）。
⇒ 你要自建或接入一个 TN12 节点才能核。**「任何人都能自己验」这半，今天需要你先有一个节点。**

---

## 二、这个端点【从不说"不"】—— 集成前必读

🔴 **所有下列情况都返回 `HTTP 200`。你的客户端【无法从状态码看出自己写错了】。**

<!-- ux1:non-exec reason=observed-behavior-table-not-a-command -->
```text
频道不存在        -> 200 {"messages":[],"channel":"<你传的那个名字>"}   ← 与"频道存在但为空"无法区分
limit=1           -> 1 条
limit=200         -> 200 条
limit=201         -> 200 条      ← 被截到 200
limit=99999       -> 200 条      ← 被截到 200, 响应里【没有任何标记】说它被截过
limit=abc         -> 50 条       ← 非法值静默退回默认
limit=0           -> 50 条       ← 同上
不传 limit        -> 50 条       ← 默认 50
limit=-5          -> 535 条      ← 🔴 负数绕过上限, 返回了全部
```

**⇒ 你必须自己做的三件事**（客户端侧，不依赖我们改）：

1. **别用空数组判断"频道存在"** —— 空数组既可能是空频道，也可能是名字打错了。**用你自己知道的频道名，不要从用户输入直接拼。**
2. **别用 `limit` 大数一次拉完** —— 超过 200 会被静默截断且不告诉你，你会以为拿全了。要拿全请按时间分页。
3. **`limit` 传整数，且不要传负数。**

⚠️ **这一节是【实跑观测】**（2026-07-26 05:11，本机 `127.0.0.1:3200`，八次只读 GET，逐次数了 `messages.length`，不是估算）。
🔴 **它描述的是行为，不是承诺** —— 这些数字没有写在任何契约里，**下一次部署可能就变**。

📌 **本文不提修法、不开工单。** 按收敛令，这里的职责是**如实告诉外部集成者会撞到什么**，不是去改它。

---

## 三、其余能力：一行带过，不展开

> 🔴 **以下整块由 `ux1-capability-manifest.mjs` 的 `toMarkedDoc()` 渲染产出，逐字粘贴，不手写。**
> 理由：手写 = 第二份权威源。今晚已经发生过一次（产品面写「建设中」、清单写 `MOCK_ONLY`，同一件事两个答案）。<!-- ux1:status-word-exempt reason=quoting-the-banned-word-to-explain-why-it-is-banned -->

<!-- ux1:non-exec reason=rendered-from-manifest-not-a-command -->
```text
🔴 前提 (先读这条, 再读下表): 下表回答的是「这个能力建了没有」, 不是「你调不调得到」。截至 2026-07-26 05:00, Console (:3200) 只在回环口 127.0.0.1 监听 ⇒ 【本机之外的程序, 下表六项一项都调不到】, 包括标 ✅ 的那项。⇒ 若你不在这台机器上, 请把下表整体读作「尚不可达」。 依据强度: 【实跑】—— Bettor 实读源码 (kasia-console/src/index.js:474 `host: process.env.HOST || '127.0.0.1'`, kanet.env 无 HOST 行), NWT 与 J2 各自枚举运行时套接字确证 (pid 40232 绑 127.0.0.1:3200)。⚠️ 这是【那一刻】的运行时事实, 不是配置承诺 —— 绑定改变则本条失效, 需重测。

🔴 能力清单不是同源生成的 —— M0b manifest 尚未落地 (kasia-console/src/contract/m0b-manifest.json 不存在), 本清单为手写占位。§6A.2 DoD「mock 与 M0b manifest 同源生成」当前【未满足】。

⚠️ 上表每一格的状态来自【读卡与频道内的实测报告】, 未逐项对运行中的系统实跑核对 ⇒ 强度: 转述+读卡, 非实跑。

| 能力 | 状态 | 不可用的性质 | 为什么 |
|---|---|---|---|
| caller identity 与 capability 获取 | 🔴 `NOT_AVAILABLE` | 尚未建 | M0c 能力强制尚未启用 (§5.2: M0c 不得在 M0b 之前启用)。当前外部程序无法获得 scoped 凭证。 |
| read-only status 查询 | 🔴 `NOT_AVAILABLE` | 尚未建 | B0-O5 只读能力状态端点未落地; /api/capability/status 实测 404 (Bettor 20:34)。 |
| read-only proof 查询 (链上凭据) | ✅ `READ_ONLY` | 尚未建 | 每笔结算带 txid, 可自行验。⚠️ TN12 无公网 explorer (explorer-tn12.kaspa.org 域名不存在, Bettor 04:02 实跑), 需自建/接入 TN12 节点。 |
| Intent → Agreement → Value Event → Settlement → Claim/Exit | 🟡 `MOCK_ONLY` | 尚未建 | 本包提供 mock 走通全程。真实链路中 Settlement 有两条路径未接落链校验 (B0-M1 钱路阻塞), 不对外开放。 |
| 外部程序自助接入 (HTTP) | 🔴 `NOT_AVAILABLE` | 尚未建 | 两道闸, 外部程序卡在【第一道】: ① 服务只在回环口监听 ⇒ 本机之外连不上 TCP; ② 即便连得上, 接入仍需自建 Telegram bot 并交出 token。HTTP 能力网关是 M0c-1 的目标, 未落地。 |
| Agent Card / Discovery / Trust Facts | 🔴 `NOT_AVAILABLE` | 本版故意不做(有裁定) | §16.3 :1490 明令 UX1/M0b v1 不得提前加入, 后移 M5/契约 v2。⇒ 这一项【不是"还没做"、是"本版故意不做"】, 裁定条号即 §16.3 :1490。 |
```

---

## 四、本文的覆盖边界（自述，不藏）

<!-- ux1:non-exec reason=self-declared-coverage-boundary-not-a-command -->
```text
✅【实跑】第一节的请求与响应 —— 本机 GET, HTTP 200, 响应逐字取自实际返回
✅【实跑】第二节全部八行 —— 八次只读 GET, 逐次数了 messages.length, 非估算
✅【渲染】第三节整块 —— 来自能力清单模块, 未手写
🔴【未做】未从【另一台机器】跑过任何一条 —— 而按第三节那条前提, 那本来也连不上
🔴【未做】「从未接触本仓的人照本文档独立跑通」—— 需要外部的人, 不在我可交付范围内
🔴【未满足】DoD「示例由 CI 实际运行」—— 本仓零 CI。runner 目前只是一条本地命令。
🔴【不写】费用 / 超时 / 错误码 / 重试 / 撤销 / sandbox 凭证 —— 这些能力今天不存在(第三节)
```

**本文产出过程**：零写入主仓 · 未碰 live 配置 · 只发只读 GET · 未构造/签名/广播 · 未动资金。
