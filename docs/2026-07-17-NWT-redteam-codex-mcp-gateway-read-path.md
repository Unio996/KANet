# NWT 红队 — Codex MCP Gateway read-path bootstrap(外部 AI 信任边界)(2026-07-17)

> **Status**: CURRENT
> **对象**: `docs/2026-07-17-codex-mcp-gateway-read-path-bootstrap-assessment.md`(cdcd8560, KANet-UI)+ 分支 `origin/agent/codex-mcp-gateway-2026-07`(实读代码, 非只审评估文档)
> **verdict**: **🟠 GREEN-with-1-MUST-SURFACE(政策层, 非代码缺陷) + 1 建议性代码加固, 第一批(本机不对外)技术上可以推进**

## 我独立核实的部分(不是重读 KANet-UI 的结论, 是自己去读了实际代码)

逐文件读了 `docs/integrations/codex-mcp-gateway.md`(设计原文, Owner 本人 `Unio996` 提交)+ `kasia-console/src/api/mcp-gateway.js`(233 行全文)+ `kasia-console/src/services/mcp-policy.js`(全文)+ `kanet-mcp-gateway/src/{app,security,console-client,mcp-server}.mjs`(全文)+ `chat.js` 完整 diff。

- **两把独立 token**: `hasValidBearer`(Gateway 侧, `security.mjs`)和 `hasValidInternalToken`(Console 侧, `mcp-policy.js`)**都已经用 `crypto.timingSafeEqual`**, 不是普通字符串比较——这批代码的作者显然已经吸收了今天 `54dd60d2`/`#7`/S1 反复撞过的同一类教训, 没有在新代码里重犯。
- **`chat.js` 防火墙未被削弱**: `isMcpCoordRelayAllowed(relayName, channelName)` 是**追加的 `&&` 条件**(`COORD_CHANNELS.has(...) && !OPUS... && !isOwner... && !isMcpCoordRelayAllowed(...)`), 不是替换或放宽既有判断; 且它要求 relay 名精确匹配 `KANet-MCP-Bot` **且** channel 精确匹配 `MCP_COORD_WRITE_CHANNELS`(默认 `codex-coord-testnet`, 不含 `dev-coord-testnet`)——**默认配置下这个新分支对 `dev-coord-testnet` 完全不生效**, 逐字符核对属实。
- **审计先写后动 + 不存明文**: `beginAudit` 在动作前插入 `outcome='started'` 行, `finishAudit` 事后更新; `mcp_audit_log` 表结构里没有 `message`/`content` 列, 只有 `message_sha256`, 发送路径审计确实只存哈希不存明文, 跟不变量⑤逐字对得上。
- **read 不依赖 relay 资金**: `channels.list`/`messages.read`/`status.get` 三个 GET 路由代码里完全没有碰 relay 余额/broadcast 逻辑, 只有 `messages.send`(POST)才会走到 `relayId`/链上广播那一段——不变量⑩(read-only degradation)代码级成立。
- **Gateway 侧 bearer 校验挂在 `/mcp` 路径的 middleware 层**(`app.use('/mcp', ...)`), 在实际 POST/GET/DELETE handler 之前统一拦截, 没有"某个 HTTP 方法绕过校验"的缺口。

**KANet-UI 报的两处发现(重复白名单信任源 / mcp-gateway.js 零集成测试)我独立复核过, 属实, 同意按其建议处理(不阻塞本批, 立卡跟踪)。**

## 我自己新增的两处发现(KANet-UI 评估没有触及的角度)

### 发现①(🔴 MUST-SURFACE, 政策层非代码缺陷——这是本次红队最重要的一条)

KANet-UI 的评估把安全审查范围完全限定在"访问控制机制对不对"(token/channel allowlist/审计/资金依赖), **完全没有触及"暴露的内容本身是什么"这个问题**。我读代码确认了一个实质性事实: `kanet.messages.read` 的实现(`mcp-gateway.js` 的 `/api/internal/mcp/messages`)**没有任何时间窗口/条数上限的服务端强制**——`after` 游标完全由调用方(Codex)自己决定要不要传, 不传就从 `channel_name = ? AND status != 'local' ORDER BY created_at ASC` 的最早一条开始, 单次 `limit` 上限 100 但可以反复翻页。**设计文档 §7 canary 步骤 3 写的"Read the latest five messages"只是首次验证时的人工操作意图, 不是代码强制的边界**——一旦 Codex 真正连上, 它可以系统性地翻页读到 `dev-coord-testnet` **从建立以来的完整历史**, 不是"观察最近决策"这种轻量级说法暗示的范围。

这件事本身不是"代码写错了", 是**这个决定的分量比评估文档呈现的要重**: `dev-coord-testnet` 这条频道(我自己这个 session 全程都在这里发消息)真实装着——真实 relay 地址与资金流水讨论、**我今天亲手写过的完整可复现攻击 payload**(`#7` 围栏突破/时序侧信道细节, 含具体构造字符串)、内部错误认账与身份纠偏记录、以及大量团队内部协作细节。这些内容一旦经这条 read-path 交给 **OpenAI 运营的外部云 AI 服务**(不是"Codex 读 GitHub 代码仓库"那种性质, 是"Codex 读团队内部作战频道的完整聊天记录"), 是一个**数据治理/信息披露层面的决定**, 跟"这段 access-control 代码写得对不对"是两个不同维度的问题——代码可以完全正确, 而"要不要把这些内容给到外部服务"这件事仍然需要 Owner 在**知道具体暴露范围**(全历史, 非近期摘要)的前提下明确点头, 不能因为"评估文档说这只是 read-path 所以安全审只审访问控制"就把这一层默认为已经决定过。

**这不是要求撤销 Owner 已经做的授权决定**(Owner 本人写了这批代码, 显然是有意为之)——是指出**评估交付物本身缺了这一节**, 建议 Owner 拍板前至少明确知道: (a) 是完整历史还是可以加个时间下限(比如"只读授权时刻之后的消息", 技术上加一个 `KANET_MCP_READ_SINCE` 之类的下限并不难); (b) `dev-coord-testnet` 里过去/未来出现的具体安全发现细节(比如我这类红队 finding 里带的攻击 payload 原文)要不要在真正对外连通前有一层"延迟披露"考虑(比如已经落地修复的 finding 才允许被读到)。这两点的答案可能都是"不需要, 全给"——但应该是**说出来的答案**, 不是"技术审查通过了就默认覆盖了"的隐性结论。

### 发现②(建议性代码加固, 不阻塞第一批, 供第二批/write-path 那轮参考)

`mcp-policy.js` 的 `loadMcpPolicy` 只校验"写白名单 ⊆ 读白名单", **没有任何代码层面阻止把 `dev-coord-testnet` 加进 `KANET_MCP_WRITE_CHANNELS`**——当前之所以安全, 纯粹是因为默认值和本次配置都刻意留空/只填 `codex-coord-testnet`, 是**运维纪律**在守, 不是**代码结构**在守。一次 `.env` 编辑失误(比如把逗号打错位置、复制粘贴时多带了一个频道名)就能让 Codex 通过合法防火墙路径拿到 `dev-coord-testnet` 的写权限, 而没有任何断言会在启动时拦下这个错误——现有 `loadMcpPolicy` 的校验逻辑完全不知道"`dev-coord-testnet` 是特别敏感、无论如何都不该进写白名单"这件事。

**建议**(不阻塞本批, 因为本批 `KANET_MCP_WRITE_CHANNELS` 本来就留空, 排到 write-path/第二批那轮落码时一并加): 在 `loadMcpPolicy` 里加一条硬编码断言, 类似 `NEVER_MCP_WRITABLE = new Set(['dev-coord-testnet'])`, 如果 `writeChannels` 里出现这个集合的任何一个成员就直接 `throw`(fail-loud, 启动即拒), 把"这个频道永远不该被 Codex 写"从运维约定升级成代码结构性不可能, 跟 `console-supervisor` 那条今天刚学的教训("靠自觉守不住, 必须上机制")同一个精神。

## 未打穿的部分
- Gateway 本身"零密钥物料"(不变量③)——读了全部 4 个 Gateway 源文件, 确实没有任何私钥/relay 凭证经过 Gateway 进程, 全部资金相关操作走 `consoleClient.sendMessage` 转发给 Console(Console 自己再走既有 Relay Manager), Gateway 拿到的只有 txid/公开地址这类结果。
- Rollback 步骤(§8)描述的四步(撤 token/停 Gateway/停 relay 或清资金/保留审计)跟代码结构对得上, 没有发现"文档说能回滚但代码没提供对应开关"的落差。

## Verdict

**GREEN-with-1-MUST-SURFACE(政策)+1建议(代码加固)**。第一批(§4, 本机不对外暴露)技术上没有找到能被利用的访问控制漏洞, 可以按 KANet-UI 的执行计划推进。但发现①必须在 Owner 拍板前明确摆出来给 Owner 看——这不是拦第一批的理由(第一批本身不涉及 Codex 真正连上, 风险面确实如评估所说是"内部新增只读服务"), 是**第二批(公网暴露, 需要独立设计+我再审)启动前必须先有答案的问题**, 现在提出好过等 Codex 已经连上再回头讨论"是不是给多了"。发现②排入 write-path 那轮的落码 DoD。

— NWT 2026-07-17
