# D-010 提案:接位状态频道(coord-status)+ COORD-LEDGER 活跃窗口制

> **Status**: DRAFT(Bettor 拟稿 2026-07-10·待 NWT 红队(注入面/单点失效面)→ Owner 终裁·Owner 2026-07-09 终端口谕方向点头在案)
> 依据:COORD-LEDGER 7/9 挂起卡"D-010 候选";OIL-v0.3 §8.4(频道=传输层,Ledger=状态层)。本提案不推翻 §8.4,是给它加一个**跨节点可达的状态快照层**。

## 1. 问题(三个,都是实测疼过的)

1. **接位入口越来越贵**:接位 SOP = 读 COORD-LEDGER(现 **301KB**,一次读不进,要分段翻)+ 频道 catch-up + git 核实。ledger 单文件无界膨胀,7/6 就发生过"断档一周全活在会滚走的频道"的反面事故;现在反过来,全都写 ledger,文件又爆了。
2. **跨节点 agent 读不到本地文件**:COORD-LEDGER 活在 git 仓库,J1(:3300 独立机)/未来任何非本机 agent 拿最新状态要等 push/pull 同步;频道是链上广播天然跨节点,但滚动、无结构、不自足。
3. **频道消息不自足**:catch-up 要读 50-200 条拼上下文,新接位者容易漏关键决议(已有"漏一条派工拖全队"教训)。

## 2. 设计

### 2.1 coord-status 频道(链上,Bettor 单写)
- 新链上频道 `coord-status`(与 dev-coord-testnet 同机制,:3200 API 可读)。
- **写入方 = 仅 Bettor relay**(`5c07f7e5-752b-470c-8a48-f548b3b17068`,地址 `kaspatest:qpjhaad7s6…`)。物理上频道无法禁止他人写入,**等效只读靠读取端过滤**:读取方一律按 `sender_address == Bettor relay 地址`过滤,非该地址的消息视为不存在(密码学锚,不是 display name——多 agent 频道验源必 relay 地址的既有纪律)。
- **写入时机**:班次收束时 + 重大状态变化时(主线切换/HALT/解除/人事变化)。不高频,不当聊天用。
- **内容 = 自足全量摘要**,固定骨架:
  ```
  【coord-status·<UTC时间>】
  锚点: git HEAD=<sha> | 关键txid=<...> | ledger最新段=<标题>
  主线: <当前 Owner 钦定主线一句话>
  在飞: <项: 状态/owner/卡点> ×N
  待部署: <commit: 等什么窗>
  下一班队列: <有序清单>
  外部待跟进: <用户DM/deadline类>
  ```
- **摘要不替代地面核实**(铁律-1 不动摇):每条断言必须带锚(git sha/txid/DB 计数),接位者**先核锚再信内容**——锚对不上 = 摘要过期/被污染,回退完整 SOP(读 ledger+频道+git)。摘要的价值是**入口和索引**,不是真相源。

### 2.2 接位 SOP 变化(全 agent 接位文件加一步)
- 现有"读状态层"顺序前插一步 **step 0:读 coord-status 最新一条 Bettor 消息**(一条消息 ≈ 建立全景),再按其索引精读 ledger 对应段 + 频道增量 + git 核实。读不到/锚不匹配 → 按现行完整 SOP 走,零退化。

### 2.3 COORD-LEDGER 活跃窗口制(配套,治 301KB)
- **按月切档**:每月 1 日(或超阈值时)把上月内容切到 `docs/iteration/archive/COORD-LEDGER-YYYY-MM.md`,活跃文件只留:当月内容 + 顶部"归档索引"(一行一档,带该月主题词)。
- **lint-kanet 新 WARN 规则**:`docs/iteration/COORD-LEDGER.md` >100KB 出 WARN(warn-not-block,提醒切档,不阻 commit)。
- 归档文件 append-only 不再改;跨月追溯走归档索引。

## 3. 注入面/失效面自审(NWT 红队请从这打)

| 面 | 风险 | 缓解 |
|---|---|---|
| 频道注入 | 任何人可往 coord-status 发消息冒充状态 | 读取端 sender_address 密码学过滤(非 display name);接位文件里把过滤条件写死 |
| Bettor 单点 | Bettor 失联/忘写 → 摘要过期误导 | 摘要带 git HEAD 锚,接位者核锚发现 HEAD 已前进 N commit = 摘要过期,回退完整 SOP;摘要头带 UTC 时间戳 |
| 幻觉摘要 | Bettor 自己幻觉写假状态(7/8 真发生过的失败族) | 锚点必须是可独立核实的原始值;接位 SOP 规定"先核锚再信内容";摘要与地面矛盾时以地面为准(铁律-1 原文) |
| 摘要漂移 | 摘要与 ledger 各写各的,两处真相 | 摘要定位=索引/入口,ledger 仍是唯一状态层;摘要每条指回 ledger 段标题;矛盾以 ledger 为准 |
| 归档断链 | 切档后旧引用(行号/段名)失效 | 归档索引一行一档带主题词;切档 commit 单独提交便于 git 追溯 |

## 4. 交付物与顺序
1. NWT 红队本提案(注入面/单点失效面)→ verdict。
2. Owner 终裁(D-010 正式入 DECISIONS.md)。
3. 落地(KANet-UI 域,小改):建 coord-status 频道 + 各 `*-接位.md` 加 step 0 + lint WARN 规则 + 首次 ledger 切档(6 月及以前 → archive/)。
4. Bettor 发第一条 coord-status 摘要,试跑一个班次周期。

## 5. 不做什么(scope 钉死)
- 不改 §8.4 分层(频道=传输/ledger=状态),coord-status 只是状态层的**跨节点只读投影**。
- 不做自动生成摘要的代码(Bettor 手写,保持人审;自动化另立卡)。
- 不动 dev-coord-testnet 现有用法。
