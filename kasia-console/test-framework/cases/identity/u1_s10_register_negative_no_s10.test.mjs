// §10 C3 · 框架层薄壳(切片计划 16ecff6d §4 第 2 层): 活 console 的【不落库负向】行为回归 —— 六字段合法形但【无 s10】⇒ 400 RELAY_NOT_OWNED。
//
// 🔴 门的归属(Bettor 澄清): 本 case 打的是【活 console】, 需 v198 + C3 已在 live 库/进程 ⇒ 属【后部署验收】(D-005 独立迁移 Owner 拍后),
//    不在 C1–C3 的 pre-deploy 门内(那一层 = src/lib/u1-registration.test.mjs 等 standalone 离线用例, 临时库真迁移)。
//    部署前跑它 = 红(live handler 还不认 s10, 会在 PoP 层拒成别的码) —— 那是"未部署"的正确信号, 不是本 case 坏。
// 🔵 为什么不需要签名/真挑战: §10 预筛排在 PoP 之前(u1-registration.mjs ②-e), 缺 s10 在到达挑战/签名校验之前就被拒 ⇒
//    零写入(不消费挑战、不建行)。rootXpub/identityPubkeyXOnly 是一次性随机助记词的【公开材料】(派生绑定要过 ②-a), 私钥未落任何文件。
// ⚠ relay 须是 mnemonic 托管形(N4-bis 在 §10 之前): 若 relayId('trader-b') 在 live 上不是 mnemonic 型, 会先拒 CUSTODY_NOT_MNEMONIC ⇒ 换一个 mnemonic 型 relay 别名。
// 跑: cd kasia-console && node scripts/test.mjs --case=test-framework/cases/identity/u1_s10_register_negative_no_s10.test.mjs
import { relayId } from '../../lib/peers.mjs';

const CHALLENGE = 'fw-s10-neg-no-s10-' + Date.now().toString(36);   // 未签发的串: 到不了 PoP, 只作零写入断言的键
const ROOT_XPUB = 'kpub2JnaGGVNDq9eV67Mx4czXnYC7Xfdfxg8Rd5xSVBoc4WEqtAMTgvKXxfCkDTxQfSr6igJhRvDQ4pxM7PbU1G1K9NxxVLsjkjYpAHcJAa1PvB';
const IDENTITY_PUBKEY = '999ee5f8bb376db634f932bea3fb88f6ec9931f475e77441f94fc9ec0034afcd';   // = deriveIdentityPubkey(ROOT_XPUB, 0)

export default {
  id: 'u1_s10_register_negative_no_s10',
  description: '§10 C3 后部署验收: 六字段合法形但无 s10 ⇒ 400 RELAY_NOT_OWNED, 挑战未消费, 身份表零行(不落库负向)',
  domain: 'identity',
  tags: ['regression', 's10', 'negative', 'post-deploy'],
  skip_in_batch: true,   // 后部署验收, 显式 --case= 跑; 部署前必红(见文件头)
  steps: [
    {
      action: 'http_post',
      url: '/api/identity/u1-register',
      body: {
        relayId: relayId('trader-b'),
        rootXpub: ROOT_XPUB,
        identityIndex: 0,
        identityPubkeyXOnly: IDENTITY_PUBKEY,
        challenge: CHALLENGE,
        signature: 'deadbeef',
        // 无 s10
      },
      expect: {
        must: {
          http_status_equals: 400,
          reply_contains: '"code":"RELAY_NOT_OWNED"',
          query_db: { sql: 'SELECT COUNT(*) AS n FROM u1_relay_identity WHERE epoch = ?', params: [CHALLENGE], expected_row: { n: 0 } },
        },
      },
    },
    {
      action: 'query_db',
      sql: 'SELECT COUNT(*) AS n FROM u1_identity_challenge WHERE challenge = ? AND used_at IS NOT NULL',
      params: [CHALLENGE],
      expect: { must: { row_field_equals: { n: 0 } } },
    },
  ],
};
