# /oracle + /broker(gateway) 页面重设计 — 从操作员需求出发

> Owner 2026-06-11: 两页要"完整、有效、便捷……管理编辑",从适用对象需求出发,先满足基本操作。
> 现状问题: 两页"能看不能管"——/broker 纯查看(注册/编辑无); /oracle 注册散在 /agent、无 edit。
> 设计原则: **每页 = 该角色操作员的完整控制台**,围绕操作员旅程组织(非通用 5 块模板堆信息)。

## 0. 适用对象 + 操作员旅程(需求驱动)

**两类操作员,同一旅程**:
| 阶段 | 操作员问题 | 页面该给什么 |
|---|---|---|
| 新人 | "我怎么成为 oracle/gateway?" | **注册** (未注册时最显眼的主 CTA, 一站完成不跳 /agent) |
| 在岗 | "我干得怎样? 能改什么?" | **面板**(状态/收入/声誉/在岗) + **编辑**(配置) |
| 退出 | "我想退出/改主意" | **退出/注销** |

**关键**: 页面按"是否已注册"自适应——未注册→注册流程主导; 已注册→面板+编辑+退出。不再把注册甩到 /agent。

## 1. /broker → gateway 管理控制台

适用对象: gateway operator(介绍人, 把市场连给用户押 + 收 fee)。

**① 注册成 gateway**(未注册时主 CTA):
- 选 relay → 设 fee%(默认 2%)→ 一键注册。调 `POST /api/relay/:id/role {role:'broker'}`(已带我 S1 双向互斥 + P2PK 守门: oracle relay 拒 / 非 P2PK 址拒)。
- 注册即该 relay 成 gateway(roles_json/is_dex_broker), user-facing 市场可设它为 broker(S2 已 wire)。

**② 我的 gateway 面板**(已注册):
- 收入: realized/pending(端点 earnings, J2 74f57143 读实际落链 fee + 我 ① 字段对齐 + refunded total)。**实数非估算**(gz5g7 实落 6.73 KAS)。
- 名下市场: pool_markets(状态 active/settled/refunded, 我修 pool_前缀对齐)。
- 当前 fee 配置。

**③ 编辑**:
- fee%: 改 gateway 默认 fee(**需建 relay 级 fee 字段 + PATCH 端点**, 现 fee 只 per-market; 或先只支持建市时设, 标"per-market")。
- 收款址: = relay 地址(自带, 展示)。
- DM 推荐配置: Owner 定 defer(单独切片), 此页占位。

**④ 注销**: `POST /api/relay/:id/role {role:'general'}` 撤 gateway 角色。

## 2. /oracle 仲裁人管理控制台

适用对象: oracle operator(仲裁人, 持 stake 投票裁决预测)。

**① 注册成仲裁人**(未注册时主 CTA, 从 /agent 搬来此页):
- 选 relay → 设质押额 + 锁定期(lock_until_daa, 短/长)→ 出 p2sh 付款址 → 自钱包转 stake 锁 → 完成。调 `POST /api/oracle-pool/enroll`(现成, UI 在 /agent → 搬 /oracle)。
- 注册即 is_oracle=1, 进委员池可被抽中裁决。

**② 我的仲裁人面板**(已注册):
- 状态: active/expired + 质押锁定额 + 锁定期剩余。
- 声誉: reputation/accuracy(Phase 4 累积; 现"暂无"诚实标)。
- licensed domains: Phase 3 指标自动授(**只读, 非手填** — 守 KB roles/oracle.md, Owner 不当发证官)。
- 在岗裁决: 当前参与的 market 投票。

**③ 编辑**:
- oracle_capabilities(声明可判源): **需建 PATCH 端点**(现 GAP); 或先只读标"Phase2"。
- 重新质押/延长锁: unstake + re-enroll(现机制), 或建 re-stake 流。
- 执照: 自动授不可手编(展示)。

**④ 退出**(unstake): `POST /api/oracle-pool/timeout-unlock`(现成)。条件: lock 过 + 无在岗未结算单。

**观察 context(次要, 折叠)**: 仲裁人名册 + 进行中裁决(现段 1/2, 保留但降为次要 tab/折叠, 不挤占操作员主流程)。

## 3. 复用现有(不重造) + 需新建

| 能力 | 现状 | 动作 |
|---|---|---|
| gateway 注册/注销 | `/api/relay/:id/role`(我 S1 守门) | ✅ 复用, 建 UI |
| gateway 收入显示 | earnings 端点(J2 实际 fee + 我字段对齐) | ✅ 完成中(r617-619) |
| gateway fee 编辑 | ❌ 无 relay 级 fee 字段/端点 | 🔨 建 OR 标 per-market |
| oracle 注册 | `/api/oracle-pool/enroll`(UI 在 /agent) | ✅ 复用, 搬 UI 到 /oracle |
| oracle unstake | `/api/oracle-pool/timeout-unlock` | ✅ 复用(现成) |
| oracle capabilities 编辑 | ❌ 无端点 | 🔨 建 OR 标 Phase2 |

## 4. 实现切片(基本操作先, Owner "先满足基本操作")

- **S-A gateway 注册/注销**(基本操作 #1): /broker 加注册 CTA + 注销, 复用 /api/relay/:id/role。browser 验: 未注册 relay → 注册成 gateway → 面板显 → 注销。
- **S-B gateway 面板实数**(r617-619 进行中): earnings 字段对齐 + refunded + 实际 fee + 部署。browser 验: 显 6.73 KAS。
- **S-C oracle 注册搬到 /oracle**(基本操作 #1): /oracle 加注册流程(搬 /agent 的 enroll UI), 复用 /api/oracle-pool/enroll。browser 验: /oracle 一站注册。
- **S-D 编辑**(基本操作 #2): gateway fee% 编辑(需建端点)+ oracle capabilities(需建端点)。— 评估后定建 OR defer。
- 每切片 Bettor 事先审 → 码 → 自测 browser load 看见实数/操作生效 → Bettor 事后审 + browser 复测(守 r620 测试闸)。

## 5. 待 Bettor/Owner 定

1. gateway fee 编辑: 建 relay 级默认 fee 字段+端点, 还是先只 per-market 建市时设?
2. oracle capabilities 编辑: 建端点, 还是 Phase2 defer(守 KB 执照自动授)?
3. 观察 context(名册/裁决)降为次要折叠 OK 吗?(让操作员主流程不被挤)
4. 切片优先序: S-A/S-B/S-C(基本注册+面板)先, S-D(编辑)后?
