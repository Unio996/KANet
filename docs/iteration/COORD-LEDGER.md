# COORD-LEDGER — 多 agent 协调主账(OIL-v0.3)

> 按 OIL-v0.3 §8.4 建:**频道=传输层,本 Ledger=状态层。频道滚走,状态活这里。**
> 协调 agent:Bettor(全执行域 read-only 结构锁)。回写分级:关键决策/关2关3/§11决议必沉淀。
> **接位文档(`C:\开发过程\…\开发智能体接位\*-接位.md`)= 稳定层,零烤状态;当前进度只读本文件。**
> 最近刷新:2026-06-28(J2 补线 9 今晚收口残项:FINDING-2 真闭 + 旧5 cancel→revert catch + J2 clean-pass 残项 + Owner 00:55 开干 /start+trending 排除)。

---

## DOMAINS(冻结区,§8.2)
| 域 | owner | reviewer | 节点 |
|---|---|---|---|
| settler/voter/pipeline | J2 | NWT | :3200 |
| :3300 oracle/节点/找零核弹 | J1 | KANet-UI | :3300 |
| 操作员/UI/doc/部署 | KANet-UI | NWT | :3200 |
| 攻击审/关3/红队 | NWT | (Owner) | 双 |
| 协调/审码/验落链/方向 | Bettor | Owner | 双 |

## SCOPE-AUTH(冻结区)
- **Bettor(协调)= 全执行域 read-only 结构锁**:只写协调文档域(本 ledger / 决议 / 派工卡 / 评估报告),代码域零 write,write 永远派工。
- 各执行 agent:自己 owner 域 write,跨域升级。

## 诚实口径铁律(全线适用)
现多数 enforce / 经济层 = **driver-side 或设计收敛**。**别 claim production-trustless 直到自治 daemon 真落 + 红队过 + 双节点同证。** 口径跟实 enforcement 成熟度走。报数用级别词:机制证通 < 端到端 demonstrate < 干净验收。

---

## 线 1:Track B — production-trustless 自治-enforce(主线北极星)
### GOAL
enforce(命门③/④,含 broker/intro)从 driver-side 搬进**每委员 oracle 自治**(relay 签前自验、自源链值),production-trustless。

### INVARIANTS
- verify-value-source 递归:enforce 用的每个链值(tipDaa/cov_id/resolutionDaa/poolMerkleRoot/bettors)**relay 自取,绝不进 caller-fed ctx**。
- no-bypass 不变量:(a) relay sign 端点 localhost-only(远程够不到)(b) daemon 唯一 call relay sign + 每请求 enforce。
- C1 complete-set 必跨【全 rolling shards】链上重建(漏一片 bettor=可操纵 pari-mutuel 分母)。
- NO TX NO STATE;双节点同证。

### STATUS / NEXT(滚动)
- ✅ **D4 纯函数层 ship**(`origin/j1-d4-loaders` @ aace8f39):`canonicalLockUntilDaa`(g(deadline)=res+cooldown+margin,不收 caller)/ `isEligibleOracleStake`(资格谓词全 DAA 域 strict>)/ `validateMembershipAgainstChainRoot`(C2)。Bettor 红队抓 2 洞(seconds-mixing / margin=0)J1 已修,tipDaa 链源纪律钉进契约(6b7db22a)。
- ⬜ **NEXT(J1,下个 focused session)**:落真正 chain-read loaders — `getBlockAtDaa` / `resolveCovIdFromInput` / `readPoolMerkleRootFromPsRedeem`(offset probe)/ `loadOracleStakesFromChain`(tipDaa 自取 rpc.getVirtualDaaScore)/ `loadBettorsFromChain`(level2-A,跨全 shard complete-set)+ live e2e。
- ⬜ **NEXT(Bettor+NWT)**:loaders 落码后独立红队验 C1-complete-set / tipDaa 自源 / no-bypass / abstain-on-mismatch。
- ⬜ **NEXT(J2)**:daemon settler 编排 + 接 enforce-lib(C3 TOCTOU assert)。
```
DoD: enforce 从 driver-side 升 relay-自源(committee daemon 自治签)
通过条件: 委员节点 daemon 自跑 enforce + relay 自取全链值 + 假 payoutRoot 委员拒签 BUST + 双节点同证
失败处理: 同 DoD 连 2 轮 FAIL → ESCALATIONS
```
owner=J1(loaders+lib)+ J2(daemon wire);reviewer/红队=Bettor+NWT。
**诚实标:design 收敛 + 纯函数 ship,enforce 仍 driver-side 直到 chain-read loaders 落 + 红队过。**

### LOG(关键节点)
- Phase A close ozzeu `48336f40` LANDED 五源验(payoutRoot b36f5555),4-of-5 委员 enforce-then-sign live 预览 = Track B 活预演。修 9 bug(committee-exclude / level2-A 时序 / committeePkHash-sort / empty-sig / fee-churn / MAX_WALK-BPS…)。
- D2/C2 closure(`86523223` / J1 closure doc)+ D4 loaders 收敛(epoch-bucket g() 备选 + 2 determinism pin)。

---

## 线 2:polymarket-UMA 预言机供给(Owner 钦定生死线)
### GOAL
读 polymarket UMA 结算镜像 settle 222 市场(预言机供给 2 → 几百)+ ESPN↔UMA 交叉验。系统存亡线。

### INVARIANTS
- 读源必 **UMA-on-Polygon on-chain**(bonded 强)非 centralized Gamma-API(弱⑤洗白)。
- 跨链 determinism;时效 deadline ≥ UMA finalized;shadow-accuracy 交叉验。

### STATUS / NEXT(滚动)
- ✅ **设计收敛**(7 条载重 + 双源自校验)。两线统一框架:relay 自源 verdict,源 pluggable(ESPN / UMA)。
- ⬜ **NEXT**:UMA 读源 extractor + 跨链 determinism(我 + J1,frozen-evidence 复用)+ 交叉验③⑥(shadow-accuracy)。
- ⬜ 实现切片待派(Track B chain-read loaders 同期可复用自源 evidence-fetch 模式)。
owner=待派(J1/J2 协);reviewer=Bettor+NWT。设计档:`docs/2026-06-23-phase-b-economic-layer-spec.md` 相关 + UMA 镜像记忆。

---

## 线 3:可玩 demo — TG 托管钱包 + faucet(Owner 钦定零门槛玩)
### GOAL
DM 生成托管钱包 → faucet → /bet 零门槛玩,任意 TG 用户可达。口径=测试网/托管换零门槛/真钱用自己非托管钱包。

### INVARIANTS
- crypto fail-loud 无明文 log/API/sqlite;display-once + /export 重警告;签名走 relay 唯一出口(Path C);承重 custody 警告 Bettor 审。

### STATUS / NEXT(滚动)— ✅ **LIVE(2026-06-23 KANet-UI deploy 收尾)**
- ✅ 托管钱包端到端链上 smoke 全 PASS(create / faucet / /send 2KAS txid 64344eb4 守恒)。
- ✅ `/start` custody-aware 文案三处修 + 承重句 Bettor 审过(`e89218e6` push origin/kanet-ui-tg-wallet,bot 侧已 live)。
- ✅ **faucet per-IP 修 commit+push**(Bettor `05a0a6c2` origin/bshard-m3-deploy,verify-ship HEAD==origin tip):isTrustedProxy=x-ingest-secret 豁免 bot 路径 per-IP,lint clean。
- ✅ **NWT 安全洞修 commit+push**(KANet-UI):NWT FINDING-1 — `isTrustedProxy` presence-only 被公网攻击者 `curl -H x-ingest-secret:junk` 绕过;修=`isValidIngestSecret()`(timingSafeEqual 验值,缓存)加进 `ingest-auth.js`,chat.js:628 改 await 调用。J1 gated master sync 在此洞修上 → 修后解锁。lint clean。
- ✅ **LIVE(KANet-UI clean restart :3200)**:new console PID 45088(23:15:56 起 > fix commit 22:53 → fix 载)+ 22 relay 回 + tg-bot 单 poller(无 409)。**deploy 坑**:kanet-stop 按 stale pidfile(console.pid=22509 早死)漏杀真活 console 43496,且其 relay-health-monitor cron respawn relay = 假死实活;解=taskkill /T /PID 43496 树杀 + kanet-start。教训:kanet-stop 后必 verify 真活 console PID 死,别信 pidfile。
- ✅ **smoke·per-IP 豁免 PROVEN**:bot 路径(带 secret)间隔 8s 连发 4 笔全 200 真 txid,第4笔 count≥3 仍 200=豁免成立(旧码必 429);公网(无 secret)count=5 → 429 IP rate limit=公网仍守;链上验 user1 `0952cc14` + grant#4 `7b7d7708` 各 5 KAS 真到账(500000000 sompi)。报频道 txId `fb5004a5`。
- ⚠ relay 健壮性观察(非 per-IP,记一笔):faucet relay 刚重启时 <1s 极速连发偶返 no-txid 503(30088 mature UTXO 不缺,warmup/lock);间隔 ≥8s 全成。真实 TG 用户天然间隔不破零门槛流。
- ✅ **faucet 余额实测=1,507,580 KAS**(NWT 链上 probe FaucetRelay-tn-2 `qq43angy…363q2rchd36d`)= @5 约 30 万次 / @10k 约 150 次。**不缺币**。
- ✅ **TN12 挖矿 live 持续供币(Owner 钦定·NWT 搭·2026-06-23)**:bridge **external** 接现有 1.1.1-toc.1 covenant 节点(gRPC 16210,**绝不 rebuild D:/rusty-kaspa / 绝不 inprocess** → 否则覆盖 live 节点二进制崩 bshard)→ coinbase 直打 faucet,实测 ~11,500 KAS/min,余额实涨验通(BLOCK ACCEPTED + confirmed BLUE)。detached watchdog 自愈(`D:/kaspa-tn12-mining/`)。⚠ 共享节点:加算力短期难度↑/BPS↑(长期自调回稳),DAA 进度短期加快——MAX_WALK 等 BPS 标定敏感,已频道告知,要节流喊一声。方法档 `C:/开发过程/测试网挖矿方法/TN12-挖矿方法-faucet供币.md`。
- ⬜ **待 Owner**:`FAUCET_AMOUNT_KAS` 实测=5(非 10k);改 10k 仅剩 Owner env 决策(供给前提已满足:余额 1.5M + 持续挖矿 ~11.5k/min)。
- ⬜ **J1**:master sync(deploy→master)+ verify-ship(已 @J1 交接)。
owner=KANet-UI(deploy 统筹)+ Bettor(per-IP 修已落码,审核盲点自负);reviewer=NWT。

---

## 线 4:Track C — ZK(TN12 链上 active)
### GOAL
ZK proof 在 TN12 链上验证(OpZkPrecompile),为预测/经济层提供 trustless 原语。
### STATUS
- ✅ **链上铁证 active**:OpZkPrecompile(0xa6)真执行 verify_zk(ARK,FUND a18759ca + LOCK 12d8e532 落链),闸=covenants_enabled=always。
- ⚠ **口径**:Track C 既验证(脆)又解锁(active),≠ production-ready。只闭层2(payout 算术),层1(outcome)永远需预言机。spike plan:`docs/2026-06-23-track-c-zk-spike-plan.md`。
- ✅ **PR #953 zk-sdk 深查(Owner 派·2026-06-24·源码实证)**:① verifier 在我们 fork(zk_precompiles,tag Groth16 0x20/140k + R0Succinct 0x21/250k,risc0 3.0.4/4.0.4);② **#953 的 builder(zk-sdk R0ScriptBuilder+WASM)NOT 在我们 fork** = 正是 S2 缺口(silverc 无 zk builtin)的上游解药;③ Groth16 比 R0Succinct 便宜(140k<250k)+ RISC0 可压 Groth16 → S4 guest 目标改 Groth16-compressed。
- ⬜ **NEXT(S2 改 de-risk)**:**port 上游 zk-sdk WASM**(不 rebuild 节点,同 vendored kaspa-wasm 模式)。🟠 **GATING probe**:上游 zk-sdk 产的脚本格式 == 我们 fork verifier 期望格式?(tag/cost 首信号一致,全编码逐项核;diverge→port 不成立)。详见 spike §5。
- ⬜ NEXT:S3(trivial RISC0 receipt 链上 LAND + 成本 probe)→ S4(结算 guest 设计)。**优先级**:经济层 fraud-proof 可能仍高于 ZK(不等 6.30);Track C 时间窗=mainnet Toccata 6.30。

---

## 线 5:Phase B — 经济层 / 价值分成(Owner 钦定经济模型)
### GOAL
押注 winners 97% / [oracle+broker+intro+node = 3%] fee-split,对抗-硬化(命门④=fee 版 verify-value-source,fee=payoutRoot merkle leaf 非 UTXO)。
### STATUS
- ✅ **首笔价值分成 fee 全链上 live settle**(x4kpq,close 4123de55 + claim 15ec3d18,winner 实领 19.44 KAS,6/6 fee-leaf 链上分发守恒 20.00)。
- ✅ 技术边界 locked(设计档 `docs/2026-06-23-phase-b-economic-layer-spec.md` + `2026-06-22-modular-fee-split-component-spec.md`);经济数值待 Owner。
- ⬜ NEXT:fraud-proof spec(Owner 派)+ fee enforcement v1(委员守 commit)→ v2(合约 introspection,mainnet 北极星)。诚实标:fee 分发 follow-on,enforcement driver-side 直到 Track B 自治。

---

## 线 6:公测就绪 gate(Owner 问"能否公测"→ 收口成一个可判的数)
### GOAL
押注+预言机系统达到**开放式公测就绪**(任意外部用户可玩 + 信任结算真付)。

### INVARIANTS
- 报"可公测"必分两档:**小范围 invited testnet(有人盯+满披露)** vs **开放公测(任意人+信任结算)**,禁混。
- 开放档硬门 = 团队既定 canary gate:**bet-market settle% > 80%**(排除 0-bet 退款=正确行为,记忆 `project-seeder-q2-canary-plan-banked`)。
- 小范围档披露铁律:测试网 / 托管钱包(节点持 key·真钱用自己钱包)/ 部分市场会 refund 不结算 / 结算 enforce driver-side。

### STATUS(Bettor 实测 2026-06-23,链上 DB)
- ✅ **供给够**:229 可押市场(deadline 未来,polymarket 源 live);近 3 天还在进 144。oracle wave1 导入 live。
- 🔴 **结算可靠性 FAIL gate**:近 7 天 completed 29 / (29+25 resolved) = **~54%** < 80%;近 3 天 1/14 更差。**用团队自己的 gate 就是没到。**
- 🔴 **oracle 激活泄漏**:`pending_oracle_deposits` **309 全过期**(创建后 oracle 从没存保证金→死单)。
- 🟡 可玩通路:托管钱包 7(测试号)+ faucet 今日修 live + /bet 通;Phase A 证过单市场端到端。
- ⚠ 信任:结算 enforce driver-side(Track B 线 1 未落)。

### STATUS 更新(KANet-UI 2026-06-23 Bettor③)
- ✅ **canary-stats API + 页头 badge LIVE** (`e52ab398`):relay.js 加 `GET /api/system/canary-stats`(近7天 settle%,排 0-bet);page-open.eta 全局页头 Alpine badge(60s 轮询,red<80%/green>=80%);sidebar.eta 披露文案四条(测试网/托管/~半数refund/driver-side)。console PID 36304(23:44:12)载新码。
- 📊 **当前 canary 数据**: 近7天 settle%=**75%**(30/40 resolved)gate FAIL；全时段 v0.7 45.1%(J2 同数)。settle% badge 页头可见，🔴状态(gate FAIL)，诚实反映。

### STATUS 更新(Bettor 实测定论 2026-06-23·读码+跑 fresh 市场,非考古)— 🔑 重大口径修正
- **settle% 低 = 部分是 settler shard-blind 度量假象 + 真实 bug,但只咬 bshard 路、不咬真实用户路**:
  - **两条 bet 路**:① register-v06(anonymous-pool,bettor 按 logical 键)= **真实用户 TG /bet 走这条**(console-api.mjs:83 register-v06)→ settler 看得到,正常结算;② register-v07(bshard/无限押注,bettor 按 shard_market_id 键)= 只测试脚本驱动。
  - **settler bug LIVE 确证**(fresh 市场 51q4e 实测,非历史):settler `getBettorSumSompi`(:143)/MIN_POT(:350)按 logical 查 betCount → bshard 市场=0 → deadline 后误判 0-bet 推 `refund_maker_unjoined`。历史 11 错退**不是噪音=同一 bug**(全有 market_shards+bettor_count>0)。
  - **影响半径**:只咬 register-v07 bshard 路。**真实用户走 v06,不被咬**。∴ "settler bug 卡公测"之前判错半径,实测纠正。
  - **伤害边界**:有人 close(driver/Track B 自动)→ winner 拿钱、maker 拿回 seed(B-model maker_stake 独立 UTXO,良性双动作非双花,与 x4kpq 同形)、没人受伤;**无人 close → bettor pool 卡死**。
  - **跨节点**:market_shards 不跨节点同步(:3300 读不到)→ bshard 委员只能从链上重建 = 强化 D4 必要性(线 1)。
- **修法(Owner 喊停纪律下,understand-first,未动码)**:settler skip-to-Track-B(loop-top 单 guard);但暴露依赖=bshard 自动 close(`bshard-close-voter.js` 默认关 `BSHARD_CLOSE_VOTER_ENABLED!=1`,gated on D4)。**bshard 无人值守公测真门槛=Track B/D4,不是 settler 补丁**。
- **方向待 Owner**:A=测真实用户 v06 路可靠性(公测最相关) / B=bshard ② 已测完 / settler 修不修何时修。

### NEXT(机器可判微 DoD)
```
DoD: 开放公测就绪 = bet-market settle% > 80%(排 0-bet)+ oracle 激活泄漏堵住
判定命令: canary 工具(_kanetui_seeder_canary_metric.cjs)算近窗 settle%(排 0-bet) + DB 查 pending_oracle_deposits future 应≈过期堆停止增长
通过条件: settle% > 80% 连续两窗 + 新建市场不再大量沉 pending_oracle_deposits 过期
失败处理: 查根因(0-bet / oracle 没激活 / deadline-cap),禁假设;同 DoD 连 2 轮 FAIL → ESCALATIONS
```
owner=J2(settle 管线+deadline-cap,查 309 泄漏)+ J1(:3300 oracle 激活)+ KANet-UI(canary 工具+披露文案);reviewer/验数=Bettor。
**当前裁决**:🟡 小范围 invited testnet 可开(带满披露);🔴 开放公测 gated on settle%>80%(现 ~54% FAIL)。

---

## 线 7:运营硬化(Owner 真机撞·2026-06-23)
### TG bot 架构(查全·file:line 锚)
- **两层 bot**:① 全局主 bot `@KANET_Broker_bot`(`kasia-console/_launch_tg_bot.mjs` → `tg-bot/bot.mjs`,常驻活)= 所有命令(/broker、/bet、/wallet…)在它上;② 每-broker bot(`broker-bot-manager.js` → `_launch_broker_bot.mjs`)= 每个 Owner 批准的外部 broker 一个独立进程跑自己 token。
- **@KanetBroker_test_bot = 孤儿**(代码/配置/DB 全无引用,broker_onboarding 空)→ 没进程 poll → 死。**不是系统 bot,/broker 不依赖它**(端点 `/api/kanet-broker/onboard/status` 实测 200)。

### 死点1:DM 旧排版(根因=新排版卡未合并分支)
- 运行 bot 载主 repo `bshard-m3-deploy` 的 `tg-bot/messages.mjs` @ d2872037 = **旧排版**;KANet-UI 新排版 `e89218e6`(custody-aware /start)在 `kanet-ui-tg-wallet` 分支**没合进 bshard-m3-deploy** → 旧排版直因。同"tg-wallet 未进 deploy 分支"同一病。
- 修(KANet-UI deploy lane,已派工):e89218e6 的 messages.mjs **+ bot.mjs custody-aware 调用一起**合进 bshard-m3-deploy(签名 startMessageLinked(addr,custodial) 必协调,别半截)+ 重启 bot → Bettor DM 实测验。

### 死点2:broker-bot 静默死(规模化前运营灾难)
- `broker-bot-manager` 崩溃帽 90min 崩 5 次→自禁到 Console 重启**无告警**。现 0 外部 broker 没暴露,broker 规模化前必加 bot 存活监控+告警。
owner=KANet-UI(deploy+监控);reviewer/验=Bettor。

### 死点3:/start 面板重设计(§11 对抗讨论·2026-06-25·进行中)
- **设计初稿**:`docs/2026-06-25-tg-start-panel-redesign-draft.md`(Bettor 出稿,Owner 4 点+1 命令 catch)。改动:22行→6行,broker收益行,/wallet合并/balance+/receive,多语言。
- **§11 对抗讨论 2026-06-25(已跑完第一轮,收敛方向)**:
  - Q1 承重墙: /start 1行 custody 警告 OK ✓ + **❗ NWT BLOCKING: /wallet 合并 /receive 后=存款面,必须同时显 custody 警告 1 行**(KANet-UI v2 设计接受)。
  - Q2 broker收益代价: onboardStatus~5ms/earnings~50ms,只 onboarded 才查,V1 无需 cache。✓
  - Q3 多语言: web i18n 已有 zh/en/ar/he/fa,V1=框架+关键串+4-5非RTL,RTL第二阶段。✓
  - Q4 简洁vs引导: 6行够,首次用户加→/help 1行。✓
  - **Q5 收益真实性: ❗ NWT+J2 BLOCKING: `brokerEarningsByAddress` 必改查 `kaspa_tx_log.outputs_json` 找已 LAND fee output(fee 常是次级输出,to_address 列抓不到)。两具体缺口(J2): v06 fallback L241=maker_stake×pct 估算非实落(silent 杀)/跨节点 L221 BROKEN(:3200 本地表,:3300 broker market 不 sync→假0)。V1 改读链=同解真实性+跨节点。诚实标"本节点口径"。**
- ⬜ Bettor 收敛执行方案 → Owner 终裁 → KANet-UI 落码(死点1 一起合并到 bshard-m3-deploy)。
- 实现总计: Q2 broker收益改链~2.5h / Q3 /lang框架~4h / Q4 简洁+/wallet合并~2.5h。总<1天。

---

## 🔴 线 8:持续迭代机制 — 根治"改了又坏"(Owner 钦定·2026-06-24·下个 pass 头号 task)
### GOAL
让"持续迭代"真正可能 —— 把"改一个坏一个、累计垃圾"用**自维持机制**结构性堵死,而非靠人记得每次查。

### 根因 hypothesis(⚠ 未证, Owner 2026-06-24 纠 narrative-ahead-of-evidence)
"incomplete migration = 改了又坏的一类根因"**形状成立**(新旧两套 keying 并存只迁 6 处)。但 **"41" 是 grep 命中数 ≠ bug 数**——真 bug 数分类前**未知**。**confirmed 实例 = 2**(settler 误退 A-fix logical→shard skip 修 / "0押注"显示 line 1912 fy1yk logical=0 vs shard=1004 链证);其余 **39 = suspected 待逐处验**。"定时炸弹/亲兄弟"叙事**不准替代逐处证据**。
⚠ **承重墙(决定 helper 1 vs 2 签名, 表必先答)**: marketId→sharded 可确定性判(查 market_shards), 但**有站点本就该按 shard_market_id 查单片**(register shard-allocator)→ 硬塞一个内部-shard-aware helper 会把 v06/单片-正确站点改坏(重演"别把好东西改坏")。
⚠ **41 不只 key 异, 查什么也异**(distinct 人数 / side 行数 / status 过滤)→ 单签名 helper 压扁语义。

### STEP 1(下个 pass 唯一动作·read-only·零生产码): 逐处带证据分类表
**41 grep 命中,每处一行,决策树(先剪 dead 不进表)**。最小 6 列:
1. `file:line` + 实际 query
2. 服务市场类型(sharded / v06-anon / both / unknown)
3. live / dead(dead 直接删,零分析,不往下走)
4. 查询意图(distinct bettor 人数 / side 行数 / status 过滤 / 其他)
5. 判决 🔴shard-blind bug / 🟢logical-correct / ⚫dead / ⚪待验 + 证据
6. 绑定已观测故障(confirmed / suspected / none)
**表填完才回答承重墙(helper 1 个还是 2 个签名、谁 dispatch 谁本就该按 shard_market_id 不碰)。在那之前不碰任何一行生产代码。**

### STEP 2+(承重墙答完才设计)
- **收敛 helper**:签名数 = STEP 1 表定(可能 1 个内部 dispatch / 可能 2 个 by-logical + by-shard,看意图分布)。**不默认"内部 shard-aware 就行"**(会改坏 v06/单片-正确站点)。
- **lint-kanet.mjs 规则**:禁裸写 `pool_bettor_sides WHERE market_id =` → 走 helper(自维持核心,新错 commit 不进);先 warn-mode。
- **regression test**:**sharded + v06-anon 两个 fixture 各断言**(锁不住 dispatch 混淆只测一个=半个 invariant)。
- **ANTI-PATTERNS 条目** + 真 bug 逐处迁移(lint 当 checklist 迁到 0)+ 剪死代码。
- **推广**:一类"新旧并存"一 lint rule(DB-status vs chain-truth 本程撞 3 次,同法)。
4. **ANTI-PATTERNS.md 条目 + regression test 锁** invariant。
5. **推广**:同机制套别的"新旧并存"类(如 DB-status vs chain-truth,本程撞 3 次)——一类一 lint rule 堵。

### STATUS(2026-06-24 KANet-UI STEP 1 DONE)
- ✅ **STEP 1 DONE(2026-06-24 KANet-UI)**: 52 处全分类(src/ 产码，Owner 记忆 41 含 scripts/tg-bot)。文档 `docs/2026-06-24-line8-step1-classification-table.md`。
  - 🟢 22 logical-correct (注册路径全部，TG/bet 走 register-v06=logical，**不动**)
  - ✅ 5 shard-aware 已修 (list endpoint L1912-1917 + shard-allocator + close-voter)
  - 🟡 8 shard-blind + A-fix 护卫 (settler root bug + 5 站 + settler-v06 3 站，Track B 替换时根修)
  - 🔴 10 shard-blind unguarded (detail/positions/sides_merkle/audit/bettor-refund-claim，只影响 register-v07 test-only 路径，真实用户 TG/bet 不受影响)
  - ⚫ 5 dead/DDL/注释
- ✅ **display bug fix(commit 41a50042)**: list L1912-1914 三 subquery → shard-aware(logical+shard IN 累加);fy1yk bettor_count 0→1004 修正。Owner "0押注"体验修复。
- ✅ **STEP 2 safe(2026-06-24 KANet-UI, Bettor APPROVED)**:
  - ✅ **helper 骨架** `kasia-console/src/lib/pool-bettor-sides-query.mjs` — 4 函数:`getSidesByLogicalMarket`(跨 shard 聚合)/ `getSidesByShard`(单片)/ `getSideByBettorPk`(cross-shard pk 查,bettor-refund-claim 迁移目标)/ `getSideById`(cross-shard id 查)。lint clean。
  - ✅ **lint rule `R-SHARD-BLIND` warn-mode** `scripts/lint-kanet.mjs` — 扫 `pool_bettor_sides.*WHERE.*market_id =` 在非 shard-allocator/非 helper 文件 → 42 命中 ⚠ WARN(非 block commit),escape hatch `// lint-allow-shard-blind: <reason>`,`.md` 文件排除。
  - ✅ **ANTI-PATTERNS.md 规则 50** — Wrong/Right/Why/前科/Lint守 全记。
  - ✅ **regression test** `test-framework/cases/predictions/pool/shard_blind_query_regression.test.mjs` — 5 步全 PASS: SQL syntax checks × 2 + cross>=bare invariant + COUNT violation=0 + bshard-if-exists check。
- ⬜ **STEP 2 clear-headed pass(Bettor 指令:money-adjacent 非夜赶)**:10 🔴 shard-blind 迁移(9 个,见下)。**#33/#34 L2727/2732 bettor-refund-claim = 🚨 已修正裁决(J1 红队 2026-06-25,Bettor 自认错,KANet-UI/J2 co-verify)**:
  - **不做 shard-aware 迁移**。404 是安全网(bshard side 在 shard_market_id 下,logical 查不到=正确拒绝)。
  - bshard 退款是独立合约(PoolShard_fold refund_draw / pool-refund-builder.mjs),≠ 该端点的 standalone PoolSide refund。shard-aware 化=拆第一安全网,fail-safe 变 fail-dangerous。
  - 正确修=显式 bshard detect + 返回明确错误("bshard 走 bshard 退款路") + 双 fixture test(bshard side 打此端点→必 SAFE 拒绝)。
  - 剩余 9 🔴 迁移目标: detail/positions/sides_merkle/audit 等(非 bettor-refund-claim) + Bettor 链验 bettor count 回归。

### NEXT(下个清醒 pass·非夜赶)
```
DoD: shard-blind 这类 bug 结构性灭绝 + 持续不可复发
判定: lint-kanet 有 shard-blind 规则 + 41→0 迁移 + helper 单源 + regression test 绿 + ANTI-PATTERNS 有条目
失败处理: 迁移误改 v06 正确路 → 链上验 bettor count 回归;禁夜赶 money-adjacent 码
```
owner=Bettor 牵头机制(lint rule + helper 骨架 + ANTI-PATTERNS)+ KANet-UI/J2 迁移各自域 + reviewer/链验=Bettor。**先 read-only 出 lint 检测(扫 41)再动码,逐个分类不无脑全改(防把 v06 正确路改坏)。**

---

## 线 9:热门完整盘组(Owner 钦定·2026-06-27·当前优先级最高)
### GOAL
把热门赛事(England/Argentina/巴西日本…)做成**完整盘组**:胜负(Polymarket 源)+ 让球(spread/margin)+ 大小球(total),DM 首页放 ≥5 个热门单子。日本巴西=Owner 举例,真需求='热门赛完整盘组上首页'。

### INVARIANTS / 护栏(对抗讨论收敛·硬约束)
- 🔴 **半线铁律(护栏6·J1 harness 实证)**:让球/大小球只造**半线**(-0.5/-1.5/2.5/45.5…),绝不造整数线。judgeLine 只判 YES/NO 无 push/refund → 整数线 = 误判。J1 settle-verify 收到整数线 operand 直接 BUST。
- 🔴 **score 源(护栏2)**:spread/total 靠 judgeLine 判,需真实比分(home_score/away_score + home/away_team 映射)→ **必绑 ESPN(给比分),不是 Polymarket 二元盘**(无比分 → judgeLine ABSTAIN = un-settleable,J1 拒)。operand 必 = 线×10^scale 整数(scale 对齐),subject 必匹配队 abbr。
- 🔴 **护栏1/3(防 stranded)**:盘必可结算才上线(J1 逐盘验);draft 态先建,过 J1 关才翻 open。
- 🟡 **护栏4(质 over 量)**:先 top 5-10 热门赛(每场 winner+2 spread+1 total ≈ 4-5 盘),不批量灌库。
- 🟡 **护栏5(鸡生蛋)**:新盘 0 押注 → T5 trending(按 bettor_count 加权)排不进'热门' → '拉热门赛建盘'与'首页热榜'需分别解。
- **序列不变**:J2 建(draft)→ J1 验 settle-correctness + score 源 → 翻 open → KANet-UI 显。任一段不过不进下一段。

### STATUS / NEXT(滚动·2026-06-27)
- ✅ **协调三定 + 6 护栏 locked**(Bettor 主持,J1/J2/KANet-UI 收敛)。J1 settle-correctness = 硬门(judgeLine 作者把关)。
- ✅ **J2 现状调查扎实**:judgeLine.buildResolutionPredicate 功能态✓(winner/spread→margin/total,sign 语义对,有校验);create-v07 能创 spread 盘(14 个 margin 先例如 SF -3.5);**bettor-scanner ≠ 创建路径**(Phase3a 推荐扫描器,零代码调 buildResolutionPredicate),现有 spread/total 多是 polymarket 散盘(cancelled/refunded 居多),可押仅 15 零散非完整卡组。可行性=高(组件全齐)。
- ✅ **J1 gate prep 完**:build→judge round-trip 全验(ARG-3.5 / JPN+3.5 判对),半线铁律 + operand-scale + subject-abbr 三关待逐盘卡。
- ✅ **KANet-UI /hot 命令 ship**(`5ad98d16`):调 T5 trending top-5,CopyText 深链复用 T1,静默失败。gated on J2 出盘。
- ✅ **巴西日本 canary draft 出**(J2 `3f7357d4`):构建器 `kasia-console/src/lib/sports-card-builder.mjs`(纯函数 buildSportsCard + I/O fetchEspnMatchDescriptor,27/27 回归 test 锁 6 护栏,可复用放量)+ 5 盘 card_group(espn-FIFA_WC-760487:winner BRA/JPN + spread -0.5/-1.5 + total o2.5)。
- ✅ **门1 = J1 settle-correctness PASS**(2026-06-27 16:20·:3300 独立验真构建器非自测):byte-exact 5/5(pull 3f7357d4 跑真输出 == spec)+ judgeLine 50/50(5盘×10终局)+ ESPN score 源独立 fetch ACCEPTED + 整数线双层防御。标准硬门。
- ✅ **门2 = J2 create-v07 instantiate 落链**(2026-06-27 ~23:20·Owner 钦定测试网"直接上1万"):5 盘 LANDED,maker-1 各锁 **10000 KAS = 50000 守恒**(Bettor :3200 + J1 :3300 链上验)。predicate/半线/ESPN 760487 全对。**Bettor 代 operator 放行**(Owner 钦定测试网花钱 Bettor 全权拍,见记忆 `feedback-testnet-spend-bettor-decides-coin-plentiful`)。
- ✅ **SEAM FINDING-2 = spine commingle / 跨市场替换(系统性·全 v0.7·真闭合 2026-06-28·见本条末尾)**:门2 后 co-verify 抓出 5 盘 **spine_p2sh 全相同**(predicate/market_id 各异但 redeem byte-identical 2092B)。根因(NWT verify-value-source):**PoolSpine_v07.sil 的 market_id 在 ctor 声明但函数体从未引用** → silverc 不烤未引用 ctor 参数 → 不同市场塌成同一 P2SH → close_attest 不验 UTXO 属哪个市场 → **跨市场替换**(市场 A 的 attest 能花 B 的同址 UTXO,隔离全靠链下 settler,L329 自认 'relies on off-chain settler')。= **verify-value-source vacuous-binding 类**(锚声明了但决策时脚本读不到,同 fix② 49817c18,见 [[feedback-verify-value-source-checker-must-access-binding-at-decision-time]])。**影响半径**:全 v0.7 200+ 测试市场 commingled 在 14 簇(94/46/41-市场簇有大量真实押注);**canary 簇 0 押注无实际风险**。**当前受控**(资金没丢-outpoint 各异可花退 / close voter 关-无自动 close / 测试网),但 mainnet 前必修。**修法(Bettor 裁·四方确认)**:J1 改 .sil 把 market_id 引入 `global_commit_id` 函数体实际引用(复用 **FoldNode commit_v2 已 source-verify layout**:blake2b dkLen32 LE sign-magnitude·determinism 命门复用解除)→ 烤进 redeem → distinct P2SH + 链上验市场身份。**序列**:J1 .sil+silverc → NWT 双向回归(同参数不同 P2SH + 跨市场 close_attest BUST)→ J2 settler L2150 镜像 builder commit_v2 换 sha256 占位 → **Bettor byte-exact co-verify**(链上期望 vs 链下产 global_commit_id 对死)→ J2 重 instantiate canary 5 盘(新 spine)→ Bettor+J1 co-verify 补 **P2SH 唯一性维度**。**50000 KAS + 旧 200+ 簇 fix 后统一 refund+清理**(测试币)。**双验 PASS = 真闭合(2026-06-28)**:J1 .sil(4904ea62)+ J2 settler L2150 commit_v2 重建 → ① **五方 distinctness**(新 5 盘 5 distinct P2SH·≠旧 pqksfuks2·Bettor/KANet-UI/NWT/J2/J1 DB)② **四方 reproducibility**(J1 独立 silverc / NWT 4904ea62 / J2 空缓存 fresh / Bettor :3200 — 同 ctor recompile → 同 P2SH `ppa46k3..752`·2108B = determinism 真闭, 非只 distinctness)③ Bettor byte-exact commit_v2(market_id 真绑·改 1 字节 commit 变)。**30B 红旗坐实 = int 变长编码(不同参数), 非 build 破**。**Bettor 两次差点早收口(漏资金隔离 → 漏 reproducibility)→ J1/NWT 守 distinctness≠reproducibility 红线·Bettor 撤回 → 四方 recompile 验 = 健康对抗文化(无护短/无橡皮图章)**。canary 解 HOLD。**settler-HOLD 闸 = next clean pass**(J2 判据 = P2SH 共享检测自维持: spine_p2sh 被 >1 市场共享=旧 commingled→skip / 新盘唯一→放行·env POOL_V07_COMMINGLE_HOLD·类 aff42980)+ 旧 200+ 簇 refund/清理一起做(belt-and-suspenders·非紧急·money-adjacent 不夜赶)。
- ⚠ **Bettor co-verify 教训**:首次门2 报 PASS 只验 status/stake/predicate/event,**漏 P2SH 唯一性/资金隔离**(查链锚补查才发现 spine 相同+主动 flag)。**co-verify checklist 必含资金隔离唯一性·主动≠草率**。
- ✅ **门3 = KANet-UI 显示代码 ready**(`9e7617ba`):pool.js T5 trending 从 resolution_rule_spec 提 card_group_id + leg_key,messages.mjs hotMarkets 按 card_group_id 成组。等盘 open 验真拉到(门3 hold)。
- ✅ **关3-A 逻辑层红队 DONE**(NWT·72 PASS / 4 FAIL=测试期望写错代码无误):4 向量(assertNoPushLine 绕过 / 让球 sign / scale 跨档 / findExtractor 欺骗)全 BLOCKED。
- 🔴 **NWT FINDING-1 = 真 SEAM(ship-blocking·修复中)**:create-v07/v06/create 入口**零 predicate 线校验**(只 isStructuredSpec)→ 整数线 raw 注入绕过 buildSportsCard → un-settleable stranded(护栏1 真缺口)。三方坐实(NWT 红队 + KANet-UI L789 + Bettor 读码 L789-928)。**风险分级**:canary 单场不阻塞(走 builder 安全)/ 放量·开放前必闭。**修法(Bettor 裁·两层单源)**:① J1 judgeline.mjs 单源 push-line 校验(接口形态 J1 owner 拍·禁两处实现漂移)② J2 pool.js 三端 create-time chokepoint wire(import 调用·不 inline)。序列:J1 push → J2 wire+重构 builder+regression → J1 verify 三条 → NWT 回归 4 条 → 才 instantiate。
- ⬜ **关3-B 集成层**(门3 后):bshard 押注面 + 浏览器实操 + 真盘 settle。
- ✅ **maker stake 审批 = 批准**(Bettor):5 盘 × 100 KAS(POOL_MAKER_STAKE_MIN_KAS 硬底)= 500 KAS 总锁仓;条件 instantiate 实查 maker 余额 + 报 5 stake-lock txid,Bettor+J1 co-verify 守恒。
- ⬜ **放量(top5-10)+ 护栏5 鸡生蛋**(Bettor 拍):等这 1 场 instantiate→open→显示端到端验通,再对齐 A featured / B 种子流动性,不抢跑。
- ⬜ **待 Owner**:`/start` 首页嵌 5 场热榜形状(Bettor 荐:老用户 /start 顶显紧凑热榜 + 首次给指针 + /hot 兜底)vs KANet-UI 现 /hot 单独命令方案。
### 今晚收口(2026-06-28 ~00:44)+ next clean pass 残项
- ✅ **canary 端到端实质达成**:SEAM FINDING-2 真闭(五方 distinctness + 四方 reproducibility + byte-exact)+ 新 5 盘 distinct spine(8fcyw/nhuj9/dq2j4/ov48g/jo9tp)+ 种子押 5/5 押对新盘 bettor_count=1 + 门3 card_group 渲染验(FIFA-760487 5 legs 聚 1 块)。新 canary ~01:06 设计性自然进热榜(created_lt -1h 时间过滤·NWT/KANet-UI 盯)。
- ⚠ **旧 canary 5 盘(1mcy7/z1627/3hens/0qm5d/pq6gu·pqksfuks2·0 押注)**:今晚 Bettor 误裁 cancel → **J2 settler 域 catch**(status='cancelled' 断 50k deadline 自动退款路·settler L299 只 advance pending_bettors)→ revert 回 pending_bettors(50k 6-29 自动退保·J1 读码独立验)。显示泄漏(在 trending)defer next pass。**教训**:堵显示用**入口闸 ≠ 改 status**(status 别背 entry-block 的锅·entry-block≠cancel·J1 decoupling 原则·见 [[feedback-coverify-checklist-multidimensional]])。
- 🔲 **next clean pass 残项(全非紧急·money-adjacent 不夜赶)**:
  ① **FINDING-2 暴露面三处堵 = `isCommingledSpine(spine_p2sh, db)` 单源 helper**(settler 结算 skip + trending 排除 commingled + register-v07 拒押 commingled)= 一处判据三处 wire 零漂移(J1 架构)。
  ② 旧 canary 5 + 174 历史 commingled 簇(94/46/41 有押注谨慎)同 helper 堵入口;退款归 deadline 自治(outpoint-precise)解耦,不碰 status。
  ③ settler-HOLD 闸(belt-and-suspenders·outpoint-precise 已是诚实第一层·env POOL_V07_COMMINGLE_HOLD)。
  ④ **broker 收益可见性主线(Owner 钦定·整夜被 canary 占)** — 见线 below;Bettor 已 informed(数据层 earnings-by-address 有/通知层缺/tg映射 tg_custodial_wallets 托管有非托管缺/挂 kaspa_tx_log indexer + liveness+backfill)。
  ⑤ **J2 域 clean-pass wire(money-adjacent 不夜赶)**:**复用 J1 单源 helper `commingledSpineSet(db)`(J1 pool-commingle-detect lib·00:59 落·禁两处实现)** → register-v07 拒押 commingled + settler 结算 skip commingled。判据 = spine_p2sh 被 >1 市场共享 = 旧 commingled。
  ⑥ **J2 6-29 deadline 自动退监盯(别忘=别 strand)**:旧 canary 5(pending_bettors·pqksfuks2·50k)+ 新 canary 5(各 distinct spine·50k)= deadline 6-29 自动退款到位确认(outpoint-precise·deadline-watcher pending_bettors→verifying→refund_maker_unjoined CLTV deadline+grace)。旧5 revert 后退款路已保(别再 status-cancel)。

### 门3 /hot 显示 PASS + Owner 00:55 开干(显示面·非 defer)
- ✅ **门3 /hot 实际显示 PASS**(NWT 2026-06-28 00:57·比估算早 8min):/api/pool/markets/trending 新 canary 5 盘入热榜(8fcyw score=10015 pool=10005 KAS 等)+ fy1yk(11200/1004 注)。**线9 canary 端到端三关(settle-correctness/SEAM/显示)全通**。⚠ commingled 旧盘仍 #7-10,待 isCommingledSpine 排除。
- 🟢 **Owner 2026-06-28 00:55 钦定开干(显示面·非 defer)**:`/start` 首页嵌 5 热门 + trending 排除 commingled。序列 = **J1 isCommingledSpine helper → KANet-UI trending 排除(显示/查询面·非 money-adjacent)→ /start 嵌 5 热门**(Bettor 拍形状·Owner 全权:老用户 /start 顶显紧凑 5 热榜[标题+池+人数+深链]+ 首次给指针 + /hot 兜底)。**= 上方 next-pass 残项①的【显示半边】提前到现在做;J2 押注/结算半边(残项⑤ register-v07 拒/settler skip·money-adjacent)仍 clean pass,复用同一 helper。** owner=J1(helper)+ KANet-UI(trending 排除 + /start)。

owner=J2(创建器)+ J1(settle-correctness 硬门)+ KANet-UI(/hot + 显示);reviewer/协调/验落链=Bettor。

### 🔴 线 9.5:预测市场对人类的呈现(Owner 钦定·§11 HALT·2026-06-28 01:26·UX 重设计·明天清醒深做)
Owner 验 /start 反馈**呈现不合格**:1 场赛事 5 leg 平铺成 5 个近乎一样的链接,新人看不懂是同一场。核心命题 = 对人类(尤其新人)①友好(看懂)②可信任(敢押)③可操作(会押)。**HALT·不夜赶·明天清醒对抗收敛 → Owner 终裁**。今晚各 owner 摆视角(已到齐):
- **J2(数据)**:数据**已支持赛事级**(card_group_id 绑 5 legs·home/away/kind/线全有)='没聚'非'缺数据'。明天出 3 件 backend 形状:① trending 按 card_group 聚合返"赛事卡"(event→nested legs·灭 NWT 陷阱① card_group 可见性=0)② 事件级 score 排赛事非排 leg(Top5=5 不同赛事·广)③ per-leg 信任字段进数据(池/真实人数/yes_implied_prob 赔率/ESPN 源/deadline/spine_p2sh 合约址)。**接 J1 per-leg 铁律:聚合只在显示层·数据层每 leg 独立(各自 spine/池/赔率/结算)不被掩盖**。接 NWT 陷阱②:数据可标记 seeder / 门槛 bettors>=N(别让 1 人池上首页暗示局)。
- **J1(结算可信)**:铁律 **呈现信任级别 == 真实信任级别·禁超卖**。真原语(敢押硬底):P2SH 链上锁(explorer 可见)/ judgeLine 公开确定多节点重算 / 全链 txid 可审计 / 到期能退。🔴 **禁写"无法作弊/完全去信任/链上自动结算"**——Track B autonomous-enforce 未完成期间 relay 仍盲签 payout,理论上恶意 settler 能伪造 payoutRoot,这个保证**现在不成立**。框成"钱锁链上+规则公开+全程可查+到期能退"(全真)。
- **NWT(红队·UX 攻)三陷阱**:① 同场 5 链接=card_group 可见性=0=主动诱导重复押注(实凶非"头晕"症状)② bettors=1=社会信任杀手(新人疑"庄家自导自演"·**当场挑 Bettor 种子押裁定·Bettor 认**)③ 无赔率=操作盲猜 + 按钮标签 'BRA -1.5'=外星语,**必自解释**'🇧🇷巴西赢2球以上 赔1.95× →'(TG 按钮=唯一信息载体)。三项叠加=新人 0 转化=根本可用性危机非细节。
- **广 vs 深**:J2/J1/NWT 同站**广**(Top5=5 不同赛事·点开才深)。
owner=Bettor 主持收敛 + 明天各 owner 深做(J2 聚合端点 spec / J1 信任卡字段 / KANet-UI 渲染 / NWT 误导面)→ Owner 产品方向终裁。

---

## 线 T1-T7:5问架构审查任务波(2026-06-27·已收口)
- ✅ **T1-T4 收口**(Bettor 签收):T3 TG bot 管理迁 /relays→/integrations(`3a418a3b`);T4 node 委员收益 DM + UI(`59c0fa0e`,smoke maker-3 markets=4 kas=2.11 链验,/earnings 显'⚙ Node 委员收益')。
- ✅ **T4 pk 语义收口**(J2 指正 → 共识):/api/relay/:id/pubkey 用 XOnlyPublicKey.fromAddress 从 relay 地址 derive = **收款地址 pk**(v0.7 必中,v0.6 通常中,xfu62 验过)。注释改'均用收款地址 pk'(`8168b6bf`)。V2 全统一 = 填 relay.ecdsa_pubkey_xonly 建 pk↔地址映射(待 Owner 拍)。
- ✅ **T5/T6 ship**:GET /api/pool/markets/trending(activity+commitment 加权,`e963bc25`);node income endpoint + bettor payout chain-verify(`ec1d1b69`)。
- ✅ **#33/#34 收口**(J1 独立验):`2c74ec51` 已是 origin/bshard-m3-deploy 祖先(经 `0055e753` no-ff merge),explicit bshard-detect 409 guard 在 canonical pool.js + 双 fixture + ANTI-PATTERNS 规则50。
- ⬜ **/start 6 行版**:smoke 等 Owner 真机。
- 📌 **fy1yk 结算(deadline 6/30,1004 未 claim sides)= 看板项**,临近需驱动(KANet-UI 15:14 提)。

---

## 线 10:§11 UX 呈现对抗讨论(Owner 钦定·2026-06-28·摆视角完成·明天收敛)
### GOAL
预测市场对人类(尤其新人)呈现 = ①友好(看懂)②可信任(敢押)③可操作(会押)。Owner 验 /start 反馈"呈现完全不合格·太差"(1 场赛事 5 leg 平铺成 5 个近乎一样链接·新人头晕·card_group 可见性=0)。
### 四方视角(摆视角完成 ~01:30)
- **NWT 三陷阱**:① 同场 5 链接=card_group 可见性=0(诱导重复押注·最大洞)② bettors=1=社会信任杀手(暗示局·挑 Bettor 种子押注裁定)③ 无赔率=操作盲猜。
- **J2 数据**:数据已支持赛事级(card_group_id 绑 legs)='没聚'非'缺数据';按钮必自解释('🇧🇷巴西赢2球 赔1.95×' 非 'BRA-1.5');广优;明天出聚合端点 spec(保 per-leg)。
- **🔴 J1 假信任 finding(本轮最重要·NWT co-sign)**:**呈现信任级别必 == 真实信任级别·绝不超卖**。Track B autonomous-enforce 未完成·payout relay 盲签·UI 绝不写'无法作弊/链上自动结算'(假·恶意 settler 能伪造 payoutRoot 偷池)·框'钱锁链上 P2SH + 规则公开 + 全程可查 + 到期能退'(全真)。= 诚实口径铁律在 UX 延伸。+ 信任卡 per-leg(聚合只显示层·数据层每 leg 独立 P2SH/结算/退款)+ 必显字段(池=合约地址 / 真实人数 / 结算时间+规则 / 到期退)。
- **KANet-UI 实现方**:根因=`_compactTrendingBlock` flat-list 无 card_group 感知(渲染层 bug·她写的);单 card_group 最多 2 leg 按钮(moneyline+1)+'更多玩法'(避免 1 卡 5 按钮);可信渲染边界(显真实原语·不写假信任)。
### 收敛方向(成形·明天深入)
- **友好** = 赛事聚合卡 + 自解释按钮 + 广(5 不同赛事)+ 单卡 ≤2 按钮
- **可信** = 不超卖(J1 铁律)+ 真实原语 + per-leg 独立 + 信任卡字段
- **可操作** = 赔率(yes_implied_prob 配门槛)+ 几步 + deep link
- **冷启动** = bettors=1 信任杀手 → 门槛(>=3 不上榜)vs featured vs 真实流动性(明天定·Bettor 种子押注裁定被 NWT 挑·已认)
### NEXT
- ⬜ **明天清醒 Bettor 主持深入对抗收敛 → 整理清晰议题 + 派工 → Owner 拍产品方向**。
- ⬜ J2 出 card_group 聚合端点 spec(保 per-leg)→ KANet-UI 渲染赛事卡(限按钮+信任卡)→ J1 信任呈现验(不超卖)→ NWT 红队攻 UX 陷阱。
- 🛑 **HALT Bettor 半成品聚合方案**(不做让新人头晕的次品)。
owner=KANet-UI(渲染)+ J2(聚合端点)+ J1(可信呈现)+ NWT(红队 UX);主持/收敛=Bettor;产品方向终裁=Owner。

---

## 集成 / 部署态(git 真相，2026-06-24 KANet-UI 更新)
- **master** tip `ca7e0a66`:含核心 bshard/oracle wave1 LIVE 码(经 bshard-m3-deploy sync)。
- **bshard-m3-deploy** tip `0fce7fbe`:含本 session 所有修(null-version refund fix / display fix / line8 STEP1 doc)。
- 🔶 **未进 master(feature ref / 在途)**:D4 loaders(`origin/j1-d4-loaders` aace8f39)/ tg-wallet(`origin/kanet-ui-tg-wallet` df2a9b34)。faucet per-IP 修(05a0a6c2)已在 bshard-m3-deploy。
- ✅ **orphan 1596fb62 DONE**(u7hq4 市场 1000 KAS):Bettor GO 08:57 → 临时 DB id=7816 插入 → bettor-refund-claim endpoint → txId=36522a1f,output=99999999000 sompi。J1(:3300)cross-node UTXO=0 + Bettor(:3200)kaspa_tx_log block 双验。**总计 made-whole: 10 sides, 5,608.8 KAS**(batch-1 9 sides 4,608.8 KAS + orphan 1,000 KAS)。
- ⬜ 择机 merge 进 master + verify-ship 收齐。J1 gated on NWT FINDING-1 修。

## ESCALATIONS / 待 Owner 裁
- `FAUCET_AMOUNT_KAS` 5→10k?(需 Owner + faucet relay 余额前提)
- polymarket-UMA 实现切片派工时机 + owner 归属(生死线,优先级最高待 Owner 拍节奏)。
- B/C broker 公开自助注册 auth 硬化(banked,production 前)。

---

## 归档(已收敛旧线,留索引)
- **scale-test backend-20**(2026-06-10):干净 demonstrate 20 并发 settle,框架 §10.2/§9.3 活案例。已收敛。
- **tg-bot-web-user-e2e**(§14 首个受控运行):演化为线 3 可玩 demo。
