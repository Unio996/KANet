# GO-E 身份与充值清单 v0.6（2026-09-14 · KANet-UI · Bettor 派工 · 只写不执行·供 Owner 拍）

> **Status: DRAFT**。权威：GO-D 已完成（主网 console PID 12404，干净稳态）+ Bettor 派工要求"设计先行，只写"。本页只回答"要不要建、建几个、充多少、谁来充、怎么验"，**不生成任何真实密钥、不发起任何转账**。**在 NWT 复核 v0.6 之前，不生成密钥、不充值、不激活任何身份，不启动任何 relay。**
>
> **v0.4 变更（NWT 红队复核 v0.3 `fcc68351`，方向 PASS + 两处 MUST-FIX）**：§5 第 2 条补第三条自动复活路径——`system-repair.js:230-231` 的 `restart_relay_{id}` 修复动作（`POST /api/settings` 人工触发），NWT 抓到我 v0.3 漏了这条；核实 DELETE 后该路径同样失败（`account_not_found`），不需要额外处置，但必须列进静态清单，并明写"静态列举有盲区，以实测兜底"。§2 新增步骤 4：Owner 明确确认备份可读无误，才允许进入 DELETE，未确认宁可留行担已知敞口也不删。§5 原第 4 条升级为九步完整执行流程表（建→验证→停→等 90s 复活窗→确认无拉起→Owner 备份确认关卡→实测第三条路径→DELETE→复核），每步列证据要求。§2 明确拒绝"只置空 address 保留密文"的轻量替代。原六条硬门合并重复项收成五条，内容未减少。
>
> **v0.5 变更（NWT 复核 v0.4 `90153e72`，①②③ PASS，两处机械错）**：§5 步骤⑦路径订正——真实路由是 `POST /api/system/repair`（`api/settings.js:129`），不是 v0.4 写的 `/api/settings`（NWT 自己 `fcc68351` 那次就写错了，我 v0.4 照抄，本次读代码独立核实过）。§5 步骤⑧改写——`relay.js` 没有能删整行 `relay_nodes` 的现成端点（只有 wallets/goals 两个子资源 delete，已核实），Bettor 裁定不为此新开 HTTP 端点（破坏性能力不该开成 web 面），改为"停 console → 跑经审查的一次性脚本 `scripts/relay-delete-row.mjs <id>` → 起 console → 复核"，脚本规格写进本页（只读打印非敏感字段/交互确认/DELETE+可选VACUUM/留 provenance 一行），脚本本身另派另审、不在本次一起交。顺带把 §1/§2/§5 里出现的旧网具体名字改成中性说法（"旧网 console.db 的 relay 行"），语义不变。
>
> **v0.6 变更（NWT 自纠·Bettor 1131 派工）**：v0.5 判断"没有现成删整行端点"是错的——`relay.js:161` `POST /relays/:id/delete` → `relay-nodes.js:70` `deleteRelayNode(id)` 早已存在（清 `skills` FK 依赖 + `DELETE relay_nodes`），只是 v0.4/v0.5 两轮只查了 `fastify.delete`（RESTful DELETE 方法）没查到 `fastify.post('*/delete')`（POST 路径式删除）这个既有命名习惯，属于查找方式的疏漏。本次独立读代码核实：该路由零 `console.log`、不碰任何其它 relay。§5 步骤⑧改为"停进程→只读 SELECT 留前证→调现成路由→SELECT 留后证"，**删除 `scripts/relay-delete-row.mjs` 全部脚本规格，不再造新删除代码**。§2 步骤 4 引用的"§5 表格步骤⑧DELETE"指代不变（仍是同一个表格位置，只是动作实现变了）。
>
> **v0.2 变更（Codex 6480a60d 真钱面 MUST CORRECT，Bettor 拍选项 1）**：§5 撤回"首充金额小=天然资金上限"的说法（余额低是暴露面缩小，不是机器强制的支出策略，Codex 指出的缺陷成立）；改为把验证用途身份严格定义为"自动化热钱包激活范围之外"的一次性手动身份，给出机械可核判据（env 零引用 + 源码零引用的 grep 证据），并明确任何转自动化用途前必须先落实 NWT 2-1 硬上限，不能延后补。§3 把 `0.046 KAS/笔` 的措辞订正为"粗略预算上界代理，非费用估计非安全证明"。§4 首充 1-2 KAS 建议保留为运营选择，未改。
>
> **v0.3 变更（Codex 复审 v0.2 判 SUPPORTED-CONDITIONAL）**：v0.2 的"零引用"只堵了自动化代码主动去用这个身份的路，没堵"手动验证本身也要真起一次 relay 进程、私钥也真的进了那个进程内存"这件事——2-1 的风险由进程是否活着决定，不由谁触发决定。§5 改写为「ephemeral manual relay」六条硬门（零自动化引用/无 auto-start 归属/仅一次显式手动启动/完成后立即停进程并删行/启停双向证据留档/转常驻前必须先落实 2-1）。**读代码查出一个真实的坑写进第 2 条**：`index.js:558` 每次 console 重启无条件 `startAllRelays()` + `relay-health-monitor.js` 30 秒健康监控 cron，两条路径只要这个身份的 `relay_nodes` 行还在（有地址+密钥）就会把它自动拉回来——只停进程不够，必须删行，§2 生成流程同步加了这一步。

## 0. 核心结论先行
按 NWT `docs/2026-09-07-NWT-mainnet-real-money-preconditions-v0.1.md` 5-1/5-2（**MUST**）的分阶段口径——波 0 = 只读零 submit，波 1 = 只开手续费级（`handshake`/`send_message`/`publish_card`/`send_broadcast`）——**本次核过的 12 个留空 relay 身份变量，没有一个是波 0/1 功能上必需的**。它们全部绑定settle/broker/mining/betting 类自动化服务，属于波 2/3。波 0/1 唯一可能需要的身份，是"有没有至少一个人工可操作的 mainnet relay，用来手动发协议消息"——这个需求**不由这 12 个变量中任何一个门控**，是否要建、建几个，是独立的问题，见 §1 末尾。

## 1. 12 个变量逐条：必需 / 可延后 / 不需要
| 变量 | 判定 | 理由（哪条 cron/服务用它） |
|---|---|---|
| `FAUCET_RELAY_ID` | **不需要** | 水龙头是旧测试网测试币免费发放概念，主网没有"免费发真 KAS"这回事，这个功能本身在主网语境下不该存在，不是"延后"是"不适用" |
| `POOL_SEEDER_MAKER_RELAY` | **可延后**（波 2） | `pool-market-seeder.js` 做市 cron，本次已 `POOL_SEEDER_ENABLED=0` |
| `GATEWAY_RELAY_ID` | **可延后**（波 2） | 同一做市 cron 里的 broker 网关字段，有硬编码默认值兜底，即便波 2 开启也不一定需要单独配 |
| `BROKER_PREDICTION_BROKER_RELAY_ID` / `BROKER_RELAY_ID` | **可延后**（波 2） | broker 子系统，本次 `BROKER_ENABLED` 默认关（GO-C/D 已验证），11 个 broker-*.js 文件全部不加载 |
| `AUTO_BET_RELAYS` | **可延后**（波 2+，且是自动下注，比波 2 更靠后） | `pool-auto-better.js`，本次 `AUTO_BET_TICK_MS=0` |
| `SETTLE_DAEMON_FEE_RELAY_ID` | **可延后**（波 2/3） | bshard 结算付费身份，波 0/1 没有 bshard 市场 |
| `MINING_RELAY_ID` | **不需要** | 主网 console 是只读节点，不在本机挖矿，跟波次无关，是这个部署形态下永久不需要 |
| `BOT_AUTOFUND_SOURCE_RELAY_ID` | **可延后**（波 2+） | 给交易机器人自动充值的源头 relay，波 0/1 没有交易机器人 |
| `BROADCASTER_RELAY_IDS` | **可延后**（波 2，甚至波 3 前要重设计） | `broadcaster-utxo.mjs` 再平衡 cron——评估文档明确写了"主网前重设计"，不是简单配个身份就能开 |
| `BSHARD_SETTLER_RELAY_ID` | **可延后**（波 3） | ZK/bshard 结算，波 3 专属 |
| `CUSTODIAL_RELAY_ID` | **可延后**（波 2+，具体看 tg-bot 托管钱包功能何时要上主网） | Telegram 托管钱包转账，`tg-wallet.js`/`capability.js` 两处都 fail-closed 无回退（Codex 2026-07-24 修的，未配就 503，不会误转给别的 relay），不需要在波 0/1 抢配 |

**波 0/1 唯一实际问题——要不要建至少一个手动身份**：这不属于上面 12 个变量任何一个，是"有没有一个 relay 能在主网上发 `handshake`/`send_message`/`publish_card`/`send_broadcast` 这四类协议消息"。**因为协调频道已经改走本机 SendMessage/inbox（不上链），这个需求现在不是必需的**——如果 Owner 只是想先让主网 console 安安静静只读运行、不发任何东西，答案是**建 0 个身份都能满足波 0/1**。如果 Owner 想要"至少能在主网上做一次真实的身份/握手/公告级验证"（比如证明这套代码真能在主网上跑通协议层，不只是理论上能），那需要 **1 个**身份，用途仅限验证性的 `handshake`/`send_message`，不需要更多——**这是 Owner 的选择题，不是技术必需项，本页只把两个选项摆清楚**。

## 2. 生成流程（每个身份，若 Owner 选择要建）
本仓已有现成端点，不需要新写代码：
1. `POST /relays/generate-mnemonic`（body `{network: 'mainnet'}`）→ 返回全新 12 词助记词 + 对应 mainnet 地址（`relay.js:1288-1292`，用的是 `Mnemonic.random(12)`，真随机，不是任何已有身份的派生）。
2. 用返回的助记词 + 地址，在（新库）`relay_nodes` 表新建一行：`network='mainnet'`（schema 默认值就是这个），`mnemonic_encrypted` 走 console 自己的 `encrypt()`（用**当前这个 mainnet console 实例自己的** `CONSOLE_ENCRYPTION_KEY`——GO-B 已生成、全新、未复用旧网那把），其余字段（`name`/`created_at`/`updated_at` 等）按建relay 的既有表单流程填。
3. **备份位置**：助记词生成那一刻是唯一能拿到明文的时刻（`generate-mnemonic` 端点返回明文，落库后就只有密文）——这个明文谁看到、存哪，是本页要 Owner 明确拍的一条（建议：Owner 亲自在返回的那一刻记录到自己的密码管理器，不经过任何 agent 的频道/ledger/scratch 文件——同 GO-B 那把 `CONSOLE_ENCRYPTION_KEY` 的处理方式，本页不建议由某个 agent 会话代为"记录备份"）。
4. 🔴 **v0.4 新增确认关卡（NWT MUST-FIX，在步骤 3 与 §5 表格步骤⑧DELETE 之间）**：DELETE 会让这个身份的密钥从 console DB 彻底消失——助记词只在生成那一刻的响应里出现过一次（步骤 3），之后就只剩 Owner 手上那份备份是唯一副本。**DELETE 之前必须先拿到 Owner 明确回复"备份已核验可读、内容无误"**——不是"Owner 说了会存"就够，是"存完之后 Owner 自己打开核对过，确认那份备份是对的、能用"。**未确认之前，宁可留着这一行、承担 §5 描述的"进程能被拉起"这个已知敞口，也不能删**——一次性身份如果密钥连备份都没确认对就没了，就从"一次性但可复验"变成"直接丢了"，这比留一行数据风险更大。这条关卡的存在，是本页唯一允许"暂不执行 DELETE"的正当理由，其余情况下 DELETE 都不能拖。
5. **绝不复用旧网密钥**：不从旧网 `console.db`（`kanet.mainnet.env` 独立生效以来一直没碰）里的 32 个旧网 relay 行拿任何助记词/私钥往这边搬——理由同 GO-B `CONSOLE_ENCRYPTION_KEY` 那条纪律：跨网络复用同一把密钥是真实安全风险，"重映射"不是选项（起服务方案 §2.3 已定过这条）。
6. **这一行的生命周期不是"建了就一直留着"**——验证动作做完、余额/链上都核过、**且步骤 4 的 Owner 备份确认关卡已通过**之后，走 §5 表格的完整流程 `DELETE` 这一行，不是只停进程。原因：`relay-manager.js` 的 `startAll()`（console 每次重启都跑）、`relay-health-monitor.js`（30 秒 cron）、`system-repair.js` 的 `restart_relay_` 修复动作（人工触发，见 §5 表格第 2 点 v0.4 补的第三条）三条路径，都只要看到这一行"有地址+有密钥"就会把进程拉回来，跟这个身份"一次性、不常驻"的设计初衷矛盾——留行不留进程挡不住这三条路径，只有删行才挡得住。
7. 🔴 **明确不采用的轻量替代方案（NWT MUST-FIX 保留项）**：**不推荐"只把 `address` 置空、保留密文（`mnemonic_encrypted`）"这种更轻的处置**——那样密文（虽然加密，但密钥材料的存在本身）仍然残留在 DB 里，没有达到"这个身份真的没了"的效果，只是看起来干净，跟 §5 那五条硬门想要的"有始有终"不是一回事。要做就做完整 `DELETE`，不做半吊子的"隐藏但留底"。

## 3. 首充金额建议与依据
🔴 **v0.2 措辞订正（Codex 6480a60d）**：`0.046 KAS/笔` 是**粗略预算上界代理（rough budget-upper-bound proxy），不是费用估计，更不是安全证明**——它只是"如果什么都不知道，按这个数量级留够零钱不至于连一条消息都发不出去"的一个够用的参考锚点，不代表对波 0/1 四类协议消息的真实成本有任何估计意义上的把握，也不构成对资金安全边界的任何保证（安全边界见 §5，不是靠这个数字撑的）。

**这个代理数字的出处**：9/7 评估 §A 表"UTXO 再平衡 30→30"实测 **0.046 KAS/笔**——那是一笔 30 输出的再平衡交易（3,731 字节 storage mass），跟波 0/1 唯一会用到的四类协议消息（`handshake`/`send_message`/`publish_card`/`send_broadcast`，都是单输出小额转账/嵌入数据的轻量 tx）在形态上完全不同，量级大概率偏高（协议消息大概率比 30 输出的再平衡便宜）。**本页没有波 0/1 这四类消息各自的真实 mainnet 费用实测**（需要真实构造一笔核实，本页不编精确数字），下表按这个代理数字推的"日消耗/缓冲"同样只是预算规划参考，不是精确预测。

| 假设频率（仅供参考，无实证基础，Owner/Bettor 按实际验证计划调整） | 日消耗预算参考（× 0.046 代理值，非估计） | 7 天缓冲建议 |
|---|---|---|
| 极低（验证性用途，全程 ≤10 条消息） | ≤0.46 KAS | **1 KAS**（覆盖一次性验证 + 余量） |
| 低频（若波 1 真开始用，~20 条/天） | ~0.92 KAS | **7 KAS** |
| 中频（~100 条/天，波 1 稳定期） | ~4.6 KAS | **35 KAS** |

**建议**：若本次只是波 0/1 的验证性尝试（§1 结论"1 个身份、仅验证用途"），**首充 1-2 KAS 量级足够**，不需要按中高频场景一次性打大额进去——真到波 1 稳定运行再按实际消耗追加，比一次性充够 7 天缓冲更符合"波 0/1 保守起步"的整体基调。

## 4. 充值动作：谁做、从哪转、怎么验
- **谁做**：转账动作本身涉及 Owner 的真实主网资金，**不该由任何 agent 代为发起**——这是 Owner 或 Owner 指定的持钱包一方的动作，本页不建议、也没有权限代为设计"某个 agent 从某个热钱包自动转"这类流程。
- **从哪转**：Owner 自己的主网钱包（具体地址/来源不是本页能定的，待 Owner 说明）。
- **验收（这部分是我能做、且应该做的只读核实）**：
  1. **链上核**：用主网节点（PID 28244，已同步）查询该 relay 地址的 UTXO/余额，确认到账金额与笔数。
  2. **console 侧核**：起动该 relay（`POST /api/relay/:id/restart` 或等效端点）后，读 console 日志确认它成功连上 kaspad、地址匹配、余额读数与链上一致——不是"起了没报错就算数"，要两边数字对上。
  3. 两项都过，才算这个身份"可用"，之前只是"已建、未验资"。

## 5. 风险面：私钥常驻的既有问题，主网真钱下的边界
直接引 NWT 真钱前置清单 2-1（**MUST**，原文未改写）：
> relay 私钥常驻进程内存（`getPrivateKey()` 40 处：chain.mjs 5 / p2sh.mjs 27 / relay.mjs 3 / utxo-split 2 / …）× ~40 个 relay 子进程 × 同一台机；主网前：每 relay 资金上限 + 热钱包总额上限写死（env）+ 冷/热分离（结算大额走独立签名机或 HSM，至少独立进程 + 独立 OS 用户）

**这条对 GO-E 新建的身份同样成立，没有例外**——不因为是"只建 1-2 个验证用途的身份"就可以不管。

🔴 **v0.2 撤回（Codex 6480a60d 指出真实缺陷，采纳不辩解）**：v0.1 这里写的"首充金额小 = 天然资金上限，可以不用 env 硬顶"是**错的，已撤回**。Codex 的反驳成立：**余额低只是缩小了暴露面这一时刻的数字，不是任何机器强制的支出策略**——没有任何东西挡住单笔转出上限、没有日累计上限、没有目的地地址范围限制，也没有东西挡住以后有人悄悄把余额充高（"补充是静默的"）。"充得少"是操作习惯，不是控制，NWT 2-1 要的是**写死的机制**，两者不能互相替代。

🔴 **v0.3 收窄（Codex 复审 v0.2 判 SUPPORTED-CONDITIONAL，指出仍不够）**：v0.2 的"零 env/源码引用"只堵住了**自动化代码主动去用它**这条路，**没有堵住"手动验证这个动作本身，也要真的起一个 relay 进程、私钥也要真的读进那个进程的内存"**——NWT 2-1 描述的风险（进程内存常驻私钥）不是"谁触发的"决定的，是"进程活着、私钥在内存里"这件事本身决定的，哪怕只活一次、哪怕是人手动点的。零引用证明了"没有自动化路径**主动**去碰它"，证明不了"这个进程活着的那几分钟，2-1 描述的风险不存在"——这两件事被 v0.2 混成一件事了，v0.3 分开处理。

**把这个身份重新定义为「ephemeral manual relay（一次性手动 relay）」，五条硬门（v0.3 原六条，v0.4 合并重复项收成五条，内容不变），缺一不可**：

1. **零自动化引用**（沿用 v0.2 两条 grep，判据不变）：`grep -rn "<该relay的id>" kanet.mainnet.env` 零命中；`grep -rn "<该relay的id>" kasia-console/src --include="*.js" --include="*.mjs"` 源码零命中（数据行本身不算，那不是源码）。
2. **无 auto-start/auto-restart/watchdog 归属**——🔴 **这条我去读代码查过，不是空口保证，查出了一个真实要处理的坑**：
   - `kasia-console/src/index.js:558` `await startAllRelays();` 在**每次 console 启动时无条件执行**（没有 env 开关，不像 `DEMO_MINDS_OFF` 那种有 `!== '1'` 判断）；它调用的 `relay-manager.js:189` `startAll()`，过滤条件是 `WHERE r.address IS NOT NULL AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)`——**任何有地址+密钥的 relay 行，下次 console 重启都会被自动拉起，没有例外，没有"跳过这一行"的字段**。
   - `kasia-console/src/services/relay-health-monitor.js`（`index.js:699`，默认开启，`RH_OFF=1` 才关）是个 **30 秒 cron**，扫 `relay_nodes`，`isRelayAlive` 为 false 就调 `startRelay()` 重新拉起——**这个身份手动验证完、进程一停，30 秒内会被这个 cron 自动重新拉起**，除非它在 30 秒内已经不在 `relay_nodes` 表里了。
   - **结论：只"停进程"不够，两条自动复活路径（console 重启 / 30s 健康监控 cron）都会把它拉回来。真正安全的收尾动作是验证完立刻把这一行从 `relay_nodes` 里 `DELETE`，不是只停进程留着行**——这条比 Bettor 派工原话第 4 条字面意思（"动作完成即停进程"）更严格，是我读代码后发现"停进程不够"才加的，不是我自己加戏，是真实存在的两条路径逼出来的必要条件。
   - 🔴 **v0.4 补第三条（NWT 红队复核 `fcc68351` 抓到，我漏了）**：`kasia-console/src/services/system-repair.js:230-231` 的 `restart_relay_{id}` 修复动作——同样调 `startRelay(relayId)`，触发方式是 `POST /api/settings` 传 `fixId=restart_relay_<id>`（`api/settings.js:130-133` `applyFix(fixId, fixData)`）。这条是**人工触发**的修复流（运营者在 console"系统修复"面板点一下），不是自动 cron/watchdog，但同样能把这个身份拉起来。NWT 同时指出：Mind 侧只是被动反应（reactive only），不会自主触发这条，不构成第四条路径。**DELETE 这一行之后，这条路径同样会失败**——`startRelay()` 内部第一步就是 `sqlite.prepare(...).get(relayNodeId)` 查不到行，直接返回 `{ok:false, reason:'account_not_found'}`（我读代码核实过这条返回路径），跟前两条路径一样被同一个"行不在了"挡住，不需要给这条单独加处置，只是必须列进来、不能漏。
   - 本机目前没有找到第四条会启动 relay 的路径（`kaspad-watchdog.ps1`/`kanet-boot-sequence.ps1`/`start-console-mainnet.ps1` 都只碰 kaspad/console 本身，不碰 relay_nodes 表），但**静态列举天然有盲区**——已经漏过一次（第三条就是这么被 NWT 抓出来的，不是我自己找到的）,**必须以实测兜底，不能只信静态审计**：真执行那天要真的触发一次 `restart_relay_` 验证会不会拉起、DELETE 后再触发一次验证会不会 `account_not_found`，见下方第 4 条的完整流程。
3. **relay 进程只为一次显式手动验证动作启动**——不接入任何自动拉起链路（同第 2 条已证），启动本身是 Owner/操作员在 console 界面/API 上的一次人工点击/调用，不是任何 tick。
4. 🔴 **v0.4 升级为完整执行流程（NWT MUST-FIX）**：动作完成后不是"立即停进程+立即删行"两步，是下面这条完整链路，**每步的证据要求列在后面，真执行那天照单打卡**，不能跳步：
   | 步骤 | 动作 | 必留证据 |
   |---|---|---|
   | ① 建 | `POST /relays/generate-mnemonic` + 建 `relay_nodes` 行 | 该行 id、`network='mainnet'`、创建时间戳（**不留助记词明文在任何 agent 可见的地方**，见 §2 步骤 3） |
   | ② 手动验证 | 启动 relay，人工触发一次 `handshake`/`send_message` | 启动 PID、启动时间戳、该条协议消息的 txid/日志行 |
   | ③ 停进程 | 显式 `Stop-Process`（不是等它自己退出） | 停止时间戳、停止命令的实际输出 |
   | ④ 等复活窗口 **≥90 秒** | 不做任何动作，纯等待——90 秒是 `relay-health-monitor.js:15` `STARTUP_GRACE_MS=90_000` 的实际值，等这个时长才能确定健康监控 cron 真的没把它拉回来（不是拍脑袋定的数） | 等待开始/结束时间戳 |
   | ⑤ 确认无自动拉起 | `Get-Process`/`tasklist` 查该 relay 对应的 PID（新起的，若有）应查无；`relay-health-monitor` 日志里不应出现这个 relay 被重启的行 | 查询的真实命令输出（不是"应该没有"） |
   | ⑥ 🔴 Owner 备份确认关卡（见 §2 新增步骤，MUST） | **Owner 明确回复"备份已核验可读、内容无误"**，否则下一步不能做 | Owner 的确认原话（时间戳+内容），没有这条，流程在这里停住 |
   | ⑦ 实测第三条路径（DELETE 前） | 🔴 **v0.5 路径订正（NWT `90153e72` 抓到，v0.4 抄错了）**：手动触发一次 **`POST /api/system/repair`**（`api/settings.js:129`，不是 `/api/settings`），body `{fixId: 'restart_relay_<id>'}`，确认它真的能把 relay 拉起来（证明这条路径确实存在、确实有效，不是纸上谈兵） | 该次调用的响应内容（应为 `ok:true` + PID）；随即再停一次该进程，重复③④⑤ |
   | ⑧ DELETE | 🔴 **v0.6 改写（NWT 自纠：现成路由早已存在，Bettor 1131 裁：不新造删除代码）**：`kasia-console/src/api/relay.js:161` `POST /relays/:id/delete` → `relay-nodes.js:70` `deleteRelayNode(id)`——本次读代码核实：该 handler 内**零 `console.log`**，`deleteRelayNode()` 内部只是两条 `DELETE`（先 `skills` 表按 `relay_node_id` 清 FK 依赖，再 `relay_nodes` 表本行），**不打印任何字段（含密文都不打印）、不碰/不启动/不停止任何其它 relay**——确认干净。流程：① 停该 relay 进程（`Get-Process`/`tasklist` 确认对应 PID 不在）② 只读 `SELECT id,name,address,network,created_at FROM relay_nodes WHERE id=?` 留删除前证据（**不选 `mnemonic_encrypted`/`privkey_encrypted` 字段，不管加密与否都不留在证据里**）③ 调 `POST /relays/:id/delete`（该路由本身会 `reply.redirect('/relays')`，无 JSON body，凭调用后的空 `SELECT` 判定成功，不凭响应体）④ 复核（见步骤⑨）——**不再需要新写脚本，`scripts/relay-delete-row.mjs` 规格作废，本页不再引用它** | 停进程时间戳+PID；步骤②③两次 `SELECT` 的真实输出（删除前有行、删除后无行）；curl/调用命令的真实输出 |
   | ⑨ 复核 | `SELECT * FROM relay_nodes WHERE id=?` 应查无；**再次**触发 `restart_relay_<id>`（走订正后的 `POST /api/system/repair`），应返回 `account_not_found`（实测第三条路径 DELETE 后确实失效，不是只读代码猜的） | 两条查询/调用的真实输出 |

5. **任何转常驻/后台用途，必须先经 NWT 2-1 硬上限（per-relay 资金上限 + 热钱包总额上限写死 env + 冷热分离）落地，另起一次独立 GO**——不能在这次 ephemeral 用途的基础上"顺便"升级成常驻，两者是两次不同的决定。

（原第 5 条"证据同时记录启动与终止"已在 v0.4 并入上面第 4 条的表格 ②③⑤ 三行，不再单列，避免两处各写一半互相打架——六条硬门在 v0.4 收成五条，内容没有减少，只是合并了重复的部分。）

本次身份运行在跟旧网那 32 个旧身份、以及本机其它一切 relay 进程同一台物理机上——"同一台机"这个风险面本身不会因为是新网络新身份而消失；但严格满足上面五条，这个身份活着的那一小段时间产生的风险敞口是"一次性、有始有终、有证据"的，跟 2-1 描述的"~40 个常驻自动化进程"是性质不同的两件事，不是靠混淆概念绕过去的。

## 6. 未完成事项（本页故意留白）
- §1 末尾"要不要建、建几个"是 Owner 选择题，本页不代为拍板。
- §3 波 0/1 四类协议消息的真实 mainnet 费用——没有实测坐标，用 0.046 KAS 作保守上界估，非精确值。
- §4 谁的钱包、具体转账操作——Owner 域，本页不代为设计。
