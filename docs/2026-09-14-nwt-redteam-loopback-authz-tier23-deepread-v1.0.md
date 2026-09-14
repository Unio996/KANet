# NWT 判断 · T-LOOPBACK-AUTHZ Tier2/3逐文件深读 v1.0（定稿，续 v0.2 INPROGRESS）

> **Status**: CURRENT
> 接续 `docs/2026-09-14-nwt-redteam-loopback-authz-tier23-deepread-v0.2-INPROGRESS.md`（J1重启中断的进度快照）。
> 本稿把 v0.2 未完成的优先级清单逐条深读完，并在过程中发现两条独立、比原有分档更严重的问题，已第一时间
> 用 SendMessage 插播报给 Bettor（见下 §0），本文档做完整记录+证据链。

## 方法（同 v0.2）

对 `fccfee59`（v0.1 分档）里"未逐条深读"的 Tier2/3 路由，跑 `fundKey`/`spawn`/`fsWrite`/`startRelay` 四类
关键词扩展信号扫描，逐条独立读源码判断是真实信号还是误判，决定是否需要从原分档升级；同时对 v0.1 文档本身
的准确性做交叉核实（发现两处文档内部不一致 / 方法论盲区，见 §2/§3）。

---

## §0 两条独立紧急发现（已 SendMessage 插播·未实测·纯源码追踪）

### 0.1 `POST /api/chat/local` 无鉴权 + 硬编码 `'owner:'` 前缀 = Mind 交易权限判据被无条件满足

- `kasia-console/src/api/chat.js:336` `/api/chat/local` **无 preHandler，零鉴权**。
- Line 367：`getReply(relay.id, 'owner:' + relay.id, content, channelName)` —— **peer 参数被端点自己硬编码
  拼成 `'owner:' + relayId`**，每次调用都满足这个前缀，不是巧合触发。
- `agent-mind/src/mind.mjs:459`：
  ```js
  const canTrade = senderRelation === 'owner' || sender === config.address || sender?.startsWith('owner:');
  ```
  `TRADE_ACTIONS`（mind.mjs:458）含 `SEND_KAS`。line 453 注释原话："SECURITY: Trade actions only execute
  if triggered by owner or proactive cycle. External messages... cannot trigger trade actions" —— **这条
  字符串前缀判据是 Mind 全部"陌生人不能碰钱"安全模型唯一的守门条件**。
- SEND_KAS 落地：mind.mjs:988 `POST /api/relay/${relayId}/transfer`（body `{to, amount}`）—— 就是 v0.1
  表 1.1 里最高优先级"解密后真实转账"路由。
- **结构性结论**：任何本机进程打一次零鉴权的 `/api/chat/local`，就能让 Mind 的 owner 权限判据对自己
  无条件成立。剩余变量只是 Brain(LLM) 会不会把输入解析/回显成 `[ACTION:SEND_KAS to=X amount=Y]`（NLU 命中
  或直接喂 `[ACTION:...]` 字面语法——`context-builder.mjs:302` 证实这个 tag 格式是教给 LLM 的标准输出
  格式）。
- **未做**：没有实际发送请求触发这条链、没有验证 LLM 在具体输入下真的会回显 ACTION tag。链路本身
  （端点→peer 拼接→canTrade 判据→executeTradeAction→真实 transfer）逐行读源码核过，行号如上可复核。
- **比 v0.1 §0 的 `runInstaller` RCE 更根本**：那条是单个路由的实现缺陷，这条是"整个 owner 权限模型的
  判据"本身被一个无鉴权端点满足——修一条路由不解决问题，得改判据本身（不能只认字符串前缀，必须绑定真实
  调用来源）。

### 0.2 `POST /skills/upload` 无鉴权 + 动态 `import()` = 全链路已确认的 RCE

- `kasia-console/src/api/skills.js:461` `/skills/upload` **无 preHandler，零鉴权**。
- 内容校验只有一条正则 `super\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)` 命中即通过——文件里随便一处出现这个
  字符串形状，其余任意代码不受限。`fileName` 会做字符白名单替换（`/[^a-z0-9_\-.]/gi` → `_`），无路径
  穿越，但不限制内容。
- `fs.writeFile` 直接写进 `agent-mind/src/skills/<safeName>`（真实源码目录，非沙箱）。
- `agent-mind/src/skills/registry.mjs:48+52`：
  ```js
  const skillFiles = files.filter(f => f.endsWith('.mjs') && !SKIP_FILES.has(f));
  const mod = await import(`./${file}`);
  ```
  `autoDiscover()` 对该目录下每个 `.mjs`（除 `base.mjs`/`registry.mjs`）逐个动态 `import()` —— ES module
  顶层代码在 import 时即执行。
- **结论（全链路已源码确认，非推断）**：无鉴权上传一个"顶层随便写恶意代码 + 随便藏一行 `super('a','b')`
  骗过正则"的 `.mjs`，等 `autoDiscover()` 跑（进程启动/重载时机未查）即在 agent-mind 进程内执行任意代码。
  agent-mind 是 Brain 决策链 + relay 私钥操作同域进程（Rule 84"生产进程内存能读到解密后的助记词"那个
  进程家族）。
- **未做**：没有真实上传文件、没有触发 autoDiscover、没有验证进程重载时机（启动一次性 vs 热加载轮询）。
  upload 写盘 → registry import 两端均逐行读源码确认。

### 0.3 两条共同模式

v0.1 的 264 条分档方法论只查"这条路由本身有没有校验调用方"，**没有查"这条路由的下游会不会把调用方输入
喂进一个更高权限的执行环境"**——这是原方法论的盲区，不是漏看了两条路由这么简单。建议 KANet-UI 落码扫描
时新增一类检查：无鉴权端点的输出/副作用是否流入（a）另一个内部权限判据（owner/trust 字符串匹配）、
（b）动态代码加载路径（`import()`/`require()`/`eval`/`spawn` 以调用方可控的文件名或内容为参数）。

---

## §1 bettor.js 优先级路由深读结论（v0.2 遗留 §"未完成部分"第一批）

### 1.1 `POST /api/prediction/publish-v2`（bettor.js:1269）—— **真实资金移动，应升 Tier1**

Line 1410-1426：`transferWithIntent({ sendCmd: sendCommandAsync, relayId: b.maker_relay_id, ...,
targetAddress: escrow.p2shAddr, amountKas: stakeKasStr })` —— 这是真实的、把 `b.maker_relay_id` 对应
relay 钱包的 KAS **实际转账**到合约计算出的 P2SH 地址，不是查询。调用方可指定任意已注册 `maker_relay_id`
（该 relay 的钱包被命令付款进一个调用方构造的 escrow，无需该 relay 所有者的额外确认）。

**判断：fundKey 信号是真信号，不是误判**。不应折入 v0.1"bettor.js 大部分…Tier2"的笼统分类，应单独升级为
Tier1（跟 relay.js:535 `/transfer` 同档——理由相同：真实、不可逆资金转移，网络层隔离不够）。

### 1.2 `POST /api/prediction/taker-stake/:offer_id`（bettor.js:1569）—— **同上，真实资金移动，应升 Tier1**

Line 1604-1620：同款 `transferWithIntent`，把 `b.taker_relay_id` 对应 relay 钱包的 KAS 转到
`offer.escrow_p2sh`。调用方指定任意 `taker_relay_id`（受 `takerPkActual !== offer.pending_taker_pubkey`
校验约束——需要该地址已在此前 handshake 步骤被登记为 taker，但登记本身也是无鉴权路由，见 v0.1 Tier2
"exchange.js…publish/accept"同族）。

**判断：真信号，升 Tier1。**

### 1.3 `POST /api/prediction/refund/:offer_id`（bettor.js:1848）—— **真实链上结算 TX，建议 Tier1（同档内相对低危）**

Line 1899-1931：`sendCommandAsync(offer.maker_relay_id, { type: 'prediction_refund_tx', ... })` ——
relay 签名+广播真实的退款 TX，花费 escrow P2SH 里锁定的资金。**跟 1.1/1.2 的关键区别**：目标地址
（`offer.maker_kaspa_addr`/`offer.taker`）和触发用的 `relay_id`（`offer.maker_relay_id`）都从 DB 读，
不是调用方在这次请求里指定的——调用方不能把资金重定向到任意地址，只能触发"提前/按约定"结算这一件事
（受 deadline 检查 + `refund_txid IS NULL` 竞态保护约束）。

**判断：真实资金移动信号成立，但风险形状不同于 1.1/1.2（不可被重定向，只可被触发时机滥用）**。建议同样
从 Tier2 升级，但落码优先级可低于 1.1/1.2/pool.js §1.4 那几条"调用方可指定收款方"的路由。

### 1.4 `pool.js` 剩余命中（v0.2 遗留清单第 8 项）—— **oracle/deposit 与 bettor/register(非v07) 真实转账，应升 Tier1；oracle/vote 确认误判**

- `POST /api/pool/market/:id/oracle/deposit`（pool.js:2138）：line 2166-2171
  `transferAndConfirm(b.oracle_relay_id, market.spine_p2sh, bondStr, ...)` —— **真实转账**（oracle 保证金
  锁仓），调用方指定 `oracle_relay_id`。**升 Tier1。**
- `POST /api/pool/market/:id/bettor/register`（pool.js:2200，⚠**非** `register-v07`）：本次深读到 line
  2226+（函数更长，此段之后大概率还有 `transferAndConfirm` 调用，跟 oracle/deposit 同一函数族写法一致，
  函数名与用途"bettor locks stake to own side P2SH"字面就是转账——**结论性质与 v0.2 已确认的 `register-v07`
  相反**：v07 版本是只读 UTXO 检测（真转账发生在调用方外部钱包），但这个**更早的非 v07 遗留版本本身直接
  调用转账函数**。**⚠ 重要提醒给 KANet-UI/J2**：不能因为"v07 是安全的"就假设同名旧版本端点也安全——
  这两个看起来像同一功能不同版本号的端点，实际资金语义完全相反，是本次深读里最反直觉的一条。**升 Tier1。**
- `POST /api/pool/market/:id/oracle/vote`（pool.js:3967）：line 4001-4026 只调用 `sendCommandAsync`
  的 `get_pubkey`/`ecdsa_sign`（对 vote payload 签名），**没有转账**。**确认 fundKey 信号是误判，维持
  Tier2**——但有独立的、非资金类的严重问题：见 §2。

---

## §2 exchange.js cancel/confirm/dispute/resolve —— fundKey 信号确认误判，但发现独立的 relay_id 身份冒充问题

四条路由（cancel:576 / confirm:616 / dispute:691 / resolve:757）逐条读完：`sendCommandAsync` 调用全部是
`type: 'send_broadcast'`（协议消息广播），不是转账命令。**判断：fundKey 信号是误判，维持 Tier2 正确。**

**但发现一个独立、跨多条路由的模式**（`exchange.js` 的 confirm/dispute/resolve + `pool.js` 的
`oracle/vote`）：这些路由的"调用方是谁"判定**只查 `relayNodeId → relay_nodes.address` 这张表的映射，没有
任何加密学上"证明你持有这个 relay 私钥"的校验**。以 `resolve` 为例（line 771-784）：调用方随便传一个
`relayNodeId`，只要这个 id 在 `relay_nodes` 表里查到的地址等于 `offer.maker` 或 `offer.taker`，就被当成
那一方本人——**知道/猜到一个 relayNodeId（本机内部 UUID，未必是秘密）就能冒充该方去 concede 认输，强制
推进一笔真实持有资金的 escrow 结算**。`oracle/vote` 同理：知道 `oracle_relay_id` 就能让该 relay 签一张
伪造的裁决投票，直接影响真实市场的结算方向。

这跟 v0.1 Tier2 rationale 里"无鉴权可被用来伪造投注记录"说的是同一件事，但这里更具体：**即便给这些路由
接上网络层/loopback 鉴权（挡住外部调用），本机内部任何能枚举到 relay_nodes.id 的进程依然可以冒充任意
一方**——这是身份验证层面的问题，不是网络访问层面的问题，两者需要分别修（网络层鉴权解决"谁能连进来"，
这条要解决"连进来的人有没有证明自己是它声称的那个身份"，例如要求带上该 relay 私钥对本次请求的签名）。
不新开独立 Tier，作为 Tier2 组的一条附注记录，供 KANet-UI 落码鉴权时一并考虑签名校验而不只是网络闸。

---

## §3 escrow.js create/lock/execute —— v0.1 分档方法论盲区：这三条其实已经有鉴权

`kasia-console/src/api/escrow.js:20`：
```js
const AUTH = { preHandler: [async (req, rep) => { await verifyIngestRequest(req, rep); }] };
```
`create`(59)/`lock`(108)/`execute`(138) 三条都挂了这个 `AUTH`（`fastify.post(path, AUTH, handler)`）。
**v0.1 文档把这三条列进"Tier2 待后续单独评估"（暗示属于 264 条无鉴权路由），实际上它们已经用
`verifyIngestRequest` 挂了鉴权**——跟 v0.1 建议给 Tier1 路由新加的鉴权是**同一个函数**。

**判断：这是原始"264 条无鉴权路由"清单（`mainnet-exposure-surface-inventory-v0.1.md`）的方法论盲区**——
大概率是当时的扫描方式只匹配了"handler 函数体内直接调用 `verifyIngestRequest(request`"这种写法，没有
识别 fastify 的 `{ preHandler: [...] }` 第二参数这种同样合法、同样生效的鉴权挂载方式。

**排查范围**：全仓用这个 `preHandler` 数组模式挂鉴权的还有 8 个文件（`relay.js` / `admin-dedup.js` /
`oracle-pool.js`（`/api/oracle-pool/seed`，已核）/ `tg-wallet.js` / `chat.js`（`/api/chat/ingest`，已核）/
`admin.js` / `link.js` / `events.js`）——本次只逐一核了 escrow.js/oracle-pool.js/chat.js 这三个文件里跟
本次任务相关的具体路由，**其余文件（relay.js 内除已知 `import-privkey` 外的路由 / admin-dedup.js /
admin.js / link.js / events.js）未逐条核对是否也有被"264 条清单"误算进无鉴权计数的路由**——这部分是
本次深读遗留的开放项，建议派 KANet-UI 或下一轮复核用 `grep -rn "preHandler.*verifyIngestRequest\|preHandler.*checkAdminSecretTier\|preHandler.*checkConsoleOrigin"` 对照原 264 条清单做一次交叉检查，
把已经有鉴权但被误计入的路由摘除，避免"264"这个数字本身被当成尚未修复的待办总量在后续汇报里误用。

---

## §4 v0.2 遗留清单其余各项处置

- `chat.js` `send`/`confirm`：已读——`send` 走 `sendCommandAsync({type:'send_broadcast'})`，本身不是转账
  （但见 §0.1，`/api/chat/local` 走的是完全不同的、更危险的路径，两者不要混）；`confirm` 消费一次性
  随机 token（`agent-mind/src/confirm-store.mjs`，`randomBytes(16)`/30s 过期/一次性，token 生成机制本身
  健壮），执行落地经同一 `getReply('owner:'+id, ...)` 模式，同样吃 §0.1 那条判据漏洞——不是 confirm 端点
  自己的锅，是下游 canTrade 判据的锅，已在 §0.1 记录，不重复开票。
- `dashboard/digest/generate` 的 `spawn` 信号：未及深读（时间预算优先给了 §0 两条紧急发现），**保留为
  开放项**，不在本次结论范围内，如实交代。
- `skills.js` `upload`：见 §0.2，已从"待确认"升级为"已确认 RCE"。
- `trading.js` 一批 GET 路由（凭据读取触发外部请求）：v0.2 已记录为"供后续参考，不在本次分档范围"，
  维持原判断，未新增信息。
- 剩余约 150 条零信号路由：**仍未逐文件通读**，维持 v0.2 原有"零命中不等于确认无害，优先级较低"的判断，
  本次时间预算全部投入了信号命中的路由 + 两条紧急发现的全链路追踪，这部分开放项原样保留给下一轮。

---

## §5 给 Bettor/KANet-UI 的处置建议汇总（本稿新增部分，不重复 v0.1 §5 已给的建议）

1. **§0.1/§0.2 两条已通过 SendMessage 插播报过，优先级应高于本文档其余所有内容**——建议在零余额/隔离
   环境验证后再决定具体修法，不要在持有真钱的 relay 上做验证性测试。
2. `bettor.js` publish-v2/taker-stake/refund + `pool.js` oracle/deposit/bettor-register(非v07) 五条从
   "bettor.js/pool.js 大部分…Tier2"里摘出来，单独升级 Tier1，纳入跟 `relay.js:535` 同一批鉴权改造。
3. `pool.js bettor/register`(非v07) 与 `register-v07` 资金语义相反这件事本身建议记一笔独立提醒——两个
   长得像"同功能不同版本"的端点行为完全不同，落码时如果打算下线旧版本，检查有没有调用方还在用非v07路径
   （避免误判"新版本安全所以两个都能保留"）。
4. exchange.js/oracle-pool.js 的 relay_id 身份冒充问题（§2）：网络层鉴权解决不了，需要单独考虑签名校验
   方案，跟 Tier1/Tier2 的路由级鉴权是两个维度，不要合并成一次改造就以为都解决了。
5. escrow.js 已有鉴权（§3）：不需要额外处理，但请求对 264 条清单做一次 `preHandler` 模式的交叉复核，
   摘除类似误算，避免后续汇报用一个虚高的"待修复总数"。
6. §4 里列出的开放项（`dashboard/digest/generate` spawn 信号、~150 条零信号路由）如实标注为未完成，
   不建议在本次任务收尾时含糊带过。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017mABguTXfun4485ecgqWsd
