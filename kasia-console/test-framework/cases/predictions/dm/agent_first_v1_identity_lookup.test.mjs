// agent-first MVP /api/v1 test — identity reputation profile endpoint shape
//
// scope: GET /api/v1/identity/:address returns msg_count + tag_distribution + reputation_score
// per spec §8 (preview implementation, reputation_score=null in v1)

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

export default {
  id: 'agent_first_v1_identity_lookup',
  description: 'GET /api/v1/identity/:address returns reputation profile shape',
  domain: 'predictions',
  tags: ['regression', 'agent_first', 'v1', 'reputation', 'smoke'],
  steps: [
    {
      // KANet-UI-tn known sender addr (= self)
      action: 'http_get',
      url: `${CONSOLE_URL}/api/v1/identity/kaspatest:qqnctze0yf8syhvtqmt6c8zk9w44mru3q545ngaww5eg6dfuply4gzjfld2ze`,
      expect: {
        must: {
          http_status_equals: 200,
          response_has_keys: ['v', 'address', 'msg_count', 'tag_distribution', 'reputation_score'],
        },
      },
    },
    {
      // Invalid addr (non-kaspatest: prefix) → 400
      action: 'http_get',
      url: `${CONSOLE_URL}/api/v1/identity/not-a-valid-kaspatest-addr`,
      expect: {
        must: {
          http_status_equals: 400,
        },
      },
    },
  ],
};
