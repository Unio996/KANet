// agent-first MVP /api/v1 test — envelope > 4500B chain payload safety cap
//
// scope: POST /api/v1/messages with body inflated past MAX_ENVELOPE_BYTES → 400
// Protects against Kaspa TX 5000-char payload hard cap (4500B safety margin per spec §10)

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

export default {
  id: 'agent_first_v1_envelope_size_cap',
  description: 'POST /api/v1/messages with envelope > 4500B → 400 (chain payload cap)',
  domain: 'predictions',
  tags: ['regression', 'agent_first', 'v1', 'validation', 'chain_safety'],
  steps: [
    {
      action: 'http_post',
      url: `${CONSOLE_URL}/api/v1/messages`,
      body: {
        relay_id: 'nonexistent-uuid-for-validation-only',
        envelope: {
          v: 0,
          tag: 'general',
          intent: 'broadcast',
          subject: 'size-cap test',
          // body = 4500 chars (max allowed by body validator), JSON wrapping pushes envelope past MAX_ENVELOPE_BYTES=4500
          body: 'X'.repeat(4500),
        },
      },
      expect: {
        must: {
          http_status_equals: 400,
          response_has_keys: ['v', 'ok', 'error', 'reason'],
        },
        should: {
          reply_contains: 'chain payload cap',
        },
      },
    },
  ],
};
