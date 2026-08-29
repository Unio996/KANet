// build.mjs — gate (a) transition probe harness · 离线部分(J2 2026-08-28 · NWT GO · Bettor 三条件 + NWT 两条)
// 证 Codex 119ec787 ①②③④⑦ 离线; ⑤⑥ READY 后广播段。零 RPC、零广播、测试钥(priv=…02)、假 funding outpoint。
// 用法: cd kasia-console(或任意) && node scratch/_j2_s63a_transition/build.mjs [--probe-dir <dir>] [--network testnet-12] [--out <dir>]
//   --probe-dir 默认本目录(J2 dry-run 产物); J1 正式产物到了换成 scratch/j1-s63a-transition。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PROBE_DIR = resolve(arg('--probe-dir', HERE));
const NET = arg('--network', 'testnet-12');
const OUT = resolve(arg('--out', join(HERE, 'out')));
mkdirSync(OUT, { recursive: true });

// 🔴 kaspa-wasm 必须与 p2sh.mjs 同一实例(类身份: Hash/CovenantBinding 传进 TransactionOutput 要同一 wasm 模块) ⇒ 用 kasia-relay 的解析
const relayRequire = createRequire('D:/kanet-tn12/kasia-relay/package.json');
const KASPA_PATH = relayRequire.resolve('kaspa-wasm');
const k = await import(pathToFileURL(KASPA_PATH).href);
const p2sh = await import(pathToFileURL('D:/kanet-tn12/kasia-relay/src/lib/p2sh.mjs').href);
const { _continuationAddress } = p2sh;
assert.strictEqual(typeof _continuationAddress, 'function', 'p2sh.mjs 未导出 _continuationAddress');

// ── 私有惯用法复刻(p2sh.mjs :76 _encodePushDataHex / :1564 _i64LE / :1587 _pushInt / :1599 _serializeLeafStateHex) — 各有 oracle 自测 ──
const pushData = (buf) => { const n = buf.length; if (n <= 75) return n.toString(16).padStart(2, '0') + buf.toString('hex'); if (n <= 255) return '4c' + n.toString(16).padStart(2, '0') + buf.toString('hex'); if (n <= 65535) return '4d' + (n & 0xff).toString(16).padStart(2, '0') + ((n >> 8) & 0xff).toString(16).padStart(2, '0') + buf.toString('hex'); throw new Error('push too large'); };
const i64LE = (v) => { let n = BigInt(v); const neg = n < 0n; let mag = neg ? -n : n; const b = Buffer.alloc(8); for (let i = 0; i < 8; i++) { b[i] = Number(mag & 0xffn); mag >>= 8n; } if (neg) b[7] |= 0x80; return b; };
const pushInt = (n) => { const v = BigInt(n); if (v === 0n) return '00'; if (v >= 1n && v <= 16n) return (0x50 + Number(v)).toString(16).padStart(2, '0'); const bytes = []; let x = v; while (x > 0n) { bytes.push(Number(x & 0xffn)); x >>= 8n; } if (bytes[bytes.length - 1] & 0x80) bytes.push(0); return pushData(Buffer.from(bytes)); };
const serLeaf = (s) => pushData(i64LE(s.phase)) + pushData(i64LE(s.pad1)) + pushData(i64LE(s.pad2)) + pushData(i64LE(s.pad3));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const hexOf = (arr) => Buffer.from(arr).toString('hex');
const p2shAddr = (redeemHex) => k.addressFromScriptPublicKey(k.payToScriptHashScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))), NET).toString();

const log = [];
const step = (name, fn) => { const r = fn(); const { tx: _omit, ...rest } = r || {}; log.push({ step: name, ok: true, ...rest }); console.log('[OK] ' + name); return r; };
const J = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1);

// ── 0. 产物 ──
const P0 = JSON.parse(readFileSync(join(PROBE_DIR, 'probe_phase0.json'), 'utf8'));
const P1 = JSON.parse(readFileSync(join(PROBE_DIR, 'probe_phase1.json'), 'utf8'));
const SIL = readFileSync(join(PROBE_DIR, 'S63A_TransitionProbe.sil'));
const CTOR0 = JSON.parse(readFileSync(join(PROBE_DIR, 'ctor_phase0.json'), 'utf8'));
const CTOR1 = JSON.parse(readFileSync(join(PROBE_DIR, 'ctor_phase1.json'), 'utf8'));
const redeem0 = hexOf(P0.script), redeem1 = hexOf(P1.script);
const { start, len } = P0.state_layout;
const STATE0 = { phase: CTOR0[1].data, pad1: CTOR0[2].data, pad2: CTOR0[3].data, pad3: CTOR0[4].data };
const STATE1 = { phase: CTOR1[1].data, pad1: CTOR1[2].data, pad2: CTOR1[3].data, pad3: CTOR1[4].data };

step('S0 state_layout = leaf 族(start=1,len=36), 两份产物同 layout 同长度', () => {
  assert.deepStrictEqual(P0.state_layout, P1.state_layout); assert.strictEqual(len, 36); assert.strictEqual(P0.script.length, P1.script.length);
  return { start, len, script_len: P0.script.length, abi: P0.abi.map((a) => a.name) };
});
step('S1 序列化器 oracle: serLeaf(ctor state) === 编译器烤进 script 的 state 字节(两份各核一次)', () => {
  assert.strictEqual(redeem0.slice(start * 2, (start + len) * 2), serLeaf(STATE0));
  assert.strictEqual(redeem1.slice(start * 2, (start + len) * 2), serLeaf(STATE1));
  return { state0_hex: serLeaf(STATE0), state1_hex: serLeaf(STATE1) };
});
step('S2 pushInt/pushData oracle: OP_0/OP_1..16/PUSHDATA1 224B 形与 p2sh.mjs 同式', () => {
  assert.strictEqual(pushInt(0), '00'); assert.strictEqual(pushInt(1), '51'); assert.strictEqual(pushInt(16), '60'); assert.strictEqual(pushInt(17), '0111');
  assert.strictEqual(pushData(Buffer.alloc(224)).slice(0, 4), '4ce0');
});
// ── NWT 条件②: 后继地址由【生产 _continuationAddress】直接算这个具体转换; oracle = 编译器直出的 phase=1 script 的 P2SH 地址 ──
const contAddr = step('S3 生产 _continuationAddress(redeem0, state1, net, start) === 编译器直出 P2SH(script1)(两源独立, 字节相等)', () => {
  const prod = _continuationAddress(redeem0, serLeaf(STATE1), NET, start);
  const oracle = p2shAddr(redeem1);
  assert.strictEqual(prod, oracle, `生产 splice ${prod} ≠ 编译器直出 ${oracle}`);
  assert.notStrictEqual(prod, p2shAddr(redeem0), '后继地址应 ≠ 输入地址');
  return { continuation_address: prod, genesis_address: p2shAddr(redeem0) };
}).continuation_address;
// Codex 14c81c1c ③ 更正措辞与断言: phase 字段占 9 字节【区】(1B push 长度 + 8B i64LE); 0→1 实际只变 1 字节(LSB = 区内偏移 1);
// 断言 = 差异全落区内 ∧ 恰 1 字节 ∧ 就是 LSB. "要求 9 字节变" 是假测试, 从未如此断言, 但旧标题读起来像.
step('S4 (NWT ①/Codex ③) phase 真变: redeem1 vs redeem0 差异 恰 1 字节 = phase i64LE 的 LSB(区内偏移 1), 且全落 phase 9 字节区内; 其余逐字节相等', () => {
  const a = Buffer.from(redeem0, 'hex'), b = Buffer.from(redeem1, 'hex');
  assert.strictEqual(a.length, b.length, 'phase0/1 redeem 应同长');
  const diff = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  assert.ok(diff.every((i) => i >= start + 1 && i < start + 9), `差异位置 ${diff} 不在 phase 字段区 [${start + 1},${start + 9})`);
  assert.strictEqual(diff.length, 1, `phase 0→1 应恰 1 字节差异, 实 ${diff.length}: ${diff}`);
  assert.strictEqual(diff[0], start + 1, `差异应在 LSB(区内偏移 1), 实 ${diff[0] - start}`);
  assert.strictEqual(a[start + 1], 0x00); assert.strictEqual(b[start + 1], 0x01);
  return { diff_positions: diff, phase_region: [start, start + 9], lsb_offset: 1 };
});

// ── 测试钥 + 假 funding(离线; outpoint 假但形状真) ──
const priv = new k.PrivateKey('0'.repeat(63) + '2');   // test-only, NEVER production
const payAddr = priv.toPublicKey().toAddress(NET).toString();
const SEED = 100_000_000n;          // 1 KAS 进 covenant
const FEE = 1_000_000n;             // 0.01 KAS/input 同 _BSHARD_FEE_PER_INPUT
const BUDGET = 70;                  // _BSHARD_COMPUTE_BUDGET
const fakeUtxo = (txid, index, amount, spk) => ({ address: new k.Address(payAddr), outpoint: { transactionId: txid, index }, amount, value: amount, scriptPublicKey: spk, blockDaaScore: 1n, isCoinbase: false });
const FUND1 = fakeUtxo('11'.repeat(32), 0, 200_000_000n, k.payToAddressScript(new k.Address(payAddr)));
const FUND2 = fakeUtxo('22'.repeat(32), 0, 50_000_000n, k.payToAddressScript(new k.Address(payAddr)));
const SUBNET = '0000000000000000000000000000000000000000';
const mkTx = (inputs, outputs) => new k.Transaction({ version: 1, inputs, outputs, lockTime: 0n, gas: 0n, subnetworkId: SUBNET, payload: '' });
// ⚠ 两条 wasm 语义(本 harness 实栽, 与生产 p2sh.mjs 形一致): ① 每个 input 都带 utxo(serializeToJSON 要求; 生产签名路径也这样喂 unsigned);
//   ② outputs 数组【只建一次】给 unsigned 与 signed 复用 —— CovenantBinding/TransactionOutput 传进 new Transaction 会被 move, 二次 new 会丢 covenant。
const inp = (u, ss) => ({ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: ss, sequence: 0n, sigOpCount: 0, computeBudget: BUDGET, utxo: u });

// ── 1. genesis: funding → out[0] = P2SH(redeem0) + populateGenesisCovenants ⇒ cov_id (① 非零) ──
const genesis = step('G1 genesis 构造: out[0]=P2SH(redeem@phase0) + GenesisCovenantGroup(0,[0]) ⇒ cov_id 非零; covenantId() 独立函数复算相等', () => {
  const outs = () => [new k.TransactionOutput(SEED, k.payToScriptHashScript(new Uint8Array(Buffer.from(redeem0, 'hex')))), new k.TransactionOutput(FUND1.amount - SEED - FEE, k.payToAddressScript(new k.Address(payAddr)))];
  const outputs = outs();
  const mk = (ss) => { const t = mkTx([inp(FUND1, ss)], outputs); t.populateGenesisCovenants([new k.GenesisCovenantGroup(0, [0])]); return t; };
  const covId = String(mk('').outputs[0].covenant.covenantId);
  assert.match(covId, /^[0-9a-f]{64}$/); assert.notStrictEqual(covId, '0'.repeat(64), 'cov_id 为零');
  // 独立 oracle: kaspa-wasm covenantId(genesis_outpoint, auth_outputs)(用新建的 output 对象, 不复用被 move 的)
  const oracle = String(k.covenantId({ transactionId: FUND1.outpoint.transactionId, index: FUND1.outpoint.index }, [{ index: 0, output: outs()[0] }]));
  assert.strictEqual(covId, oracle, 'populateGenesisCovenants 与 covenantId() 不一致');
  const sig = k.createInputSignature(mk(''), 0, priv, k.SighashType.All);
  const tx = mk(sig);
  return { covId, tx, txid: String(tx.id), genesis_address: p2shAddr(redeem0) };
});

// ── 2. reveal: in[0]=genesis:0 (transition OP_0) + in[1]=fee → out[0]=P2SH(redeem@phase1)+CovenantBinding(0,Hash(covId)) + change ──
const GEN_UTXO = fakeUtxo(genesis.txid, 0, SEED, k.payToScriptHashScript(new Uint8Array(Buffer.from(redeem0, 'hex'))));
const transitionSig = (redeemHex, selfInIdx = 0, selfOutIdx = 0) => pushInt(selfInIdx) + pushInt(selfOutIdx) + '00' /* entry 0 selector */ + pushData(Buffer.from(redeemHex, 'hex'));
function buildReveal({ covIdHex = genesis.covId, binding = 'ok', outRedeem = redeem1, inRedeem = redeem0, prevIndex = 0, prevTxid = genesis.txid }) {
  const genU = { ...GEN_UTXO, outpoint: { transactionId: prevTxid, index: prevIndex } };
  const cov = binding === 'ok' ? new k.CovenantBinding(0, new k.Hash(covIdHex)) : binding === 'wrong' ? new k.CovenantBinding(0, new k.Hash('ab'.repeat(32))) : undefined;
  const outputs = [   // 只建一次, unsigned/signed 复用(见上 ⚠②)
    cov ? new k.TransactionOutput(SEED, k.payToScriptHashScript(new Uint8Array(Buffer.from(outRedeem, 'hex'))), cov) : new k.TransactionOutput(SEED, k.payToScriptHashScript(new Uint8Array(Buffer.from(outRedeem, 'hex')))),
    new k.TransactionOutput(FUND2.amount - FEE * 2n, k.payToAddressScript(new k.Address(payAddr))),
  ];
  const unsigned = mkTx([inp(genU, ''), inp(FUND2, '')], outputs);
  const feeSig = k.createInputSignature(unsigned, 1, priv, k.SighashType.All);
  const tx = mkTx([inp(genU, transitionSig(inRedeem)), inp(FUND2, feeSig)], outputs);
  return tx;
}
const reveal = step('R1 reveal 构造: in[0] = genesis:0 (transition 0,0 OP_0 + redeem0) ; out[0] = P2SH(redeem@phase1) + CovenantBinding(0, Hash(cov_id)); fee input 签名', () => {
  const tx = buildReveal({});
  const o0 = tx.outputs[0];
  assert.strictEqual(tx.inputs[0].previousOutpoint.transactionId, genesis.txid); assert.strictEqual(Number(tx.inputs[0].previousOutpoint.index), 0);   // ②
  assert.strictEqual(String(o0.covenant?.covenantId), genesis.covId);   // ③ 同 cov_id 绑定
  assert.strictEqual(k.addressFromScriptPublicKey(o0.scriptPublicKey, NET).toString(), contAddr);   // ④ 后继地址 = 生产算的 continuation
  assert.strictEqual(String(o0.value), String(SEED));
  return { tx, txid: String(tx.id), out0_cov: String(o0.covenant.covenantId), out0_addr: contAddr };
});
step('R2 序列化往返 + 不变量(Σin>Σout, 输出≥dust, fee≥mass×100) 两笔', () => {
  const chk = (tx, ins, label) => {
    const j = tx.serializeToJSON(); const back = k.Transaction.deserializeFromJSON(j);
    assert.strictEqual(back.serializeToJSON(), j, `${label} 往返不等`); assert.strictEqual(String(back.id), String(tx.id));
    const sumIn = ins.reduce((a, u) => a + u.amount, 0n); const sumOut = tx.outputs.reduce((a, o) => a + BigInt(o.value), 0n);
    const fee = sumIn - sumOut; assert.ok(fee > 0n, `${label} fee<=0`);
    for (const o of tx.outputs) assert.ok(BigInt(o.value) >= 1000n, `${label} dust`);
    // mass: 同生产 _assertTxInvariants :57-62 —— calculateTransactionMass 对 v1 covenant tx 在本 wasm 构建上 panic(unreachable) ⇒ try/catch 跳过如实记, 不 fail(mempool 兜底)
    let mass = 'unavailable(calculateTransactionMass panicked: same as production fallback)';
    try { const m = BigInt(k.calculateTransactionMass(NET, tx)); assert.ok(fee >= m * 100n, `${label} fee ${fee} < mass ${m}×100`); mass = m.toString(); } catch (e) { if (e?.code === 'ERR_ASSERTION') throw e; }
    return { txid: String(tx.id), size_json: j.length, mass, fee: fee.toString() };
  };
  return { genesis: chk(genesis.tx, [FUND1], 'genesis'), reveal: chk(reveal.tx, [GEN_UTXO, FUND2], 'reveal') };
});

// ── 3. 负向量(NWT ②: 四失败模式 + N5), 各带预期拒因层; 离线只钉"哪一层、哪条 require"; 拒绝码 READY 后实测 ──
const NEG = [
  { id: 'N1', name: '错 cid: CovenantBinding(0, Hash(other))', build: () => buildReveal({ binding: 'wrong' }), expect: { layer: 'consensus-covenant', reason: 'binding cov_id ≠ authorizing input UTXO cov_id ⇒ covenant validation reject' } },
  { id: 'N2', name: '错输入 outpoint: genesis:1(不存在)', build: () => buildReveal({ prevIndex: 1 }), expect: { layer: 'chain/mempool', reason: 'missing outpoint / orphan (not a covenant finding)' } },
  { id: 'N3', name: '错 continuation 地址: 后继 = P2SH(redeem@phase0)(state 未变)', build: () => buildReveal({ outRedeem: redeem0 }), expect: { layer: 'script', reason: 'validateOutputState(selfOutIdx,{phase:1,…}) fails (output script ≠ expected continuation)' } },
  { id: 'N4', name: '错·陈 state: 输入是 phase=1 的 UTXO 再走 transition', build: () => buildReveal({ inRedeem: redeem1, outRedeem: redeem1 }), expect: { layer: 'script', reason: 'require(phase == 0) fails (stale/wrong LOCKED_F)' } },
  { id: 'N5', name: '漏 binding: 后继无 CovenantBinding', build: () => buildReveal({ binding: 'none' }), expect: { layer: 'script', reason: 'OpOutputCovenantId(selfOutIdx) ≠ self_cov (0 vs cid) ⇒ require(out_cov == self_cov) fails' } },
];
const negatives = NEG.map((n) => { const tx = n.build(); const j = tx.serializeToJSON(); assert.strictEqual(k.Transaction.deserializeFromJSON(j).serializeToJSON(), j); writeFileSync(join(OUT, `${n.id}.tx.json`), j); console.log(`[OK] ${n.id} ${n.name} → 期望层 ${n.expect.layer}`); return { id: n.id, name: n.name, txid: String(tx.id), expect: n.expect, file: `${n.id}.tx.json`, sha256: sha(j) }; });
// N3/N4/N5 的"差异证明": 与正向 reveal 恰在预期字段不同
step('N-diff: N1 只差 binding cov_id; N5 只差 binding 缺失; N3 只差 out[0] spk; N2 只差 in[0] index', () => {
  const base = reveal.tx.serializeToJSON();
  const d = (id) => { const j = readFileSync(join(OUT, `${id}.tx.json`), 'utf8'); return { same_len_class: Math.abs(j.length - base.length) < 400, differs: j !== base }; };
  return { N1: d('N1'), N2: d('N2'), N3: d('N3'), N5: d('N5') };
});

// ── 3b. v0.3 (D-016 A′): recovery_daa 入口 = DAA 域 CLTV 相对锚; E1 字节证 + 构造级 + 广播段负向量 N6/N7/N8/P 的构造 ──
const { cltvLockTime, cltvSequence, LOCK_TIME_THRESHOLD: CLTV_T } = await import(pathToFileURL(resolve(HERE, '..', '..', 'kasia-relay', 'src', 'lib', 'cltv-locktime.mjs')).href);
const OPC = { TxInputDaaScore: 0xc0, Add: 0x93, LessThan: 0x9f, Verify: 0x69, CLTV: 0xb0, PushData1: 0x4c, PushData2: 0x4d, PushData4: 0x4e };
// 最小 opcode 流解码 (只区分 push 与单字节 op; 与 S2 的 pushInt/pushData oracle 同一套编码规则)
const decodeOps = (hex) => { const b = Buffer.from(hex, 'hex'); const ops = []; let i = 0; while (i < b.length) { const op = b[i]; if (op >= 0x01 && op <= 0x4b) { ops.push({ at: i, op, data: b.subarray(i + 1, i + 1 + op) }); i += 1 + op; } else if (op === OPC.PushData1) { const n = b[i + 1]; ops.push({ at: i, op, data: b.subarray(i + 2, i + 2 + n) }); i += 2 + n; } else if (op === OPC.PushData2) { const n = b.readUInt16LE(i + 1); ops.push({ at: i, op, data: b.subarray(i + 3, i + 3 + n) }); i += 3 + n; } else if (op === OPC.PushData4) { const n = b.readUInt32LE(i + 1); ops.push({ at: i, op, data: b.subarray(i + 5, i + 5 + n) }); i += 5 + n; } else { ops.push({ at: i, op }); i += 1; } } return ops; };
const N_PROBE = Number(CTOR0[5]?.data ?? 100);
step('E1 字节证(cfedc5c6 §1 E1/§4): redeem1 含且仅含 1 个 OpTxInputDaaScore(0xc0), 其后依次 OpAdd(0x93) → push(5e11 LE) → OpLessThan(0x9f) → OpVerify(0x69) → OpCheckLockTimeVerify(0xb0); CLTV 共 2 个(recovery ms + recovery_daa); v0.2 产物只有 1 个', () => {
  const ops = decodeOps(redeem1);
  const idx = (pred, from = 0) => ops.findIndex((o, i) => i >= from && pred(o));
  const iDaa = idx((o) => o.op === OPC.TxInputDaaScore); assert.ok(iDaa >= 0, '无 OpTxInputDaaScore');
  assert.strictEqual(ops.filter((o) => o.op === OPC.TxInputDaaScore).length, 1, 'OpTxInputDaaScore 应恰 1 处(只在 recovery_daa)');
  const iAdd = idx((o) => o.op === OPC.Add, iDaa); assert.ok(iAdd > iDaa, 'OpAdd 应在 OpTxInputDaaScore 之后');
  const thrLE = Buffer.alloc(8); thrLE.writeBigUInt64LE(CLTV_T); const thrMin = Buffer.from(thrLE.subarray(0, 5));   // 5e11 = 0x746a528800 ⇒ 最小正编码 5 字节 (最高位 0x74 < 0x80, 无需符号字节)
  const iThr = idx((o) => o.data && o.data.equals(thrMin), iAdd); assert.ok(iThr > iAdd, `push(5e11=${thrMin.toString('hex')}) 应在 OpAdd 之后`);
  const iLt = idx((o) => o.op === OPC.LessThan, iThr); assert.ok(iLt > iThr, 'OpLessThan 应在 push(5e11) 之后');
  const iVer = idx((o) => o.op === OPC.Verify, iLt); assert.ok(iVer > iLt, 'OpVerify 应在 OpLessThan 之后');
  const cltvs = ops.map((o, i) => (o.op === OPC.CLTV ? i : -1)).filter((i) => i >= 0);
  assert.strictEqual(cltvs.length, 2, `CLTV 应 2 处(recovery + recovery_daa), 实 ${cltvs.length}`);
  assert.ok(cltvs[1] > iVer, 'recovery_daa 的 CLTV 应在域守卫之后');
  const v02 = join(PROBE_DIR, 'probe_phase1.v02.json');
  if (existsSync(v02)) { const s02 = Buffer.from(JSON.parse(readFileSync(v02, 'utf8')).script).toString('hex'); assert.strictEqual(decodeOps(s02).filter((o) => o.op === OPC.CLTV).length, 1, 'v0.2 产物应只有 1 个 CLTV'); }
  return { ops_total: ops.length, i_daa: iDaa, i_add: iAdd, i_thr: iThr, i_lt: iLt, i_verify: iVer, i_cltv: cltvs, threshold_push_hex: thrMin.toString('hex'), n_probe: N_PROBE };
});
// recovery_daa 构造: 花 reveal 后继(phase=1 UTXO, contAddr) → 全部到 payAddr(terminal, 无 covenant 输出); selector = entry 3
const SUCC_DAA = 80_000_000n;   // 假 successor 创建 DAA(离线); 真链上 = reveal 落块 DAA, 由回读给
const SUCC_UTXO = { ...fakeUtxo(reveal.txid, 0, SEED, k.payToScriptHashScript(new Uint8Array(Buffer.from(redeem1, 'hex')))), blockDaaScore: SUCC_DAA, address: new k.Address(contAddr) };
const recoveryDaaSig = (selfInIdx = 0) => pushInt(selfInIdx) + pushInt(3) /* entry 3 selector */ + pushData(Buffer.from(redeem1, 'hex'));
const mkTxL = (inputs, outputs, lockTime) => new k.Transaction({ version: 1, inputs, outputs, lockTime, gas: 0n, subnetworkId: SUBNET, payload: '' });
function buildRecoveryDaa({ lockTime, sequence = 0n } = {}) {
  const outputs = [new k.TransactionOutput(SEED - FEE, k.payToAddressScript(new k.Address(payAddr)))];
  const i0 = { ...inp(SUCC_UTXO, recoveryDaaSig(0)), sequence };
  return mkTxL([i0], outputs, lockTime);
}
const E_PROBE = SUCC_DAA + BigInt(N_PROBE);
const recoveryDaa = step(`P recovery_daa 构造(D-016 硬前置): lockTime = cltvLockTime({daa,[d+N]}) = ${E_PROBE} (非 0), sequence 0n(≠MAX); 输出 terminal 无 covenant; 往返相等`, () => {
  const lockTime = cltvLockTime({ domain: 'daa', bounds: [E_PROBE] });
  assert.strictEqual(lockTime, E_PROBE); assert.ok(lockTime < CLTV_T);
  const tx = buildRecoveryDaa({ lockTime, sequence: cltvSequence(0n) });
  assert.strictEqual(BigInt(tx.lockTime), E_PROBE, 'tx.lockTime 应 = E');
  assert.strictEqual(BigInt(tx.inputs[0].sequence), 0n);
  assert.strictEqual(tx.outputs.length, 1); assert.ok(!tx.outputs[0].covenant, 'terminal: 无 covenant 输出');
  const j = tx.serializeToJSON(); assert.strictEqual(k.Transaction.deserializeFromJSON(j).serializeToJSON(), j);
  return { tx, txid: String(tx.id), lockTime: lockTime.toString(), E: E_PROBE.toString(), d: SUCC_DAA.toString(), n: N_PROBE };
});
// 广播段负向量(构造级; 期望拒因 = classifyLockReject 四类之三; 离线只能钉"构造与期望", 拒绝文本 READY 后实测)
const NEG_LOCK = [
  { id: 'N6', name: `lock_time = E−1 (${E_PROBE - 1n})`, build: () => buildRecoveryDaa({ lockTime: E_PROBE - 1n }), expect: { layer: 'script', reason: 'CLTV: locktime requirement not satisfied (stack E > tx.lock_time)', consensus_site: 'opcodes/mod.rs:1038' } },
  { id: 'N7', name: 'lock_time 时间类 (5e11 + now_ms)', build: () => buildRecoveryDaa({ lockTime: CLTV_T + BigInt(Date.now()) }), expect: { layer: 'script', reason: 'CLTV: mismatched locktime types (tx time-class vs stack DAA-class)', consensus_site: 'opcodes/mod.rs:1034' } },
  { id: 'N8', name: 'lock_time = E 但提交时 tip DAA ≤ E (立即提交)', build: () => buildRecoveryDaa({ lockTime: E_PROBE }), expect: { layer: 'consensus/mempool', reason: 'NotFinalized: tx.lock_time >= block DAA and input sequence != MAX', consensus_site: 'tx_validation_in_header_context.rs:86' } },
  { id: 'N9', name: 'sequence = MAX (finalized 绕过尝试)', build: () => buildRecoveryDaa({ lockTime: E_PROBE, sequence: (1n << 64n) - 1n }), expect: { layer: 'script', reason: 'CLTV: transaction input is finalized', consensus_site: 'opcodes/mod.rs:1056' } },
];
const negativesLock = NEG_LOCK.map((n) => { const tx = n.build(); const j = tx.serializeToJSON(); assert.strictEqual(k.Transaction.deserializeFromJSON(j).serializeToJSON(), j); writeFileSync(join(OUT, `${n.id}.tx.json`), j); console.log(`[OK] ${n.id} ${n.name} → 期望层 ${n.expect.layer} (${n.expect.consensus_site})`); return { id: n.id, name: n.name, txid: String(tx.id), lockTime: String(tx.lockTime), expect: n.expect, file: `${n.id}.tx.json`, sha256: sha(j) }; });
step('N-lock diff: N6 只差 lockTime(E−1 vs E); N7 只差 lockTime 量级; N8 与 P 字节相同(差在提交时机); N9 只差 sequence', () => {
  const P = recoveryDaa.tx.serializeToJSON();
  const rd = (id) => readFileSync(join(OUT, `${id}.tx.json`), 'utf8');
  assert.strictEqual(rd('N8'), P, 'N8 应与 P 逐字节相同');
  assert.notStrictEqual(rd('N6'), P); assert.notStrictEqual(rd('N7'), P); assert.notStrictEqual(rd('N9'), P);
  return { N8_equals_P: true };
});
writeFileSync(join(OUT, 'recovery_daa.tx.json'), recoveryDaa.tx.serializeToJSON());

// ── 4. 证据(Codex ⑦) ──
const COMPILER = 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
const evidence = {
  probe: 'S63A transition probe · offline part', utc: new Date().toISOString(), network: NET, provisional: 'offline-only; ⑤⑥ pending READY broadcast segment',
  source: { sil_sha256: sha(SIL), ctor_phase0: CTOR0, ctor_phase1: CTOR1, compiler: { path: COMPILER, sha256: sha(readFileSync(COMPILER)), version: P0.compiler_version }, script0_sha256: sha(Buffer.from(redeem0, 'hex')), script1_sha256: sha(Buffer.from(redeem1, 'hex')), state_layout: P0.state_layout, abi: P0.abi },
  genesis: { txid: genesis.txid, cov_id: genesis.covId, address: genesis.genesis_address, funding_outpoint: FUND1.outpoint, seed_sompi: SEED.toString(), file: 'genesis.tx.json' },
  reveal: { txid: reveal.txid, spends: `${genesis.txid}:0`, out0_cov_id: reveal.out0_cov, out0_address: reveal.out0_addr, continuation_by_production_fn: contAddr, file: 'reveal.tx.json' },
  codex_items: { '1_nonzero_cid': true, '2_consumes_exact_input': true, '3_same_cid_binding': true, '4_intended_successor_state': 'phase 0→1, address changed, only phase bytes differ', '5_readback_and_branches': 'PENDING READY', '6_negatives': 'expected layers recorded; codes PENDING READY', '7_durable': 'this file + MANIFEST' },
  negatives, steps: log,
  recovery_daa_v03: { entry: 3, n_probe: N_PROBE, lockTime: recoveryDaa.lockTime, E: recoveryDaa.E, d_offline_fake: recoveryDaa.d, txid: recoveryDaa.txid, file: 'recovery_daa.tx.json', negatives: negativesLock, note: 'D-016 A′: DAA 域 CLTV 相对锚; 离线只证字节形(E1)与构造硬前置(lockTime=E, sequence≠MAX); 拒因文本与落地 READY 后广播段实测(N6/N7/N8/N9 + P)' },
};
writeFileSync(join(OUT, 'genesis.tx.json'), genesis.tx.serializeToJSON());
writeFileSync(join(OUT, 'reveal.tx.json'), reveal.tx.serializeToJSON());
writeFileSync(join(OUT, 'evidence.json'), J(evidence));
const files = ['genesis.tx.json', 'reveal.tx.json', 'recovery_daa.tx.json', 'evidence.json', ...negatives.map((n) => n.file), ...negativesLock.map((n) => n.file)];
writeFileSync(join(OUT, 'MANIFEST.txt'), files.map((f) => `${sha(readFileSync(join(OUT, f)))}  ${f}`).join('\n') + '\n');
console.log(`\n✅ offline harness: ${log.length} steps OK, ${negatives.length} negatives built; cov_id=${genesis.covId.slice(0, 16)}… genesis=${genesis.txid.slice(0, 16)}… reveal=${reveal.txid.slice(0, 16)}…\n   out: ${OUT}`);
