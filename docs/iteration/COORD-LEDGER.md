# COORD-LEDGER — 多 agent 协调主账(OIL-v0.3)

> 按 OIL-v0.3 §8.4 建:**频道=传输层,本 Ledger=状态层。频道滚走,状态活这里。**
> 协调 agent:Bettor(全执行域 read-only 结构锁)。回写分级:关键决策/关2关3/§11决议必沉淀。
> **接位文档(`C:\开发过程\…\开发智能体接位\*-接位.md`)= 稳定层,零烤状态;当前进度只读本文件。**
> 最近刷新:2026-06-23(断电后接位重整 + Owner 今晚总账对账)。

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
- ⚠ **口径**:Track C 既验证(脆)又解锁(active),≠ production-ready。spike plan:`docs/2026-06-23-track-c-zk-spike-plan.md`。
- ⬜ NEXT:spike 续(待排期,非当前主线)。

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

## 集成 / 部署态(git 真相,Bettor 对账 2026-06-23)
- **master** tip `ca7e0a66`:含核心 bshard/oracle wave1 LIVE 码(经 bshard-m3-deploy sync)。
- 🔶 **未进 master(feature ref / 在途)**:D4 loaders(`origin/j1-d4-loaders` aace8f39)/ tg-wallet(`origin/kanet-ui-tg-wallet` df2a9b34)/ **faucet per-IP 修 + bot.mjs custody = uncommitted 工作树**。
- ⬜ 择机 merge 进 master + verify-ship 收齐"GitHub 完整含今晚码"。J2 部署待。

## ESCALATIONS / 待 Owner 裁
- `FAUCET_AMOUNT_KAS` 5→10k?(需 Owner + faucet relay 余额前提)
- polymarket-UMA 实现切片派工时机 + owner 归属(生死线,优先级最高待 Owner 拍节奏)。
- B/C broker 公开自助注册 auth 硬化(banked,production 前)。

---

## 归档(已收敛旧线,留索引)
- **scale-test backend-20**(2026-06-10):干净 demonstrate 20 并发 settle,框架 §10.2/§9.3 活案例。已收敛。
- **tg-bot-web-user-e2e**(§14 首个受控运行):演化为线 3 可玩 demo。
