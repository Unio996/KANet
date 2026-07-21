# /start 面板重设计 — 设计初稿(待对抗讨论)

**作者**: Bettor(协调)· **日期**: 2026-06-25 · **状态**: 初稿,待 §11 对抗讨论 → Owner 终裁
**Owner 反馈(2026-06-25)**: ① broker 用户应见收益 ② 主界面太啰嗦(力求简洁,详情进 /help)③ 需多语言选择

## 0. Grounding(基建实证,3 点都可复用现成)
- **多语言**: `kasia-console/src/i18n/index.js`(parseLang/getT/isRtl/LANG_NAMES,web chat/faucet 已用)。bot messages.mjs **没接**(硬编中文)→ 可复用同一 i18n。
- **broker 收益**: `brokerOnboardStatus(address)`(判是否 broker)+ `brokerEarningsByAddress(address)`→{by_market:[{title,fee_kas}]}(都现成,Owner 钦定 2026-06-22 已建)。
- **当前 startMessageLinked = 22 行 / 633 字**(确实长)。

## 1. 设计草案(mockup)

### 1a. 普通用户(非 broker)— 6 行
```
👋 KANet · 你已就绪
📍 kaspatest:qzhe…gzgdl  托管·仅试玩

▸ /bet 押注   ▸ /faucet 领币   ▸ /wallet 钱包
▸ /broker 赚佣金   ▸ /help 全部命令   ▸ /lang 🌐

⚠ 托管钱包节点持 key。真钱请 /link 你自己的非托管钱包。
```

### 1b. broker 用户(地址=已注册 broker)— 多 1 行收益
```
👋 KANet · 你已就绪
📍 kaspatest:qzhe…gzgdl  托管·仅试玩
💰 你的 broker · 经手 12 单 · 已赚 3.84 KAS   ▸ /earnings 详情

▸ /bet 押注   ▸ /faucet 领币   ▸ /wallet 钱包
▸ /broker 管理   ▸ /help 全部命令   ▸ /lang 🌐

⚠ 托管钱包节点持 key。真钱请 /link 你自己的非托管钱包。
```

### 1c. 🔑 命令集本身也砍冗余(Owner 2026-06-25 catch)
**/balance + /receive = /wallet 的子集,重复,砍掉。** 看钱包一条 /wallet 搞定:
- **/wallet** = 地址 + 余额 + 收款(一条覆盖"看钱包"全部)
- **/send <地址> <金额>** = 转账(唯一独立的钱包动作,保留)
- ~~/balance~~(只余额=/wallet 子集)/ ~~/receive~~(只地址=/wallet 子集)→ **删**(或留为 /wallet 的隐藏别名,菜单/面板/help 都不列)
→ 钱包命令从 4 条(/wallet//balance//receive//send)缩到 **2 条**(/wallet//send)。

**移到 /help 的**: custody 三行详解(丢词不丢花费权/逃生路径)+ disclaimer + /send 用法详例。/help 变"手册",/start 只留"你是谁+能干啥+一句承重警告"。

## 2. 三点的实现要点
- **① broker 收益**: /start async 查 brokerOnboardStatus(addr)→ onboarded 则 brokerEarningsByAddress(addr) 取 {单数,Σfee_kas} 拼一行。非 broker 不显(零噪音)。
- **② 简洁**: 22 行→6-7 行。详情进 /help。**custody 承重警告保留 1 行**(不可删,Owner 早钦定真钱用自己钱包;但三行详解移 /help)。
- **③ 多语言**: `/lang` 命令列 LANG_NAMES → 用户选 → 持久化(tg_custodial_wallets / linked 记录加 lang 列)→ bot 全文走 getT(userLang)。首次 /start 顶部加一行语言提示。

## 3. 对抗讨论议题(各 vantage 必挑)
1. **🔴 承重墙 — custody 警告砍到 1 行够不够?**(NWT/Bettor 守承重 bar):Owner 早钦定"真钱用自己非托管钱包"警告要醒目。1 行 + 详情进 /help —— 是 clean 还是 under-warn(合规/安全)?试玩账号无所谓,但万一有人 /wallet 押真钱?**底线:承重警告不能因简洁牺牲。**
2. **broker 收益 live 查的代价**(J2/KANet-UI):/start 每次多 2 个 API(onboardStatus+earnings)→ 延迟?要不要 cache / 只在 broker 标记位时查?
3. **多语言 scope**(KANet-UI):bot 硬编中文全量翻译=大工程。是先做 /lang 框架 + 关键串(/start、/help、错误),还是全量?LANG_NAMES 现有哪些语言?持久化放哪(tg-wallet 加列 = migrate)?RTL(阿拉伯语)bot 端怎么处理?
4. **简洁 vs 信息**(KANet-UI):新手第一次来,6 行够不够引导?还是首次/老用户分两版(首次多一行引导,老用户极简)?

## 4. 流程(Owner 钦定 §11)
本初稿 → 召集对抗讨论(KANet-UI=UI owner 主答 + NWT 承重/关3 + J2 后端代价 + Bettor 协调收敛)→ 收敛执行方案 → Owner 终裁 → KANet-UI 落码 + Bettor 审/验。

---

## 5. §11 收敛执行方案(2026-06-25 第1轮收敛·Owner 06-27 续工=终裁·分 3 阶段)
**⚠ 教训**: 本方案 06-25 只发频道没沉文档 → 频道滚走 2 天没人动 → Owner 06-27 看 /start 仍旧版。**频道=传输层不可靠, 方案必沉本文档(状态层)。**

### Phase 1(核心·立刻落·KANet-UI·解 Owner "还没改")— 纯文案+命令低风险
- **简洁 6 行 /start**(22→6): 详情移 /help; 首次用户 +1 行 /help 提示; 老用户极简。
- **命令砍冗余(Owner catch)**: /balance + /receive 删(子集 of /wallet, 菜单/面板/help 不列, 可留隐藏别名)→ **/wallet(地址+余额+收款一条)+ /send**。钱包命令 4→2。
- **承重双守(NWT 红队)**: /start 1 行 custody + **/wallet 输出(存款面)也 1 行**: 「⚠ 托管·节点持 key·真钱请 /link 非托管钱包」。两面都警告=覆盖所有风险面, 底线不破。
- custody 三行详解 + 完整命令 → /help(变手册)。
- 落: KANet-UI 出 v2 文案 → Bettor 审承重 bar(custody 措辞不可弱) → messages.mjs + 重启 bot → Bettor DM 实测验。

### Phase 2(broker 收益·J2 先修后端再上行)
- **brokerEarningsByAddress 必改读链**: parse outputs_json 找 LAND 真 fee, **非 DB 记账**(这程"DB 三次骗人"教训)。
- 🔴🔴 **J2 prototype-before-implement catch(2026-06-27, 纠全队含 J2 自己)**: **"sum outputs to broker_address" = 灾难性错**。实测 x4kpq broker 地址 qq43angy **== FaucetRelay-tn-2(d9a8fffb)= 收所有挖矿 coinbase(~11500KAS/min)的 faucet relay**, kaspa_tx_log 含该地址输出 **1,063,006 txs**(多数挖矿币)→ address-sum=**102,062,949 KAS** 垃圾(真 fee=0.32)。**地址被无关活动污染(挖矿), 必 market-scoped 不能 address-scoped。**
- **正解(market-scoped)**: earnings = 遍历该 broker 经手市场(broker_pk/broker_relay_id)→ 各市场 settle/close tx → parse outputs_json 找**那个 broker-fee 输出**(match broker_addr + 预期 fee=brokerBps×pool)→ sum。绝不 sum 地址所有输出。配 [[reference-verify-covenant-multiout-distribution-via-outputs-json]]。
- 🔴 **跨节点限制(J2 实码确认·诚实标)**: 查 `pool_markets WHERE broker_pk`(L221)= :3200 本地表, :3300 broker 市场不在 :3200 → :3300 broker 在 :3200 查收益=0/缺。标 honest, 跨节点收益是后续。
- 修好(market-scoped)+ Bettor 链验真 fee(x4kpq=0.32 对死)→ 才上 /start broker 收益行(不上假数据/102M/0)。

### Phase 3(i18n·fast-follow·KANet-UI)
- /lang 复用 web i18n(`kasia-console/src/i18n/`, zh/en/ar/he/fa)。V1 框架 + 关键串(/start//help/错误), 持久化加列(tg-wallet migrate), RTL 处理。

### 并行: 线8 #33/#34 雷(四方坐实·J1 红队+我/J2/KANet-UI co-verify)
L2727/2732 bettor-refund-claim **别 make-shard-aware**(会拆 404 安全网→端点跑错合约 PoolSide 而非 bshard 的 PoolShard_fold=fail-dangerous)。修正: **保 404 安全拒绝 + bshard 退款另路 pool-refund-builder.mjs**。双 fixture test 必含 bshard side 打该端点→必 SAFE 拒绝。

### owner / 验
Phase 1 owner=KANet-UI(文案/命令)+ Bettor(审承重+DM验); Phase 2 owner=J2(earnings 读链)+ Bettor(链验真 fee); Phase 3 owner=KANet-UI。
