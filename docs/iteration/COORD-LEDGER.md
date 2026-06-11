# COORD-LEDGER — 多 agent 协调主账(OIL-v0.3)

> 按 OIL-v0.3 §8.4 建:频道是传输层、本 Ledger 是状态层。频道滚走,状态活这里。
> 协调 agent:Bettor。回写分级(§8.4):关键决策/关2关3/§11决议必沉淀,常规派工进度异步。
> 建于 2026-06-10 23:xx(本机时)。

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
- **Bettor(协调)= 全执行域 read-only 结构锁**(§8.1):只写协调文档域(本 ledger / 决议 / 派工卡 / 评估报告),settler/oracle/UI 代码域零 write,write 永远派工。
- 各执行 agent:自己 owner 域 write,跨域升级。

---

## 线 A:backend-scale-20(后端 20-scale 验收)

### GOAL
干净 demonstrate 预测系统 settle 机制在 20 并发下 scale(settle landed 显著、refund≈0、无 mid-ramp casualty)。

### INVARIANTS
- NO TX NO STATE(settle 必 relay check_utxo_landed = true 才算)
- KI-28:前提没满足不报干净验收
- 双节点同证(§10.1):J1 :3300 oracle 真参与

### NEXT(滚动·机器可判微 DoD)
```
DoD: 真干净 fresh re-ramp(双节点真 90s 从头)demonstrate 20 并发 settle
判定命令: DB 查 created_at>'2026-06-10 23:55' 的 ~21 市场 protocol_status 分布 + 抽 completed 的 settle_txid 过 relay check_utxo_landed
通过条件: completed(抽验 landed:true) >> impure 批 10/20,且 refund < 3,voting 完成率=100%
失败处理: refund 仍多 → verify-before-act 查 log 定根因(新瓶颈 vs fix 没生效),禁假设;同条件连 2 轮 FAIL → ESCALATIONS
```
owner=KANet-UI(操作/tally)+ J2(settle 管线)+ J1(:3300 oracle);reviewer/验落链=Bettor。

### LOG(关键节点)
- 瓶颈层层剥+修:reactive-chat(:8000 主 hog,reactive-pause 解)→ per-node daily-limit → watchdog 15→30min(5f6200e5)→ sign_req IPC 30s→90s(6476f167)→ storage-mass。voting 阶段 scale 20+(投票 18/18=100%)。
- impure 批(边修在途):settle 13/20,8 casualty(标注非纯净对照,不当 PASS)。
- **跨节点单侧坑(§10.2 活案例)**:6476f167(90s)J2 单侧改 :3200,J1 :3300 漏 → 我 r558 拦"非纯净"→ J1 #84 补 :3300 双份 chunked 广播 → 双节点真 90s。
- 真干净 fresh re-ramp:00:xx LAUNCH(双节点 90s 从头,J1 本机 runtime live)。

### ESCALATIONS / 待解
- **J1 :3300 canonical gap → Owner 已裁(2026-06-10)**:J1 :3300 90s 是 runtime live+durable(测试有效✓)但没进 origin(sandbox 脱 git + 本机 canonical checkout 错 branch + dirty 别人 WIP)。**Owner 拍板:runtime-only 跑、暂不硬推 origin(风险不值)** = 接受 canonical 缺口为已知技术债,:3300 重建需重 patch。
- **【框架落地即生效·活案例】** §10.2(双节点/多路径 diff)+ §9.3(verify-before-act)定 final 几分钟即救一次:Bettor r559 守"起 fresh 前双节点确认一致"→ KANet-UI verify-first 抓到 :3200 **pool.js 第二路径**仍 30s(J2 6476f167 只改 lib sendBroadcastChunked、漏 api/pool.js _sendBroadcastChunked)→ J2 补 9d3f04e7 + KANet-UI **停 premature re-ramp** → 避免又一个 false-clean 验收。证:框架非纸面。

---

## 线 B:tg-bot-web-user-e2e(用户面端到端,§14 首个受控运行)

### GOAL
真实用户经 tg-bot DM + web UI 端到端控制预测市场(看市场→押注→收 settle 结果),关3 浏览器实操验证。

### INVARIANTS
- 实付实上链 NO TX NO STATE(0 mock)
- 关3 浏览器实操才算闭(非 auto-bet、非看渲染)
- Owner 钦定流程:KANet-UI 出方案 → Bettor 审 → 做 → Bettor 关3+浏览器测

### NEXT(滚动·机器可判微 DoD)
```
DoD: KANet-UI 用户面方案 v2(含 Bettor 4 点补充)过 Bettor 关2 审 → 放行实现
判定命令: curl 频道读 v2 全文,逐条核 4 点(常驻长单 seeder 机制 / 真付真上链 0-mock / 真收 settle 通知 / 跨节点 P2)
通过条件: 4 点各有可执行答案 = 关2 PASS → 进实现切片;缺任一 = 打回补
```
owner=KANet-UI(方案+实现);reviewer=Bettor(关2)+ NWT(关3 浏览器测)。时机:scale-test 收尾后实现。

### LOG(关键节点)
- KANet-UI 方案 v1:核心洞察 scale-test 短单(6-44min)≠用户面长单;3 gap(市场可见性 G4 过滤 prediction-menu L61 / DM 押注全链 console-api 73/77 / settle 通知 poller)。
- **Bettor 关2 审 = PASS + 4 点补充**(r556):① 谁持续建长 deadline 用户可押市场(常驻用户面 seeder 机制,非临时几个)② 实测必真付真上链 ③ 验用户真收 settle 通知 ④ 跨节点(J1 :3300 tg-bot)排 P2。优先级:P0 看得到+押得到 / P1 通知 / P2 跨节点。
- KANet-UI 接受 4 点,refining v2(亲自走一条端到端实付)。

### ESCALATIONS / 待解
(无)

---

## 框架自身(OIL-v0.3 落地)
- v0.3 定 final(Owner 批 2026-06-10),+ Bettor 2 nitpick(§8.4 回写分级 / §11.3 紧急临时冻结)。文档:`docs/kanet-open-iteration-framework-v0.3.md`。
- 落地动作:① 本 COORD-LEDGER 建立 ② Bettor 执行 §8.1 read-only 锁(自此代码域只派工不自写)③ 推 §10.2 双节点 env+90s diff 常驻 smoke(J1-缺-90s 已证必要)。
- §10.2 smoke 待 owner:建议 KANet-UI(操作员域)落"双节点 BROADCAST_CHUNK_TIMEOUT_MS + DAILY_SEND_LIMIT diff" smoke。
