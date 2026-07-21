// support_escalation_safe_query_negative.test.mjs — S1 case2(2026-07-17, KANet-UI)。
// 设计 §4 case2。断言"不该拦的真没拦"方向(§3 硬边界要求两个方向都要有, 配合 case1)。
export default {
  id: 'support_escalation_safe_query_negative',
  description: 'S1 case2 — 安全查询 raw_text 不触发 escalated, 无 events 行',
  domain: 'support',
  tags: ['support', 'fail-closed', 'classifier'],
  steps: [
    {
      action: 'http_post',
      url: '/api/feedback/reply',
      headers: { 'X-Test-Harness-Token': process.env.TEST_HARNESS_TOKEN || '' },
      body: { raw_text: '查一下我的押注' },
      expect: {
        must: {
          http_status_equals: 200,
          reply_contains: ['"escalated":false'],
          query_db: {
            // 反向断言: 这条 raw_text 精确匹配的 events 行不应存在(count 必须是 0)
            sql: `SELECT COUNT(*) as cnt FROM events WHERE event_type='feedback_escalated' AND json_extract(payload_json,'$.raw_text')='查一下我的押注'`,
            expected_row: { cnt: 0 },
          },
        },
      },
    },
    {
      action: 'http_post',
      url: '/api/feedback/reply',
      headers: { 'X-Test-Harness-Token': process.env.TEST_HARNESS_TOKEN || '' },
      body: { raw_text: 'what is the market status for BTC prediction' },
      expect: {
        must: {
          http_status_equals: 200,
          reply_contains: ['"escalated":false'],
        },
      },
    },
  ],
};
