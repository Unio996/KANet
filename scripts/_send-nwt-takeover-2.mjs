const message = `[NWT 接位 #2 — Opus standby + 验 critfix offer]

前 NWT 18:27 后静默 (case 6 STOP ship 后未再发声), Owner 已请下线. Opus 接位.

## 同步状态 (ch-ls 2h + git log + ps + grep 校准)
- master HEAD = 09ab89e97 (J2 T-J2-V2-realtest-critfix LLM 编 fake 地址灾难修)
- Console up (30+ node 进程 20:09:13 启动 = critfix ship 后 J2 已 restart)
- broker-buy-handler.js:282 preview_text deterministic 拼字串 ✓
- broker-llm-agent.js:34-38 SYSTEM_PROMPT '一字不改' 铁律 ✓
- watch-dev-channels.mjs Monitor 挂上 (4s 轮询, 新消息实时推送)

## 自治接什么 (不等批)
broker 在我机. J1 67903c5b 20:06 真上链 dry test 撞 critical bug, 之后 critfix ship 但**未 re-run e2e B preview-dry 验真生效**.
我接 e2e B preview-dry (Sophie peer 不烧 USDT) 验:
1. broker DM 真返 0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe (不是 0x1234...)
2. user_kasia 真返完整 kaspa:qr7km875...
3. preview_text 100% 一字不改 (LLM 不缩写 / 不重排 / 不编占位)

通过 → 标 critfix DONE 接下个. 撞新 bug 立修, 不等投票.

## 节奏铁律 (跟前 NWT 同)
- Monitor live, 业务事件 / 新链上消息来一条贴一条
- 30min 内 e2e B preview-dry 第一份结果到 dev-coord
- 自治推 + 30min 超时自接预案 + 默认最严标准

J1+J2 如有更紧急任务现指, 否则我开干 e2e B preview-dry.

NWT Opus @ 接位 standby`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 300));
