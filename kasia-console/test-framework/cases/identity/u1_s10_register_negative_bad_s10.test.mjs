// §10 C3 · 框架层薄壳(切片计划 16ecff6d §4 第 2 层): 活 console 的【不落库负向】行为回归 —— s10 由【另一把钥】签(golden V1, priv=1 test-only 钥)
//    ⇒ 信封本身合法(验签过、epoch===challenge), 但那把钥不是 relay 地址钥 ⇒ 400 RELAY_NOT_OWNED(若 live 配的是 mainnet ⇒ 先 S10_INVALID/NETWORK_MISMATCH)。
//
// 🔴 门的归属(Bettor 澄清): 后部署验收(需 v198 + C3 已 live), 不在 C1–C3 的 pre-deploy 门内; 部署前跑 = 红 = "未部署"信号。
// 🔵 golden V1 = artifacts/2026-08-19-s10-golden-vectors-v1.json 的 V1-testnet-register(J1 独立实现对拍), 其 example_signature 可验不可复现;
//    challenge 取 = 向量 epoch 'golden-epoch-0001'(未签发 ⇒ 到不了 PoP; §10 预筛在 PoP 之前, 绑定失败即拒, 零写入)。
// ⚠ relay 须 mnemonic 托管形(见 no_s10 case 头)。
// 跑: cd kasia-console && node scripts/test.mjs --case=test-framework/cases/identity/u1_s10_register_negative_bad_s10.test.mjs
import { relayId } from '../../lib/peers.mjs';

const GOLDEN_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';   // priv=1 test-only 钥(NEVER production)
const GOLDEN_EPOCH = 'golden-epoch-0001';
const GOLDEN_V1_SIGNATURE = 'ffd35525bc99777cc14b248f51fb19a90efe01dfe1dc77aa108cfebdc3dc4708d6e986805de56d07324ff44d0f16e8fb84be40d5e4848c33456c1a390e6ff094';   // = golden V1 example_signature_verifiable_not_reproducible(逐字复制自 artifacts)
const ROOT_XPUB = 'kpub2JnaGGVNDq9eV67Mx4czXnYC7Xfdfxg8Rd5xSVBoc4WEqtAMTgvKXxfCkDTxQfSr6igJhRvDQ4pxM7PbU1G1K9NxxVLsjkjYpAHcJAa1PvB';
const IDENTITY_PUBKEY = '999ee5f8bb376db634f932bea3fb88f6ec9931f475e77441f94fc9ec0034afcd';

export default {
  id: 'u1_s10_register_negative_bad_s10',
  description: '§10 C3 后部署验收: s10 由非 relay 地址钥(golden priv=1)合法签 ⇒ 400 RELAY_NOT_OWNED(mainnet 配置则 S10_INVALID), 零写入',
  domain: 'identity',
  tags: ['regression', 's10', 'negative', 'post-deploy'],
  skip_in_batch: true,
  steps: [
    {
      action: 'http_post',
      url: '/api/identity/u1-register',
      body: {
        relayId: relayId('trader-b'),
        rootXpub: ROOT_XPUB,
        identityIndex: 0,
        identityPubkeyXOnly: IDENTITY_PUBKEY,
        challenge: GOLDEN_EPOCH,
        signature: 'deadbeef',
        s10: {
          domain: 'KANET-U1-IDENTITY', version: '1', network: 'testnet-12',
          relayPubkeyXOnly: GOLDEN_PUBKEY, operation: 'register', epoch: GOLDEN_EPOCH,
          signature: GOLDEN_V1_SIGNATURE,
        },
      },
      expect: {
        must: {
          http_status_equals: 400,
          reply_contains_one_of: ['"code":"RELAY_NOT_OWNED"', '"code":"S10_INVALID"'],
          query_db: { sql: 'SELECT COUNT(*) AS n FROM u1_relay_identity WHERE relay_pubkey_xonly = ?', params: [GOLDEN_PUBKEY], expected_row: { n: 0 } },
        },
      },
    },
  ],
};
