#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// KANet — 外部程序发一条加密消息到 TN12。可直接运行的最小完整例子。
//
//   node send-comm.mjs --self-check          # 步骤 1+2，不需要节点、不需要币
//   node send-comm.mjs --to <kaspatest:...>  # 完整流程，需要节点 + 余额
//
// 本文件【不依赖 KANet 仓库的任何模块】—— 密码学部分是内联的，你可以整个拷走。
// 唯一的外部依赖是 kaspa-wasm（见 README.md §1「装依赖」）。
// 🔴 本文件是 UTF-8 编码（注释里有中文）—— 用别的编码打开会坏。
//
// 验证过：Node v24.14.1 · Windows 11 · kaspa-wasm 1.1.0（vendored）
// 步骤 1+2 的输出与本网络现役收信实现做过逐字节交叉验证（见 README.md §3.4）。
// 🔴 而 --to 那条分支【只跑到连接节点为止】—— 它之后的代码今天没有环境可以执行。
// ─────────────────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import * as kaspa from './kaspa-wasm/kaspa.js';   // ← 见 README.md §1：把 kaspa-wasm 放这里

const { PrivateKey, NetworkType, RpcClient, Encoding, Generator, Address, PaymentOutput } = kaspa;

// ── 配置（都可以用环境变量覆盖）────────────────────────────────────────────────
const RPC_URL    = process.env.KANET_RPC_URL || '';          // 见 README.md §4：你需要一个 TN12 节点
const NETWORK    = 'testnet-12';                              // 这是网络的真名字
const GENERATOR_NETWORK_ID = 'testnet-10';                    // 🔴 而 Generator 只认这个，见 README.md §6 坑 1
const MY_PRIVKEY = process.env.KANET_PRIVKEY || '';           // 64 位十六进制；留空则新生成一把
const MY_ALIAS   = process.env.KANET_ALIAS || 'my-program';   // 你的名字，非空且不能含冒号

// ─────────────────────────────────────────────────────────────────────────────
// 第 1 步 · 生成密钥与地址
// ─────────────────────────────────────────────────────────────────────────────
function newPrivateKeyHex() {
  return crypto.randomBytes(32).toString('hex');
}

function addressOf(privKeyHex) {
  return new PrivateKey(privKeyHex).toKeypair().toAddress(NetworkType.Testnet).toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// 第 2 步 · 构造加密信封
//   ECDH(secp256k1) + HKDF-SHA256 + ChaCha20-Poly1305
//   输出字节布局： nonce(12) ‖ ephPub(33, 压缩式) ‖ ciphertext(N) ‖ mac(16)
//   其中 N == 明文的 UTF-8 字节数（ChaCha20 是流密码，不扩张）
// ─────────────────────────────────────────────────────────────────────────────
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function convertBits(data, fromBits, toBits) {
  let acc = 0, bits = 0;
  const out = [];
  const maxv = (1 << toBits) - 1;
  for (const v of data) {
    if (v < 0 || (v >> fromBits) !== 0) return null;
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; out.push((acc >> bits) & maxv); }
  }
  if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) return null;
  return out;
}

/**
 * 从 kaspatest: 地址取出 32 字节 x-only 公钥。
 *
 * 🔴 版本字节【必须】检查。地址 payload 的第 0 个字节是版本：
 *      0 = P2PK(schnorr, 32 字节公钥)  ← 只有它能加密
 *      1 = P2PK(ecdsa,  33 字节公钥)
 *      8 = P2SH        (32 字节【脚本哈希】—— 不是公钥)
 *   🔴 P2SH 的哈希【也是 32 字节】⇒ 只查长度会让它整个通过，
 *      于是你会把一段脚本哈希当公钥用来加密，产出一个【谁都解不开】的密文 ——
 *      而它照样上链、照样扣费、照样有 txid、零错误。
 */
function xOnlyPubkeyFromAddress(address) {
  const i = address.indexOf(':');
  if (i === -1) throw new Error('地址缺少 "kaspatest:" 前缀');
  const payload = address.slice(i + 1);
  const data5 = [];
  for (const c of payload) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) throw new Error(`地址含非 bech32 字符 '${c}'`);
    data5.push(idx);
  }
  const bytes = convertBits(data5.slice(0, -8), 5, 8);   // 去掉 8 位校验和
  if (!bytes || bytes.length < 2) throw new Error('地址解码失败');
  const version = bytes[0];
  if (version !== 0) {
    throw new Error(
      `这个地址不是 schnorr P2PK 地址（版本字节 = ${version}，需要 0）。` +
      (version === 8 ? ' 它看起来是一个 P2SH（合约）地址 —— 加密消息发不到那里去。' : '')
    );
  }
  const pub = bytes.slice(1);                            // 版本字节已校验，这里才能安全丢掉
  if (pub.length !== 32) throw new Error(`期望 32 字节公钥，得到 ${pub.length}`);
  return Buffer.from(pub);
}

/** 明文 + 收信方地址 ⇒ 信封字节。 */
function sealEnvelope(plaintext, recipientAddress) {
  const recipient = Buffer.concat([Buffer.from([0x02]), xOnlyPubkeyFromAddress(recipientAddress)]);
  const eph = crypto.createECDH('secp256k1');
  eph.generateKeys();
  const ephPub = eph.getPublicKey(null, 'compressed');           // 33 字节，首字节 0x02 或 0x03
  const shared = eph.computeSecret(recipient);
  const key = crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.alloc(0), 32);
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('chacha20-poly1305', Buffer.from(key), nonce, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(plaintext, 'utf-8'), c.final()]);
  return Buffer.concat([nonce, ephPub, ct, c.getAuthTag()]);
}

/** 逆运算 —— 只用来自检；收信方跑的是同一套。 */
function openEnvelope(envelope, privKeyHex) {
  const nonce = envelope.subarray(0, 12);
  const ephPub = envelope.subarray(12, 45);
  const rest = envelope.subarray(45);
  const ct = rest.subarray(0, rest.length - 16);
  const mac = rest.subarray(rest.length - 16);
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privKeyHex, 'hex'));
  const key = crypto.hkdfSync('sha256', ecdh.computeSecret(ephPub), Buffer.alloc(0), Buffer.alloc(0), 32);
  const d = crypto.createDecipheriv('chacha20-poly1305', Buffer.from(key), nonce, { authTagLength: 16 });
  d.setAuthTag(mac);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf-8');
}

/**
 * 🔴 这一行是整份配方里最容易静默失败的一格。
 * 少了 <alias>: 这一段，收信侧会把整条消息【正确地丢弃】，而你【收不到任何错误】。
 */
function buildCommPayload(alias, envelope) {
  if (!alias || alias.includes(':')) throw new Error('alias 必须非空、且不能含冒号');
  return `ciph_msg:1:comm:${alias}:${envelope.toString('base64')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 第 3 步 · 上链（需要节点 + 余额）
// ─────────────────────────────────────────────────────────────────────────────
async function broadcast(payloadStr, privKeyHex) {
  if (!RPC_URL) {
    throw new Error(
      '没有 RPC 端点。设 KANET_RPC_URL=ws://<host>:17210 —— ' +
      '🔴 而 README.md §4 写着：今天我们没有给外部提供一个够得到的 TN12 节点。'
    );
  }
  const key = new PrivateKey(privKeyHex);
  const myAddress = key.toKeypair().toAddress(NetworkType.Testnet).toString();

  const rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: NETWORK });
  await rpc.connect({});
  const { isSynced } = await rpc.getServerInfo();
  if (!isSynced) console.warn('⚠ 节点未同步完成，交易可能不被接受');

  const { entries } = await rpc.getUtxosByAddresses([new Address(myAddress)]);
  if (!entries.length) throw new Error(`地址 ${myAddress} 上没有 UTXO —— 见 README.md §5（怎么拿测试币）`);

  entries.sort((a, b) => (a.amount < b.amount ? 1 : -1));       // 降序
  const payloadBytes = Buffer.from(payloadStr, 'utf-8');

  // ── KIP-9 storage mass ─────────────────────────────────────────────────────
  // 🔴 这一段不是"多留点手续费"，它是在避开一条会让交易被整个拒绝的规则。
  //
  //   这笔交易是【自发自收】：输出打回自己，找零也回自己。
  //   storage mass ≈ 10¹² × ( Σ(1/每个输出) − Σ(1/每个输入) )，上限 100,000（单位 sompi）。
  //   ⇒ 输出越小，1/输出 越大。把 UTXO 几乎全额打出去 ⇒ 找零是一笔尘埃 ⇒ 冲破上限 ⇒ 被拒。
  //   ⇒ 而输入越多、越碎，Σ(1/输入) 越大，反而把结果拉低 —— 所以“多凑几个输入”是有效的解法。
  //
  //   🔴 踩中时节点只回一句 `Storage mass exceeds maximum`：不提 UTXO、不提找零、
  //      不告诉你该怎么办。所以下面【自己先算一遍】，并在发出去之前用人话拦住你。
  const MASS_LIMIT = 100_000;
  const MIN_CHANGE = 20_000_000n;                                // 0.2 KAS —— 找零不做成尘埃
  const feeByBytes = BigInt(payloadBytes.length) * 1000n + 200000n;
  const feeReserve = feeByBytes + MIN_CHANGE;                    // 预留 = 手续费 + 一笔像样的找零

  const massOf = (ins, outs) => {
    const inv = (v) => 1 / Number(v);
    const si = ins.reduce((a, v) => a + inv(v), 0);
    const so = outs.reduce((a, v) => a + inv(v), 0);
    return Math.max(0, 1e12 * (so - si));
  };
  // 先试最大那一个；不够就把所有 UTXO 一起当输入（输入越多 mass 越低）。
  const pick = (list) => {
    const total = list.reduce((a, e) => a + e.amount, 0n);
    if (total <= feeReserve) return null;
    const main = total - feeReserve;
    const mass = massOf(list.map((e) => e.amount), [main, MIN_CHANGE]);
    return { list, total, main, mass };
  };
  let plan = pick(entries.slice(0, 1));
  if (!plan || plan.mass > MASS_LIMIT) {
    const all = pick(entries);
    if (all && (!plan || all.mass < plan.mass)) plan = all;
  }
  if (!plan) {
    const totalAll = entries.reduce((a, e) => a + e.amount, 0n);
    throw new Error(
      `余额不够：全部 UTXO 合计 ${Number(totalAll) / 1e8} KAS，而这条消息需要预留 ` +
      `${Number(feeReserve) / 1e8} KAS（手续费 ${Number(feeByBytes) / 1e8} + 找零 ${Number(MIN_CHANGE) / 1e8}）。`
    );
  }
  if (plan.mass > MASS_LIMIT) {
    throw new Error(
      `凑不出一笔 KIP-9 允许的交易：算出来的 storage mass = ${Math.round(plan.mass)}，上限 ${MASS_LIMIT}。\n` +
      `   你现在有 ${entries.length} 个 UTXO，合计 ${Number(plan.total) / 1e8} KAS。\n` +
      `   🔵 解法是【让找零别太小】或【多凑几个输入】—— 见 README.md §6 坑 5。`
    );
  }
  const selected = plan.list;
  console.log(`   (KIP-9 storage mass = ${Math.round(plan.mass)} / 上限 ${MASS_LIMIT}，用了 ${selected.length} 个 UTXO)`);

  // comm 是【自发自收】：输出打回自己。收信方能不能读到与输出地址无关。
  const generator = new Generator({
    entries: [best],
    outputs: [new PaymentOutput(new Address(myAddress), best.amount - feeReserve)],
    priorityFee: 0n,
    changeAddress: new Address(myAddress),
    networkId: GENERATOR_NETWORK_ID,          // 🔴 不是 NETWORK，见 README.md §6 坑 1
    payload: new Uint8Array(payloadBytes),    // 🔴 必须 Uint8Array，见 README.md §6
  });

  let pending, txid = '';
  while ((pending = await generator.next())) {
    await pending.sign([key]);
    txid = await pending.submit(rpc);
  }
  await rpc.disconnect();
  if (!txid) throw new Error('没有产生任何交易');
  return txid;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

// 🔴 没设 KANET_PRIVKEY 就【每次运行新生成一把】—— 下面所有输出都会跟着变。
//    这个区别必须打印出来，否则一个照做的人会存下一把、下次再跑发现地址变了。
const keyIsEphemeral = !MY_PRIVKEY;
const privKeyHex = MY_PRIVKEY || newPrivateKeyHex();
const myAddress = addressOf(privKeyHex);

/** 把"这把密钥是哪来的"讲清楚 —— 临时的就说临时，并给出固定它的确切命令。 */
function printIdentity() {
  if (keyIsEphemeral) {
    console.log('🔴 私钥（本次运行【临时生成】，下次再跑会是另一把）:', privKeyHex);
    console.log('   要固定成你的身份，设环境变量再跑：KANET_PRIVKEY=' + privKeyHex);
  } else {
    console.log('✅ 私钥（来自环境变量 KANET_PRIVKEY）:', privKeyHex);
  }
  console.log('   地址                        :', myAddress);
}

if (argv.includes('--self-check')) {
  // 步骤 1+2 的离线自检 —— 不需要节点、不需要币、不上链。
  const plaintext = arg('--text') || 'hello from an external program';
  const envelope = sealEnvelope(plaintext, myAddress);          // 加密给自己，好当场解回来
  const payloadStr = buildCommPayload(MY_ALIAS, envelope);

  printIdentity();
  console.log('');
  console.log('信封总长                    :', envelope.length, 'bytes');
  console.log('  nonce  [0..12)            :', envelope.subarray(0, 12).toString('hex'));
  console.log('  ephPub [12..45)           :', envelope.subarray(12, 45).toString('hex'));
  console.log('  ct     [45..-16)          :', envelope.length - 61, 'bytes  (== 明文 UTF-8 字节数', Buffer.byteLength(plaintext, 'utf8'), ')');
  console.log('  mac    [-16..]            :', envelope.subarray(envelope.length - 16).toString('hex'));
  console.log('');
  console.log('payload 字符串              :', payloadStr);
  console.log('payload hex（上链的就是它） :', Buffer.from(payloadStr, 'utf-8').toString('hex').slice(0, 80) + '…');
  console.log('');

  // 自检 ①：自己能解回来
  const back = openEnvelope(envelope, privKeyHex);
  console.log(back === plaintext ? '✅ 自检 1：信封能被解回原文' : '🔴 自检 1 失败');

  // 自检 ②：长度关系成立（明文字节数 == 密文字节数）
  const lenOk = envelope.length === 12 + 33 + Buffer.byteLength(plaintext, 'utf8') + 16;
  console.log(lenOk ? '✅ 自检 2：长度 = 12+33+明文+16' : '🔴 自检 2 失败 —— 布局对不上');

  // 自检 ③：🔴 阴性对照 —— 少了 alias 段，收信侧【找不到冒号 ⇒ 丢弃】
  const noAlias = `ciph_msg:1:comm:${envelope.toString('base64')}`;
  const dropped = noAlias.indexOf(':', 'ciph_msg:1:comm:'.length) === -1;
  console.log(dropped
    ? '✅ 自检 3（阴性对照）：缺 alias 段的载荷确实会被收信侧丢弃 —— 而它不会给你任何错误'
    : '🔴 自检 3 未达预期');

  // 自检 ④：🔴 拿一个【合约(P2SH)地址】去加密，必须被拒绝。
  //   这个地址是从 redeem = OP_1 算出来的，谁都不拥有它，你可以自己复算。
  //   🔴 为什么单列一条：自检 1–3 都是"加密给自己"，走的永远是 P2PK 地址 ——
  //      它们在这个检查存在与不存在时读数完全相同，所以它们【结构上抓不到这一格】。
  const P2SH_SAMPLE = 'kaspatest:pr89wgtzs5f9qphvrqvhhkqcggsua7j4nwc8npqsmxd9hwjmqlx36gz5l6t4g';
  let rejected = false;
  try { sealEnvelope('x', P2SH_SAMPLE); }
  catch (e) { rejected = /版本字节/.test(String(e.message)); }
  console.log(rejected
    ? '✅ 自检 4（阴性对照）：合约(P2SH)地址被拒绝 —— 而只查长度的实现会放它过去'
    : '🔴 自检 4 未达预期：P2SH 地址没有被拒绝，别用这份代码加密任何东西');

  console.log('\n' + (back === plaintext && lenOk && dropped && rejected
    ? '=== 步骤 1+2 通过。接下来需要一个 TN12 节点和一点测试币 —— 见 README.md §4 / §5。==='
    : '=== 有自检未通过，先别往下走。==='));
  process.exit(0);
}

const to = arg('--to');
if (!to) {
  console.error('用法：\n  node send-comm.mjs --self-check\n  node send-comm.mjs --to <kaspatest:...> [--text "..."]');
  process.exit(2);
}

// 🔴 这条路要花钱，而没设 KANET_PRIVKEY 就是往一把【全新的、余额必为 0 的】密钥上跑。
//    这里直接拦住，而不是让它跑到"没有 UTXO"再报一个指向别处的错。
if (keyIsEphemeral) {
  console.error(
    '🔴 没有设 KANET_PRIVKEY —— 这会用一把【本次运行新生成的】密钥，它上面必然没有余额。\n' +
    '   先跑 `node send-comm.mjs --self-check` 拿到一把，设成 KANET_PRIVKEY 再来。'
  );
  process.exit(2);
}

const plaintext = arg('--text') || 'hello from an external program';
const payloadStr = buildCommPayload(MY_ALIAS, sealEnvelope(plaintext, to));
printIdentity();
console.log('发给    :', to);
let txid;
try {
  txid = await broadcast(payloadStr, privKeyHex);
} catch (e) {
  // 只打消息，不打调用栈 —— 这里的失败几乎都是环境问题，栈帮不上忙。
  console.error('\n🔴 没能发出去：' + (e?.message || e));
  process.exit(1);
}
console.log('txid    :', txid);
console.log('');
console.log('🔴 上链成功【不算数】—— 必须对方实际读到了，才叫接进来了。');
console.log('   而今天你【没有办法自己验证这一步】—— 见 README.md §7。');
