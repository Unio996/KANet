# Codex MCP Gateway — read-path bootstrap 执行评估(2026-07-17)

> **Status**: CURRENT(执行评估稿·先评估不部署;待 Bettor 审+NWT 安全审, 均 GREEN 后才执行)
> **作者**: KANet-UI · 依据: Bettor 派工(#oqpepq.2, KANET-CODEX-BOOTSTRAP-001 host 执行切片)
> **范围**: 只做 read-path(`kanet.channels.list` + `kanet.messages.read`, `dev-coord-testnet` 只读)。
> 不含 write-path(`codex-coord-testnet` 写权限/relay 资金/`kanet.messages.send`)——那部分 out of
> scope for this bootstrap(同 `coordination/codex-bridge/STATUS.md` 口径:"Wallet creation / TN12
> funding is out of scope for the read-path bootstrap")。

## §0 背景 一句话

Owner 授权 Codex(OpenAI 外部编码 agent, 经 GitHub PR #3 协作)通过一个 MCP gateway 只读观察
`dev-coord-testnet` 协调频道。代码已在未合并分支 `origin/agent/codex-mcp-gateway-2026-07` 上就绪
(设计文档 `docs/integrations/codex-mcp-gateway.md`), 本评估的任务是: 这批代码能不能安全部署、
怎么部署、有没有前置缺口要先堵。

## §1 代码审计结论(只读, 逐条核实非读文档信文档)

对照 `docs/integrations/codex-mcp-gateway.md` §3 十条安全不变量逐条读代码核实, 结论:

- **①两把独立 token / ②固定身份禁止调用方选 relay / ③Gateway 零密钥材料 / ④白名单默认值
  fail-closed / ⑤审计先写 started 再动作+不存明文 / ⑥read 路径物理不依赖 relay 资金状态** ——
  六条均**代码实证成立**, 没有发现"文档说做了但代码没做"的情况, 也没有发现额外未声明的密钥/
  签名风险点。
- **`chat.js` 改动核对**: 新增的 `isMcpCoordRelayAllowed` 判定是精确 scoped 的追加许可分支(仅
  `relay.name` 精确匹配 `MCP_COORD_RELAY_NAMES` 默认值 `KANet-MCP-Bot` **且** `channel` 精确匹配
  `MCP_COORD_WRITE_CHANNELS` 默认值 `codex-coord-testnet`, 不含 `dev-coord-testnet`, 才生效),
  **没有发现该改动削弱或绕开既有 dev-coord-testnet 防火墙**。

### 两处需要在评估里点名的问题(非当前可被利用的漏洞, 但影响执行判断)

1. **重复实现的白名单判定**: `mcp-policy.js`(Console 内部 API 层)和 `chat.js`(频道防火墙层)
   各自独立 parse 同一批环境变量(`KANET_MCP_WRITE_CHANNELS` 等), 没有统一单点。当前两者读同
   一环境变量、默认值一致, 行为吻合; 但这是两份独立信任源, 日后任一方改动未同步会静默产生权限
   判定分歧。**建议**: 部署前不必须修(不阻塞 read-path, 属技术债), 但应该在部署 PR 里留一条
   TODO 或立卡跟踪, 别让"两处判定恰好一致"变成没人知道的隐性耦合。
2. **`kasia-console/src/api/mcp-gateway.js`(Console 路由层)零集成测试**: 现有
   `mcp-policy.test.mjs` 只测纯函数库, `gateway.test.mjs` 只测 Gateway+桩 Console(绕过真实
   Console HTTP 层)。`requireInternalToken` 403/503、`beginAudit`/`finishAudit` 实际写库、
   `channel_not_writable` 拒绝分支——这些安全行为**目前只有代码走读验证, 没有回归测试兜底**。
   **建议**: read-path 部署前补至少一条打真实 Console 路由的集成测试(token 缺失/错误 → 403 或
   503、channel 不在读白名单 → 拒绝、正常读请求 → 200+审计行落库), 覆盖设计文档 §7 canary 序列
   第 1-3 步对应的失败路径, 不能只验证 happy path。

## §2 read-path 执行需要做什么(不含 write-path/relay 资金)

read-path 只需要 `kanet.channels.list` + `kanet.messages.read` 工作, 按文档 §3 第 10 条("Read-only
degradation")这两个工具**不依赖 relay 是否有资金/是否启动**——但仍然需要一个 relay_id 配置
(`KANET_MCP_RELAY_ID`)存在于 `relay_nodes` 表, 因为 `mcp-policy.js` 读取 `policy.relayId` 用于
`/status` 展示身份, 只是 send 才会真正驱动它广播。

**前置步骤(按依赖顺序)**:

1. **合并/拉取 Console 侧代码**: `mcp-gateway.js`/`mcp-policy.js`/`chat.js` 改动 + `index.js` 路由
   注册, 目前只在 `agent/codex-mcp-gateway-2026-07` 分支, 需要 merge 到 `bshard-m3-deploy`(走
   正常 PR review, 不是我这份文档能单独批的范围——这本身是"代码要不要合并进主线"的决策, 应该
   由 Bettor/Owner 在 PR #3 走完 review 后拍板, 我这份评估只处理"合并后怎么安全上线"）。
2. **创建专用测试网 relay `KANet-MCP-Bot`**: 走 Console 既有 UI/API 流程, 独立地址/key, 不复用
   Owner relay(文档 §4 硬性要求)。read-path 阶段这个 relay 不需要预先充值(§3 第 10 条)。
3. **Console 侧配置**(`kanet.env`, 只加 read-path 需要的部分, write 相关先不设或设成空):
   ```
   KANET_MCP_INTERNAL_TOKEN=<≥32随机字符, 新生成>
   KANET_MCP_RELAY_ID=<步骤2创建的relay id>
   KANET_MCP_RELAY_NAMES=KANet-MCP-Bot
   KANET_MCP_READ_CHANNELS=dev-coord-testnet,codex-coord-testnet
   KANET_MCP_WRITE_CHANNELS=
   ```
   （`KANET_MCP_WRITE_CHANNELS` 留空 = 写白名单为空集, `mcp-policy.js` 的"写⊆读"校验对空集
   天然成立, 不阻断启动, 但任何 send 调用都会被拒——这是刻意的, read-path 阶段不开 send 口子。）
4. **重启 Console**: 这批改动是 Console 侧代码, 必须重启才生效(同今天 #7/S1 的教训, 不是
   owner-bot 单进程能装的)。**需要重启窗**——但按 Bettor 已给的优先级("不阻塞 H2 用户面主线"),
   这次不单独开窗, 排进下一个已经在排队的重启窗(跟 H2/kanet-start.sh supervisor 修法一起)。
5. **部署 Gateway 独立进程**: `kanet-mcp-gateway/` 是全新组件, 目前没有接入 `kanet-start.sh`/
   `logs/pids/` 体系。read-path 验证阶段建议**先手动跑, 不接自动化启动脚本**(降低"这次改动同时
   影响全栈自动重启行为"的风险面, 等 canary 通过再考虑要不要接进 `kanet-start.sh`)。
   ```
   cd kanet-mcp-gateway && npm ci && npm test
   KANET_MCP_HOST=127.0.0.1 KANET_MCP_PORT=3215 \
   KANET_MCP_TOKEN=<新生成, 与INTERNAL_TOKEN不同> \
   KANET_MCP_INTERNAL_TOKEN=<同步骤3> \
   KANET_CONSOLE_URL=http://127.0.0.1:3200 \
   npm start
   ```
6. **本地验证(不对外暴露)**: 用 curl 带 `KANET_MCP_TOKEN` 直接打 `http://127.0.0.1:3215/mcp`,
   核实 `kanet.channels.list` 返回 `dev-coord-testnet=read_only`、`kanet.messages.read` 能读到
   频道最近消息、`mcp_audit_log` 确实落了 `outcome=started→success` 行。**这一步刻意不做任何
   公网暴露**, 纯本机验证 gateway+console 链路本身工作。
7. **公网暴露(独立决策点, 不在本次 read-path bootstrap 范围内直接做)**: Codex 是外部云服务,
   要真正连上 gateway 需要公网可达的 HTTPS 端点(文档 §5 提到"Expose only /mcp through an HTTPS
   reverse proxy")。这台 TN12 host 目前没有为此设置的反向代理/隧道基础设施(现有对外暴露只有
   `kaspa-ws-proxy` 这类局域网内用途, 不是公网)。**这是本评估里唯一没有现成路径的一步**——需要
   额外决定用什么方案(cloudflared/ngrok/自建反代+证书), 这本身是一个新的攻击面(host 首次对外
   公网暴露一个服务), 建议**单独走一轮设计+安全审**, 不要因为"read-path bootstrap 听起来只是
   读"就把"host 从零对外暴露一个端口"这个决策焊在同一次批准里。

## §3 是否需要重启窗

**需要, 但不紧急**——Console 侧代码改动(步骤 4)必须重启才生效, 排进下一个已排队的窗口
(H2 + kanet-start.sh supervisor 修法), 不单独开。Gateway 独立进程(步骤 5)本身不需要 console
重启窗, 是全新进程, 随时可以单独起停, 不影响现网。

## §4 建议的批准粒度(分两段, 不要一次性批到公网暴露)

- **第一批(本次评估请求批准的范围)**: §2 步骤 1-6, 即"Console 侧代码合并+配置+重启+Gateway
  本机部署+本机验证", 终态 = gateway 在 localhost работает, 本机 curl 能验证 read-path 全链路,
  **Codex 依然连不上**(没有公网入口)。这一批的风险面 = 内部新增一个只读服务+一个新 relay 身份,
  没有新增外部可达攻击面。
- **第二批(独立请求, 需要额外设计+NWT 审)**: 公网暴露方案选型+落地。只有第一批完全验证过、
  且第二批单独过审后, Codex 才能真正连上——中间这个窗口本来就是"代码就绪但没上线"的正常状态,
  不算卡住。

## §5 DoD(第一批范围)

- Console 重启后 `KANET_MCP_INTERNAL_TOKEN` 生效(`policy.enabled === true`)。
- 本机 curl `kanet.status.get`/`kanet.channels.list`/`kanet.messages.read` 三个只读工具全部
  返回预期结果(见文档 §7 canary 序列第 1-3 步)。
- `mcp_audit_log` 对应三次调用都有 `outcome=started→success` 行, 不含明文 token。
- 补一条打真实 Console 路由层的集成测试(§1 发现②), 覆盖 token 缺失 403/503 + 正常读 200 两条
  路径, 作为这批代码合并进主线的一部分, 不是事后补。
- `KANET_MCP_WRITE_CHANNELS` 留空, 确认任何 send 尝试(哪怕本机手工 curl 试探)都被拒绝
  (`channel_not_writable` 或等价错误), 证明 read-path 阶段 write 口子确实没开。

## §6 不做什么(本次范围外)

- 不做公网暴露/反向代理(§2 步骤 7, 独立决策点)。
- 不做 relay 充值(read-path 不需要, write-path 才需要)。
- 不改 `mcp-policy.js`/`chat.js` 的重复白名单实现(§1 发现①, 记技术债不阻塞)。
- 不把 Gateway 接入 `kanet-start.sh` 自动化启动(先手动运行验证稳定性, 之后再考虑要不要接)。
