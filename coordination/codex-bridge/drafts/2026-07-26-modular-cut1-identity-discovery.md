# 模块化第一刀 —— 【身份与发现】原语的实际调用路径

> Bettor 05:21 派工：「一个外部程序拿到身份、声明能力、被别人发现 —— 这条路上要用到哪些代码？
> 交付：那条路上【实际被调用到的】文件清单 + 其中【依赖了房子】的那几处。只列被这条路走到的。」
> 判据 05:22 改用文档原话四条，不自创分类。

## 🔴 坐标更正（`:77` 这个错被引了三次，而三次的来源不同）

```
docs/KANet-Positioning.md:76  = 标题「## KANet 不做什么」 ; :77 = 空行
docs/KANet-Positioning.md:78  = 那四条本身
```
判据逐字（`:78`）：**「KANet 不运营任何业务。不撮合交易，不托管资金，不设定价格，不审核参与者。」**

---

## 🔴🔴 先说这条路上最重的一格 —— 与 J1 那条互补，方向相反

J1 查出【安全通信】：**门不存在**（加密点对点在 console 侧零外部入口）。
而【身份与发现】相反：**门存在，而门上没有锁。**

```
POST /api/agent/create           relay.js:1543   生成助记词+地址 = 铸一个身份
POST /api/relay/:id/publish-card relay.js:1496   下 publish_card IPC ⇒ 用我们的 relay 发一笔链上 TX
```

**这两个端点没有任何鉴权。**

```
【实读】relay.js 全文只有一处 verifyIngestRequest —— :119 /api/relay/import-privkey, 与上面两个无关
【实读】index.js:171 那个全局 preHandler 是【编码检查】(ENCODING_BAD_RE), 不是鉴权; 且只对 POST 的两条 url 生效
⇒ 今天挡住外面的【只有】回环绑定这一件事
```

🔴 **⇒ 落到主线上的直接后果：**
**只要"可达"那一步单独先做，网络上任何人都能铸身份、并让我们的 relay 替他发链上 TX。**
⇒ 这就是「可达 + 鉴权必须在同一个变更里」这条前提在本原语上的**具体实例**，不是抽象担心。

---

## A. 入口路由（这条路的门）

| 路由 | 文件:行 | 做什么 |
|---|---|---|
| `POST /api/agent/create` | relay.js:1543 | 生成助记词+地址、建 adapter/relay 记录 —— 拿到身份 |
| `POST /api/relay/:id/publish-card` | relay.js:1496 | 汇总 active skills → `publish_card` IPC 上链 —— 声明能力 |
| `GET /api/relay/:id/card` | relay.js:1463 | 读回本地 card + active skills |
| `POST /api/discovery/card` | discovery.js:213 | Scout 回报链上探到的 Card → 落库 |
| `POST /api/discovery/register` | discovery.js:242 | Scout 回报新地址 → 落 identities |
| `GET /api/discovery/list` | discovery.js:128 | 列出同伴 —— 被别人发现 |
| `GET /api/discovery/targets` / `stats` / `local-addresses` / `known-addresses` | discovery.js:413 / 406 / 421 / 431 | 探测种子与统计 |
| `POST /identities` | identities.js:144 | 手工添加联系人 |
| `GET /api/exchange/reputation/:address` · `/batch` · `/peer-reputation` | exchange.js:1216 / 1243 / 562 | 信誉查询 |

## B. 实际被调用到的文件（只列走得到的）

| 文件 | 符号 | 被谁调（文件:行） |
|---|---|---|
| services/ingest-auth.js:19 | `verifyIngestRequest` | discovery.js:188（preHandler） |
| data/discovery/discovery.js:16 / :107 / :123 | `registerDiscoveredAddress` / `getProbeTargets` / `getDiscoveryStats` | discovery.js:246 / 416 / 407 |
| data/discovery/agent-cards.js:12 | `processAgentCard` | discovery.js:220 |
| data/discovery/probe-logs.js:59 | `getFunnelMetrics` | discovery.js:408 |
| services/mind-manager.js:702 | `triggerProactiveAll`（动态 import） | discovery.js:230 / 255 |
| data/settings/relay-nodes.js:18 / :22 | `getRelayNode` / `createRelayNode` | relay.js:1464 / 1497 / 1582 |
| data/settings/adapter-nodes.js:6 / :23 | `listAdapterNodes` / `createAdapterNode` | relay.js:1577 / 1535 / 1559 / 1568 |
| services/wallet.js | `addressFromMnemonic` | relay.js:1550 |
| data/settings/skills.js | `registerMindSkills` | relay.js:1592 |
| services/relay-manager.js:247 | `sendCommand` | relay.js:1511 |
| kasia-relay/src/relay.mjs:421 | `case 'publish_card'` | 经 IPC（relay-manager.js:250 `child.send`） |
| kasia-relay/src/chain.mjs:179 / :220 | `publishCard` / `sendKaspa` | relay.mjs:422 / 423 |
| data/settings/identities.js:5 / :19 / :35 | `upsertIdentity` / `getIdentityByAddress` / `updateIdentity` | identities.js:147 / 153 / 158 |
| services/reputation.js:45 | `assessReputation`（动态 import） | exchange.js:1223 / 1253 / 568 |
| db/client.js · lib/time.js | `sqlite` · `nowIso` | 上列数据层文件 |

**写的表**：`identities` · `relation_states` · `relay_nodes` · `adapter_nodes`
**读的表**：以上 + `skills` · `conversations` · `messages` · `chain_events` · `probe_logs` · `mm_orders` · `exchange_offers` · `reputation_summary`
**链上落点**：`publishCard` = self-send（`chain.mjs:215`），payload 1024 字节硬上限（`chain.mjs:209-211`）

## C. 越界处（判据逐字 `:78`）

**3 条，全部落在同一类：不审核参与者。**

| 文件:行 | 类 | 内容 |
|---|---|---|
| `api/exchange.js:1226-1234` | 不审核参与者 | 星级评定：`completed>=50 ⇒ 5星` … 且 `disputed/totalTrades > 0.1 ⇒ 扣一星`。**阈值与扣分规则由本仓单方设定并对外发布评级。** |
| `services/reputation.js:145-159` | 不审核参与者 | 风险分级：零交易 ⇒ `high`；无 Card ⇒ `medium`；地址 <1 天 ⇒ `high`。**而该文件头 :4 自称「不做虚假的信誉分，做事实陈列」—— 声称与实现不符。** |
| `api/discovery.js:186-190` | 不审核参与者 | 写入 discovery 需持有**单一共享 secret**（`ingest-auth.js:19-43`）⇒ **谁能登记身份/上报 card，由我们发放的一把钥匙决定。** 这正是 Bettor 05:31 判别式里「由我们发放的凭证」那一档。 |

**「不撮合交易」「不托管资金」「不设定价格」在这条路上 = 0 条。**
（本路径的写操作只有那四张表 + 一笔 self-send card TX；`serviceTerms` 是原样透传，`relay.js:1518 → chain.mjs:198`，本仓不对其取值做任何设定或校验。）

## D. 我做的一处判断（不是转述，可以攻我）

`api/identities.js:125` `/identities/:id/trust` 与 `:134` `/identities/:id/block`（把 `trust_level` 置 `'blocked'`）——
**我判它【不越界】**，理由用 Bettor 05:31 的判别式：

```
它写的是【本节点主人自己地址簿】的 trust_level, 是运营者对自己视图的过滤
⇒ 不是"我们决定他准不准进这张网", 是"我不想看见他"
⇒ 与 discovery 那把共享 secret 的性质不同: 后者决定【别人能不能进来】
```
🔴 **而我明标这是判断不是实读结论** —— 判据文本不区分二者，我给了理由，谁不同意可以直接推翻。

## E. 未做 / 强度

```
🔴【未做】relay 侧 IPC 接收端: 我未定位 relay.mjs 里 process.on('message') 那段,
         "console 发 publish_card ⇒ relay 那个 case 接住" 是按命令字面量相同【推的】
🔴【未做】/api/discovery/message-index · /checkpoint 只读到路由行, 未读 SQL ⇒ 其表未进清单
🔴【未做】Scout 本身不在 kasia-console 里, "外部程序如何拿到 ingest secret" 未追
🔴【未做】api/capability.js 未展开 —— 它是 wallet/custodial 网关, 属托管路径, 不在本原语路上
✅【实读】A/B/C 三节每个坐标
✅【实读】relay.js 无鉴权、index.js:171 是编码检查 —— 这两条是我自己核的, 不是转述
```

**本文件产出**：零写入部署树 · 未改任何代码 · 未发 HTTP 请求 · 未碰 live。
