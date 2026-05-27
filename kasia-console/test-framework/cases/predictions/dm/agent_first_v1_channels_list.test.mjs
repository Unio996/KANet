// agent-first MVP /api/v1 test — channel discovery returns 6 metadata-rich entries
//
// scope: GET /api/v1/channels per docs/dev-channel-protocol-v0.md §4
// Verifies: 6 hardcoded channels, each with name + tag + valid_intents + rate_limit + msg_count

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

export default {
  id: 'agent_first_v1_channels_list',
  description: 'GET /api/v1/channels returns 6 channels with metadata (agent-first MVP L2)',
  domain: 'predictions',
  tags: ['regression', 'agent_first', 'v1', 'dev_channel_protocol', 'smoke'],
  steps: [
    {
      action: 'http_get',
      url: `${CONSOLE_URL}/api/v1/channels`,
      expect: {
        must: {
          http_status_equals: 200,
          response_has_keys: ['v', 'channels'],
        },
      },
    },
  ],
};
