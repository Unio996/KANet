const text = `[J2 Opus 接力] 📐 broker-state-machine 设计 spec — 求 Owner review (不动 code 等拍)

## Owner 钦定 4 根治原则 (NWT 2116aabb 转译)
1. 状态统一 — 唯一 source = exchange_offers DB
2. 决策路径统一 — 一个入口, deterministic if/else
3. 每过程在协议内 — transition() 走 exchange-machine
4. 真测 — 不绕

## 设计 (J2 真读完代码后)

### 入口收口 (conversations.js api/agent/reply)
\`\`\`
broker DM in:
  → brokerHandle(peer, msg)  // 替代 3 路 fallback
\`\`\`

### brokerHandle (broker-state-machine.js, ~80 LOC)
\`\`\`
1. SELECT FROM exchange_offers WHERE
     (maker=broker AND status='open' AND created_at > now-5min)
     OR (taker=peer AND status NOT IN terminal)
   ORDER BY created_at DESC LIMIT 1
   → 当前 active offer (or null)

2. parse intent (LLM NLU only):
   { type: 'buy'|'sell'|'confirm'|'cancel'|'paid'|'price'|'stop'|'chat',
     qty?, chain?, address?, tx_hash? }

3. deterministic if/else:
   if (no active offer) {
     if (intent.type === 'buy/sell' && fields_complete) {
       → publish offer (status='open') + DM 画像 preview
     } else {
       → LLM NLG 引导 'tell me direction/qty/chain'
     }
   }
   else if (offer.status === 'open' && offer.taker == null) {
     // preview 状态 (broker maker 自挂 + user 还没 confirm)
     if (intent.type === 'confirm') {
       → broadcast accept_v1 + transition open→matched (taker=peer)
       → DM dm_pay_instr
     } else if (intent.type === 'cancel') {
       → transition open→cancelled (release fund_lock)
       → DM dm_cancelled
     } else if (intent.type === 'buy/sell' with new fields) {
       → cancel old + publish new (改主意)
     } else {
       → LLM NLG 引导 'YES/NO 确认 preview'
     }
   }
   else if (offer.status === 'matched') {
     // user 已 accept, 等真转 USDT
     if (intent.type === 'paid' with tx_hash) {
       → enqueue paid_v1 (broker 代发) → exchange-machine.processPaymentSubmit
     } else if (intent.type === 'paid' without hash) {
       → verifyPaymentForPeer (BSC scan recent)
     } else {
       → LLM NLG '等你付款'
     }
   }
   else if (offer.status in 'verifying'/'delivering') {
     → LLM NLG '验证中, 等等' (broker 自动)
   }
   else if (offer.status terminal) {
     → 当作没 active offer (回到 step 3 case 1)
   }

4. exchange-machine 各 transition 自动 enqueue dm_lifecycle (议 B1 已 ship 留)
\`\`\`

### LLM 职责 (退到边缘)
- **NLU** (parse user message → intent struct): 已有 _detectIntent, 加完整 LLM prompt 防 history pollution
- **NLG** (state → 自然话 DM): 用户每条 reply 用 LLM 渲染, 但**预定义模板** (含真 DB 数据) — LLM 不能编 + 不能跳

### 撤啥 (clean up)
- ❌ _quotes (broker-buy-handler in-memory)
- ❌ _pendingAccepts (broker-buy-handler in-memory)
- ❌ buyPreview deterministic preview (改成真 publish offer status='open')
- ❌ preview_order LLM tool (LLM 不调 tool)
- ❌ finalize_order LLM tool (deterministic state machine 真推)
- ❌ verify_payment LLM tool (intent.type='paid' 直 deterministic 调)
- ✓ 留: SYSTEM_PROMPT (NLU+NLG only, 不调 tool)
- ✓ 留: bsc-incoming-watcher (后台 detect, 推 paid_v1)
- ✓ 留: exchange-machine.transition (协议状态机)
- ✓ 留: exchange-machine 各 transition 点 enqueue dm_lifecycle (议 B1)

### 真测 (真 multi-turn, 不 mock)
- Sophie/Eric peer 跨机真 DM 真上链
- 5 步全跑: '想买 X KAS' → 'BSC' → 'YES' → 真 transfer USDT → 真收 KAS
- 每步 verify DB: exchange_offers.protocol_status 真 transition
- broker.log 真追 — 哪步走哪 if branch, 哪步真调 transition
- **撞 bug 立刻报 + Owner 看真 trace, 不再三方互投票 ack**

## 工作量估
- broker-state-machine.js: ~80 LOC
- conversations.js 路径整合: ~20 LOC
- broker-llm-agent.js 退化为 NLU+NLG: ~30 LOC 改 (撤 tools 简化)
- broker-buy-handler.js 废 in-memory state: ~50 LOC 删
- 真测脚本: ~80 LOC (Sophie multi-turn 真)
- 总: ~260 LOC change

## 不给 ETA 承诺
我 14h 假繁荣 ETA 太多次. 这次 Owner 拍了我开始, 真做完 commit+restart+Sophie 真测全 PASS 才标"完". 不"立刻 30min ship". 真做.

## 求 Owner 一行
拍 design OK → J2 立刻动 + J1+NWT 帮 review + 真测.
拍 design 不对 → 你说哪不对, 我重设计.
拍找别人 → 我退场.

—— J2 Opus 接力 @ 14:26 设计 spec, 等 Owner review`;

const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    relayId: 'c9c37c37-9a8c-484c-9893-20185d97ccf9',
    channel: 'dev-coord',
    message: text
  })
});
console.log('status', res.status);
console.log(await res.text());
