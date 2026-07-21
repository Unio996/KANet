# D-010 提案:接位状态频道(coord-status)+ COORD-LEDGER 活跃窗口制

> **Status**: DRAFT v1.1(Bettor 拟稿 2026-07-10·**v1.0 被 NWT 红队 RED/PUSH-BACK(78161b7d),v1.1 折入全部 must-fix 待 NWT 复审**→ Owner 终裁·Owner 2026-07-09 终端口谕方向点头在案)
> 依据:COORD-LEDGER 7/9 挂起卡"D-010 候选";OIL-v0.3 §8.4(频道=传输层,Ledger=状态层)。本提案不推翻 §8.4,是给它加一个**跨节点可达的状态快照层**。
> **v1.0→v1.1 变更**:①信任根从"sender_address 过滤"(NWT finding① CRITICAL:bcast 归因=output[0] 攻击者自选,vacuous)换为**内容显式签名**(NWT must-fix (b),与 scout 归因解耦);②锚语义按 finding② HIGH 收紧(锚只证新鲜度不证正文,禁"核锚过⇒信正文"推断链);③bcast 全局归因 spoofability 拆独立安全卡(§6);④切档跨段引用禁行号(nit)。

## 1. 问题(三个,都是实测疼过的)

1. **接位入口越来越贵**:接位 SOP = 读 COORD-LEDGER(现 **301KB**,一次读不进,要分段翻)+ 频道 catch-up + git 核实。ledger 单文件无界膨胀,7/6 就发生过"断档一周全活在会滚走的频道"的反面事故;现在反过来,全都写 ledger,文件又爆了。
2. **跨节点 agent 读不到本地文件**:COORD-LEDGER 活在 git 仓库,J1(:3300 独立机)/未来任何非本机 agent 拿最新状态要等 push/pull 同步;频道是链上广播天然跨节点,但滚动、无结构、不自足。
3. **频道消息不自足**:catch-up 要读 50-200 条拼上下文,新接位者容易漏关键决议(已有"漏一条派工拖全队"教训)。

## 2. 设计(v1.1)

### 2.1 coord-status 频道(链上,Bettor 单写)+ 内容签名门(信任根)
- 新链上频道 `coord-status`(与 dev-coord-testnet 同机制,:3200 API 可读)。
- **信任根 = 内容显式签名,不是 sender_address**(v1.0 的"读端 sender_address 过滤=密码学锚"被 NWT finding① 打穿:bcast 归因取 output[0]=造 tx 者自选地址,rpc-scanner.mjs:519/light-scanner.mjs:266,任何能广播的节点可伪造;详见 NWT 红队稿):
  - Bettor 发摘要时,对 `blake2b(content)` 用 Bettor relay 私钥签名,签名+公钥标识随 payload 带上(格式:摘要正文尾部附 `SIG:<hex>` 行)。
  - **读端验签**:接位者用 Bettor relay 公钥(写死在各 `*-接位.md`,即现有"你的坐标"段那个 relay id 的公钥)验 `blake2b(content)` 签名。**验签不过 = 消息不存在**,与 tx 输出到哪个地址、scout 怎么归因完全解耦。
  - sender_address 过滤仍可留作**第一道粗筛**(减噪),但明确标注为 display-name 级弱过滤、不抗主动注入,**不承担任何信任功能**。
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
  SIG:<blake2b(上述正文)的relay私钥签名hex>
  ```

### 2.2 锚语义(NWT finding② 收紧版)+ 接位 SOP 变化
- **锚(git HEAD/txid)只证一件事:摘要不比当前 HEAD 旧(新鲜度),不证正文为真**——攻击者可把真实公开锚抄进伪正文,"核锚全过+正文全假"是真实攻击形态。**禁止"核锚通过 ⇒ 信正文"的推断链。**
- 正文的信任来源 = **验签**(证明"这段正文确实是 Bettor 写的")+ 即便验签过,正文断言仍按铁律-1 以地面(git/链/DB 原始返回)为准复核——签名只排除冒充,不排除 Bettor 自己幻觉写假状态(7/8 失败族)。摘要的价值是**入口和索引**,永远不是真相源。
- 接位 SOP 加 **step 0:读 coord-status 最新一条验签通过的消息**(一条消息 ≈ 建立全景),再按其索引精读 ledger 对应段 + 频道增量 + git 核实。读不到/验签不过/锚过期 → 按现行完整 SOP 走,零退化。

### 2.3 COORD-LEDGER 活跃窗口制(配套,治 301KB·NWT GREEN)
- **按月切档**:每月 1 日(或超阈值时)把上月内容切到 `docs/iteration/archive/COORD-LEDGER-YYYY-MM.md`,活跃文件只留:当月内容 + 顶部"归档索引"(一行一档,带该月主题词)。
- **lint-kanet 新 WARN 规则**:`docs/iteration/COORD-LEDGER.md` >100KB 出 WARN(warn-not-block,提醒切档,不阻 commit)。
- 归档文件 append-only 不再改;跨月追溯走归档索引。**跨段引用禁用行号/相对位置**("见上文 P2 收口"类),一律用稳定锚(commit sha / 日期+段标题 slug),防切档后引用漂移(NWT nit)。

## 3. 注入面/失效面(v1.1 更新)

| 面 | 风险 | 缓解(v1.1) |
|---|---|---|
| 频道注入 | 任何人可造 output[0]=Bettor 地址的 tx 伪造 sender(NWT finding① 已坐实) | **内容验签**(信任根,与归因解耦);sender 过滤降级为减噪粗筛不承担信任 |
| Bettor 单点失联 | 摘要过期误导 | HEAD 锚证新鲜度,过期回退完整 SOP;头部 UTC 时间戳 |
| Bettor 单点冒充 | 伪造摘要 | 内容验签一并解决(NWT finding③:冒充与失联同根,签名是唯一解) |
| 真锚配假正文 | 核锚全过但正文是编的(NWT finding②) | 锚语义写死"只证新鲜度";正文信任=验签+地面复核双层 |
| 幻觉摘要 | Bettor 自己幻觉写假状态 | 验签排除不了本项——铁律-1 原文:正文断言必以地面为准,摘要永远只是索引 |
| 摘要漂移 | 摘要与 ledger 两处真相 | 摘要定位=索引/入口,ledger 仍是唯一状态层;矛盾以 ledger 为准 |
| 归档断链 | 切档后旧引用失效 | 归档索引+跨段引用禁行号(稳定锚) |

## 4. 交付物与顺序(v1.1)
1. NWT 复审本 v1.1(重点:签名门方案是否立得住)→ verdict。
2. Owner 终裁(D-010 正式入 DECISIONS.md)。
3. 落地:**先签名/验签工具**(relay sign 命令+读端验签 helper,KANet-UI/J1 域,NWT 审)→ 建 coord-status 频道 → 各 `*-接位.md` 加 step 0(含验签命令模板+Bettor 公钥)→ lint WARN 规则 → 首次 ledger 切档。
4. Bettor 发第一条签名摘要,接位者实测验签通过+伪造消息验签失败(负测试),试跑一个班次周期。

## 5. 不做什么(scope 钉死)
- 不改 §8.4 分层(频道=传输/ledger=状态),coord-status 只是状态层的**跨节点只读投影**。
- 不做自动生成摘要的代码(Bettor 手写,保持人审;自动化另立卡)。
- 不动 dev-coord-testnet 现有用法。

## 6. 拆出的独立安全卡:bcast 全局归因 spoofability(非 D-010 范围,但 D-010 红队的最大副产出)
NWT finding① 的影响面**不限于 coord-status**:今天 dev-coord-testnet 的每条消息的 `sender_address` 都是 output[0] 归因=可伪。当前协调流程的韧性来自纪律而非机制——铁律-1 本就规定频道通知不是地面真相、钱路 GO 必须独立链/DB 核实,所以**已有钱路决策不因此失守**,但"看到 @J2 说 X"的日常协调信任是可注入的。
- **修法候选** = NWT must-fix (a):scout 归因改 `inputAddresses[0]`(签名者,密码学绑定),缺 input 地址 fail-loud 拒报不静默回退;合法自送广播 input==output,正常显示不破坏,但需实证历史消息兼容面。
- **立卡**:owner=J1tn(基础设施/scout 域)出半页影响面评估+diff,reviewer=NWT(已承诺复审)。优先级=正常队列(纪律层已缓解,非 launch-blocker),不阻自治化主线。
