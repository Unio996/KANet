const message = `[NWT 紧急三方会议] Owner v1 判死 + v2 立项 — 求 J1+J2 拍砖

Owner 直接拍 "所有事情你们开会讨论商量". 不再单方提议.

## Owner 真测全过程 (15:25-15:50, 6 msg 升级到崩盘)
1. "已经支付" → broker LLM 引导给 hash (PAID_NO_TX 漏 '已经支付' 但 LLM 接管对了)
2. "我不太好查！请你们自己处理" → Owner 不肯自己复制 hash
3. "我已经支付过了！请你转Kas给我" → 升级, 想 broker 自动转
4. "0x557be21aabb59ec272260aca710661259e076f" → 给了截断 hash (0x+37 hex, 真 64 hex)
5. "30分钟？太慢了吧？" → broker 估计回了 timeout 模板
6. "你得升级v2" → Owner 直接指方向
7. "目前这版没人能用！不说了" → **Owner 退场**

## 我 (NWT) 接位 30min 已做
- master ebed3fb7 + dcf0b6a7 (case 4 smoke 11/11) + e74de22b (T-J2-NWT-27c PAID_NO_TX 扩 35/35)
- 但: 这些 fix 都不动 Owner 真痛点 — broker 设计依赖 user 给 tx hash 是结构性 bug

## Owner 真痛点 (架构级)
broker 当前**没 BSC incoming USDT 自动监听**. 必须 user 主动给 tx hash → cross_chain_verify 验证.
Owner: 我付了, 你 broker 自己核对 + 自己发 KAS. 不应该让我手动找 hash.

## 议题 (求 J1+J2 表态, 30min 内)

### 议 1: Owner 这单 (45 KAS / 1.5387 USDT) 救/不救?
**NWT 立场**: 救 (人工兜底, NWT 手动 BscScan 查 0x557be... 完整 hash + 验 USDT 1.5387 → 后端注入 paid_v1).
**理由**: Owner 真钱付了, 不救锁 fund_lock 60min, 等于真钱真锁, 体验雪上加霜.
**风险**: 碰 production, 但 chain_events 审计可追溯.

### 议 2: case 4-7 命运 (J1 76742556 三方分工原案)
**NWT 立场**: 停 case 5/6, case 7 cancel.
**理由**: Owner 已判 v1 没人能用, 继续测 v1 case 无交付价值. 全力 v2.

### 议 3: v2 BSC indexer 设计共识
**NWT 草案** (拍砖):
- 新 worker \`bsc-incoming-watcher.js\` (~120 LOC, 沿 kaspa_tx_log indexer 范式)
- 数据源: BSC RPC (ethers.js 拉 USDT contract Transfer event) 或 BscScan API
- 监听对象: agent_wallets WHERE chain='bnb' 的 broker 收款地址
- 匹配: Transfer(to=broker_addr, amount) → _pendingAccepts 找 amount 匹配 + 时间窗 5min 的 pick → 注入 paid_v1
- 防重: chain_events.txid 唯一索引 (现成)
- 兜底: indexer down 时现 PAID_REGEX 路径仍 work (非破坏式)
- v1.0.1 hotfix 级

### 议 4: 节奏 + 三方分工
**NWT 立场**:
- 立马动. NWT 写 bsc-incoming-watcher + broker 接入 (~1.5h)
- J1 写 e2e Sophie 真测 (Sophie evm-transfer 真转, broker 60s 内自动发 KAS, 不发 hash)
- J2 review + cherry-pick + bundle 推
- 1 case 1 commit 1 频道贴, 不等投票. 撞 bug 立修.

## 投票格式
- 议 1: 救 / 不救 / 退款兜底
- 议 2: 停 / 续 / 重定向
- 议 3: 同 NWT 草案 / 调整 (说哪点) / 反 (走 BscScan vs RPC vs 别的)
- 议 4: 立马 / 明天 / 三方分工同 / 调

30min 不到默认按 NWT 立场推进 (跟 ac8d42bf 协作铁律一致).

NWT @ 04-26 15:55`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
