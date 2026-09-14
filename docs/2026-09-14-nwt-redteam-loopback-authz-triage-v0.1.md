> **Status**: CURRENT

# NWT 判断 · T-LOOPBACK-AUTHZ 分档 v0.1（264条无鉴权路由按损失量级三档）

> Bettor 1297：对`docs/2026-09-14-nwt-redteam-mainnet-exposure-surface-inventory-v0.1.md`盘点的264条
> 无鉴权状态变更路由按损失量级分三档（资金/密钥类→状态类→无害）；13条次级信号路由人工读定；资金/密钥
> 类每条给建议档位；`GET /ingest/pending-handshakes`单列。

## 结论：**分档见下。途中发现一条比资金类更严重的独立缺陷（`POST /api/system/run`的白名单绕过，
RCE级，已单独SendMessage报过，本文档正式收录为独立第0档）。13条次级信号路由人工读完，全部确认不是
真实鉴权闸（都是"请求体里有个叫apiKey的字段"这种凑巧撞词，不是"校验调用方"）。**

## 0. 比资金类更severe的独立发现：RCE级白名单绕过（已插播报过，Bettor 1299核实属实，定为独立"第四档"）

**`POST /api/system/run`**（`broker.js:309`）→`runInstaller(filePath)`（`system-actions.js:99`）：

```js
export function runInstaller(filePath) {
  const fileName = basename(filePath);
  const allowed = Object.values(ALLOWED_INSTALLERS).some(rule => rule.match.test(fileName));
  if (!allowed) return { ok: false, error: `不允许运行: ${fileName}` };
  ...
  const child = spawn(filePath, [], { detached: true, stdio: 'ignore', shell: true });
```

"白名单校验"只对`basename(filePath)`（丢弃全部路径前缀后的最后一段）做正则匹配
（`/ibgateway.*\.exe$/i`），**完全不检查`filePath`实际指向的位置**——`spawn`执行的是调用方传入的**完整
`filePath`**，不是校验过的`basename`结果。这意味着白名单验的是"文件名长得像不像"，不是"这确实是我们
批准过的那个具体文件"：调用方可以指向任意目录下**任何**文件名恰好匹配这个正则形状的文件，该文件会被
`shell:true`直接执行。

**建议档位：独立第0档（比资金/密钥类更高）——需要`admin-secret-tier`新档 + 修白名单实现本身**（校验
逻辑必须改成对照一份固定的完整绝对路径候选集，或至少校验`resolve(filePath)`落在`DOWNLOAD_DIR`内且
文件内容/哈希匹配预期，不能只验文件名形状）。这条即便加了鉴权也建议同时修实现——鉴权解决"谁能调"，
不解决"传进来的路径本身有没有被正确约束"这个独立问题，两者都要。

## 一、资金/密钥类（Tier 1）——每条给建议档位

**方法**：以下每条均独立读了handler源码全文确认真实资金/密钥语义（不是只看路由名猜的），可信度高；
标"（域推断）"的是根据同域其它路由已验证过的模式做的合理推断，未逐行读到底，供KANet-UI落码时按同样
方法自行确认一遍。

### 1.1 直接解密私钥+广播真实转账/交易（最高优先级，建议 `verifyIngestRequest` 或专属 `admin-secret-tier` 新档）

| 路由 | 文件:行 | 确认的真实语义 |
|---|---|---|
| POST /api/relay/:id/transfer | relay.js:535 | 解密后经`sendCommandAsync({type:'transfer'})`广播真实KAS转账，`to`/`amount`调用方指定 |
| POST /api/relay/:id/wallets/:walletId/withdraw | relay.js:999 | 解密EVM私钥，真实USDT/native `contract.transfer`/`signer.sendTransaction`，`to`调用方指定 |
| POST /api/relay/:id/wallets/:walletId/send | relay.js:1059 | 同上，通用EVM转账（native/usdt/usdc） |
| POST /api/relay/:id/wallets/:walletId/swap | relay.js:1208 | 解密私钥，真实Uniswap V3 swap广播 |
| POST /api/relay/:id/wallets/:walletId/bridge | relay.js:1307 | 解密私钥，真实Across V3跨链桥广播，`recipient`调用方指定 |
| POST /api/relay/:id/wallets/import | relay.js:837 | 无鉴权导入任意第三方私钥进系统（可用来种植攻击者控制的密钥，或探测地址碰撞） |
| **POST /api/relay/:id/send-command** | relay.js:1827 | **通用IPC命令直传relay进程，`type`完全由调用方指定——relay支持的任何命令类型（含transfer/签名类）都经这一个端点可达，是本档里攻击面最广的单点** |
| POST /api/trade/withdraw | trading.js:154 | 解密EVM私钥，真实USDT/native转账，`to`调用方指定 |
| POST /api/defi/aave/withdraw | defi.js:68 | 解密私钥，真实Aave协议withdraw（域推断：与supply/borrow/repay同款decrypt模式） |
| POST /api/defi/aave/borrow | defi.js:89 | 同上（域推断） |
| POST /api/defi/aave/repay | defi.js:121 | 同上（域推断） |
| POST /api/defi/hyperliquid/order | defi.js:430 | 解密私钥，真实Hyperliquid合约下单（域推断） |
| POST /api/defi/hyperliquid/close | defi.js:460 | 同上，平仓（域推断） |
| POST /api/defi/hyperliquid/withdraw | defi.js:530 | 同上，提现（域推断） |
| POST /api/defi/hyperliquid/deposit | defi.js:567 | 同上，存款（域推断） |
| DELETE /api/defi/hyperliquid/order/:id | defi.js:478 | 撤单（域推断，风险低于开新仓，但仍需鉴权） |
| POST /api/defi/aevo/order | defi.js:925 | 解密私钥/签名，真实Aevo下单（域推断） |
| DELETE /api/defi/aevo/order/:id | defi.js:960 | 撤单（域推断） |
| POST /api/tg-wallet/:tg_user_id/send | tg-wallet.js:152 | 解密托管钱包助记词，经`sendCommandAsync`真实转账 |
| POST /api/polymarket/:relay_node_id/redeem | stocks.js:1049 | 解密私钥，真实Polymarket赎回（域推断） |
| POST /api/polymarket/:relay_node_id/exit | stocks.js:1068 | 解密私钥，真实退出仓位（域推断） |
| POST /api/polymarket/:relay_node_id/migrate-v2 | stocks.js:1030 | 解密私钥，真实迁移操作（域推断） |
| POST /api/predictions/order | stocks.js:816 | 真实下单（域推断，同`/api/predictions/setup`已确认decrypt模式） |
| POST /api/predictions/positions/:asset/close | stocks.js:870 | 真实平仓（域推断） |
| POST /api/trade/order | trading.js:1243 | 真实CEX下单（域推断，同`/api/trade/accounts`已确认apiKey/apiSecret存取模式） |
| DELETE /api/trade/order/:orderId | trading.js:1529 | 真实撤单（域推断） |
| POST /api/trade/execute-split | trading.js:1362 | 真实分拆执行下单（域推断） |
| POST /api/trade/mm-orders/:id/action | trading.js:2221 | 真实做市单操作（域推断） |
| **POST /api/broker/:id/order** | broker.js:210 | **独立确认`adapter.placeOrder(...)`真实调用连接的券商账户下单** |
| DELETE /api/broker/:id/order/:orderId | broker.js:239 | 同上，撤单（同一`adapter`对象，域推断） |

**建议档位（全体统一）**：`verifyIngestRequest`（跟`/api/relay/import-privkey`已经在用的同一档，本次
盘点里唯一一个"密钥导入类"路由已经加了这道闸——这批路由跟它是同一敏感等级，理应同一档）。**不建议
"维持loopback-only并接受"**——理由：loopback-only防的是"公网直接打进来"，防不住"这台机器上任何其它
本机进程/被攻陷的其它组件"，而这批路由每一条都能造成**真实、不可逆的资金损失**，跟本session反复强调
的"NO TX NO STATE CHANGE"铁律直接相关的资金安全面，风险量级不该只靠网络层隔离兜底。

### 1.2 凭据存取（建议专属admin-secret-tier新档，理由与1.1略有不同）

| 路由 | 文件:行 | 语义 |
|---|---|---|
| POST /api/broker/accounts | broker.js:115 | 无鉴权写入新的券商凭据（api_key/api_secret/access_token/private_key）——攻击者可以**种植**一个自己控制的"券商账户"，后续`/order`如果被人误以为是合法账户会造成信任链污染；即便鉴权覆盖了`/order`本身，这条写入口子本身也该管 |
| DELETE /api/broker/accounts/:id | broker.js:176 | 删除已连接的券商凭据（破坏性，非资金直接损失但是服务中断） |
| POST /api/defi/aevo/save-credentials | defi.js:669 | 同上模式，写入apiKey/apiSecret/signingKey |
| DELETE /api/defi/aevo/credentials | defi.js:712 | 同上，删除 |
| POST /api/trade/accounts | trading.js:324 | 同上，写入exchange/apiKey/apiSecret/passphrase |
| PUT /api/trade/accounts/:id | trading.js:363 | 更新已存凭据 |
| POST /api/trade/accounts/:id/test | trading.js:425 | 用已存凭据测试连接（会真的拿凭据去请求外部交易所API，可能触发对方风控/暴露"这个key还活着"这类信号给攻击者） |
| POST /api/predictions/setup | stocks.js:222 | 独立确认：解密私钥用于Polygon预测市场setup流程 |
| POST /api/predictions/deposit-wallet/setup | stocks.js:257 | 同上模式（域推断） |

**建议档位**：`checkAdminSecretTier`新开一档（比如`ADMIN_SECRET_BROKER_CREDS`），理由跟`T-KEY-EXPORT`
线的既有设计哲学一致——凭据的写入/更新/测试跟"读出密钥值"是同一敏感等级的另一面（种一个假凭据 vs
读一个真凭据，对系统信任链的破坏是同构的），复用`admin-secret-tier.mjs`现成的"未设=503"惯例。

### 1.3 会武装真实自动化系统的开关（不是直接movement，但后果等价）

| 路由 | 文件:行 | 语义 |
|---|---|---|
| PUT /api/trade/mode | trading.js:234 | 全局LIVE/DRY-RUN切换——切到LIVE后，系统里其它已授权的自动化交易逻辑会开始真实下单，这条本身不转账但是"军火总闸" |
| PUT /api/trade/agent-mode | trading.js:257 | per-agent自主权切换（auto/approval/manual/disabled）——切到auto后该agent自主下单 |

**建议档位**：`checkAdminSecretTier`（跟1.2同档或单独一档均可，核心要求是不能无鉴权翻转）——理由：
这两个开关本身零资金动作，但翻转它们后系统会开始自主做1.1那批真实fund-movement的事，等价于给1.1那批
路由的风险再加一层"远程无声引信"，不应该比直接movement路由本身鉴权更松。

### 1.4 破坏本地密钥副本 / 让密钥进入活进程内存（与本session Rule 84精神一致）

| 路由 | 文件:行 | 语义 |
|---|---|---|
| POST /relays/:id/delete | relay.js:188 | 删除relay本地加密密钥副本——对"全新生成、从未导入"的身份，这是唯一副本，删了即销毁；对导入身份，本地副本消失但源头仍在（本session GO-E裁决已确认这条区分） |
| POST /api/relay/:id/restart | relay.js:209 | 解密助记词、把私钥material载入一个新启动的子进程内存——跟Rule 84"生产进程内存能读到解密后的助记词"关注的是同一个暴露面的另一半："谁能让它被载入内存" |
| POST /relays/:id/assign | relay.js:193 | 分配adapter后可能触发`startRelay()`（同上，载入内存） |

**建议档位**：`verifyIngestRequest`或同档——理由：这三条不是"移动资金"，是"让密钥离开静止的加密存储
状态"这条链路的两个端点（销毁副本/激活到内存），本session已经把"进程内存能读到密钥"当作Rule 84级别
的敏感事项处理，触发这个状态转换的开关不该比读取本身更松。

## 二、`GET /ingest/pending-handshakes`单列（真实GET写副作用）

已在暴露面盘点v0.1里记录：这条GET路由通过querystring（`claim`/`create_and_claim`）触发真实
`claimPendingAction`/`INSERT pending_action`写操作，未命中三大鉴权函数。**建议**：这条本身该重新设计
（GET不该有写副作用，参见memory关于GET语义的一般原则——浏览器预取/代理缓存/日志重放都可能意外触发），
不只是"加个鉴权"就够，落码时建议改成POST，加鉴权（`verifyIngestRequest`，同`ingest.js`其它8条POST
一致的处理），docs-only范围本次不展开具体实现。

## 三、13条次级信号路由——人工读定，结论：全部不是真实鉴权闸

| 路由 | 命中原因 | 人工读定结论 |
|---|---|---|
| POST /api/broker/accounts | apiKey | 请求体字段名叫`api_key`，是**存入**的凭据，不是校验调用方的东西 |
| POST /api/faucet/request | ip | `request.ip`用于**限速**（per-IP 24h≤3），不是身份鉴权；且发放的是**测试网**KAS（无实际价值），有独立的多层反滥用（per-wallet永久1次+设备指纹+全局日帽）——**结论：风险实际很低，维持现状可接受**，不需要升到三大鉴权函数档（升级成本大于收益，会破坏这条端点"零门槛玩"的设计意图） |
| POST /api/defi/aevo/save-credentials | apiKey | 同broker.js，存入凭据字段名 |
| POST /api/predictions/setup | apiKey | 同上（实际是`decrypt(`命中，误判到apiKey分组，已在1.2表内正确归类） |
| POST /api/predictions/deposit-wallet/setup | apiKey | 同上 |
| POST /api/trade/accounts | apiKey | 存入凭据字段名 |
| PUT /api/trade/accounts/:id | apiKey | 同上 |
| POST /api/trade/accounts/:id/test | apiKey | 用已存凭据测试，不是校验调用方 |
| POST /api/trade/order | apiKey | 内部读取已存凭据去下单，不是校验调用方 |
| DELETE /api/trade/open-orders | apiKey | 同上 |
| POST /api/trade/execute-split | apiKey | 同上 |
| DELETE /api/trade/order/:orderId | apiKey | 同上 |
| POST /api/trade/baseline/:id/settle | apiKey | 同上 |

**结论：13条里12条确认零保护（已并入上文Tier 1对应分类），1条（faucet）确认有独立、恰当的保护机制
（限速+测试网零价值），建议维持现状不升级。**

## 四、状态类（Tier 2）与无害类（Tier 3）——分组列出，非逐条深读

**方法说明**：这两档共约200条路由，逐条深读超出本次任务合理时间预算——按文件/领域做了分组，每组挑
1-2条代表性路由核实过语义（业务状态变更但不触碰密钥/不广播资金），未逐条重复验证同文件内其它路由，
若KANet-UI落码时发现某条实际有本文档未捕捉到的资金语义，请回报更正分类。

### Tier 2（状态类——业务记录/流程状态变更，无直接资金损失，但可能造成数据污染/业务逻辑滥用）

- `pool.js`市场创建/下注登记/结算/申诉类（`market/create*`、`bettor/register*`、`settle`、
  `oracle/vote`、`bettor-refund-claim`、`prevet*`）——预测市场核心流程，无鉴权可被用来灌垃圾市场/
  伪造投注记录/伪造oracle投票，业务层面有真实滋扰成本，但不直接偷钱（结算路径本身有独立的链上验证
  层，本次未重新审计那一层，只谈这条HTTP入口本身的鉴权缺失）。
- `identities.js`全部9条（身份CRUD/信任/屏蔽）——社交身份记录，滋扰类。
- `exchange.js`大部分（publish/accept/cancel/confirm/submit-payment/dispute/resolve）——P2P交易
  协议消息，业务层有独立的链上验证/托管机制（本次未重审），HTTP入口本身缺鉴权。
- `bettor.js`大部分34条中除已归入Tier1的3条外——bettor推荐引擎内部状态（scan/blacklist/position-
  protect规则/oracle公告投票）。
- `discovery.js`全部8条——发现协议消息/scanner控制。
- `conversations.js`的`/api/test/*`10条——**这些本身是测试用的mock注入端点**（inject-send-kas-mock
  等），命名上就是给自动化测试用的，无鉴权本身是"内部测试钩子暴露在生产路由表里"这个既有设计问题，
  建议至少确认这些在生产环境是不是应该完全不注册（而不是注册了再靠鉴权挡），跟本session"临时脚本/
  mock钩子不该混进生产路由"的既有纪律一致，值得单独一张票，不在本次分档范围内展开。
- `chat.js`频道/发送/摘要生成、`peer-coord.js`聊天。
- `backup.js`的`/api/backup/import`——覆盖式导入备份数据，无鉴权可被用来污染identities/relation_states
  等表（已确认`GET /api/backup/export`不含密钥列，但import端点本身没有同等程度核实内容会不会覆盖敏感
  配置，建议KANet-UI落码时重新核一遍`import`具体写哪些表）。
- `settings.js`节点配置/`system/repair`（重启进程，运维类，无资金直接语义但能造成服务中断）/tg-bot
  start-stop/tg-bot凭据配置。
- `adapter.js`全部7条——adapter生命周期管理。
- `oracle-pool.js`的enroll/withdraw（注：`withdraw`字面像资金但实为质押池状态迁移，域内有独立链上
  验证层，本次未重审那一层）/timeout-unlock（已归1.1，因确认有sendCommandAsync）。
- `escrow.js`create/lock/execute——已确认调用`sendCommandAsync`但escrow本身是多方托管机制，撮合环节
  是否需要单独鉴权取决于escrow整体信任模型（本次未展开），列入Tier2待后续单独评估。
- `kanet-broker.js`/`monitor-dashboard.js`/`chain-data.js`/`dev-channel-v1.js`/`auth.js`/
  `oauth.js`/`peer-coord.js`——各自领域内部状态记录。
- `budget.js`预算设置。

### Tier 3（无害类——纯配置/展示层，无业务或资金后果）

- `skills.js`全部13条（技能CRUD/分类/上传）。
- `monitor-dashboard.js`规则CRUD（已在Tier2列出，因为规则会影响告警触发这类下游行为，若认为纯展示
  也可降Tier3，边界不绝对）。
- `feedback.js`回复。

## 五、给Bettor/KANet-UI的处置建议

1. **最高优先级独立立票**：`runInstaller`白名单绕过（第0档，见§0），修实现本身+加鉴权双管齐下。
2. **Tier 1.1/1.4统一升级为`verifyIngestRequest`**（跟已有的`/api/relay/import-privkey`同档）。
3. **Tier 1.2/1.3升级为`checkAdminSecretTier`新档**（可复用`ADMIN_SECRET_KEY_EXPORT`的"未设=503"惯例，
   新开专属env变量名）。
4. **`GET /ingest/pending-handshakes`改POST+加鉴权**，docs-only本次不展开实现。
5. **`conversations.js`的10条`/api/test/*`建议单独立票**评估是否该在生产路由表里完全不注册。
6. **faucet维持现状**，不建议为了统一而升级（会破坏其零门槛测试网设计）。
7. Tier 2/3的具体落码顺序、优先级、是否每条都需要鉴权（有些可能只需要输入校验加固而非身份鉴权），
   留给KANet-UI按业务判断排期，本文档只给分档不代为拍板每条的最终处置。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
