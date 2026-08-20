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
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

// relay：用 J2-tn（发送/注资），与今晚其它探针同源
const relays = JSON.parse(execFileSync(process.execPath, ['-e', `
const D=require('D:/kanet-tn12/kasia-console/node_modules/better-sqlite3');
const db=new D('D:/kanet-tn12/kasia-console/data/console.db',{readonly:true});
console.log(JSON.stringify(db.prepare("SELECT id,name FROM relay_nodes WHERE name='J2-tn'").get()));
`], { encoding: 'utf8' }));
const RELAY = relays.id;
const rc = async (c, ms = 60000) => (await (await fetch(`${CONSOLE}/api/relay/${RELAY}/send-command`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c), signal: AbortSignal.timeout(ms) })).json());

const V = JSON.parse(readFileSync(`${OUT}/vectors.json`, 'utf8'));
log(`向量 ${V.vectors.length} 格 · pkBaked ${V.pkBaked.slice(0, 16)}… · 编译器 ${SILVERC.split('/').pop()}`);

// 编译（坐标写死；ctor = vectors.json 里那把 pk）
execFileSync(SILVERC, [SIL, '--ctor', `${OUT}/_ctor.json`, '-o', `${OUT}/onchain_probe.json`], { stdio: 'pipe' });
const artifact = JSON.parse(readFileSync(`${OUT}/onchain_probe.json`, 'utf8'));
const redeem = Buffer.from(artifact.script);
log(`redeem ${redeem.length}B`);

const p2shSpk = ScriptBuilder.fromScript(redeem).createPayToScriptHashScript();
const p2shAddr = addressFromScriptPublicKey(p2shSpk, NET).toString();
log(`P2SH ${p2shAddr}`);

const rpc = new RpcClient({ url: RPCURL, encoding: Encoding.Borsh, networkId: NET });
await rpc.connect();

const pushData = (buf) => {
  const n = buf.length; let p;
  if (n < 0x4c) p = Buffer.from([n]);
  else if (n <= 0xff) p = Buffer.from([0x4c, n]);
  else p = Buffer.from([0x4d, n & 0xff, (n >> 8) & 0xff]);
  return Buffer.concat([p, buf]).toString('hex');
};

const toAddr = (await rc({ type: 'get_pubkey' })).address;
const toSpk = payToAddressScript(new Address(toAddr));

// 跑一格：注资 → 用该向量的 witness 花费 → 记 submit 结果与【原文】
async function runVector(v, requireLanded = false) {
  const ftx = (await rc({ type: 'transfer', target: p2shAddr, amount: 2 })).txId;
  // 注资等待窗: 90s 太短 —— 2026-08-20 实测一笔注资在 90s 窗内判"未落", 事后查【其实落了】。
  //   ⇒ 放宽到 180s, 并打印真实耗时, 免得下次还靠猜。窗口不足会把好格误判成不可归因(浪费), 不会造假绿。
  let funded = false;
  const fundT0 = Date.now();
  for (let i = 0; i < 90; i++) {
    if ((await rc({ type: 'check_utxo_landed', txid: ftx, address: p2shAddr })).landed) { funded = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log(`  注资 ${funded ? '落链' : '未落'} 用时 ${((Date.now() - fundT0) / 1000).toFixed(0)}s`);
  if (!funded) return { id: v.id, result: 'INCONCLUSIVE', why: '注资未落链 —— 与被测物无关，本格作废重跑' };
  const { entries } = await rpc.getUtxosByAddresses([p2shAddr]);
  const utxo = entries.find((e) => e.outpoint.transactionId === ftx) || entries[0];
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
  try {
    const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
    if (!requireLanded) return { id: v.id, result: 'PASS', txid: r.transactionId };
    // 🔵 边界: submit 被收 = 节点跑过脚本且返回 true(mempool 即做脚本校验) = 本卡要证的那件事;
    //   【落链】另证矿工/共识也收了 —— Bettor 条件② 要的是这一层, 故 V0 预检才等它。
    // 等待窗与注资同量级: 实测注资落链 149s, 而这里原本只等 60s ⇒ 会把已 PASS 的格误判成未落链。
    let landed = false;
    for (let i = 0; i < 90; i++) {
      if ((await rc({ type: 'check_utxo_landed', txid: r.transactionId, address: toAddr })).landed) { landed = true; break; }
      await new Promise((s) => setTimeout(s, 2000));
    }
    return { id: v.id, result: 'PASS', txid: r.transactionId, landed };
  } catch (e) {
    return { id: v.id, result: 'REJECT', reason: String(e?.message || e).slice(0, 400) };
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
  results.push({ window: v.id, v0Before: before.result, target, expect: v.expect });
  log(`窗 ${v.id}: V0=${before.result} | ${v.id}=${target.result} (期望 ${v.expect})` +
    (target.reason ? `
    拒因原文: ${target.reason}` : ''));
}
const v0Final = await runVector(V0);
log(`收尾 V0 = ${v0Final.result} (期望 PASS)`);

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
for (const r of results) evidence.push({ window: r.window, expect: r.expect, v0Before: r.v0Before, result: r.target.result, txid: r.target.txid, reason: r.target.reason, why: r.target.why });
evidence.push({ window: 'V0-final', expect: 'PASS', result: v0Final.result, txid: v0Final.txid, reason: v0Final.reason });
writeFileSync(OUT + "/run-evidence.json", JSON.stringify(evidence, null, 1));
console.log("");
console.log("证据已落盘: " + OUT + "/run-evidence.json (拒因原文不再随进程消失)");
console.log(`\n${fail === 0 && inconclusive === 0 ? '✅' : '🔴'} ${pass} PASS / ${fail} FAIL / ${inconclusive} 不可归因`);
if (fail > 0) console.log('🔴🔴 有篡改格仍 PASS 或合法格被拒 ⇒ 按判据 STOP，立即报 Bettor，勿用于 §6-3。');
await rpc.disconnect();
// 🔴 Codex 2026-08-20 逮: 原本 `fail > 0 ? 1 : 0` 只看 fail ⇒ 一次【全格不可归因】的跑会 exit 0,
//   而 summary(上一行)判绿的条件是 fail===0 && inconclusive===0 —— 两处判据不一致, 退出码更宽松。
//   后果: 自动化/调用方只看退出码时, "什么都没测到"会冒充"全绿"。⇒ 与 summary 对齐。
process.exit(fail > 0 || inconclusive > 0 ? 1 : 0);
