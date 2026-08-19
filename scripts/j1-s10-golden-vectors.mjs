// J1 §10 golden vectors 生成器(2026-08-19) — 按 docs/2026-08-19-s10-pubkey-identity-design.md
// (546) 冻结的 v1 canonical 规范【只读设计文本】独立实现, 供跨实现逐字节对拍。
// 冻结规范(L2 MUST-FIX B, 选 (b)):
//   canonical_bytes = 按固定序 6 字段 [domain, version, network, relayPubkeyXOnly, operation, epoch]
//                     各取 u32be(utf8字节长) ‖ utf8(value) 串接
//   被签字节(message) = "KANET-U1-IDENTITY-v1|" ‖ network ‖ "|" ‖ lowerhex(sha256(canonical_bytes))
// 输出: artifacts/2026-08-19-s10-golden-vectors-v1.json
// ⚠ 签名字段: kaspa-wasm signMessage 实测非确定(BIP340 aux-rand)⇒ example_signature 只可验不可复现;
//   canonical_bytes_hex / sha256 / message 三者是逐字节可复现的对拍锚。
// 复跑: node scripts/j1-s10-golden-vectors.mjs (任意 cwd; vendor 路径相对本文件解析)
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const { PrivateKey, signMessage, verifyMessage } = await import(new URL('../shared/vendor/kaspa-wasm/kaspa.js', import.meta.url).href);

const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const lp = (s) => { const u = Buffer.from(s, 'utf8'); return Buffer.concat([u32be(u.length), u]); };

// 独立实现的 canonical 函数(字段序照设计 L2 表: domain, version, network, relayPubkeyXOnly, operation, epoch)
export function canonicalBytesV1({ network, relayPubkeyXOnly, operation, epoch }) {
  return Buffer.concat([
    lp('KANET-U1-IDENTITY'),
    lp('1'),
    lp(network),
    lp(relayPubkeyXOnly),
    lp(operation),
    lp(epoch),
  ]);
}
export function signedMessageV1(fields) {
  const sha = createHash('sha256').update(canonicalBytesV1(fields)).digest('hex'); // 已是小写
  return `KANET-U1-IDENTITY-v1|${fields.network}|${sha}`;
}

// 向量钥: priv = 1(secp256k1 生成元, 任何实现可独立重现同一 x-only pubkey)
const PRIV_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const priv = new PrivateKey(PRIV_HEX);
const pub = priv.toKeypair().xOnlyPublicKey.toString().toLowerCase();

const cases = [
  { name: 'V1-testnet-register', fields: { network: 'testnet-12', relayPubkeyXOnly: pub, operation: 'register', epoch: 'golden-epoch-0001' } },
  { name: 'V2-mainnet-register', fields: { network: 'mainnet', relayPubkeyXOnly: pub, operation: 'register', epoch: 'golden-epoch-0001' } },
  { name: 'V3-testnet-epoch2', fields: { network: 'testnet-12', relayPubkeyXOnly: pub, operation: 'register', epoch: 'golden-epoch-0002' } },
];

const vectors = cases.map(({ name, fields }) => {
  const cb = canonicalBytesV1(fields);
  const msg = signedMessageV1(fields);
  const sig = signMessage({ message: msg, privateKey: priv });
  if (verifyMessage({ message: msg, signature: sig, publicKey: pub }) !== true) throw new Error(`${name}: self-verify failed`);
  return {
    name, fields,
    canonical_bytes_hex: cb.toString('hex'),
    canonical_sha256: createHash('sha256').update(cb).digest('hex'),
    signed_message: msg,
    example_signature_verifiable_not_reproducible: sig,
  };
});

// 互异性自检: 三向量的 message 两两不同(network/epoch 变化必须改变被签字节)
const msgs = vectors.map(v => v.signed_message);
if (new Set(msgs).size !== msgs.length) throw new Error('向量 message 出现重复 — 编码没把差异带进被签字节');

const out = {
  spec: 'docs/2026-08-19-s10-pubkey-identity-design.md L2 MUST-FIX B frozen (b) length-prefixed v1',
  spec_commit: '22aeb959',
  generator: 'scripts/j1-s10-golden-vectors.mjs (J1 independent implementation from spec text)',
  key: { private_key_hex: PRIV_HEX, note: 'priv=1 test-only key, NEVER production', relayPubkeyXOnly: pub },
  signature_note: 'kaspa-wasm signMessage measured NON-deterministic (aux-rand); reproduce canonical_bytes/sha256/message byte-exact, verify example signature with verifyMessage',
  vectors,
};
const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts', '2026-08-19-s10-golden-vectors-v1.json');
writeFileSync(path, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('written', path);
for (const v of vectors) console.log(`${v.name}: sha256=${v.canonical_sha256.slice(0, 16)}… msg="${v.signed_message.slice(0, 48)}…" verify=OK`);
