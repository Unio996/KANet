# NWT 红队复核 · GO-E 身份与充值清单（真钱面）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md` 提交 `2bce30e4`。
> **本页只核实清单里的技术性主张（够不够小、密钥会不会被记下来、数字从哪来），不代 Owner 拍"建 0 个还是 1 个"这个选择题——那条清单自己也说了这是 Owner 域，我不越权。**

## 结论：**GREEN，技术性主张全部核实为真，可以把"0 或 1 个身份、1-2 KAS"这个选择题报给 Owner**

## 一、①最小集是否真最小——12 个变量逐个查了实际判定表达式，不是读注释信

逐个 `grep` 了这 12 个变量在源码里的真实使用位置(不是只读清单里写的理由,是去看代码本身怎么判定的)：

| 变量 | 我核实到的判定 | 与清单结论是否一致 |
|---|---|---|
| `FAUCET_RELAY_ID` | `chat.js:475` `!!process.env.FAUCET_RELAY_ID`,且代码注释自己说这是"测试网水龙头"概念 | 一致("不适用"判断对) |
| `GATEWAY_RELAY_ID` | `pool-market-seeder.js:161` **有硬编码回退 UUID**——但这个 seeder 现在 `POOL_SEEDER_ENABLED=0`(本会话前几轮已验证过`!=='1'`即不启动),回退值是死代码 | 一致,且清单自己已经点出了这个硬编码兜底的存在,没有藏着 |
| `MINING_RELAY_ID` | `mining-utxo-consolidate.mjs:44/115` 未设直接 "not started" | 一致("不需要"是永久性判断,不是"延后",对) |
| `BOT_AUTOFUND_SOURCE_RELAY_ID` | `pool-bot-autofund.js:15/93` 未设不启动 | 一致 |
| `BROADCASTER_RELAY_IDS` | `broadcaster-utxo.mjs:40` 未设→空数组 | 一致 |
| `CUSTODIAL_RELAY_ID` | `capability.js:36` `() => process.env.X \|\| null`,注释里提到 2026-07-24 Codex 修复(原来会静默 fallback,现在改 null) | 一致("已 fail-closed"这条属实 |
| 其余(`POOL_SEEDER_MAKER_RELAY`/`BROKER_*`/`AUTO_BET_RELAYS`/`SETTLE_DAEMON_FEE_RELAY_ID`/`BSHARD_SETTLER_RELAY_ID`) | 本会话前几轮(broker-optional/broker-optional-2/GO-B 各轮)已经逐一核实过对应的 `ENABLED`/`TICK_MS` 开关确实挡住了它们 | 一致 |

**结论：12 个里没有一个在当前配置下会导致任何崩溃/静默错误——它们要么彻底不适用（faucet/mining），要么被各自的功能开关正确挡住（本会话已反复验证这些开关本身是真的挡而不是摆设）**。清单的核心主张("波0/1 没有一个必需")核实为真。**唯一新发现**：`GATEWAY_RELAY_ID` 的硬编码回退(`15593e10-...`)是又一处跟 `SETTLE_DAEMON_FEE_RELAY_ID`(已修)、`broker-llm-agent.js`(已记档)同族的"静默拿旧网默认 id"模式——清单自己已经诚实指出了这条,不是我发现了一个清单藏起来的问题,只是提醒它也该进那份"等真正打开对应功能时一并清理"的清单，不阻塞当前判断。

## 二、②裸密钥是否经过任何会被记录的通道——查了端点本身与全部响应钩子

**`POST /relays/generate-mnemonic`(`relay.js:1288-1293`)**：读了完整实现——`Mnemonic.random(12).phrase` 生成、`reply.send({mnemonic, address})` 直接返回,函数体内**没有任何 `console.log`/写库/写文件动作碰到 `mnemonic` 这个变量**。

**全局响应钩子**：`index.js` 里唯一的 `onSend` 钩子是 `installBigResponseObserve`——读了它的日志行格式定义（`http-big-response-observe.mjs` 头注释给的原话）：`route=<url> method=<M> bytes=<n> status=<s> ms=<t> ip=<ip> ua=<ua40> q=<query48> at=<ISO>`——**这个格式里没有 body/payload 内容字段**,只有 URL、方法、字节数、耗时、IP、UA、查询字符串(`generate-mnemonic` 走 POST body 不是 query string,不会命中 `q` 这个字段)。这个钩子自己的注释也写"永远原样返回 payload"，只做**只读的长度/耗时观测**，不重新构造或记录内容。唯一的 `preHandler` 钩子(`index.js:197`)只对 `/api/agent/reply` 与 `send_message`/`send_broadcast` 两类 URL 生效，跟 `/relays/generate-mnemonic` 完全不相关。

**结论：明文助记词从生成到返回给调用方这条路径上,没有任何一处会把它写进日志/DB/文件**。清单第 2 节写的"这一刻是唯一能拿到明文的时刻,落库后就只有密文"这条描述准确。**PASS**。

## 三、③首充依据——核实数字来源真实、范围说明诚实

去查了清单引用的"9/7 评估"文档(`docs/2026-09-07-bettor-mainnet-pivot-assessment-v0.1.md`)——表格里"UTXO 再平衡 30→30"这一行原文是 **"3,731 B / 45,994 / 0.046 KAS/笔"**,逐字跟清单引用的数字对得上，字节数(3,731B)也对得上。**这个数字确实来自一笔 30 输出的再平衡交易,不是波 0/1 那四类协议消息的真实费用**——清单自己明确说了这一点，把它当**保守上界**用（协议消息大概率比这便宜），不是包装成精确值。**这是我认可的诚实处理方式**：没有真实数据时，宁可用一个已知偏高的数字打底，也不去编一个"看起来更精确"但实际是猜的数字。**PASS**。

## 四、其余核实

- **NWT 2-1 引用**：核对 `docs/2026-09-07-NWT-mainnet-real-money-preconditions-v0.1.md:16` 原文，清单引用逐字未改写，属实。
- **"充得少=天然上限"这条处置**：给的是"1-2 KAS 量级"的建议，这个量级即使私钥暴露损失也有限——这是一个务实的阶段性权衡，清单自己也明确说了这不能替代波 1/2 之后真正需要的"env 写死上限+冷热分离"，不是拿小额度当成一劳永逸的解法，边界写清楚了。
- **谁来转账**：清单正确地把这个动作划给 Owner 域，不代为设计——这跟 GO-B/GO-C/GO-D 那几轮"起服务不代为发起真实交易"的分工原则一致。

## 五、给 Bettor 的处置建议

- **GREEN**：清单里三条核心技术主张(最小集/密钥不落日志/首充数字来源)全部独立核实为真，可以把"0 或 1 个身份、1-2 KAS"这个选择题按现在这份材料报给 Owner。
- 一条非阻塞记档：`GATEWAY_RELAY_ID` 的硬编码回退加入"等打开对应功能时一并清理"名单(跟 `SETTLE_DAEMON_FEE_RELAY_ID`/`broker-llm-agent.js` 同批)。
- 我这边不对"建 0 个还是 1 个"这个问题表态——这是产品/Owner 决策，不是我该替 Owner 拍的技术判断，清单也正确地没有代拍。
