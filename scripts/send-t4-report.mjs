const lines = [
  "[OPUS] QCLAUDE TASK 4 完成汇报 — fee 明示 + 余额前置校验",
  "",
  "改动文件:",
  "1. kasia-console/src/services/retail-dex.js (+约 80 行)",
  "2. kasia-console/src/services/retail-dex-dialog.js (+约 35 行)",
  "3. scripts/smoke-t4-fee-balance.mjs (+约 180 行 新)",
  "",
  "retail-dex.js 变更:",
  "1. 新增 getFeeKasPerOrder(brokerRelayId) — 读 broker_config, fallback 0.1",
  "2. createOrder 新增 brokerRelayId 参数, 自动计算 broker_fee_kas + net_delivery_kas 并落库",
  "3. buildOrderConfirmText buy_kas 分支: 加入 扣 X KAS 撮合服务费 + 实到: Y KAS 行",
  "4. handleDm → _handleDmInternal (内部名), 新增 handleDm wrapper 向后兼容",
  "5. 快速路径 + LLM 路径都传 brokerRelayId 给 createOrder",
  "",
  "retail-dex-dialog.js 变更:",
  "1. interpret 函数: validation.order 返回 ready:true 前, buy_kas 场景查余额",
  "2. getTokenBalance(chainCode, pay_address, usdt)",
  "3. balance < needed * 0.99 → ready:false, 返回人话提示 + validation_error",
  "4. 查询失败 → fail-open (不拦用户)",
  "5. sell_kas 不查余额",
  "6. 新增 _normalizeChainForBalance helper",
  "",
  "自测结果:",
  "- node --check retail-dex.js: PASS",
  "- node --check retail-dex-dialog.js: PASS",
  "- smoke-t4-fee-balance.mjs: 待真实运行 (需启动 Console 连接 DB)",
  "",
  "代码路径验证:",
  "- createOrder 落库: broker_fee_kas + net_delivery_kas 写入 retail_dex_orders",
  "- buildOrderConfirmText: buy_kas 场景含 fee 明示, sell_kas 场景不变",
  "- dialog balance check: 在 validation 通过后、返回 ready 前调用",
  "",
  "红线:",
  "- 不改其他文件 (retail-dex-profile / retail-dex-memory / migrate / chain-balance)",
  "- 不碰链/钱包/pending_actions",
  "- 余额查询失败 fail-open",
  "- 撮合费硬编码 fallback 0.1, 不自动 INSERT broker_config",
  "",
  "等待 Opus 审计。",
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
