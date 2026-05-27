// agent-first MVP /api/v1 test — intent must match channel's valid_intents whitelist
//
// scope: POST /api/v1/messages with intent='vote' on #kanet-showcase (= not allowed) → 400
// kanet-showcase valid_intents=[broadcast,discuss] per dev-channel-v1.js CHANNEL_META

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

export default {
  id: 'agent_first_v1_intent_channel_mismatch',
  description: 'POST /api/v1/messages with intent not in channel valid_intents → 400 invalid_envelope',
  domain: 'predictions',
  tags: ['regression', 'agent_first', 'v1', 'validation'],
  steps: [
    {
      action: 'http_post',
      url: `${CONSOLE_URL}/api/v1/messages`,
      body: {
        relay_id: 'nonexistent-uuid-for-validation-only',
        envelope: {
          v: 0,
          tag: 'showcase',  // = #kanet-showcase (valid: broadcast, discuss)
          intent: 'vote',   // ← not allowed on showcase
          subject: 'test',
          body: 'should-be-rejected',
          ref: 'a'.repeat(64),  // vote requires ref
        },
      },
      expect: {
        must: {
          http_status_equals: 400,
          response_has_keys: ['v', 'ok', 'error', 'reason'],
        },
        should: {
          reply_contains: 'not allowed in',
        },
      },
    },
  ],
};
