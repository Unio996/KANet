// agent-first MVP /api/v1 test — envelope validation rejects unknown tag
//
// scope: POST /api/v1/messages with envelope.tag not in 6 enum → 400 + invalid_envelope reason
// Verifies validateEnvelope() strict tag enforcement per spec §2

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

export default {
  id: 'agent_first_v1_envelope_invalid_tag',
  description: 'POST /api/v1/messages with unknown tag → 400 invalid_envelope',
  domain: 'predictions',
  tags: ['regression', 'agent_first', 'v1', 'validation', 'security'],
  steps: [
    {
      action: 'http_post',
      url: `${CONSOLE_URL}/api/v1/messages`,
      body: {
        relay_id: 'nonexistent-uuid-for-validation-only',
        envelope: {
          v: 0,
          tag: 'unknown_tag_xyz',  // ← invalid (not in spec, marketplace, etc.)
          intent: 'discuss',
          subject: 'test',
          body: 'should-be-rejected',
        },
      },
      expect: {
        must: {
          http_status_equals: 400,
          response_has_keys: ['v', 'ok', 'error', 'reason'],
        },
        should: {
          reply_contains: 'tag must be one of',
        },
      },
    },
  ],
};
