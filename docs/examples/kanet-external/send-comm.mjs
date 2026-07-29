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
 * 从地址取出 32 字节 x-only 公钥。
 *
 * 🔴 分工是刻意的：**校验交给 kaspa-wasm 自己的 `Address` 解析器，这里只负责取字节。**
 *
 *   自己手写地址校验会漏掉整类问题，而漏掉的那类不会报错 ——
 *   它会让你加密到一把错的公钥，产出一笔【照样上链、照样扣费、照样有 txid】的交易。
 *   `new Address(s)` 会拒绝：校验和被改过的地址、别的网络的地址、乱前缀、没前缀。
 *
 *   🔴 而它拒绝时只抛一句 `unreachable` —— 什么都不说。所以下面把它翻译成人话。
 *
 *   还要额外检查两样（`Address` 接受、而我们不能接受的）：
 *     · `prefix` 必须是 kaspatest —— 主网地址是合法地址，但不是这个网络的
 *     · `version` 必须是 PubKey —— ScriptHash(P2SH，合约地址) 的脚本哈希也是 32 字节，
 *       只看长度会让它整个通过，而加密到它 = 谁都解不开
 */
function xOnlyPubkeyFromAddress(address) {
  let parsed;
  try {
    parsed = new Address(String(address));
  } catch {
    throw new Error(
      `这个地址解析不了：${String(address).slice(0, 24)}…\n` +
      `   （校验和不对、前缀不对、或者根本不是一个 Kaspa 地址。原始报错是一句什么都不说的 "unreachable"，所以这里换成了这句。）`
    );
  }
  if (parsed.prefix !== 'kaspatest') {
    throw new Error(`这个地址属于网络 "${parsed.prefix}"，而本例只发 TN12（前缀 kaspatest）。`);
  }
  if (parsed.version !== 'PubKey') {
    throw new Error(
      `这个地址的类型是 ${parsed.version}，而加密消息只能发给 PubKey 类型的地址。` +
      (parsed.version === 'ScriptHash' ? ' 它是一个 P2SH（合约）地址 —— 发不到那里去。' : '')
    );
  }
  // 走到这里，校验和/前缀/类型都由规范解析器确认过了，下面只做一次纯粹的取字节。
  const data5 = [];
  for (const c of parsed.payload) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) throw new Error(`地址含非 bech32 字符 '${c}'`);
    data5.push(idx);
  }
  const bytes = convertBits(data5.slice(0, -8), 5, 8);   // 校验和已由 Address 验过，这里才能安全丢掉
  if (!bytes || bytes.length < 2) throw new Error('地址解码失败');
  const pub = bytes.slice(1);                            // 版本字节同上
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
// 选输入 · KIP-9 storage mass
//
// 🔴 这一段不是"多留点手续费"，它是在避开一条会让交易被整个拒绝的规则。
//
//   这笔交易是【自发自收】：输出打回自己，找零也回自己。
//   storage mass ≈ 10¹² × ( Σ(1/每个输出) − Σ(1/每个输入) )，上限 100,000（单位 sompi）。
//   ⇒ 输出越小，1/输出 越大。把 UTXO 几乎全额打出去 ⇒ 找零是一笔尘埃 ⇒ 冲破上限 ⇒ 被拒。
//   ⇒ 而输入越多、越碎，Σ(1/输入) 越大，反而把结果拉低 —— 所以“多凑几个输入”是有效的解法。
//
//   🔴 踩中时节点只回一句 `Storage mass exceeds maximum`：不提 UTXO、不提找零、
//      不告诉你该怎么办。所以这里【自己先算一遍】，并在发出去之前用人话拦住你。
//
// 🔵 它被单独拆成一个函数，是为了让 `--self-check` 也能跑到它（见自检 5）——
//    否则这段代码只有在"有节点 + 有币"时才会被执行一次，而那是它最容易带着错的时候。
// ─────────────────────────────────────────────────────────────────────────────
const MASS_LIMIT = 100_000;
const MIN_CHANGE = 20_000_000n;                                  // 0.2 KAS —— 找零不做成尘埃

function massOf(ins, outs) {
  const inv = (v) => 1 / Number(v);
  return Math.max(0, 1e12 * (outs.reduce((a, v) => a + inv(v), 0) - ins.reduce((a, v) => a + inv(v), 0)));
}

/** entries: [{amount: BigInt}, …]（降序无所谓，内部会排）。返回 {list, total, main, mass, feeReserve}。 */
function planInputs(entries, payloadStr) {
  const sorted = [...entries].sort((a, b) => (a.amount < b.amount ? 1 : -1));   // 降序
  const payloadBytes = Buffer.from(payloadStr, 'utf-8');
  const feeByBytes = BigInt(payloadBytes.length) * 1000n + 200000n;
  const feeReserve = feeByBytes + MIN_CHANGE;

  const pick = (list) => {
    const total = list.reduce((a, e) => a + e.amount, 0n);
    if (total <= feeReserve) return null;
    const main = total - feeReserve;
    return { list, total, main, feeReserve, mass: massOf(list.map((e) => e.amount), [main, MIN_CHANGE]) };
  };

  let plan = pick(sorted.slice(0, 1));                            // 先试最大那一个
  if (!plan || plan.mass > MASS_LIMIT) {                          // 不够就全用上（输入越多 mass 越低）
    const all = pick(sorted);
    if (all && (!plan || all.mass < plan.mass)) plan = all;
  }
  if (!plan) {
    const totalAll = sorted.reduce((a, e) => a + e.amount, 0n);
    throw new Error(
      `余额不够：全部 UTXO 合计 ${Number(totalAll) / 1e8} KAS，而这条消息需要预留 ` +
      `${Number(feeReserve) / 1e8} KAS（手续费 ${Number(feeByBytes) / 1e8} + 找零 ${Number(MIN_CHANGE) / 1e8}）。`
    );
  }
  if (plan.mass > MASS_LIMIT) {
    throw new Error(
      `凑不出一笔 KIP-9 允许的交易：算出来的 storage mass = ${Math.round(plan.mass)}，上限 ${MASS_LIMIT}。\n` +
      `   你现在有 ${sorted.length} 个 UTXO，合计 ${Number(plan.total) / 1e8} KAS。\n` +
      `   🔵 解法是【让找零别太小】或【多凑几个输入】—— 见 README.md §6 坑 5。`
    );
  }
  return plan;
}

/**
 * 用 planInputs() 的结果造交易。
 *
 * 🔴 它必须与 planInputs() 用【同一个 plan 对象】——
 *    否则打印出来的 mass 描述的是一笔交易，真正广播的是另一笔，而两者没有任何东西会去比对。
 * 🔵 单独成函数同样是为了让 `--self-check` 能真跑到它（见自检 6）。
 */
function buildGenerator(plan, myAddress, payloadStr) {
  // comm 是【自发自收】：输出打回自己。收信方能不能读到与输出地址无关。
  return new Generator({
    entries: plan.list,                                    // 🔴 与算 mass 用的是同一批
    outputs: [new PaymentOutput(new Address(myAddress), plan.main)],
    priorityFee: 0n,
    changeAddress: new Address(myAddress),
    networkId: GENERATOR_NETWORK_ID,                       // 🔴 不是 NETWORK，见 README.md §6 坑 1
    payload: new Uint8Array(Buffer.from(payloadStr, 'utf-8')),  // 🔴 必须 Uint8Array，见 README.md §6
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 第 3 步 · 上链（需要节点 + 余额）
// ─────────────────────────────────────────────────────────────────────────────
async function broadcast(payloadStr, privKeyHex) {
  if (!RPC_URL) {
    throw new Error(
      '没有 RPC 端点。\n' +
      '   🔵 而这个端点应当是【你自己的】TN12 节点 —— 不需要我们给你任何东西。\n' +
      '   TN12 就是标准的 kaspad testnet：kaspad --testnet --netsuffix=12 --utxoindex\n' +
      '   （实测：一台全新机器、不给任何 --addpeer，它自己查 DNS seeder 找到同伴并开始同步；\n' +
      '     🟡 而"要多久追到链尖"我们没有那个数 —— 别按时间预期排计划。）\n' +
      '   起好之后：KANET_RPC_URL=ws://127.0.0.1:17210 —— 详见 README.md §4。'
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

  const plan = planInputs(entries, payloadStr);                 // 见上面 planInputs()，失败会抛
  console.log(`   (KIP-9 storage mass = ${Math.round(plan.mass)} / 上限 ${MASS_LIMIT}，用了 ${plan.list.length} 个 UTXO)`);

  const generator = buildGenerator(plan, myAddress, payloadStr);

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

/**
 * 把"这把密钥是哪来的"讲清楚 —— 而**默认绝不把密钥本身打出来**。
 *
 * 🔴 为什么这么设计（这一条是被审出来的，不是我们一开始就想到的）：
 *   终端输出会落到 CI 日志、贴给别人的排查记录、录屏、截图、进程包装器的日志里。
 *   一个把长期身份密钥打到 stdout 的例子，即使在测试网上，也是在教人用不安全的方式对待密钥。
 *
 * 规则：
 *   · 来自 KANET_PRIVKEY 的那把 —— **任何情况下都不打印**（它是你长期持有的东西）
 *   · 本次运行临时生成的那把 —— 默认也不打印；要看它，显式加 `--reveal-new-private-key`
 *
 * 返回要打印的行（而不是直接打印），是为了让自检能断言"这些行里没有密钥"。
 */
function identityLines() {
  const out = [];
  if (keyIsEphemeral) {
    out.push('🔴 本次运行【临时生成】了一把密钥 —— 下次再跑会是另一把，地址也会跟着变。');
    if (argv.includes('--reveal-new-private-key')) {
      out.push('⚠️  你要求显示它。下面这一行是密钥本身 —— 不要贴进任何日志、聊天或截图：');
      out.push('    KANET_PRIVKEY=' + privKeyHex);
    } else {
      out.push('   要把它固定成你的身份：重跑并加 --reveal-new-private-key 拿到它，');
      out.push('   然后设进环境变量 KANET_PRIVKEY（本例默认不打印密钥）。');
    }
  } else {
    out.push('✅ 身份来自环境变量 KANET_PRIVKEY（本例不回显它的值）。');
  }
  out.push('   地址: ' + myAddress);
  return out;
}

function printIdentity() {
  for (const line of identityLines()) console.log(line);
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
  //   🔴 而这里断言的是【它被拒绝了】，不是【报错里有某句话】——
  //      本条上一版断言的是报错文案，于是换了一种更好的实现之后它当场报红，
  //      而那一版其实拒得更严。**断言要盯住要紧的那个谓词，不是盯住它此刻的措辞。**
  let rejected = false;
  try { sealEnvelope('x', P2SH_SAMPLE); }
  catch { rejected = true; }
  console.log(rejected
    ? '✅ 自检 4（阴性对照）：合约(P2SH)地址被拒绝 —— 而只查长度的实现会放它过去'
    : '🔴 自检 4 未达预期：P2SH 地址没有被拒绝，别用这份代码加密任何东西');

  // 自检 ⑤：🔴 把【选输入 + 算 mass】那段真跑一遍，用假的 UTXO，不需要节点。
  //   它存在的理由很具体：那段代码原本只有"有节点 + 有币"时才会被执行，
  //   而它在那之前已经带着一个 `best is not defined` 上过线一次。
  let planOk = false;
  try {
    const fake = [{ amount: 69_530_000n }, { amount: 44_940_000n }, { amount: 44_710_000n }];
    const p1 = planInputs(fake, payloadStr);
    // 只用得着最大那一个，且 mass 在限内
    const single = p1.list.length === 1 && p1.mass < MASS_LIMIT;
    // 而一个全是小额的钱包应当被"合并输入"救回来
    const tiny = [{ amount: 12_000_000n }, { amount: 12_000_000n }, { amount: 12_000_000n }];
    const p2 = planInputs(tiny, payloadStr);
    const merged = p2.list.length === 3 && p2.mass < MASS_LIMIT;
    // 而余额真不够时必须抛错，不是悄悄返回一个坏计划
    let refused = false;
    try { planInputs([{ amount: 1_000_000n }], payloadStr); } catch { refused = true; }
    planOk = single && merged && refused;
    console.log(planOk
      ? `✅ 自检 5：选输入那段能跑（单 UTXO mass=${Math.round(p1.mass)}／合并 3 个 mass=${Math.round(p2.mass)}／余额不足会抛错）`
      : `🔴 自检 5 未达预期：single=${single} merged=${merged} refused=${refused}`);
  } catch (e) {
    console.log('🔴 自检 5 挂了：' + (e?.message || e) + '　← 选输入那段有问题，别用它发交易');
  }

  // 自检 ⑥：🔴 把【真正造交易】那一步也跑一遍，用一个形状完整的假 UTXO，不需要节点。
  //   它存在的理由同样具体：这一步曾两次带着错上线（一次逻辑、一次 `best is not defined`），
  //   而两次都是"第一次真执行"才暴露 —— 因为在此之前没有任何东西会执行到它。
  //   🔵 而它还顺带守住一件更隐蔽的事：造交易用的输入，必须与算 mass 用的是【同一批】。
  let buildOk = false;
  try {
    const fakeEntry = (amount) => ({
      address: new Address(myAddress),
      outpoint: { transactionId: '00'.repeat(32), index: 0 },
      amount,
      scriptPublicKey: kaspa.payToAddressScript(new Address(myAddress)),
      blockDaaScore: 0n,
      isCoinbase: false,
    });
    const plan = planInputs([fakeEntry(69_530_000n)], payloadStr);
    const gen = buildGenerator(plan, myAddress, payloadStr);
    const pending = await gen.next();
    const built = gen.summary();
    // 造出来的输入个数必须与算 mass 时用的那一批一致 —— 否则打印的数描述的是另一笔交易
    const sameInputs = Number(built.utxos) === plan.list.length;
    buildOk = !!pending && sameInputs;
    console.log(buildOk
      ? `✅ 自检 6：造交易那段能跑（用了 ${built.utxos} 个输入，与算 mass 的那批一致；手续费 ${built.fees} sompi）`
      : `🔴 自检 6 未达预期：pending=${!!pending} 输入个数 built=${built.utxos} vs plan=${plan.list.length}`);
  } catch (e) {
    console.log('🔴 自检 6 挂了：' + (e?.message || e) + '　← 造交易那段有问题，别用它发交易');
  }

  // 自检 ⑦：🔴 默认输出里【必须有地址、必须没有密钥】。
  //   这一条是被外部审查逼出来的：此前这个例子每次自检都把私钥明文打出来，
  //   包括【来自 KANET_PRIVKEY 的那一把】—— 而那是使用者长期持有的东西。
  //   ⇒ 所以这里不只是"改了打印"，而是把它变成一条【会报红的断言】。
  let secretOk = false;
  try {
    const shown = identityLines().join('\n');
    const hasAddr = shown.includes(myAddress);
    const shows = shown.includes(privKeyHex);
    const asked = argv.includes('--reveal-new-private-key');
    // 该不该出现，取决于两件事：你有没有显式要求，以及这把是不是临时生成的。
    //   🔴 来自 KANET_PRIVKEY 的那把 —— 无论你怎么要求都不该出现。
    const shouldShow = asked && keyIsEphemeral;
    secretOk = hasAddr && (shows === shouldShow);
    console.log(secretOk
      ? (shouldShow
          ? '✅ 自检 7：你显式要求了，临时密钥按要求显示（而来自 KANET_PRIVKEY 的那把任何时候都不显示）'
          : '✅ 自检 7：输出里有地址、没有密钥')
      : `🔴 自检 7 未达预期：地址在=${hasAddr} 密钥出现=${shows} 应当出现=${shouldShow}`);
  } catch (e) {
    console.log('🔴 自检 7 挂了：' + (e?.message || e));
  }

  // 自检 ⑧：🔴 地址校验交给了 kaspa-wasm 的 Address —— 这里证明它真的在拒绝坏地址。
  //   🔵 而它必须用【几种不同的坏法】，因为此前那个只查版本字节的实现
  //      对"校验和被改过"和"别的网络"这两类是完全看不见的。
  let addrOk = false;
  try {
    const bad = [
      ['校验和被改过', myAddress.slice(0, -1) + (myAddress.slice(-1) === 'q' ? 'p' : 'q')],
      ['别的网络(主网前缀)', myAddress.replace('kaspatest:', 'kaspa:')],
      ['乱前缀', myAddress.replace('kaspatest:', 'foo:')],
      ['没有前缀', myAddress.slice(myAddress.indexOf(':') + 1)],
      ['合约(P2SH)地址', 'kaspatest:pr89wgtzs5f9qphvrqvhhkqcggsua7j4nwc8npqsmxd9hwjmqlx36gz5l6t4g'],
    ];
    const rejected2 = bad.filter(([, s]) => { try { xOnlyPubkeyFromAddress(s); return false; } catch { return true; } });
    // 阳性对照：正确地址必须【通过】—— 否则"全拒"与"这个检查坏了"读数相同
    let goodPasses = false;
    try { goodPasses = xOnlyPubkeyFromAddress(myAddress).length === 32; } catch { goodPasses = false; }
    addrOk = rejected2.length === bad.length && goodPasses;
    console.log(addrOk
      ? `✅ 自检 8：${bad.length} 种坏地址全被拒，而正确地址通过（阳性对照，否则"全拒"与"检查坏了"分不开）`
      : `🔴 自检 8 未达预期：拒掉 ${rejected2.length}/${bad.length}，正确地址通过=${goodPasses}`);
  } catch (e) {
    console.log('🔴 自检 8 挂了：' + (e?.message || e));
  }

  console.log('\n' + (back === plaintext && lenOk && dropped && rejected && planOk && buildOk && secretOk && addrOk
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
