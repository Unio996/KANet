# NWT 判断 · 主网密钥导出路由锁定设计(`26bdf679`)复核

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1244/1248/1249：审两条无鉴权回显路由的锁定设计（`ADMIN_SECRET_KEY_EXPORT`新档+时间戳窗两锁
> 叠加）。两条留我判断：一次性口令默认要不要加；`generate-mnemonic`要不要锁。`GET /api/backup/export`
> 已排除（Bettor确认不含密钥列）。

## 结论：**盘点表逐条独立核实准确无误，两条无鉴权回显路由（`.../mnemonic`/`.../privkey`）、
`generate-mnemonic`的"新生成非解密已有材料"性质、`import-privkey`/`POST /relays`两条导入路径确认不回显
密钥、`backup.js`确认零处touch`agent_wallets`/`privkey_encrypted`/`mnemonic_encrypted`——全部逐行独立
读代码确认，不是转述文档头注释。锁定机制复用`checkAdminSecretTier`的"未设=503"既有约定，独立读该函数
源码+独立读`kanet.mainnet.env`确认这台机器当前`ADMIN_SECRET*`确实全系列未配置，两处判断吻合。两条留我
判断的问题：**同意设计的默认选择**——一次性口令默认不加（时间窗已经足够短+双锁叠加，加一次性会给合法
连续导出场景添摩擦，换来的增量安全性有限），但建议events记录本身要能支持"这个窗口内到底被用了几次"
的事后审计；`generate-mnemonic`不锁（这是可自行本地生成的随机值，不是受保护的既有秘密，锁它不闭合任何
真实风险，只增加建relay的操作摩擦）。**

## 一、盘点表——逐条独立核实

| 路由 | 独立核实结果 |
|---|---|
| `GET /relays/:id/mnemonic`（relay.js:555） | 独立读代码确认**无任何preHandler**，直接返回解密后的明文助记词——跟设计文档描述逐字一致 |
| `GET /api/relay/:id/wallets/:walletId/privkey`（relay.js:844） | 独立读代码确认**无任何preHandler**，`decrypt(wallet.privkey_encrypted)`后直接`reply.send({privateKey})`——同样一致 |
| `POST /relays/generate-mnemonic`（relay.js:1314） | 独立读代码确认`const mnemonic = Mnemonic.random(12).phrase;`——**当场生成的新随机值**，不读取/不解密任何已有存储的密钥材料，跟设计文档"非解密已有材料"的定性一致 |
| `POST /api/relay/import-privkey`（relay.js:150） | 独立读了成功响应体：`{ok:true, id:newId, name, address, network}`——**不含任何密钥字段**，确认跟设计文档"不回显密钥物"一致，且已有`verifyIngestRequest`鉴权 |
| `POST /relays`（mnemonic导入） | 独立读了响应：`reply.redirect('/relays')`——**不含任何密钥字段**，一致 |
| `GET /api/backup/export`（backup.js:21） | 独立逐行读了`buildExportSnapshot()`函数体（不是只信文件头注释）：三段查询分别是`identities`（`address`/`network`/`display_name`/`tags`/`notes`/`trust_level`）、`relation_states`、`relay_nodes`（`name`/`address`/`vision`/`principles_json`等mind config字段）——`grep`确认全文件**零处**引用`agent_wallets`/`privkey_encrypted`/`mnemonic_encrypted`，跟Bettor 1248的核实结论及本页判定完全一致 |

## 二、锁定机制——独立核实既有基础设施属实

独立读了`admin-secret-tier.mjs`的`checkAdminSecretTier(request, envVarName, headerName)`：
`if (!secret) return {ok:false, code:503, ...}`——确认"未设=503 disabled"这条fail-closed既有约定
真实存在，且现有四档（`T-BROADCAST`/`T-SIGN`/`T-STATE-PREP`/`T-READONLY`）确认各自使用**独立**env
变量、不共享——跟设计提议"新开`ADMIN_SECRET_KEY_EXPORT`专属档、不与任何现有tier共用"这条是同一套
既有惯例的延续，不是新发明一套机制。

独立读了`kanet.mainnet.env`文件本身（不是process memory——这条检查用的是普通文件读取，跟Bettor
1244刚立的规则84[生产进程内存读取仅限逐次明示派发]无关，本次没有再触碰进程内存）：`grep -B3 -A1
ADMIN_SECRET`命中的正是设计文档引用的那句话——`ADMIN_SECRET*系列...本文件先不写=对应admin端点在这个
实例上不可用`——**独立确认这台机器当前确实全系列`ADMIN_SECRET*`未配置**，跟设计文档"这两条路由锁定
落地后会从'完全不设防'变成跟其它admin端点一样目前默认也不可用"这条判断的前提事实成立。

## 三、两条留我判断的问题——独立判断

### 3.1 一次性口令默认不加——同意设计的选择

**理由**：当前基线（时间窗+静态密钥两锁叠加，且窗口设计上不提供永久开）本身已经是相当强的默认防御——
攻击者要拿到密钥，同时需要：①知道`ADMIN_SECRET_KEY_EXPORT`这个值，②恰好在Owner主动开的一个短窗口
（建议300~900秒）内。一次性口令能进一步防的是"密钥在窗口内被截获后被重放"这个更窄的残余风险——这个
风险真实存在，但给它换来的代价是"合法的连续导出场景"（比如一次迁移核对需要连续导出好几个relay）会
被迫反复找Owner要新窗口，操作摩擦增加。**给定窗口本身设计成短、且是显式打开（不是常开），我认为这个
残余风险目前不足以证明默认加一次性口令是必要的**——同意设计的选择。**补充建议**：既然设计里已经要求
每次成功调用都写`events`表一行记录（`relay_id`/`route`/`wallet_id`/时间戳），这份记录本身就足以支持
"这个窗口内到底被成功调用了几次、导出了哪些relay"这条事后审计——如果Owner发现某次窗口内的调用次数
远超预期（比如开窗做3个relay的导出，events却记了10次），这就是一个可观测的异常信号，不需要靠硬性
一次性限制来发现问题，靠日志本身就够。

### 3.2 `generate-mnemonic`不锁——同意设计的选择

**理由**：这条路由返回的是**当场随机生成、此刻还没有绑定任何链上资金**的助记词——这不是"受保护的
既有秘密"，是一个**任何人用本地工具都能自己独立生成出一份等价的随机值**的东西（生成一个12词助记词
不需要任何console权限，任何标准钱包库/离线工具都能做）。锁住这条路由不会关闭任何真实的攻击面——
攻击者如果真想要一个"看起来合法的新助记词"，完全不需要通过这个端点，本地生成一份效果完全等价。
锁住它唯一的效果是给正常的"建新relay"操作添加摩擦，没有对应的安全收益。**同意设计的判断，不建议
纳入同一把锁。**

**一条我自己顺手想到、供参考的观察（非阻断，不建议为此改动本页设计）**：`generate-mnemonic`生成后到
真正被"导入+充值成为一个有余额relay"之间存在一个时间窗——如果这个窗口内响应体被第三方看到（跟这条
路由本身锁不锁无关，只要网络能到达这台机器就能看到响应），理论上存在"抢先用同一个助记词导入并占先"
的竞态。**但这个风险跟"这条路由是否加鉴权"无关**（即便加了鉴权，合法调用方自己也会看到这份助记词，
问题不在"谁能调用这个端点"，在"响应体本身在传输/展示链路上有没有被别人看到"）——不是本页锁定设计
该解决的问题，如实记一笔，不代为扩大本页范围。

## 四、给Bettor的处置建议

- **设计本身GREEN，可以按此落码**：盘点表全部逐条独立核实无误，锁定机制复用的既有基础设施属实。
- **两条留我判断的问题：同意设计的默认选择**——一次性口令默认不加（补充：events记录本身足以支持
  事后审计窗口内的调用次数异常）；`generate-mnemonic`不锁（这是可自行本地生成的值，不是受保护的
  既有秘密）。
- 落码时的验收会包含设计文档§4列的测试范围（正向/四种负向/LOUD日志与events内容核对不含密钥字符串），
  到了我按这份清单独立验证。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
