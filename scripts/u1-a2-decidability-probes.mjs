#!/usr/bin/env node
/**
 * u1 · A2 同源判定 —— 设计稿 `docs/2026-08-12-u1-a2-same-origin-decidability-v0.1.md` 的全部读数,
 * 一条命令跨节点复现。
 *
 * 🔴 为什么进仓(而不是留在 scratch/): 稿子里每条结论都配了命令, 但那些命令指向 `scratch/` —— **gitignored,
 *    别的节点根本读不到** ⇒ "可复现"在本机成立、在复核者那台不成立。在册同族教训:
 *    gitignored 产物不算可复核证据(④ 量级重报那次, 三台机三份 logs/test-runs 谁都非权威)。
 *
 * 🔵 路径一律相对本文件解析, 不写死 D:/ —— 另一台机 clone 到别处也能跑(在册: 搬迁坏绝对锚)。
 * ⚠ 只读 + 只用当场随机生成的助记词。**不解密、不打印任何在库真实密钥。**
 *
 * 跑: node scripts/u1-a2-decidability-probes.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || path.resolve(HERE, '..');
const CONSOLE_DIR = path.join(ROOT, 'kasia-console');
const DB_PATH = path.join(CONSOLE_DIR, 'data', 'console.db');

const SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const line = (s) => console.log(s);
const head = (s) => console.log(`\n=== ${s} ===`);

function loadSqlite() {
  return require(path.join(CONSOLE_DIR, 'node_modules', 'better-sqlite3'));
}
async function loadKaspaWasm() {
  // relay 与 console 各有一份 —— 任一可用即可, 逐个试而不是写死一个
  for (const p of [
    path.join(ROOT, 'kasia-relay', 'node_modules', 'kaspa-wasm', 'kaspa.js'),
    path.join(CONSOLE_DIR, 'node_modules', 'kaspa-wasm', 'kaspa.js'),
  ]) {
    if (fs.existsSync(p)) return await import(pathToFileURL(p).href);
  }
  throw new Error('kaspa-wasm 两处都没找到, 装了吗?');
}

// ── ① 地基事实(稿 §1) ────────────────────────────────────────────────────────
function probeGroundFacts(D) {
  head('① 地基事实 (稿 §1)');
  if (!fs.existsSync(DB_PATH)) { line(`⚠ 跳过: 本机没有 ${DB_PATH}(非本机跑属正常)`); return; }
  const db = new D(DB_PATH, { readonly: true });
  const n = (sql) => db.prepare(sql).get().n;
  const tot = n('SELECT COUNT(*) n FROM relay_nodes');
  line(`relay_nodes 总数              = ${tot}`);
  line(`is_oracle = 1                 = ${n('SELECT COUNT(*) n FROM relay_nodes WHERE is_oracle=1')}`);
  line(`ecdsa_pubkey_xonly 非空       = ${n("SELECT COUNT(*) n FROM relay_nodes WHERE ecdsa_pubkey_xonly IS NOT NULL AND TRIM(ecdsa_pubkey_xonly)<>''")} / ${tot}`);
  line(`mnemonic_encrypted 非空       = ${n("SELECT COUNT(*) n FROM relay_nodes WHERE mnemonic_encrypted IS NOT NULL AND TRIM(mnemonic_encrypted)<>''")}`);
  line(`privkey_encrypted 非空        = ${n("SELECT COUNT(*) n FROM relay_nodes WHERE privkey_encrypted IS NOT NULL AND TRIM(privkey_encrypted)<>''")}`);
  const dup = db.prepare(`SELECT COUNT(*) n FROM (SELECT address FROM relay_nodes
      WHERE address IS NOT NULL AND TRIM(address)<>'' GROUP BY address HAVING COUNT(*)>1)`).get().n;
  line(`重复 address 组数             = ${dup}   ← 现行派生下"两 relay 同 mnemonic"就长这样, 见 ②(a)`);
  // 密文能不能直接比对判同源? 只看去重计数与算法头, 不解密、不打印密文本体
  const cips = db.prepare("SELECT mnemonic_encrypted c FROM relay_nodes WHERE mnemonic_encrypted IS NOT NULL AND TRIM(mnemonic_encrypted)<>''").all().map(r => r.c);
  const alg = (() => { try { return JSON.parse(cips[0]).alg || '?'; } catch { return '?'; } })();
  line(`mnemonic 密文去重             = ${new Set(cips).size} / ${cips.length}  (alg=${alg}, 带 IV ⇒ 密文不可比对, 不能拿密文判同源)`);
  try {
    line(`u1_domain_assignment 行数     = ${n('SELECT COUNT(*) n FROM u1_domain_assignment')}   (表在 live 库)`);
  } catch (e) { line(`u1_domain_assignment          = ${e.message}`); }
  db.close();
}

// ── ② 同 mnemonic 的两个身份长什么样(稿 §2) ──────────────────────────────────
function probeDerivation(w) {
  head('② 同一 mnemonic 的两个身份 (稿 §2) — 随机助记词, 不碰真实密钥');
  const { Mnemonic, XPrv, PrivateKey, NetworkType } = w;
  const addrAt = (phrase, acct) => {
    const d = new XPrv(new Mnemonic(phrase).toSeed())
      .deriveChild(44, true).deriveChild(111111, true).deriveChild(acct, true)
      .deriveChild(0, false).deriveChild(0, false);       // == kasia-relay/src/lib/wallet.mjs:39-50
    const pk = (typeof d.toPrivateKey === 'function') ? d.toPrivateKey() : PrivateKey.fromXPrv(d);
    return pk.toKeypair().toAddress(NetworkType.Testnet).toString();
  };
  const m1 = Mnemonic.random().phrase, m2 = Mnemonic.random().phrase;
  line(`A 同 mnemonic · acct 0 两次   : ${addrAt(m1,0) === addrAt(m1,0) ? 'IDENTICAL' : 'DIFFER'}`);
  line(`B 同 mnemonic · acct 0 vs 1   : ${addrAt(m1,0) === addrAt(m1,1) ? 'IDENTICAL' : 'DIFFER'}   ← 同源却看不出同源`);
  line(`C 异 mnemonic · acct 0        : ${addrAt(m1,0) === addrAt(m2,0) ? 'IDENTICAL' : 'DIFFER'}`);
}

// ── ③ 硬化墙: 裁定硬要求与 A2 目标互斥(稿 §3) ────────────────────────────────
function probeHardenedGap(w) {
  head('③ 硬化墙 (稿 §3) — 带对照臂');
  const { Mnemonic, XPrv } = w;
  const master = new XPrv(new Mnemonic(Mnemonic.random().phrase).toSeed());
  const mpub = master.toXPub();
  try { mpub.deriveChild(44, true); line('① master XPub -> 硬化子      : 成功 ← 与稿子结论相反, 请重查!'); }
  catch (e) { line(`① master XPub -> 硬化子      : 抛错 "${(e.message || e).toString().slice(0,40)}"`); }
  try { mpub.deriveChild(0, false); line('② master XPub -> 非硬化子    : 成功 ← 对照臂: XPub 本身可用, ① 不是对象坏了'); }
  catch (e) { line(`② master XPub -> 非硬化子    : 抛错 ${e.message} ← 对照臂也坏, ① 的读数不可用`); }
  const acctPub = master.deriveChild(44,true).deriveChild(111111,true).deriveChild(0,true).toXPub();
  try { acctPub.deriveChild(0,false).deriveChild(0,false); line('③ 账户层 XPub -> 叶子        : 成功 ← 只有这一层推得到 relay pubkey'); }
  catch (e) { line(`③ 账户层 XPub -> 叶子        : 抛错 ${e.message}`); }
}

// ── ④ 存量列补齐的信息量(稿 §4) ──────────────────────────────────────────────
function probeAddrPubkeyBijection(D, w) {
  head('④ ecdsa_pubkey_xonly 能否纯从 address 算出 (稿 §4)');
  if (!fs.existsSync(DB_PATH)) { line('⚠ 跳过: 本机没有 console.db'); return; }
  const db = new D(DB_PATH, { readonly: true });
  const rows = db.prepare("SELECT name,address FROM relay_nodes WHERE address IS NOT NULL AND TRIM(address)<>'' LIMIT 4").all();
  let ok = 0;
  for (const r of rows) {
    const a = new w.Address(r.address);
    const back = w.XOnlyPublicKey.fromAddress(a).toAddress(w.NetworkType.Testnet).toString();
    if (back === r.address) ok++;
    line(`${String(r.name||'').padEnd(18)} 回推 == 原地址: ${back === r.address ? 'YES' : 'NO'}`);
  }
  line(`⇒ ${ok}/${rows.length} 可纯从 address 算出 ⇒ 补齐该列的信息量 = 0, 不能记成 A2 进展`);
  db.close();
}

// ── ⑤ 形态A 的代价: xpub + 一把子私钥 ⇒ 账户 xprv(稿 §5-A) ───────────────────
function probeXpubLeak(w) {
  head('⑤ 形态A 代价: 账户 xpub + 任一非硬化子私钥 (稿 §5-A) — 带对照臂');
  const { Mnemonic, XPrv } = w;
  const master = new XPrv(new Mnemonic(Mnemonic.random().phrase).toSeed());
  const acct = master.deriveChild(44,true).deriveChild(111111,true).deriveChild(0,true);
  const acctPub = acct.toXPub();
  const chainCode = Buffer.from(String(acctPub.chainCode), 'hex');            // 公开
  const parentPub = Buffer.from(acctPub.toPublicKey().toString(), 'hex');     // 公开
  const ser32 = (i) => Buffer.from([(i>>>24)&255,(i>>>16)&255,(i>>>8)&255,i&255]);
  const ILat = (cc, i) => BigInt('0x' + createHmac('sha512', cc).update(Buffer.concat([parentPub, ser32(i)])).digest('hex').slice(0,64));

  const leaked = BigInt('0x' + acct.deriveChild(0,false).toPrivateKey().toString());   // 泄露的那一把
  const truth  = BigInt('0x' + acct.toPrivateKey().toString());
  const recovered = ((leaked - ILat(chainCode,0)) % SECP_N + SECP_N) % SECP_N;
  line(`反推账户私钥 == 真账户私钥   : ${recovered === truth ? 'YES — 反推成立' : 'NO'}`);

  const bogus = Buffer.alloc(32, 7);
  const rec2 = ((leaked - ILat(bogus,0)) % SECP_N + SECP_N) % SECP_N;
  line(`对照臂(乱 chainCode)         : ${rec2 === truth ? '恒真 = 算式没在验东西' : '推不出 — 上一行确实在用登记根'}`);

  const sib = acct.deriveChild(1,false).toPrivateKey().toString();
  const sibDerived = ((recovered + ILat(chainCode,1)) % SECP_N).toString(16).padStart(64,'0');
  line(`再算兄弟 i=1                 : ${sibDerived === sib ? '命中 — 一把泄露 ⇒ 该账户全部兄弟沦陷' : '未命中'}`);
}

// ── ⑥ 兜住程度是 stake 分布的函数(稿 §5-A-ter) ───────────────────────────────
function probeSamplingCondition() {
  head('⑥ committee 抽样: 22.2% 的适用条件 (稿 §5-A-ter)');
  const C = (n,k) => { let r = 1; for (let i=0;i<k;i++) r = r*(n-i)/(i+1); return Math.round(r); };
  line(`均匀抽样下 该域 2 人都进场   : C(8,3)/C(10,5) = ${C(8,3)}/${C(10,5)} = ${(C(8,3)/C(10,5)).toFixed(4)}`);
  line('⚠ 但 pool-committee-sampler.mjs:117-128 是 stake 加权 (hit = rand % totalStake),');
  line('  ⇒ 上面这个数只在【候选 stake 相等】时精确; 超额 stake 的沦陷域进场概率更高。');
  line('  ⇒ "兜住的程度" = stake 分布的函数, 而 stake 来自 loadPoolSnapshot(见 2026-06-22 NWT 红队),');
  line('    不是 relay_nodes.oracle_stake_locked_kas —— 别拿后者下结论(主语不同)。');
}

const D = loadSqlite();
const w = await loadKaspaWasm();
line('u1 · A2 同源判定 —— 设计稿全部读数复现 (只读; 随机助记词; 不碰真实密钥)');
line(`ROOT = ${ROOT}`);
probeGroundFacts(D);
probeDerivation(w);
probeHardenedGap(w);
probeAddrPubkeyBijection(D, w);
probeXpubLeak(w);
probeSamplingCondition();
line('\n完。任何一行与设计稿不符 ⇒ 以本命令的输出为准, 稿子该改。');
