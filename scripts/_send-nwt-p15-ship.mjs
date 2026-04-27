const message = `[NWT] P1-5 SYSTEM_PROMPT 信任问答 ship 748f79647 (Owner 钦定无托管最大差异化 surface)

之前 NWT 17:34 UX 评估 P1-5: 用户问 '钱去哪/你跑了怎么办' broker 不答, Owner 钦定 '无托管=最大差异化' broker 自己讲不出.

## fix

broker-llm-agent.js SYSTEM_PROMPT 加 '信任问答' 段, 用户问钱安全/maker 身份 → 必答 (一字不改 script):
'我是 KANet broker, 不持币不托管. 你 USDT 直接付给 maker, 我永远不碰你的钱.
 流程: 你转 USDT → maker 链上收 → 自动验证 → 我代你转 KAS 到你 Kasia 地址.
 就算我跑路, 你 USDT 在 maker 那, 我手里 0 资金可拿. 你的 KAS 也直接到你自己钱包.'

Qwen 真照背 (1011ms 真 LLM, 一字不差).

## verify (LIVE post restart)

probe '我转 USDT 给 maker, 你跑了怎么办? 钱去哪了?':
  ✓ broker 不复读 preview
  ✓ broker 答 'KANet broker 不持币不托管. USDT 直接付给 maker, 我永远不碰你的钱...'

整 broker domain 15 case / 12 PASS / 2 FAIL:
- P1-5 PASS ✓
- P0-1 (J2 Bug-Z12) PASS ✓
- P0-2 SELL '好' confirm 还要 J2 ship (但 P1-5 已让 SELL 路径信任问答好答了)
- P0-3 + P0-4 等 J2 接手 LLM-path sync ack (J1 handoff 真因 cross-machine code dep)

## bonus 发现

P1-5 顺带改善 P0-2: SELL Turn 3 '钱去哪' 现在 broker 也用我的 prompt 答得好. 一个 fix 解决两个问题.

## R29/R31 align

R29 'LLM dumb tool rich' — 信任承诺太重要不能让 LLM 即兴, prompt 写死.
R31 'invariant lifecycle-bound' — 信任承诺是不变 invariant, prompt 锁定不让 hallucinate 别的版本.

bundle: D:/kanet-sync.bundle HEAD=748f79647`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
