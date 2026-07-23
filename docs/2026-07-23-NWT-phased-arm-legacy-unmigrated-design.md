# 分阶段 arm — legacy-unmigrated 过渡机制设计（NWT·Bettor 派设计 blast-radius 解）

> **Status**: DRAFT（2026-07-23 · NWT）· 待 Bettor 方向审 + Owner 知情（arm 语义·不可逆相关）。
> **起因**: NWT blast-radius 点破——armed=on 后收敛类零鉴权路由（pool.js 18 建市/下注/oracle + relay :1726/:504 + trading action，批C 只标 TODO 未真迁移）origin 缺失 → authorizeCommand fail-closed 拒 → live pool/relay/trading 钱路全断。Bettor 认账三关框架遗漏，选 (C) 分阶段 arm。
> **目标**: armed=on 保护已迁移 app 面（envelope 授权），同时**不断** live 收敛类路由，直到它们逐步迁移。

---

## 🔴 红队第一原则：绝不用"origin 缺失→放行"

朴素 (C) = "armed 后 origin 缺失就放行收敛类" = **重开 gate 本要堵死的 fail-open**：任何攻击者/新未迁移路由/被剥 origin 的命令都 origin 缺失 → 放行 = 授权闸形同虚设。**必须用显式正向 tag，缺失仍 fail-closed 拒。**

## 机制：第 5 个 origin 值 `legacy-unmigrated`

origin 四值 → 五值：`internal`（daemon TCB）/ `operator`（专道）/ `app`（envelope）/ **`legacy-unmigrated`（收敛类过渡·暂放行）** / 缺失·非法（fail-closed 拒）。

**1. 收敛类路由显式打 legacy tag（非留缺失）**：批C B桶（pool18/relay:1726·504/trading action）的 sendCommandAsync call 从"无 origin"改为 `origin='legacy-unmigrated'`。这是**显式声明**，不是缺失。

**2. gate（authorizeCommand·armed）分支**：
```
internal          → allow（daemon）
operator          → operator 专道
app               → verifyAppEnvelope
legacy-unmigrated → allow + LOUD warn（记 migration debt·每次放行 log）
其余/缺失          → deny fail-closed（不变——真未标命令仍拒）
```

**3. shrink-only lint（migration debt ledger）**：新 lint 规则枚举 `origin='legacy-unmigrated'` call 点，**跨 commit 计数只减不增**。新代码**禁止新增** legacy tag（新路由必须直接 app/operator/internal；企图新增 legacy=lint block）。既有 legacy 逐条迁移出（改成 app 信封 / operator 专道）时计数减。

**4. LOUD 可见（防静默永久化）**：`armReport()`/健康探针暴露 legacy-tag 存量计数 + 最近一次 legacy 放行时间戳。非零 = 迁移未完 = 声明的残留零鉴权面（不静默）。

**5. 诚实安全含义（必须写死·上报 Owner 带）**：
- armed+C **保护**：已迁移 app 面（origin=app envelope 授权）+ operator 面 + **堵未标命令注入**（缺失仍拒——新未迁移路由/剥 origin 攻击 → 拒，不放行）。
- armed+C **不保护**：legacy 面（pool/relay/trading 收敛类仍存量零鉴权·origin=legacy→放行），直到迁移。
- **legacy tag = 迁移债记账 marker，非安全控制**。目标 shrink 到零。

## 红队自审（refute 自己的设计）

- **攻击者直接发 origin='legacy-unmigrated'？** origin 是 Console 侧 sendCommandAsync 形参权威设置 + else delete 防 command 伪造。app（场景-A）碰不到 __origin（Console 侧设）。攻击者要 legacy 放行只能走一个 Console 侧打 legacy tag 的收敛类路由=该路由今天就是零鉴权=**无新增暴露**（arm 前它就能被打）。✅
- **场景-B（被攻陷 Console）随意打 legacy？** Console 是乙路 conceded TCB，本就能设任意 origin（含 internal）。legacy 不增场景-B 暴露（Console 全信任下已 game over，抗场景-B 归 R）。✅
- **无新增 fail-open**：只显式 legacy tag 放行；真缺失仍拒。新未迁移路由（没打任何 tag）→缺失→拒（逼新代码声明 origin，不静默放行）。✅ 这是与朴素 (C) 的关键区别。
- **legacy 永久不迁移？** shrink-only lint + LOUD 健康 + 债记账缓解；**残留风险（诚实标）**：无硬 ratchet 则纪律依赖——建议 Owner 定迁移目标/deadline（如收敛类全迁 by 某里程碑）。
- **收敛类 tag 遗漏（某路由仍缺失）→ armed 时拒→断**：所以 legacy tagging 必须**穷尽覆盖收敛类集**（= 我完整清单 pool18+relay:1726·504+trading action；别名 8 已是通信标 app/internal 不在此集）。arm 前跑 lint 核收敛类全打 legacy、无遗漏（同批C 穷尽纪律）。

## 与 arm 前提整合

- 原三关（②批C 标注 + ①app provision + ③provision）**+ 第四关：收敛类全打 legacy-unmigrated tag（穷尽）+ shrink-only lint 上线**。
- arm 决策（Owner 拍）带诚实 caveat：**armed 保护 app 面，收敛类面仍存量零鉴权（legacy 放行）待迁移，迁移债 = N 处，LOUD 追踪 shrink 到零**。
- 迁移路径（post-arm，渐进）：每把一条收敛类路由从 legacy 迁到 app 信封/operator 专道 → legacy 计数减 → 债降。全迁完 = legacy tag 归零 = 收敛类面授权闭合 = 真 arm-complete。

## 落码（待批准后）

1. authorize.mjs：origin 五值分支加 `legacy-unmigrated → allow + warn`（缺失分支不动）。
2. 收敛类 call 点（pool18/relay/trading）：`origin='legacy-unmigrated'`（替 TODO）。
3. lint 新规则 R-LEGACY-ORIGIN-SHRINK：legacy tag 计数 baseline + 只减不增（新增 block）。
4. armReport() 加 legacy 存量计数。
5. harness 补一条：armed 下 legacy 命令放行（+warn 留痕）、缺失命令拒——验分支正确。

**关联**: `docs/2026-07-23-NWT-m0c-1-complete-list-alias-exchange-mindmgr.md`（收敛类穷尽）、`docs/2026-07-23-NWT-m0c-1-per-route-classification.md`（§9 收敛类面）、`kasia-relay/src/lib/authorize.mjs`（origin 分支）、NWT app provision GREEN（arm 前提）。
