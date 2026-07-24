import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

function getKey() {
  const hex = process.env.CONSOLE_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('CONSOLE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

// Codex MSG-124 整改 C 项：密钥链一致性 sanity check——candidate-generate.mjs / reviewed
// insert helper / Console 启动日志三处都要打印"用的是哪把 CONSOLE_ENCRYPTION_KEY"的指纹供
// operator 人工核对，三处必须调同一个 reviewed 函数（非各自抄一遍 sha256 逻辑），否则指纹
// 算法本身出现漂移就失去交叉核对的意义。指纹只是 key 内容的单向摘要前 8 hex，不可逆推出 key。
export function currentKeyFingerprint() {
  return createHash('sha256').update(getKey()).digest('hex').slice(0, 8);
}

export function encrypt(plaintext) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

export function decrypt(envelope) {
  const key = getKey();
  const { iv, tag, ciphertext } = JSON.parse(envelope);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(ciphertext, 'base64')) + decipher.final('utf8');
}

export function encryptIfSensitive(value, isSensitive) {
  if (!isSensitive) return { valueEncrypted: null, valuePlainHint: value };
  return { valueEncrypted: encrypt(value), valuePlainHint: null };
}

export function makeMnemonicHint(mnemonic) {
  if (!mnemonic) return null;
  const words = mnemonic.trim().split(/\s+/);
  return `已配置 (${words.length}词)`;
}

export function makeTokenHint(token) {
  if (!token) return null;
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}
