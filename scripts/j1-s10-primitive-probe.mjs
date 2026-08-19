// J1 §10 二审配套 · 设计级原语探针(2026-08-19) — 复跑: node scripts/j1-s10-primitive-probe.mjs (repo 根或任意 cwd 均可, vendor 路径相对本文件解析)
// 目的: 用真 kaspa-wasm 验证 2026-08-19-s10-pubkey-identity-design.md 的 L1/L2/L3 原语假设
//       与 §6 负例 1/2/3/7/8 在原语层是否"必红"。
// 边界: 全新随机密钥(Mnemonic.random), 不碰任何 relay 托管钥; 零广播零 DB 写; 独立节点(J1)上跑。
// 负测纪律: 每条负例先有同条件正例对照(未改样本必须穿透), 防"因错误的原因红"。
const { Mnemonic, XPrv, PrivateKey, XOnlyPublicKey, Address, signMessage, verifyMessage } = await import(new URL('../shared/vendor/kaspa-wasm/kaspa.js', import.meta.url).href);
import { createHash as nodeHash, randomUUID } from 'crypto';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`[PASS] ${name}`); } catch (e) { fail++; console.log(`[FAIL] ${name} — ${e.message}`); } };
const sha256hex = (s) => nodeHash('sha256').update(s).digest('hex');

// ── 造两把全新钥(A=声明主体, B=负例3用) ──────────────────────────────
function freshKey() {
  const m = Mnemonic.random();
  const xprv = new XPrv(m.toSeed(''));
  const priv = xprv.derivePath("m/44'/111111'/0'/0/0").toPrivateKey();
  const keypair = priv.toKeypair();
  return { priv, xonly: keypair.xOnlyPublicKey.toString().toLowerCase(), addr: keypair.toAddress('testnet-12').toString() };
}
const A = freshKey(), B = freshKey();
console.log('A.xonly =', A.xonly.slice(0, 16) + '…', 'len', A.xonly.length);

// ── L2 声明构造(照设计冻结结构) ──────────────────────────────────────
function statementBytes({ network = 'testnet-12', domain = 'KANET-U1-IDENTITY', version = 1, pubkey, operation = 'register', epoch }) {
  const canonical = JSON.stringify({ domain, version, network, pubkey, operation, epoch });
  return `${domain}-v${version}|${network}|${sha256hex(canonical)}`;
}
const epoch = randomUUID();
const msgA = statementBytes({ pubkey: A.xonly, epoch });
const sigA = signMessage({ message: msgA, privateKey: A.priv });

// ── 正例对照(负测纪律: 未改样本必须穿透) ─────────────────────────────
t('正例: A 签 L2 声明, payload-pubkey 直验 = true', () => {
  const ok = verifyMessage({ message: msgA, signature: sigA, publicKey: A.xonly });
  if (ok !== true) throw new Error(`expected true, got ${ok}`);
});

// ── §6 负例(原语层) ────────────────────────────────────────────────
t('负例1: 改 network 重建字节 ⇒ 验签必红', () => {
  const mutated = statementBytes({ pubkey: A.xonly, epoch, network: 'mainnet' });
  if (mutated === msgA) throw new Error('mutation no-op');
  if (verifyMessage({ message: mutated, signature: sigA, publicKey: A.xonly }) !== false) throw new Error('穿透');
});
t('负例2a: 改 domain ⇒ 必红', () => {
  const mutated = statementBytes({ pubkey: A.xonly, epoch, domain: 'KANET-U1-IDENT1TY' });
  if (verifyMessage({ message: mutated, signature: sigA, publicKey: A.xonly }) !== false) throw new Error('穿透');
});
t('负例2b: 改 version ⇒ 必红', () => {
  const mutated = statementBytes({ pubkey: A.xonly, epoch, version: 2 });
  if (verifyMessage({ message: mutated, signature: sigA, publicKey: A.xonly }) !== false) throw new Error('穿透');
});
t('负例3: pubkey 换 B(签名不变) ⇒ 必红', () => {
  const r = verifyMessage({ message: msgA, signature: sigA, publicKey: B.xonly });
  if (r !== false) throw new Error(`穿透: ${r}`);
});
t('负例8a: 63-hex pubkey ⇒ XOnlyPublicKey 解析必拒', () => {
  let threw = false;
  try { new XOnlyPublicKey(A.xonly.slice(0, 63)); } catch { threw = true; }
  if (!threw) throw new Error('63-hex 被解析接受');
});
t('负例8b: 非法曲线点(全f) ⇒ 解析或验签必拒', () => {
  const bad = 'f'.repeat(64);
  let rejected = false;
  try { new XOnlyPublicKey(bad); } catch { rejected = true; }
  if (!rejected) {
    // 解析没拒 ⇒ 验签路径必须拒
    try { rejected = verifyMessage({ message: msgA, signature: sigA, publicKey: bad }) === false; } catch { rejected = true; }
  }
  if (!rejected) throw new Error('非法点全程未被拒');
});
t('负例8c: 大写 hex ⇒ 记录原语行为(设计 L1 regex 是否为唯一守卫)', () => {
  const upper = A.xonly.toUpperCase();
  let parseOk = false, verifyOk = null;
  try { new XOnlyPublicKey(upper); parseOk = true; } catch {}
  try { verifyOk = verifyMessage({ message: msgA, signature: sigA, publicKey: upper }); } catch (e) { verifyOk = 'throw:' + e.message.slice(0, 40); }
  console.log(`    [数据] 大写hex: XOnlyPublicKey解析=${parseOk ? '接受' : '拒'} · verifyMessage=${verifyOk}`);
  // 本条只记录不判红绿——它回答的是"L1 的小写 regex 是不是唯一防两串身份的守卫"
});
t('负例7: address↔pubkey 规范往返 = 单一身份串', () => {
  const derived = XOnlyPublicKey.fromAddress(new Address(A.addr)).toString().toLowerCase();
  if (derived !== A.xonly) throw new Error(`往返失配: ${derived.slice(0, 16)}`);
});
t('P4 数据: 垃圾签名 ⇒ verifyMessage 返 false 还是 throw(fail-closed 要两路都接)', () => {
  let r;
  try { r = verifyMessage({ message: msgA, signature: 'deadbeef', publicKey: A.xonly }); } catch (e) { r = 'throw:' + String(e && (e.message ?? e)).slice(0, 80); }
  console.log(`    [数据] 垃圾签名 ⇒ ${JSON.stringify(r)}`);
});

// ── 追加(2026-08-19 · Codex MSG-246 红队后): 两条【演示型】用例 ────────────
// 它们不是负测(预期 verify=true), 是把"洞在授权层不在签名层"量成数据:
// 签名本身救不了这两个场景 ⇒ MUST-FIX A(本地 network 权威)与 operation 硬 allowlist 是承重的。
(function demos() {
  let d = 0;
  const demo = (name, fn) => { try { fn(); d++; console.log(`[DEMO] ${name}`); } catch (e) { console.log(`[DEMO-BROKE] ${name} — ${e.message}`); } };
  demo('MUST-FIX A 演示: 合法 testnet 声明 + 验证方按 payload 自报 network 重建字节 ⇒ verify=TRUE(签名层放行, 只有本地 network 权威能拦)', () => {
    // "mainnet 验证方"若信 payload.network 重建 ⇒ 与签名方字节一致 ⇒ 必然 true
    const rebuiltFromPayload = statementBytes({ pubkey: A.xonly, epoch, network: 'testnet-12' });
    const r = verifyMessage({ message: rebuiltFromPayload, signature: sigA, publicKey: A.xonly });
    if (r !== true) throw new Error(`预期 true(演示洞存在), 实得 ${r}`);
  });
  demo('操作域演示: operation=rotate 的合法签名 ⇒ verify=TRUE(签名层不拦未知操作, verifier 硬 allowlist=承重)', () => {
    const rotateMsg = statementBytes({ pubkey: A.xonly, epoch, operation: 'rotate' });
    const rotateSig = signMessage({ message: rotateMsg, privateKey: A.priv });
    const r = verifyMessage({ message: rotateMsg, signature: rotateSig, publicKey: A.xonly });
    if (r !== true) throw new Error(`预期 true, 实得 ${r}`);
  });
  console.log(`== 演示 ${d}/2(预期 2/2 TRUE = 两条 MUST-FIX 承重性已量) ==`);
})();

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
