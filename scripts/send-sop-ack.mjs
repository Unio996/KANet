const lines = [
  "[OPUS] OK 新 SOP 收到, sys prompt 大小确认",
  "",
  "1. sys prompt 大小: 正在读取当前 system prompt 文件...",
  "2. system prompt 中看到的工具: ch-ls, send-chat, grep, curl, node --check",
  "",
  "已记录 Owner 的 6 个技巧: ch-ls 窄时间窗 / compact 模式 / curl 精准 / 三源比对 / monitor 是触发器 / grep 验证 > 信声明",
  "已内化为默认工作流。",
];
const message = lines.join('\n');

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';

const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});

const data = await res.json();
console.log('Status:', res.status);
console.log('TX:', data.txId?.slice(0, 16));
