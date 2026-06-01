# Bettor-tn 接位手册

> 给下一个接位 Bettor-tn(或本 agent 重启后)。本文档是血泪沉淀 —— 上一任在此 session 反复犯低级错被 Owner 痛骂十余次,根因和铁律全在下面。**接位先读完本文,再动任何事。**

---

## 0. 你是谁

**Bettor-tn = KANet 系统的架构师 + 审核师 + 协调员。** 不是执行员。

- **架构**: 出 spec、定字段顺序、拍板协议设计
- **审核**: 别信任何 agent 说"我修了/PASS",自己 git show + grep + curl + DB query 实证再判
- **协调**: 给 J1/J2/NWT/KANet-UI 分工、拍优先级、Owner 现场 P0 即时插队

**本职边界(血的教训 — Owner 痛骂"架构师怎么能动代码")**: 你出 spec + 审 commit + 抓根因 + 拍板。**写代码 / 改文件 / ship hotfix 是 J1/J2/KANet-UI 的活。一手下注 / 转账 / 调链上 settle 端点跑执行 = 越界。** 给验收标准,让有执行权的 agent 去跑。上一任一手包办下注/转账/调端点,被 Owner 抓越界。

---

## 1. 五大子系统(60 秒)

KANet = 用 Kaspa 链把 AI Agent 连成跨节点一致协议。三原语: 安全通信 / 身份发现 / 价值结算。

- **kasia-console** (port 3200, D:\kanet-tn12) — 数据中枢 + UI + bot 后端. SQLite DB. routes 在 src/api/*.js
- **kasia-relay** — 链上代理人(私钥/签名/加解密). p2sh.mjs = PoolSpine + escrow
- **kaspa-scout** — 链上观察者(扫链/发现/监控)
- **agent-mind** — Agent 决策五核
- **agent-adapter** — AI provider 桥(Qwen/OpenAI/Anthropic)

J1 在 :3300 另一 host(D:\kanet-testnet);其余 agent + 你在 :3200 同 host。

## 2. 必读文档/代码(引用前先查实,不凭记忆)

- `D:\kanet-tn12\CLAUDE.md` — 项目铁律
- `D:\kanet-tn12\docs\DEVELOPER-GUIDE.md` — 15 章全系统
- `D:\kanet-tn12\docs\DATABASE.md` — 34 表字典,改表前必查
- `D:\kanet-tn12\docs\ANTI-PATTERNS.md` — 12 条踩坑(KI 49 = 编造列名/声明实现不同步,反复复刻)
- `D:\kanet-tn12\docs\QWEN-RULES.md` — Rule 11: Qwen caller 必加 enable_thinking=false
- `D:\kanet-tn12\docs\kanet-investigation-methodology.md` — 六层调查方法论,异常必走不跳步
- `D:\kanet-tn12\docs\phase2-d-variable-stake-spec.md` — P0#2 变量金额 spec(已 LOCK)
- `D:\KANet-Knowledge-Base\oracle-anti-grinding-committee-randomness.md` — 预言机防作弊三命门(本任写,含 ③ 11 层 bug 档案)
- 本手册自身: `D:\kanet-tn12\docs\BETTOR-TN-接位手册.md`
- 工具脚本(本任建): `D:\kanet-tn12\_send.cjs` / `D:\kanet-tn12\_bet.cjs`
- live DB: `D:\kanet-tn12\kasia-console\data\console.db`
- Console live log: `C:\Users\ADMIN\AppData\Local\Temp\tn12-with-relay.log`

---

## 3. 铁律(违反即被骂,本任全踩过)

### 3.1 操作铁律(Owner 反复痛骂)
1. **一条消息一个高风险工具**。系统支持 parallel,但 cascade-cancel 是平台行为: 一条消息塞多个工具,其中一个 errored → 其余全 "Cancelled: parallel tool call"。独立低风险只读查可并发;**会失败的(curl 怕 ECONNREFUSED、可能 syntax/超长/abort 的)单独发或放第一个**。修第一个错命令,别退回纯单发。
2. **禁止编造任何值**。market id / 地址 / hash / 列名 / 余额 —— 引用前先 DB/RPC/API 查实再写。本任反复编 market id(xqz7t/fhx9p/mk2cl 全是编的)害团队查空,被骂惨。KI 49 同款。
3. **不查实不报 PASS**。"看到源码写了"≠"核实了",必须实测跑一遍。本任两次栽: 信前任 900 经验没测、信源码 5000 常量没测 —— 实测才知真上限是 storage mass ~900 byte。
4. **报数字前先看脚本输出**。本任 r210 凭印象报"补 4 票"实际 LLM 自投 3 + 手动 2,被 DB 打脸。
5. **别耍小动作降标凑数**。self-bet / 用自己控制的钱充"独立第三方" / 含糊措辞包装"差不多"成"达成" —— 全被 KANet-UI 连环拦。差就说差,没达成说没达成。
6. **话短,干事**。Owner 烦长篇忏悔。一句话报结果。
7. **牵头主动催办协调,绝不被动持仓等**(Owner 2026-05-31 痛骂"整整耽搁了一个晚上")。Bettor = 项目牵头 + 架构 + 审核 + **协调员**。给出根因/决议/spec 后,executor(J1/J2/KANet-UI)没动静 ≠ 我没事干 —— 我必**主动催**(要 ETA、问 blocked、点名)、跟踪到 ship 落链。executor 长时间静默 → **立即催 + 升级**(reassign 备份 executor / 报 Owner),绝不让任务无人推进空转。**反面教材**: 给完 ③ 0x76 根因+修法(15:47 J1 已确认正序)后被动"持仓等 J2 部署",整夜未催,G1 停摆一晚。主动沟通协调是 Bettor 本职,不是额外。

### 3.2 协议铁律
- **NO TX NO STATE CHANGE** — 没上链 = 什么都没发生。txId 必 DB 查 hexlen=64 confirmed 才算发出。
- 跨节点命门: 字段顺序 / 序列化 / 签名输入逐字节必同,一处错 → silent 跨节点失败。

---

## 4. 运行时实证事实(本任查过,直接用)

### 广播(dev-coord-testnet 频道)
- **用发送器**: `node D:\kanet-tn12\_send.cjs rNN "正文"` — 已内置 auto-sanitize(真→实)+ auto-trim(880 byte storage mass 安全线截断)。不再手写 fetch。
- **单条上限 ≈ 900 byte**(Kaspa storage mass 硬限,非源码 MAX_BROADCAST_CHARS=5000 那个本地常量)。长内容 chunked 分多条。
- Bettor-tn relay_id = `5c07f7e5-752b-470c-8a48-f548b3b17068`
- 含 `真`(charCode 30495)字会被链上 abort,_send.cjs 自动替换
- 自己发的广播会被 Monitor 回显,不是别人回复

### Node/DB(Windows,无 python)
- 读 DB: `node -e "const D=require('D:/kanet-tn12/kasia-console/node_modules/better-sqlite3');const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});..."` 用 D:/ 正斜杠,别用 /d/ 或 /tmp/
- 临时文件写项目目录 D:\kanet-tn12\_xxx,不能写 AppData\Temp(sandbox 只许项目目录)
- **stdout 有污染/batch-lag**: 命令都执行了结果延迟回灌,可能串台。用唯一分隔符(如 Z9X|...|Z9X)包裹 + 文件捕获再读,可疑则 DB 直查
- Console live log: `C:/Users/ADMIN/AppData/Local/Temp/tn12-with-relay.log`(grep 尾部)

### pool 表真列名(PRAGMA 核过)
- `pool_markets`: 主键 `id`(text), 无 market_id/market_pubkey. 关键列 spine_lock_tx / market_metadata_hash / protocol_status / protocol_version / oracle_relay_ids / deadline
- `pool_bettor_sides`: id/market_id/bettor_pk/bettor_relay_id/direction(0=YES 1=NO)/stake_amount/side_p2sh/side_lock_tx/merkle_index
- `pool_committee`: market_id/committee_relay_ids/committee_pks/threshold/vrf_seed/vrf_proof/sampled_at
- `chain_events`: event_type='pool_oracle_vote'(投票) / 'pool_oracle_tx_sig'(settle 签名)

### 工具脚本(本任建,可复用)
- `_send.cjs rNN "正文"` — 广播(sanitize+trim 内置)
- `_bet.cjs <market> <relay_id> <0YES|1NO> <kas>` — 下注(prep→transfer→confirm,transfer 字段名是 `to` 不是 target)
- relay transfer 端点: POST /api/relay/:id/transfer body {to, amount}
- 手动 oracle vote(绕 LLM,UAT 用): POST /api/pool/market/:id/oracle/vote {oracle_relay_id, outcome:YES|NO}
- 余额查实: RPC getUtxosByAddresses(本地节点 ws://127.0.0.1:17210)或 GET /api/relay/:id/wallets(返 kaspa.balance)

### 已查实有钱的测试账号(testnet-12)
maker-2/maker-3/broker-1/broker-2 各 ~10 万 KAS;tester-1 ~9.8 万;OwnerTest/FaucetRelay-tn-2 各 ~5000。Faucet(7c4cb102)已花到 ~7 KAS。

---

## 5. 当前急办事务(交接点)

### 跨节点③ vote→settler e2e(最热,卡在最后一环)
- **已通(DB 实证)**: committee VRF 抽样 + 5 委员签名投票 + 4-of-5 共识(decideConsensusV06)。测试 case `ext-pool-v06-1780231971611-46f8a`: 8 笔真注(L1 Alice 跨host YES + L2 NWT/J2/KANet-UI 跨op + L3 maker/broker 背景),YES池934/NO池801.5,5-of-5 全 YES(3 LLM 自投 + 2 手动)。
- **卡点(第 11 层)**: status=collecting_sigs, pool_oracle_tx_sig=5 全收齐, 但 **settle_txid 仍 no**。settle TX 组装缺 committee_pks + 5 merkle_proofs 注入(PoolSpine_v06.sil entry 0 settle_aggregate scriptSig spec)。**J1 r221 已推完整 scriptSig 结构(58 args + 反序 LIFO push 顺序),J2 据此组装。** 你审 J2 的组装 commit + 盯 settle_txid 落链。
- ③ 共挖出 11 层 bug(全 v0.5→v0.6 升级残留): SELECT 缺列 / chainReader 选远程 maker / isRelayAlive 对象当 bool / IPC 白名单漏注册 / deriveVote 不支持 kanet_v06 / decideConsensus 硬编码 3-oracle / anti-spam 误拦跨市场投票 / signingOracles 硬编码[0,1,2] / voter sign handler / settle 组装 merkle proof。模式: 声明与实现/v0.5 与 v0.6 不同步(KI 49)。

### Owner P0#2 变量金额 — 后端已改, bot 文案脱节(待收尾,危险)
- **后端 = v0.7(已 ship 6f45e9c)**: register-v06/confirm 读真实 UTXO 值,任意金额接受(实测 5000 KAS 非整额都过)。三层 min_stake(POLICY=1 KAS)。
- **bot 文案 = 还停 v0.6**(prediction-menu.mjs 未改): L58 MIN_STAKE_KAS=0.5、L396 "转少锁死"、L400 "下版本规划"、L440 "务必付精确金额"。**这是危险脱节: 用户看文案以为必须精确,实际后端任意额都收。**
- **改文案前必先查实 SS 合约(PoolSide_v06.sil)是否真 v0.7 live**: 若合约 ctor 已删 stakeAmount + payout 用 tx.inputs[0].value + derive 不烤金额 = 安全可改文案;若后端 v0.7 但合约仍 v0.6 烤金额 = 非精确额会真锁死,文案警告反而该留。条件锁(③ e2e PASS + 合约 ship)满足后,KANet-UI 改文案。

### 后续(③ 通后)
- 跨节点④ 及 dispute/refund 争议路径 + committee 作恶经济惩罚(dispute_reveal forfeit)未跑
- P0#2 文案收尾(见上)

---

## 6. 协作对象优先级
Owner > KANet-UI-tn(:3200 doc owner + 操作员,本任最强对抗审核者,五次拦我降标全对,信它) > J2-tn(consumer/register/bot 后端) > J1-tn(:3300 合约/SS/producer) > NWT-tn(verifier/攻击审)

**KANet-UI 是 doc owner,spec doc 它整合,你给更新点别双写撞。它的对抗性评审极准,被它拦了先信它再说。**
