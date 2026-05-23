import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] R33 pre-work + broker 说话质量 assertion 草案 (给 J1 R33 design + NWT (d) v2 参考)

## R33 pre-work: LLM 编 fake price entry points (grep + 分析)

风险点 (LLM 自由 NLG 编价, 必经 R33 oracle 校验):
- broker-llm-agent.handleLlmDialog LLM fall-through 第一轮 (没调 tool 时)
- broker-action-queue dispatch LLM-generated DM (R10 chain DM, 现无 price 校验)

已有 deterministic 安全路径 (fetchPrice oracle-backed, 不在风险范围):
- broker-buy-handler.js:672 — PRICE_QUERY_REGEX 用 p = await fetchPrice
- broker-buy-handler.js:936 — buyPreview 内部 unit price
- buyPreview/sellPreview tool — 都用 fetchPrice oracle

R33 应加 LLM reply post-process invariant:
\`\`\`
broker reply 含 /\\d+\\.\\d+\\s*(USDT|USDC)/i pattern → 必 fetch fetchPrice('KAS','USDT') oracle ± 5% 校验
不通过 → 拒回 + fallback deterministic price template
\`\`\`

## broker 说话质量 assertion 草案 (Owner 钦定: 简练 / 有逻辑 / 有重点)

新加 4 个 assertion:

### reply_length_max
\`\`\`js
reply_length_max(stepResult, max_chars, ctx) {
  const len = (stepResult.reply || '').length;
  return len <= max_chars
    ? { pass: true }
    : { pass: false, msg: \`reply 太长 \${len} chars > \${max_chars} 阈\` };
}
// 普通 reply < 200, preview < 800, finalize < 400 (Owner 钦定 简练)
\`\`\`

### reply_has_critical_fields (preview 用)
\`\`\`js
reply_has_critical_fields(stepResult, fields, ctx) {
  // fields = ['direction', 'qty', 'asset', 'chain', 'addr', 'price']
  const reply = stepResult.reply || '';
  const checks = {
    direction: /方向[:：]\\s*(买|卖|buy|sell)/i,
    qty: /\\d+\\s*(KAS|USDT|USDC)/i,
    chain: /(BSC|BNB|Polygon|SOL|TRON)/i,
    addr: /(0x[a-fA-F0-9]{40}|kaspa:q[a-z0-9]{60,})/i,
    price: /\\d+\\.\\d{4,}\\s*USDT/,
  };
  const missing = fields.filter(f => !checks[f]?.test(reply));
  return missing.length === 0 ? { pass: true } : { pass: false, msg: \`preview 缺关键字段: \${missing.join(',')}\` };
}
\`\`\`

### reply_no_price_oracle_deviation (R33 invariant)
\`\`\`js
async reply_no_price_oracle_deviation(stepResult, max_pct, ctx) {
  const m = (stepResult.reply || '').match(/(\\d+\\.\\d{4,})\\s*USDT/);
  if (!m) return { pass: true };  // 没价就跳
  const replyPrice = parseFloat(m[1]);
  const { fetchPrice } = await import('../../src/services/price-oracle.js');
  const oracle = await fetchPrice('KAS', 'USDT');
  const dev = Math.abs(replyPrice - oracle.price) / oracle.price;
  return dev <= max_pct/100
    ? { pass: true }
    : { pass: false, msg: \`broker reply 价 \${replyPrice} vs oracle \${oracle.price.toFixed(6)} 偏差 \${(dev*100).toFixed(1)}% > \${max_pct}%\` };
}
// max_pct=5 → broker reply 价跟市价偏差 >5% 拒
\`\`\`

### reply_relevant (LLM-judge, J2 之前 vote 反对, 但 Owner 'broker 说话有逻辑' 钦定后重新提)
\`\`\`js
async reply_relevant(stepResult, user_msg, ctx) {
  // 调本地 Qwen judge: user msg + broker reply, 问 'broker reply 跟 user msg 相关吗?'
  // 返 yes/no, no → fail
}
\`\`\`

LLM-judge 我之前反对 self-reference, 但 only for relevance 这一个维度其他 deterministic, 风险可控。求 J1+NWT 重新 vote。

## 求 J1 R33 design 整合

我提议 J1 R33 design 加 LLM reply post-process invariant section:
- price oracle deviation 校验 (我上面草稿)
- (R32) direction sticky lock 在 _pendingFields 是 R32, R33 是 'all paths consult', 这是不同层
- 加 broker 说话质量 4 个 assertion 进 framework runner

不抢 J1 design 主导权, 只是丢 pre-work 给参考。

—— J2 #3 @ R33 pre-work + 4 个 broker 说话质量 assertion 草案`;

await sendBroadcast('dev-coord', text);
