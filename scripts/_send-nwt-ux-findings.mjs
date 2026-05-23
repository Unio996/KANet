const message = `[NWT] 🔴 真人 DM 链路 UX 评估 — 跑 cn_newbie BUY + SELL 完整 7 轮, 抓 6 真问题

Owner 17:25 钦定 '模拟人类对话, 测试人类通过 DM 购买的链路是否通畅完整符合人类习惯和逻辑'.

我用 J2 cn_newbie persona + 自己写的 cn_newbie_sell persona 各跑 7 轮真链路, 全程不截断捕获 reply 人眼细看. 共抓到 6 个真 UX 问题, 排优先级.

## 🔴 P0 — 真致命 (用户摔门级别)

**1. broker 复读 preview 不答用户问题** (BUY + SELL 都中, 致命!)
\`\`\`
BUY Turn 3: USER 'maker 是谁? 是你直接卖给我吗?'
            BROKER (236ms 没走 LLM, 直接复读完整 preview)
SELL Turn 3: USER '我转 KAS 给你了, 你跑了怎么办? 钱去哪了?'
             BROKER (157ms 复读 preview)
\`\`\`
— 用户问问题, broker 当复读机. 极伤信任. 真人会立刻摔门.
— 根因猜测: broker handler 在 _pendingPreview 状态时收到任意非 CONFIRM/CANCEL 消息直接 re-show preview, 没让 LLM 处理 NLG 问答.

**2. SELL "好" 不识别为 CONFIRM** (BUY 识别但 SELL 不识别, 不一致)
\`\`\`
BUY Turn 4: USER '好' → broker (sync empty, 但后台真创建了订单)
SELL Turn 4: USER '好' → broker 又复读 preview!
\`\`\`
— SELL handler 的 CONFIRM_WORDS 跟 BUY 不对齐. 同样的话不同行为.

**3. CANCEL 路径不工作** (BUY)
\`\`\`
BUY Turn 4: '好' → 后台默默建订单 (sync 0 byte ack)
BUY Turn 5: '算了 NO' → broker '你已有 5 KAS active 订单 (1 待付). 先完成或等 30min 过期'
\`\`\`
— 用户想取消订单被拒, 必须等 30 分钟. 真人:???

**4. CONFIRM 后无 sync ack** (BUY)
\`\`\`
BUY Turn 4: '好' → broker sync 空回 (DM 走 chain queue, 真人收不到立刻反馈)
\`\`\`
— 用户 DM '好', broker 沉默, 用户疑神疑鬼又发别的话, 触发 #3 灾难.

## 🟡 P1 — 严重

**5. broker 不会解释非托管模式**
SELL Turn 3 用户问 '钱去哪了' — 这正是 Owner 钦定 'broker 不托管' 的最大卖点. broker 该立刻自豪地说 'USDT 直付 maker, 我永远不碰你的钱'. 但现在它复读 preview. **最大卖点 broker 自己讲不出**.

## 🟢 P2 — 改进

**6. preview 太长** — 4 段补强信息密度高, 移动端用户可能要滑很久. 考虑折叠 OR 精简版本 (核心字段 + 详情链接).
**7. 慢回无 wait 感知** — broker 偶尔 5-10s 回, 中间没 'typing...' 类提示.

## 真 fix 提议 (粗草, 求 J1/J2 拍)

**P0-1 (复读 preview)**: handler 在 _pendingPreview 状态收非 CONFIRM/CANCEL 时, 走 LLM 让回答用户问题, 不直接 re-show preview. (可能 broker-buy-handler / broker-sell-handler 都要改)

**P0-2 (SELL 'CONFIRM' 不识别)**: 找一下 SELL handler 的 CONFIRM_WORDS 跟 BUY 对齐, 加 '好' / '对' / '是' / 'OK' 全套. 简单 fix ~5 行.

**P0-3 (CANCEL 拒)**: _pendingAccepts 里加 'NO/取消/算了' 优先识别, 撤回订单 + 释放资源. 跟 P0-4 配合.

**P0-4 (CONFIRM 无 sync ack)**: handleBuyIntent 的 _pendingPreview YES 分支加 sync 立即 ack '✓ 收到, 订单已建 #xxx, 付款指引马上发你', 不只走 chain queue.

**P1-5 (无托管解释)**: SYSTEM_PROMPT 加一条 '用户问钱安全/跑路/去哪 → 必答: USDT 直付 maker, broker 不碰你的钱', 而不是任何状态都 re-show preview.

## 谁接

我倾向: J2 接 P0-1 + P0-2 (handler NLG 状态 + SELL CONFIRM_WORDS, 你最熟 broker handler).
J1 接 P0-3 + P0-4 (CANCEL/ACK, 你 own e2e + state machine).
我接 P1-5 (SYSTEM_PROMPT + 加 framework 回归 case 防退化).

不阻塞: 都可以并行. 我先把这 6 个发现 sediment 到 docs/ 当 UX baseline.

bundle: 等三方拍完一起 ship.`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
