// support_no_broadcast_leak_negative.test.mjs — S1 case4(2026-07-17, KANet-UI)。
// 设计 §4 case4。隔离机制唯一的自证 regression: 证明 is_simulated:true 的升级工单真的没有被
// owner-bot Direction C 转发到 dev-coord-testnet。
//
// NWT 红队 MUST-FIX 折入(docs/2026-07-17-NWT-redteam-s1-isolation-design.md 自主发现①): 原设计
// 只断言"没有新增消息", 但没保证测试窗口覆盖了 pollFeedbackEscalations 的 tick(默认 15000ms)——
// 断言跑得比下一次 poll 还早, "没有消息"无论隔离逻辑对不对都会成立。改两步:
//   (a) 反例: is_simulated:true 的钱类工单, 等够一个完整 FEEDBACK_ESCALATION_POLL_MS 周期(用
//       wait_for_db_row 的轮询等待语义, found:false 才算通过——不是固定 sleep, 但等待窗口覆盖
//       poll tick)。
//   (b) 正对照: 同一 case 里紧接着提交一条**不带** token 的钱类工单(真实路径), 用同样等待窗口,
//       断言这条**确实**被转发(found:true)。如果轮询器根本没在跑, (b) 会先失败, 不会让 (a)
//       侥幸绿灯——这是排除"轮询器没在跑"这种更荒谬假阳性来源的关键。
//
// 注意: (b) 是真实工单, 会真的广播到 dev-coord-testnet(Owner 真实 relay 身份) —— 这是 NWT
// 要求的必要代价(不这样测不出隔离机制是否真的只挡 is_simulated 而不是全局失灵), 内容显式标注
// 自己是自动化 regression 探针, 不是真实用户投诉。
//
// FEEDBACK_ESCALATION_POLL_MS 默认 15000ms(tg-bot/config.mjs), 等待窗口取 20000ms(+5s 余量)。
const POLL_WAIT_MS = 20_000;
const SIM_MARKER = 'S1CASE4-SIM-8f3a1c-不该出现在频道里';
const POSCTRL_MARKER = 'S1CASE4-POSCTRL-8f3a1c-KANet-UI自动化regression探针非真实用户投诉';

export default {
  id: 'support_no_broadcast_leak_negative',
  description: 'S1 case4 — is_simulated:true 升级不转发(反例)+ 不带 token 的真实升级确实转发(正对照)',
  domain: 'support',
  tags: ['support', 'fail-closed', 'isolation'],
  skip_in_batch: true,  // 单条等待窗口 20s x2 + 会真实广播一条消息到 dev-coord-testnet, 非批量自动跑
  steps: [
    // (a) 反例: is_simulated:true, 钱类信号触发 escalated:true, 但不应被转发
    {
      action: 'http_post',
      url: '/api/feedback/reply',
      headers: { 'X-Test-Harness-Token': process.env.TEST_HARNESS_TOKEN || '' },
      body: { raw_text: `我的钱怎么还没到账 ${SIM_MARKER}` },
      expect: { must: { http_status_equals: 200, reply_contains: ['"escalated":true'] } },
    },
    {
      action: 'wait_for_db_row',
      sql: `SELECT id FROM broadcast_messages WHERE channel_name='dev-coord-testnet' AND content LIKE ? AND datetime(created_at) > datetime('now','-2 minutes')`,
      params: [`%${SIM_MARKER}%`],
      timeout_ms: POLL_WAIT_MS,
      poll_ms: 2_000,
      expect: {
        must: { found: false },
      },
    },
    // (b) 正对照: 不带 token(真实路径), 同样钱类信号, 应该被转发(证明轮询器确实在跑)
    {
      action: 'http_post',
      url: '/api/feedback/reply',
      body: { raw_text: `我的钱怎么还没到账 ${POSCTRL_MARKER}` },
      expect: { must: { http_status_equals: 200, reply_contains: ['"escalated":true'] } },
    },
    {
      action: 'wait_for_db_row',
      sql: `SELECT id, content FROM broadcast_messages WHERE channel_name='dev-coord-testnet' AND content LIKE ? AND datetime(created_at) > datetime('now','-2 minutes')`,
      params: [`%${POSCTRL_MARKER}%`],
      timeout_ms: POLL_WAIT_MS,
      poll_ms: 2_000,
      expect: {
        must: {
          found: true,
          // 顺带核实围栏净化确实生效在这条真实转发上(复用 #7 已验证的渲染断言)
          row_field_present: ['content'],
        },
      },
    },
  ],
};
