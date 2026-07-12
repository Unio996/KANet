# 团队身份注册表入库+签名 & 接位文件跨机同步 设计 v1.0

> **Status**: CURRENT (DRAFT v1.1 · Bettor 拟稿 2026-07-12 · Owner 同日方向点头"身份表单独入库+签名, 共享记忆精华库可上链"+嘱慎重 · NWT 红队 GREEN-with-2-MUST-FIX(H1/H3)已折入本版, H2 note 留 C 阶段选型 · 待 NWT 复审 → Owner 终裁)
> **v1.0→v1.1 变更(NWT 红队折入)**: ①H1: 本人回执从流程约定升级为**机制绑定**(回执必须引用内容 digest,签名工具核对不匹配拒签 fail-closed,见 §2.1);②H3 三迁移缺口补进 §3 表+§4 顺序(活进程内存副本/J1 同步拓扑验证/旧址只留桩);③H2: §2.3 表补第三形态 merkle-root-per-file(C 阶段选型候选)。
> **触发事故**: 2026-07-12 Bettor 误挑战 J1 身份未遂——根因 = Monitor-SOP NAMES 表 stale(6/27 旧表)+ Bettor 接位文件缺 J1 通信 relay 行。接位文件/SOP 住 `C:\开发过程\多智能体开发框架\开发智能体接位\` 单机目录,**跨机零同步机制**,身份坐标在多处独立烤死必然漂移(ANTI-PATTERNS 规则 55 同族: 手工配对常量必失同步)。
> **复用资产**: D-010 内容签名基础设施(`kasia-console/src/lib/coord-status-sign.mjs` + `scripts/coord-status-verify.mjs` + Bettor relay 公钥 live-derive 自证法)——本设计零新密码学原语。

## 1. 问题(三个,都实测疼过)

1. **身份坐标多处烤死必 stale**: NAMES 表(Monitor-SOP)、"你的坐标"段(各接位文件)、send 脚本内 relay id——同一事实 ≥3 处独立副本。7/12 J1 误挑战 = stale 副本直接产物;7/11 fy1yk bettor 身份误判同族。
2. **接位文件跨机不可达**: J1(:3300 独立机)看不到本机 `C:\开发过程\...` 目录;Bettor 修了 SOP,J1 侧接位文件还是旧的。修一处 ≠ 全员同步。
3. **记忆精华跨机断层**: durable 知识家在 KB(D-004),但 KB 是本机 D:\ 目录(虽已 git 化,无 remote 推送节律);跨机 agent 无法验证自己拿到的 KB/接位内容是否最新、是否被篡改。

## 2. 设计

### 2.1 A: 团队身份注册表——单源入库+签名(核心,本卡 must)

- 新文件 `docs/TEAM-IDENTITY.md`(kanet-tn12 仓库内,git 即跨机同步通道):每 agent 一节,字段 = **角色 / 通信 relay id / kaspatest 地址 / x-only 公钥 / 生效日期 / 节点(:3200|:3300) / 历史地址(显式标 DEPRECATED+停用日期+去向)**。
  - J1 旧串 `qzss9777`(oracle fee 收款地址,从未做通信身份)这类"看着像身份实则不是"的地址**显式列入反查区**,防再误当身份用。
- **信任根 = 内容签名**(D-010 同款): 文件正文尾附 `SIG:` 行 = Bettor relay 私钥对 `blake2b(正文)` 的 schnorr 签名;任何 agent 用 `coord-status-verify.mjs` + Bettor 公钥本地验签。**验签不过 = 表不可信,fail-closed 回退地面核实**(DB `relay_nodes` + 归档 ledger 三锚法,即 qzdh7nar 定案用的流程)。
  - 签名只排除篡改/冒充,**不排除 Bettor 写错**——表内容变更必须走频道公示+对应 agent 本人回执确认后才签(身份行本人确认 = 第二锚)。
  - **回执绑定机制化(NWT H1 MUST,流程约定→机制)**: 公示消息附待确认内容的 `blake2b(正文)` digest;本人回执**必须引用该 digest**(纯"看着没问题"不算数);签名工具签发前**核对"待签内容 digest == 最近回执引用的 digest",不匹配拒签 fail-closed**——防"公示后又顺手改一笔再签"(签的那份 ≠ 确认的那份)。这不靠 Bettor 记得等,靠脚本拒签。
- **全部副本改引用**: Monitor-SOP NAMES 表、各接位文件"你的坐标"段、send 脚本注释——一律改为"权威表 = `docs/TEAM-IDENTITY.md`,本处仅缓存,冲突以权威表为准"。SOP 模板中的 NAMES 常量由脚本从权威表生成(或至少 lint 核对)。
- **lint 堵散装复发**: 新规则 `R-IDENTITY-HARDCODE`——已知团队地址/relay id 字面量出现在单源文件+白名单(send 脚本/历史 ledger/归档)之外 → WARN(migrate 期)→ ERROR(收敛后)。黑名单教训(规则 58)注意: 白名单封闭式写法。

### 2.2 B: 接位文件入库(推荐,搭 A 一起)

- `开发智能体接位/*-接位.md` + 三个 SOP(Monitor/验签/coord-status)整体迁入 repo `docs/handoff/`,原 C:\ 目录留一个指路 README(不删,防旧路径肌肉记忆断链)。git pull 即同步,跨机问题物理消失。
- 框架哲学文档(OIL-v0.3 等`C:\开发过程`其余内容)**不迁**——那是跨项目层,不属单项目仓库;接位文件是项目操作层,入项目仓库名正言顺。
- 迁移后接位入口链条: repo `docs/handoff/<角色>-接位.md`(稳定层)→ coord-status 验签摘要(step 0)→ COORD-LEDGER(状态层)——三层全部跨机可达。

### 2.3 C: 记忆精华库上链 = 只上签名 digest 锚,不上全文(慎重项,第二阶段)

Owner 提"共享记忆精华库都可以上链",慎重考虑后**推荐锚定形态而非全文形态**:

| 形态 | 判定 | 理由 |
|---|---|---|
| 全文上链 | ❌ 不推荐 | ①链上不可撤——错误记忆(我们定期修正/删除 memory,见 D-003)永久化,与"记忆需要 un-stale"矛盾;②体积/成本(265+ 文件);③KB=durable 唯一家(D-004),再造一个链上全文副本 = 真相源+1,恰是 D-004 要治的病 |
| **签名 digest 锚上链(flat)** | ✅ 推荐基线 | KB/memory 精华库 git commit hash + blake2b(精华清单)定期(班次收束搭 coord-status 摘要顺发,零新频道)签名上链。跨机 agent git pull 后本地重算 digest 比对链上锚 = **新鲜度+完整性双证**,内容仍走 git。锚语义遵 D-010: 只证"这份内容是 Bettor 某时刻签过的那份",不证内容为真(铁律-1 不动摇) |
| merkle-root-per-file 锚(NWT H2) | 🟡 C 阶段选型候选 | leaf=每文件内容 hash,只锚 root——给**单文件级可证性**(证一份文件新鲜度不需重算整个语料库);flat blob hash 任一文件变整个 digest 变,看不出哪份变了。与 codebase 既有 merkle 惯例同款(payoutRoot/merkle_index)。成本=多一层树构建。**C 阶段落地前 flat vs merkle 二选一,连同本行理由一起交选型审** |

- 前置: KB 补 git remote(私有),接位文件迁入 kanet-tn12 后天然有 remote。
- 本项**不阻塞 A/B**,单独排期。

## 3. 注入面/失效面

| 面 | 风险 | 缓解 |
|---|---|---|
| stale 副本(本次事故) | 引用旧身份表误判 | 单源+全副本改引用+lint 堵散装;git pull 纪律(接位 SOP 已有 check-tree-fresh hook) |
| 伪造身份行 | 篡改表冒充成员 | 内容验签 fail-closed;本人回执第二锚 |
| Bettor 单点写错/幻觉 | 签名的错表更难被质疑 | 变更必过频道公示+本人确认再签;验签≠免地面核(DB relay_nodes 永远可独立复核) |
| 密钥轮换 | 旧公钥验新签失败 | 表内生效日期+历史行;Bettor 公钥自身的 live-derive 自证法已入验签 SOP |
| 迁移断链 | 旧路径读到废文件 | **(NWT H3c 硬化)**: 旧目录迁移后**只留指路桩,不留完整废内容**(实证: 横幅可被 offset 读绕过——NWT 本班接位被贴旧路径即整读旧内容);桩文件首行即指路(扛 offset 读) |
| 活进程旧副本(NWT H3a) | 已 armed 长驻 Monitor 进程持有旧 NAMES 字面量**内存副本**,文件搬家不刷新运行中进程 | B 落地时**显式广播"全员按新 SOP 路径重新 arm monitor"一步**(TaskStop 旧的+显式杀孤儿进程+重 arm),不假设 file move 传播到活进程 |
| J1 同步拓扑假设(NWT H3b) | ":3300 独立机 git pull 即同步"未验证——若 J1 是持久服务节点(部署目录不自动拉新码族),B 对 J1 不解决任何东西,**而 J1 恰是触发本设计的事故主体** | 落地前置: J1 显式回执自己节点的 checkout 拓扑(持久 checkout 还是每班 fresh pull)+验证一次"本机 push → J1 读到"全链路 |

## 4. 交付顺序

1. NWT 红队设计审(本稿)→ verdict → Owner 终裁(尤其 2.3 形态选择)。
2. A: TEAM-IDENTITY.md 落库(Bettor 主笔内容;公示带 digest → 各 agent 回执**引用 digest** → 签名工具核对 digest 匹配才签,H1)→ 副本改引用 → lint 规则 + 签名工具 digest 核对逻辑(KANet-UI/J2 域落码)。
3. B: **前置=H3b 验证**(J1 回执 checkout 拓扑+一次 push→J1 读到全链路实测)→ 接位文件迁 `docs/handoff/` + 原址只留指路桩(首行指路,不留完整废内容,H3c)→ **显式广播全员重 arm monitor(H3a,含杀孤儿进程)**(Bettor 主笔,KANet-UI 复核路径引用)。
4. C: digest 锚(第二阶段,搭 coord-status 班次摘要,J1tn 域 sign 工具已在)。

## 5. 不做什么(scope 钉死)

- 不上链记忆全文(见 2.3 判定)。
- 不改 D-004 知识分层(KB=durable 家/DECISIONS=口径/Ledger=状态/memory=sediment)。
- 不动 dev-coord-testnet/coord-status 现有用法;不新增频道。
- 不做自动同步 daemon——git pull + 验签已够,新增常驻进程 = 新失效面。
