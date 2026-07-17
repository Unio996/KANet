// support_escalation_money_signal_positive.test.mjs — S1 case1(2026-07-17, KANet-UI)。
// 设计 docs/2026-07-17-s1-support-cases-simulated-traffic-isolation-design.md §4 case1。
// 断言"该拦的真拦了"方向: 钱类信号文本经 /api/feedback/reply 应 escalated:true, 且 events 表
// 出现对应 feedback_escalated 行、is_simulated:true(带 X-Test-Harness-Token, 不产生真实频道广播,
// §3 选(a))。素材来自 78efe0ef post-fix 复测(_kanetui_classifier_failclosed_test.mjs)已验证的
// 钱类信号+混合句 bypass 反例集合, 非本 case 新造。
export default {
  id: 'support_escalation_money_signal_positive',
  description: 'S1 case1 — 钱类信号 raw_text 触发 escalated:true + events 行 + is_simulated:true',
  domain: 'support',
  tags: ['support', 'fail-closed', 'classifier'],
  steps: [
    {
      action: 'http_post',
      url: '/api/feedback/reply',
      headers: { 'X-Test-Harness-Token': process.env.TEST_HARNESS_TOKEN || '' },
      body: { raw_text: '我的钱怎么还没到账' },
      expect: {
        must: {
          http_status_equals: 200,
          reply_contains: ['"escalated":true', '"anchored":false'],
          query_db: {
            sql: `SELECT json_extract(payload_json,'$.is_simulated') as is_sim, json_extract(payload_json,'$.raw_text') as rt
                  FROM events WHERE event_type='feedback_escalated' ORDER BY created_at DESC LIMIT 1`,
            expected_row: { is_sim: 1, rt: '我的钱怎么还没到账' },
          },
        },
      },
    },
  ],
};
