// §10 C1 · S10 信封验证器离线确定性测试 (2026-08-27 J2)。跑: node kasia-console/src/lib/u1-s10-identity.test.mjs
// 🔴 零 DB、零 IPC、零节点: 只用 kaspa-wasm 签/验 + golden vectors。向量 u1-s10-identity.vectors.json; 任一红 ⇒ 退出码 1。
// 🔴 G1 期望值【直接读】artifacts/2026-08-19-s10-golden-vectors-v1.json, 不由被测 canonicalBytes 现生成(自证无信息) ——
//    该 golden 的 generator = J1 从 spec 独立实现(COORD-LEDGER (547)) ⇒ 本文件对拍的是真独立 oracle, canonical GREEN 满(NWT C1 审 2026-08-27; 原"provisional-until-J1"作废)。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { S10_DOMAIN, S10_VERSION, S10_REJECT, S10_OPERATIONS, S10_NETWORKS, canonicalBytes, s10Prefix, s10CanonicalSha256Hex, s10SignedMessage, assertCanonicalPubkey, verifyS10Envelope } from './u1-s10-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const V = JSON.parse(readFileSync(join(HERE, 'u1-s10-identity.vectors.json'), 'utf8'));
const GOLDEN = JSON.parse(readFileSync(join(REPO, V.golden_file), 'utf8'));
const { PrivateKey, signMessage } = await import('kaspa-wasm');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass += 1; console.log(`[PASS] ${name}`); } catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); } };

// test-only 钥 (priv=1, golden 同钥; NEVER production)
const priv1 = new PrivateKey(V.test_key_priv_hex);
const PK1 = GOLDEN.key.relayPubkeyXOnly;
const priv2 = new PrivateKey('0'.repeat(63) + '2');
const PK2 = priv2.toPublicKey().toXOnlyPublicKey().toString();
assert.strictEqual(priv1.toPublicKey().toXOnlyPublicKey().toString(), PK1, 'priv=1 x-only 须等于 golden key');

const baseFields = (over = {}) => ({ domain: S10_DOMAIN, version: S10_VERSION, network: 'testnet-12', relayPubkeyXOnly: PK1, operation: 'register', epoch: 'c1-epoch-001', ...over });
const signEnv = (fields, priv = priv1) => ({ ...fields, signature: signMessage({ message: s10SignedMessage(fields), privateKey: priv }) });
const subst = (v) => ({ '$PRIV2_XONLY': PK2, '$UPPER': PK1.toUpperCase(), '$SHORT63': PK1.slice(0, 63), '$WITH0X': '0x' + PK1, '$NONHEX': 'zz' + PK1.slice(2), '$GARBAGE128': 'ab'.repeat(64) })[v] ?? v;

for (const c of V.cases) {
  if (c.type === 'golden') {
    await t(c.id + ' · ' + c.desc, async () => {
      assert.strictEqual(GOLDEN.vectors.length, 3, 'golden 须 3 向量');
      for (const g of GOLDEN.vectors) {
        const f = { domain: S10_DOMAIN, version: S10_VERSION, ...g.fields };
        assert.strictEqual(canonicalBytes(f).toString('hex'), g.canonical_bytes_hex, `${g.name} canonical_bytes`);
        assert.strictEqual(s10CanonicalSha256Hex(f), g.canonical_sha256, `${g.name} sha256`);
        assert.strictEqual(s10SignedMessage(f), g.signed_message, `${g.name} signed_message`);
        // 前缀派生 = 消息前缀
        assert.ok(g.signed_message.startsWith(s10Prefix()), `${g.name} prefix`);
        const r = await verifyS10Envelope({ ...f, signature: g.example_signature_verifiable_not_reproducible }, { localNetwork: g.fields.network });
        assert.ok(r.ok, `${g.name} example_signature verify: ${r.code} ${r.reason}`);
        assert.strictEqual(r.relayPubkeyXOnly, g.fields.relayPubkeyXOnly);
      }
    });
  } else if (c.type === 'positive') {
    await t(c.id + ' · ' + c.desc, async () => {
      const env = signEnv(baseFields({ network: c.network, epoch: c.epoch }));
      const r = await verifyS10Envelope(env, { localNetwork: c.network });
      assert.ok(r.ok, `${r.code} ${r.reason}`);
      assert.strictEqual(r.relayPubkeyXOnly, PK1); assert.strictEqual(r.epoch, c.epoch); assert.strictEqual(r.operation, 'register');
      assert.strictEqual(r.signedMessage, s10SignedMessage(env));
      // 同钥两次签同消息不相等(非确定) —— 记录事实, 不作锚
      const env2 = signEnv(baseFields({ network: c.network, epoch: c.epoch }));
      assert.notStrictEqual(env.signature, env2.signature, 'signMessage 应非确定(aux-rand); 若相等说明库行为变了, 向量锚假设须重审');
    });
  } else if (c.type === 'mutate') {
    await t(c.id + ' · ' + c.desc, async () => {
      const env = signEnv(baseFields());
      for (const [k, v] of Object.entries(c.mutate || {})) env[k] = subst(v);
      const localNetwork = c.localNetwork === undefined ? 'testnet-12' : c.localNetwork;
      const r = await verifyS10Envelope(env, { localNetwork });
      assert.strictEqual(r.ok, false, '须拒');
      assert.strictEqual(r.code, S10_REJECT[c.expect], `期望 ${c.expect}(${c.layer}), 实际 ${r.code}: ${r.reason}`);
    });
  } else if (c.type === 'resign') {
    await t(c.id + ' · ' + c.desc, async () => {
      const env = signEnv(baseFields(c.fields));   // 合法签名(签的就是这个 operation)
      const r = await verifyS10Envelope(env, { localNetwork: 'testnet-12' });
      assert.strictEqual(r.ok, false); assert.strictEqual(r.code, S10_REJECT[c.expect], `期望 ${c.expect}, 实际 ${r.code}: ${r.reason}`);
      // 对照: 同签名若 operation 在白名单里, 那份签名对它无效(消息不同) —— 说明拒的是白名单, 不是签名
      const alt = { ...env, operation: 'register' }; const r2 = await verifyS10Envelope(alt, { localNetwork: 'testnet-12' });
      assert.strictEqual(r2.code, S10_REJECT.SIGNATURE_INVALID, '改回 register 后签名应对不上(证明原签名确为 rotate 消息所出)');
    });
  } else if (c.type === 'a2pop') {
    await t(c.id + ' · ' + c.desc, async () => {
      // A2 PoP 材料 = 对 64-hex blake2b 串的签名(u1-registration-pop.mjs:61/:129 形); 这里用 sha256 hex 模拟同形(64-hex 消息空间)
      const popLikeMessage = createHash('sha256').update('kanet.u1.registration.pop.v1\nfake').digest('hex');
      assert.match(popLikeMessage, /^[0-9a-f]{64}$/);
      const popSig = signMessage({ message: popLikeMessage, privateKey: priv1 });
      const env = { ...baseFields(), signature: popSig };
      const r = await verifyS10Envelope(env, { localNetwork: 'testnet-12' });
      assert.strictEqual(r.ok, false); assert.strictEqual(r.code, S10_REJECT[c.expect], `期望 ${c.expect}, 实际 ${r.code}: ${r.reason}`);
      // 反向的一半: S10 消息空间不是 64-hex(带前缀), 结构上不可能被当 A2 PoP 的 message 用 —— 形状断言
      assert.doesNotMatch(s10SignedMessage(baseFields()), /^[0-9a-f]{64}$/);
    });
  } else if (c.type === 'shape') {
    await t(c.id + ' · ' + c.desc, async () => {
      let env = c.raw !== undefined ? c.raw : signEnv(baseFields());
      if (c.extraKeys) env = { ...env, ...c.extraKeys };
      for (const k of (c.deleteKeys || [])) delete env[k];
      const r = await verifyS10Envelope(env, { localNetwork: 'testnet-12' });
      assert.strictEqual(r.ok, false); assert.strictEqual(r.code, S10_REJECT[c.expect], `期望 ${c.expect}, 实际 ${r.code}: ${r.reason}`);
    });
  } else if (c.type === 'prefix') {
    await t(c.id + ' · ' + c.desc, async () => {
      assert.strictEqual(s10Prefix(), 'KANET-U1-IDENTITY-v1|');
      assert.strictEqual(s10Prefix('KANET-U1-IDENTITY', '2'), 'KANET-U1-IDENTITY-v2|');
      const f = baseFields(); const m = s10SignedMessage(f);
      assert.strictEqual(m.split('|')[1], f.network, '外层 network = canonical.network(同源)');
      assert.strictEqual(m.split('|')[2], s10CanonicalSha256Hex(f));
    });
  }
}
// 常量冻结与 L1 直测
await t('常量: S10_OPERATIONS 冻结且只含 register; S10_NETWORKS 闭枚举; S10_REJECT 冻结', async () => {
  assert.ok(Object.isFrozen(S10_OPERATIONS) && S10_OPERATIONS.length === 1 && S10_OPERATIONS[0] === 'register');
  assert.deepStrictEqual([...S10_NETWORKS], ['testnet-12', 'mainnet']); assert.ok(Object.isFrozen(S10_REJECT));
});
await t('L1 直测: assertCanonicalPubkey 大写归一被拒、规范通过、parseXOnly 注入 throw ⇒ 拒', async () => {
  assert.strictEqual((await assertCanonicalPubkey(PK1.toUpperCase())).code, S10_REJECT.PUBKEY_NOT_CANONICAL);
  assert.ok((await assertCanonicalPubkey(PK1)).ok);
  assert.strictEqual((await assertCanonicalPubkey(PK1, { parseXOnly: () => { throw new Error('boom'); } })).code, S10_REJECT.PUBKEY_NOT_CANONICAL);
});
await t('验证器不读环境: 不传 localNetwork 即拒(无 process.env 回落)', async () => {
  const env = signEnv(baseFields()); const r = await verifyS10Envelope(env, {});
  assert.strictEqual(r.code, S10_REJECT.NETWORK_MISMATCH);
});
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
