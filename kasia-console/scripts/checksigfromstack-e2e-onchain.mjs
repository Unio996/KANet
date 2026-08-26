// checkSigFromStack 链上 E2E（J2 2026-08-20）—— Owner 10:03 授权跑；Bettor 五条跑法逐条落地。
//
// 判据（预注册，事后不加项）：
//   八格链上全对（V0/V5c PASS ∧ V1-V4/V5a/V5b REJECT）⇒ 该原语在链上真的在验 = A runtime 闸闭。
//   🔴 任一篡改仍 PASS ⇒ 该原语不可用于 §6-3，**立即 STOP 报 Bettor**。
//
// 🔴 承重的是阴性臂：always-true 的坏 codegen 会让 V0 全绿、零判别力。
// 🔴 同窗交替（Bettor 第 4 条）：每个阴性格【紧邻】一个 V0 复跑；同窗 V0 PASS ⇒ 该窗 REJECT 不可归因于节点。
// 🔴 捕获拒绝原文：不是只记 ok/fail，记 kaspad 原话，用来分辨"被脚本拒"与"被节点/费用/同步拒"。
//
// 编译坐标：versioned-builds/silverc-zk-8065184.exe（默认路径是 legacy 副本，编不出本内建）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const NET = 'testnet-12';
const CONSOLE = 'http://127.0.0.1:3200';
const RPCURL = 'ws://127.0.0.1:17210';
const SILVERC = 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
const SIL = 'D:/kanet-tn12/kasia-console/src/lib/CheckSigFromStackProbe.sil';
const OUT = 'D:/kanet-tn12/scratch/e2e';

const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const { RpcClient, Encoding, Address, Transaction, TransactionOutput, ScriptBuilder,
  SighashType, kaspaToSompi, payToAddressScript, addressFromScriptPublicKey } = W;

// Bettor 条件②(2026-08-20): V0-first 预检 —— 先只跑合法格并确认【落链】, 过了才烧全 8 格。
//   理由: V0 都不 PASS ⇒ harness 还没好, 8 格全是不可归因, 白烧链上代价。
const V0_ONLY = process.argv.includes('--v0-only');
const log = (m) => console.log(`[csfs-e2e ${new Date().toISOString().slice(11, 19)}] ${m}`);

// ── 2026-08-27 (Bettor (13) · Codex MSG-269/270 唯一 OPEN = REJECT 提交体没落盘) ──────────────────────
//   每笔 submit 【之前】把能重构该 tx 的最小集合(serializeToSafeJSON: inputs/outputs/fee/lockTime/witness 全量)+ 目标 script
//   字节 hex/sha + 期望 + 实际(txid 或 kaspad 拒因原文)写成一条记录: scratch/e2e/<run>/submissions/<seq>-<vector>.json,
//   run-evidence.json 里引用文件路径 + sha256。判据 / 向量 / 编译器路径【一行不动】, 只加落盘。
//   --dry-run: 不连 RPC、不注资、不广播; 用合成 UTXO 只为构造 tx 并证明记录形状完整。
//   --probe <json>: 用已编好的产物(如 docs/provenance/…/02a-probe-…-A.json)代替本地编译 —— 编译器常量那行不动, 只是跳过它。
const DRY_RUN = process.argv.includes('--dry-run');
const argAfter = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const PROBE_OVERRIDE = argAfter('--probe');
const RUN_ID = `${DRY_RUN ? 'dry' : 'run'}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const RUN_DIR = `${OUT}/${RUN_ID}`;
mkdirSync(`${RUN_DIR}/submissions`, { recursive: true });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
let submitSeq = 0;
// 记录: submit 前写(actual=null), submit 后原地补 actual; 返回 {file, sha} 供 evidence 引用(sha 以【终版】文件为准)
function recordSubmission(rec) {
  const file = `${RUN_DIR}/submissions/${String(++submitSeq).padStart(2, '0')}-${rec.vector}.json`;
  const write = () => { const body = JSON.stringify(rec, null, 1); writeFileSync(file, body); return { file, sha256: sha256(body) }; };
  write();
  return { file, finalize(actual) { rec.actual = actual; rec.finalized_at = new Date().toISOString(); return write(); } };
}

// relay：用 J2-tn（发送/注资），与今晚其它探针同源
const relays = JSON.parse(execFileSync(process.execPath, ['-e', `
const D=require('D:/kanet-tn12/kasia-console/node_modules/better-sqlite3');
const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});
console.log(JSON.stringify(db.prepare("SELECT id,name,address FROM relay_nodes WHERE name='J2-tn'").get()));
`], { encoding: 'utf8' }));
const RELAY = relays.id;
const rc = async (c, ms = 60000) => (await (await fetch(`${CONSOLE}/api/relay/${RELAY}/send-command`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c), signal: AbortSignal.timeout(ms) })).json());

const V = JSON.parse(readFileSync(`${OUT}/vectors.json`, 'utf8'));
log(`向量 ${V.vectors.length} 格 · pkBaked ${V.pkBaked.slice(0, 16)}… · 编译器 ${SILVERC.split('/').pop()}`);

// 编译（坐标写死；ctor = vectors.json 里那把 pk）—— --probe 给了就跳过本地编译, 用指定产物(编译器常量不动)
if (!PROBE_OVERRIDE) execFileSync(SILVERC, [SIL, '--ctor', `${OUT}/_ctor.json`, '-o', `${OUT}/onchain_probe.json`], { stdio: 'pipe' });
const artifactPath = PROBE_OVERRIDE || `${OUT}/onchain_probe.json`;
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
const redeem = Buffer.from(artifact.script);
const redeemHex = redeem.toString('hex');
const redeemSha = sha256(redeemHex);
log(`redeem ${redeem.length}B sha256(hex)=${redeemSha.slice(0, 16)}… 来源=${PROBE_OVERRIDE ? '--probe ' + PROBE_OVERRIDE : 'local compile'}${DRY_RUN ? ' · DRY-RUN(不连 RPC/不注资/不广播)' : ''} · run=${RUN_ID}`);

const p2shSpk = ScriptBuilder.fromScript(redeem).createPayToScriptHashScript();
const p2shAddr = addressFromScriptPublicKey(p2shSpk, NET).toString();
log(`P2SH ${p2shAddr}`);

const rpc = DRY_RUN ? null : new RpcClient({ url: RPCURL, encoding: Encoding.Borsh, networkId: NET });
if (!DRY_RUN) await rpc.connect();

const pushData = (buf) => {
  const n = buf.length; let p;
  if (n < 0x4c) p = Buffer.from([n]);
  else if (n <= 0xff) p = Buffer.from([0x4c, n]);
  else p = Buffer.from([0x4d, n & 0xff, (n >> 8) & 0xff]);
  return Buffer.concat([p, buf]).toString('hex');
};

const toAddr = DRY_RUN ? relays.address : (await rc({ type: 'get_pubkey' })).address;   // dry-run 不打 relay 命令, 用库里记的 J2-tn 地址
const toSpk = payToAddressScript(new Address(toAddr));

// 跑一格：注资 → 用该向量的 witness 花费 → 记 submit 结果与【原文】
// 🔴 transient 根因: 每格都要【等一笔新注资】, 而实测注资 68-191s 波动 —— 一格赶不上 180s 窗
//   整轮就带 inconclusive。根因不是窗口太窄, 是"每格必须等注资"这个依赖本身。
//   ⇒ 优先复用 P2SH 上【已有的未花 UTXO】(前几轮被拒的格留下的, 同一 redeem script 同一地址),
//     把注资延迟这个变量直接消掉; 没有可用的才回落到注资+等待。
//   🔵 复用不影响判别: UTXO 只是被花的钱, 判的是【花它那笔 tx 的 witness 能不能通过脚本】。
const usedOutpoints = new Set();
const opKey = (o) => o.transactionId + ":" + o.index;

async function runVector(v, requireLanded = false) {
  let utxo = null;
  if (DRY_RUN) {
    // 合成 UTXO: 只为构造/序列化 tx, 证明记录形状完整; 值域与真跑同量级(2 KAS)
    const fakeTx = sha256(`dry:${RUN_ID}:${submitSeq}:${v.id}`);
    const amount = kaspaToSompi('2');
    // wasm Transaction 要 IUtxoEntry 顶层字段(amount/scriptPublicKey/blockDaaScore/isCoinbase); live 路径读 utxo.entry.amount ⇒ 两种形状都给
    utxo = { outpoint: { transactionId: fakeTx, index: 0 }, amount, scriptPublicKey: p2shSpk, blockDaaScore: 0n, isCoinbase: false, entry: { amount } };
  }
  const pre = DRY_RUN ? [] : (await rpc.getUtxosByAddresses([p2shAddr])).entries
    .filter((e) => !usedOutpoints.has(opKey(e.outpoint)));
  if (DRY_RUN) {
    // 已有合成 UTXO, 不注资
  } else if (pre.length) {
    utxo = pre[0];
    log(`  复用已有 UTXO ${utxo.outpoint.transactionId.slice(0, 12)}… (剩 ${pre.length - 1} 可用) — 零等待`);
  } else {
    const ftx = (await rc({ type: 'transfer', target: p2shAddr, amount: 2 })).txId;
    let funded = false;
    const fundT0 = Date.now();
    for (let i = 0; i < 150; i++) {   // 300s 兜底窗(实测最长 191s)
      if ((await rc({ type: 'check_utxo_landed', txid: ftx, address: p2shAddr })).landed) { funded = true; break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    log(`  注资 ${funded ? '落链' : '未落'} 用时 ${((Date.now() - fundT0) / 1000).toFixed(0)}s`);
    if (!funded) return { id: v.id, result: 'INCONCLUSIVE', why: '注资未落链 —— 与被测物无关，本格作废重跑' };
    const { entries } = await rpc.getUtxosByAddresses([p2shAddr]);
    utxo = entries.find((e) => e.outpoint.transactionId === ftx)
      || entries.filter((e) => !usedOutpoints.has(opKey(e.outpoint)))[0];
  }
  if (!utxo) return { id: v.id, result: 'INCONCLUSIVE', why: '无可用 UTXO —— 与被测物无关' };
  usedOutpoints.add(opKey(utxo.outpoint));
  const fee = kaspaToSompi('0.02');
  // 🔴 每个值的理由(2026-08-20 首跑八格全废的教训: 抄样板时【无理由偏离】= 整轮作废):
  //   sigOpCount: 0   — v1(TX_VERSION_TOCCATA) 用 compute_budget 而非 SigOpCount 计价(p2sh.mjs:1739)。
  //                     写 1 ⇒ 节点 pre-script 拒 "sig_op_count is inconsistent with transaction version 1",
  //                     连正路 V0 都进不到脚本执行 ⇒ 八格全部不可归因。这就是首跑挂掉的字面成因。
  //   computeBudget: 70 — 生产 flat 值(_BSHARD_COMPUTE_BUDGET, p2sh.mjs:1734)。allowed=70*10000+9999=709,999 units;
  //                     本合约仅 1 次签名验证(同量级参照 P2PK checksig≈100,000u) ⇒ ~7x 余量。
  //   fee 0.02 KAS    — ≥ 生产 0.01 KAS/input 的 compute-mass floor(_BSHARD_FEE_PER_INPUT)。
  // 🔵 已核【无害】不必改: tx.inputs[0] 建后再赋 signatureScript —— 本 wasm 构建写回生效(离线实测), 非取值即拷贝。
  // 🔵 已核【正确】: 单 entrypoint 合约【不押 selector】(押了会被当 int ctor 参数 ⇒ require fail, p2sh.mjs:308),
  //     入参按 SS 声明序 forward 推(p2sh.mjs:1538) ⇒ push(sig)+push(digest)+push(redeem) 排布成立。
  const tx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index },
      signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo }],
    outputs: [new TransactionOutput(utxo.entry.amount - fee, toSpk)],
    lockTime: 0n, gas: 0n, subnetworkId: '0'.repeat(40), payload: '',
  });
  // witness 顺序 = 合约入参序 (datasig s, byte[32] digest)，**按文档签名预注册，不按"调到过为止"**
  const ss = pushData(Buffer.from(v.sig, 'hex')) + pushData(Buffer.from(v.digest, 'hex')) + pushData(redeem);
  tx.inputs[0].signatureScript = ss;
  // 🔴 submit 【之前】落提交体: 被拒的 tx 从此有原文可复核(Codex MSG-269/270 那格), 不再只剩拒因里的 txid
  const rec = recordSubmission({
    run: RUN_ID, seq: submitSeq + 1, vector: v.id, expect: v.expect, why: v.why, mode: DRY_RUN ? 'DRY-RUN' : 'LIVE',
    target_script: { bytes: redeem.length, hex: redeemHex, sha256_of_hex: redeemSha, source: PROBE_OVERRIDE || 'local compile', p2sh_address: p2shAddr },
    witness: { sig: v.sig, digest: v.digest, redeem_sha256_of_hex: redeemSha, signatureScript_hex: ss },
    fee_sompi: String(fee), lock_time: String(0n), input_outpoint: { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index }, input_amount_sompi: String(utxo.entry.amount), output_address: toAddr,
    tx_safe_json: JSON.parse(tx.serializeToSafeJSON()),   // bigint→string, 可 Transaction.deserializeFromSafeJSON 重构
    submitted_at: new Date().toISOString(), actual: null,
  });
  if (DRY_RUN) {
    const f = rec.finalize({ result: 'DRY-RUN', note: '未广播(--dry-run); 记录形状与 LIVE 相同, 仅 actual 不同' });
    return { id: v.id, result: 'DRY-RUN', submission_file: f.file, submission_sha256: f.sha256 };
  }
  try {
    const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
    const f = rec.finalize({ result: 'PASS', txid: r.transactionId });
    if (!requireLanded) return { id: v.id, result: 'PASS', txid: r.transactionId, submission_file: f.file, submission_sha256: f.sha256 };
    // 🔵 边界: submit 被收 = 节点跑过脚本且返回 true(mempool 即做脚本校验) = 本卡要证的那件事;
    //   【落链】另证矿工/共识也收了 —— Bettor 条件② 要的是这一层, 故 V0 预检才等它。
    // 等待窗与注资同量级: 实测注资落链 149s, 而这里原本只等 60s ⇒ 会把已 PASS 的格误判成未落链。
    let landed = false;
    for (let i = 0; i < 90; i++) {
      if ((await rc({ type: 'check_utxo_landed', txid: r.transactionId, address: toAddr })).landed) { landed = true; break; }
      await new Promise((s) => setTimeout(s, 2000));
    }
    const f2 = rec.finalize({ result: 'PASS', txid: r.transactionId, landed });
    return { id: v.id, result: 'PASS', txid: r.transactionId, landed, submission_file: f2.file, submission_sha256: f2.sha256 };
  } catch (e) {
    const reason = String(e?.message || e).slice(0, 400);
    const f = rec.finalize({ result: 'REJECT', reason });
    return { id: v.id, result: 'REJECT', reason, submission_file: f.file, submission_sha256: f.sha256 };
  }
}

// ── 同窗交替：每个阴性格前后各夹一次 V0 ────────────────────────────────
// 🔴 预注册(2026-08-20, 在看到结果之前定): 只有拒因原文含此串才算【脚本验证拒】。
//   tx 格式拒(sig_op_count…) / 节点状态拒(not synced) / 拒因读不到 —— 一律不算, 记不可归因。
//   理由: REJECT 这个词对三种成因长得完全一样, 今早八格全 REJECT 却一格都没进脚本。
const SCRIPT_REJECT_MARK = 'failed to verify the signature script';
const evidence = [];
const V0 = V.vectors.find((x) => x.id === 'V0');
if (V0_ONLY) {
  log('V0 预检(Bettor 条件②): 只跑合法格, 要求【落链】');
  const r0 = await runVector(V0, true);
  log(`V0 = ${r0.result} | landed=${r0.landed} | ${r0.txid ? r0.txid.slice(0, 16) : (r0.reason || r0.why || "")}`);
  const ok = r0.result === 'PASS' && r0.landed === true;
  console.log(ok
    ? '✅ V0 预检通过(PASS 且落链) ⇒ harness 已好, 可跑全 8 格'
    : '🔴 V0 预检未过 ⇒ harness 仍有问题, 【不】跑 8 格, 先查');
  await rpc.disconnect();
  process.exit(ok ? 0 : 1);
}
const results = [];
for (const v of V.vectors) {
  if (v.id === 'V0') continue;
  const before = await runVector(V0);
  const target = await runVector(v);
  results.push({ window: v.id, v0Before: before.result, target, expect: v.expect, v0BeforeFile: before.submission_file, v0BeforeSha: before.submission_sha256 });
  log(`窗 ${v.id}: V0=${before.result} | ${v.id}=${target.result} (期望 ${v.expect})` +
    (target.reason ? `
    拒因原文: ${target.reason}` : ''));
}
const v0Final = await runVector(V0);
log(`收尾 V0 = ${v0Final.result} (期望 PASS)`);

// --dry-run: 没有可判读的链上结果, 只证【记录形状】—— 落盘证据后退出, 不进八格判读(判据代码一行不动)
if (DRY_RUN) {
  const ev = { run: RUN_ID, mode: 'DRY-RUN', target_script_sha256_of_hex: redeemSha, target_script_bytes: redeem.length, probe_source: PROBE_OVERRIDE || 'local compile', p2sh_address: p2shAddr,
    windows: [...results.map((r) => ({ window: r.window, expect: r.expect, v0Before: r.v0Before, result: r.target.result, submission_file: r.target.submission_file, submission_sha256: r.target.submission_sha256, v0Before_submission_file: r.v0BeforeFile, v0Before_submission_sha256: r.v0BeforeSha })),
      { window: 'V0-final', expect: 'PASS', result: v0Final.result, submission_file: v0Final.submission_file, submission_sha256: v0Final.submission_sha256 }] };
  writeFileSync(`${RUN_DIR}/run-evidence.json`, JSON.stringify(ev, null, 1));
  console.log(`\nDRY-RUN 完成: ${submitSeq} 条提交体记录 → ${RUN_DIR}/submissions/ ; run-evidence.json 引用每条文件 sha256。未广播、未注资、未连 RPC。`);
  process.exit(0);
}
console.log('\n========== 八格判读 ==========');
let pass = 0; let fail = 0; let inconclusive = 0;
const judge = (n, ok, detail) => { if (ok === null) { inconclusive++; console.log(`[????] ${n} — ${detail}`); } else if (ok) { pass++; console.log(`[PASS] ${n}`); } else { fail++; console.log(`[FAIL] ${n} — ${detail}`); } };
judge('V0 (合法) PASS', v0Final.result === 'INCONCLUSIVE' ? null : v0Final.result === 'PASS', v0Final.reason || v0Final.why || '');
for (const r of results) {
  if (r.target.result === 'INCONCLUSIVE') { judge(`${r.window}`, null, r.target.why); continue; }
  if (r.v0Before !== 'PASS') { judge(`${r.window}`, null, `同窗 V0=${r.v0Before} ⇒ 该窗读数不可归因于被测物`); continue; }
  if (r.expect === 'REJECT' && r.target.result === 'REJECT' && !String(r.target.reason || '').includes(SCRIPT_REJECT_MARK)) {
    judge(`${r.window}`, null, `REJECT 了, 但拒因【不是脚本验证】⇒ 不可归因于被测物。原文: ${r.target.reason || '(空)'}`);
    continue;
  }
  judge(`${r.window} 期望 ${r.expect}`, r.target.result === r.expect, `实得 ${r.target.result}${r.target.reason ? ' | ' + r.target.reason : ''}`);
}
// 🔴 落盘证据: 上一轮 8/8 拿不到拒因原文, 正因为它只存在于进程内存里、日志又被截断。
//   ⇒ 拒因原文必须落盘, 否则"判据③"事后【无法复核也无法补测】。
for (const r of results) evidence.push({ window: r.window, expect: r.expect, v0Before: r.v0Before, result: r.target.result, txid: r.target.txid, reason: r.target.reason, why: r.target.why,
  submission_file: r.target.submission_file, submission_sha256: r.target.submission_sha256, v0Before_submission_file: r.v0BeforeFile, v0Before_submission_sha256: r.v0BeforeSha });
evidence.push({ window: 'V0-final', expect: 'PASS', result: v0Final.result, txid: v0Final.txid, reason: v0Final.reason, submission_file: v0Final.submission_file, submission_sha256: v0Final.submission_sha256 });
const evidenceDoc = { run: RUN_ID, mode: DRY_RUN ? 'DRY-RUN' : 'LIVE', target_script_sha256_of_hex: redeemSha, target_script_bytes: redeem.length, probe_source: PROBE_OVERRIDE || 'local compile', p2sh_address: p2shAddr, windows: evidence };
writeFileSync(`${RUN_DIR}/run-evidence.json`, JSON.stringify(evidenceDoc, null, 1));
if (!DRY_RUN) writeFileSync(OUT + "/run-evidence.json", JSON.stringify(evidence, null, 1));   // 旧位置保留给 LIVE(向后兼容读者); dry-run 不覆盖 8/20 那份
console.log("");
console.log(`证据已落盘: ${RUN_DIR}/run-evidence.json + submissions/*.json(每笔提交体原文 + sha256 引用)${DRY_RUN ? '' : ' ; 旧位置 ' + OUT + '/run-evidence.json 同步'}`);
console.log(`\n${fail === 0 && inconclusive === 0 ? '✅' : '🔴'} ${pass} PASS / ${fail} FAIL / ${inconclusive} 不可归因`);
if (fail > 0) console.log('🔴🔴 有篡改格仍 PASS 或合法格被拒 ⇒ 按判据 STOP，立即报 Bettor，勿用于 §6-3。');
await rpc.disconnect();
// 🔴 Codex 2026-08-20 逮: 原本 `fail > 0 ? 1 : 0` 只看 fail ⇒ 一次【全格不可归因】的跑会 exit 0,
//   而 summary(上一行)判绿的条件是 fail===0 && inconclusive===0 —— 两处判据不一致, 退出码更宽松。
//   后果: 自动化/调用方只看退出码时, "什么都没测到"会冒充"全绿"。⇒ 与 summary 对齐。
process.exit(fail > 0 || inconclusive > 0 ? 1 : 0);
