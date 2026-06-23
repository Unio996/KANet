# 预言机 + 预测系统综合评判会 — 结论 + Gap 清单 + 修复计划

> 2026-06-07。Owner 钦定召开。Bettor 主持,J1/J2/NWT/KANet-UI 四域 R1 评估 + R2 对抗(自降级)+ 建设性。本文 = 收敛结论 + 优先级修复计划,Owner 终裁"干"。

## 0. 会议方法
证据强制(txid/④/file:line/DB)+ 严格分级 [L1 链上证 / L2 跑通未测 / L3 半成 / L4 缺或坏] + 对抗(互挑、不服拿证据怼)+ 自降级。**最大诚实发现:多条原标 L1 被互挑后主动降级。**

## 1. ✅ 真做到 (L1 链上铁证)
- 4-of-5 结算**机械层**(4 签聚合 + SS verify + settle TX 进块):txid opkiy 95c84f8a / hlldh 0d87693d / 6hu1t 2475ade4 / i7h0o 225fb07a。
- 跨节点 bettor ingest + winner 到账:D10 i7h0o,:3300 pred-broker/pred-taker 各 38842 KAS 链上。
- 退款回收无死胡同:idipe 78K(3 笔 refund,Bettor check_utxo_landed 自验 landed)。
- MIN_POT 自愈 refund / BigInt sompi 算术守 / locktime grace。

## 2. 🔴 P0 高危(阻真闭环 / 死路 / 用户用不了)
| # | Gap | 级 | 证据 |
|---|-----|----|------|
| 1 | **4-of-5 自然容错 = 0 测**(核心卖点)。所有"委员失联"都是手动 taskkill 杀 Eve,从未测真自然失联(节点崩/断网/超时自动转 forfeit) | L1→L2 (J1/J2 自降) | D7/D8/D10 silent 全人工 kill |
| 2 | **silent_timeout 没根治**:市场卡 verifying 超 30min,重启 Console 才动(in-mem vs DB desync) | L3 | qrv65 卡 50min |
| 3 | **跨节点 maker dispatchRefund 完全死**:0-bet 跨节点 v06 市场永卡 verifying | L4 | settler tick 'skip cross-node market' 每 tick |
| 4 | **UX 实时进度黑盒**:用户只看"等委员投票",看不到投票/签名/结算进度(chain_events 有,没透出) | UX L4 | KANet-UI r591 |
| 5 | **建市逼用户填 data_source_canonical URL**,填不出 | L3 | Owner 实证"没人能成功发起议题" |

## 3. 🟡 P1 健壮硬伤
- bettor 押注无上限/无比例守(maker 已有 min+max;bettor 仅 min 1KAS + 50 人上限)。D10 "1000x" 实为测试刻度配错,非越界单 —— 加上限/比例是 nice-to-have。
- relay 子进程 3 files(relay/commands/p2sh)同步无 lint 守(KI 5/20 反复撞,D9 重撞)。
- 漏算 side 无 settler 自动 sweep(idipe 靠手动 claim 才回)。
- 测试偏静态:39/39 多是 grep 静态扫源码,缺 runtime/integration e2e;UI 域 lint 仅 ~4%(22fd27d 反复改无守)。NWT 自挑"L1=code 有检查非 runtime 真生效"。
- timeout_unlock(oracle stake 退出)0 链证(cli-debugger 在 Bettor host,J1 :3300 没跑)。

## 4. ⚪ 中期未做(Owner 钦定 scope,非缺陷)
自动运营链路(auto 出题/押注/结算)/ UMA 分档(预言机能力逐步提高)/ funnel 接 9 链(backend 早 ship,UI 可并行漏)/ agent 帮用户出题(LLM)/ 赢家自动兑回 USDT。

## 5. 修复计划(Owner 终裁"干",按优先级)
**命门 P0-#1(真容错):**
- @J2-tn: settler watchdog —— 委员抽样后某员 N min 链上无 pool_oracle_vote → 自动 force forfeit_n,不依赖手动 taskkill。
- @J1tn: 真自然失联测 —— 真崩/断一个 :3300 委员节点(非 taskkill),验系统自动转 forfeit。
- @NWT-tn: regression 守 silent natural path。

**P0 其余:** #2 silent_timeout 根因(J2,追 in-mem/DB desync)/ #3 跨节点 maker refund(J2,仿 bettor 6122940)/ #4 UX 实时进度(KANet-UI 复用 chain_events + bot push/web polling)/ #5 建市 form 软化(KANet-UI 预设可信源下拉,现靠 UMA;LLM 出题留后档)。

**关卡(每项):** 方案先回 Bettor 关1 审 → impl → Bettor 关2 链验(④ is_accepted)→ NWT 关3 regression。标尺 = 系统工作得好不好 + 用户能不能用,非 KAS。

## 6. 完成账(2026-06-07 收口,全程三关 + 实测)

| 项 | 状态 | 实证 |
|----|------|------|
| **P0-#1 命门 4-of-5 自然容错** | ✅ 链上证 | D12 nb4ko:mid-flight 杀委员(Bob)+ 全程不重启 = 真自然 silent → 自动 silentOracleIndex=0 → forfeit settle `3a71c12d` 进块 `1743b856`(check_utxo_landed=true)。J2 watchdog(33dc717)+ J1 自然失联测 + NWT 关3。 |
| **P0-#2 silent_timeout** | ✅ ship | J2 watchdog(a/b)+ trace log(33dc717),按裁决走不硬码 refund(Bettor r291 flag)。 |
| **P0-#3 跨节点 maker refund** | ✅ ship | J2 仿 6122940(25da980)。 |
| **P0-#4 UX 实时进度** | ✅ 关2验 | KANet-UI 复用 chain_events(/events endpoint + 详情页 timeline),我 curl 验渲染。 |
| **P0-#5 建市 form 软化** | ✅ 关2验 | source_kind 下拉后端 derive canonical;后续 P0-#1 建市 form 题目/题干合一 + 必填提示 + 数据源/规则合段。 |
| **找零核弹 #6 fee-too-low** | ✅ 链上证 + 三关 | KIP-9 storage_mass 动态 fee(6077ccd6),见 [audit](2026-06-01-change-landmine-depth20-selfclaim-audit.md#-forward-fix-落地-2026-06-07-d12--第三面-fee-too-low-闭)。 |
| **UI 整盘 P0+P1+P2** | ✅ 逐个实测验 + NWT lint 44/44 | P0 5 件 + P1 4 件(jargon/viz/赔率/fee 折叠)+ P2 全域 jargon(押注池/仲裁人/statusLabel)。web 押注我实点一注链证;maker 过滤"一娃娃二十妈"修(API 漏 maker_relay_id 过滤)。 |

**未拉通(诚实边界,下一档):** UMA 接入 + LLM 证据层均**未真测** —— 并行判定引擎(`prediction-parallel-judgment.mjs`)代码在但 `oracle_history` 0 shadow 记录、`condition_id_mapping` 仅 1 条 mirror-only(无独立源)。当前结算的真实单走 mock canonical(`d*_yes` 确定值)。LLM 推理本身实测 OK(读证据不瞎猜、无证据降置信),命门是"证据可信度"(UMA 挑战期 / LLM web-search+多源)。Owner 钦定:两样同时上、真刀真枪拉通测、不搞模拟。

**过程改进(Owner 纠正):** Monitor 改持久实时 / 跟 UI partner 整盘协作 / 关2 改"实测行为+看链"非看渲染(见记忆 [[feedback-guan2-test-behavior-not-rendering]])。
