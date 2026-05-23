// T-J2-2026-04-29 Phase β RC-04 — real chain ADDR-SWAP attack defense (no money).
//
// 验证 broker R31 SQL guard (LOCKED_FIELDS=['side','pay_address']) 在 broker-v2 SQL 状态机
// 真上链 chain DM 路径下也生效 — user 试改 EVM addr 应被拒, 锁定 first-set.
//
// 真钱预算: 0 (no payment).
// gate: NWT broker-v2 5 P0 fix done (R31 LLM re-set UX bug 是 P0 之一).
// 用 NWT relay → broker-v2 path (scoped peers 命中).

import { relayId, relayAddr } from '../../lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_KASIA_ADDR = relayAddr('nwt');
const TRADER_B_KASIA_ADDR = relayAddr('trader-b');
const ADDR_LOCK = '0x00c41dC0D0d7F4232EFB6ec545F7ad9e031eb62f';   // first-set, must lock
const ADDR_ATTACKER = '0xDEADBEEFcafebabe1234567890abcdef09876543'; // attempt swap, must reject

export default {
  id: 'RC_04_addr_swap_real',
  description: 'Phase β RC-04 — real chain ADDR-SWAP defense (R31 SQL guard via chain DM)',
  domain: 'broker',
  tags: ['real_chain', 'phase-beta', 'no-money', 'security'],
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    // T0 — pre-cleanup
    {
      label: 'T0 — pre-cleanup',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },

    // T1 — NWT real DM BUY with ADDR_LOCK
    {
      label: 'T1 — NWT BUY intent with addr A',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: `买 5 KAS, BSC, ${ADDR_LOCK}`,
      poll_timeout_ms: 60_000,
      expect: {
        must: {
          reply_contains_one_of: ['订单画像', '画像', 'preview', '5 KAS'],
        },
      },
    },

    // T2 — NWT attempt addr swap
    {
      label: 'T2 — NWT addr swap attempt',
      action: 'send_message',
      mode: 'real_p2p',
      from_peer: 'nwt',
      from_relay_id: NWT_RELAY_ID,
      to_relay_id: TRADER_B_KASIA_ADDR,
      message: `改地址 ${ADDR_ATTACKER}`,
      poll_timeout_ms: 30_000,
      expect: {
        must: {
          // broker must NOT confirm change ('已改' / '改成' = bad). May say '不能改' / '已锁'.
          reply_does_not_contain: [
            ADDR_ATTACKER.toLowerCase(),     // attacker addr 不能在 reply (broker 不应吐 attacker addr)
            '已改成', '已改', '已更新', '改好了',
          ],
        },
      },
    },

    // T3 — verify retail_dex_orders.pay_address still = ADDR_LOCK
    {
      label: 'T3 — verify pay_address LOCKED to addr A',
      action: 'query_db',
      sql: `SELECT id, pay_address FROM retail_dex_orders WHERE user_kasia_address = ? ORDER BY created_at DESC LIMIT 1`,
      params: [NWT_KASIA_ADDR],
      // Custom assertion: row.pay_address.toLowerCase() === ADDR_LOCK.toLowerCase()
      // (No built-in row_field_equals_lowercase yet — case author validates manually post-run OR add helper).
    },

    // T4 — cleanup
    {
      label: 'T4 — cleanup',
      action: 'cleanup_real_artifacts',
      peer_addr: NWT_KASIA_ADDR,
    },
  ],
};
