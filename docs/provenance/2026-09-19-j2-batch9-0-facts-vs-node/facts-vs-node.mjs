// facts-vs-node.mjs — 批9 9-0 验收①(设计 v0.3.1 §12.11①): relay `facts` 路径回的 scriptPublicKey/covenantId
// 与【节点直读】逐字节比对, 含 covenant 与普通(P2SH 无 covenant / P2PK)两类, 形态 O 与形态 L 各一。
//
// 三个相互独立的来源:
//   S1 relay 代码: handleGetAddressUtxos(真 kasia-relay/src/lib/utxo-facts.mjs) + 真实 kaspa-wasm RpcClient(borsh)
//   S2 节点直读:   原始 JSON wRPC(ws://…:18511)——裸 WebSocket + JSON.parse, 不经 wasm 类、不经本仓任何代码
//   S3 构造期望:   建交易时本地算出的 spk 原文与 kaspa.covenantId(outpoint, outputs)(与生产 builder 同一函数)
// 另含: 比较器红灯对照(故意翻 1 个 nibble 必报不一致)、形态 O 的 missing(已花/不存在)、R2 pmt 对照。
//
// 🔴 只连本机 simnet: URL 必须是 127.0.0.1/localhost, 且 borsh 与 json 两条通路的 getBlockDagInfo.network 都必须是 simnet,
//   否则拒绝运行。密钥为本次运行临时随机生成的 simnet 测试钥, 不打印、不落盘。不碰主网、不动任何驱动开关。
//
// 运行: node docs/provenance/2026-09-19-j2-batch9-0-facts-vs-node/facts-vs-node.mjs [--borsh=ws://127.0.0.1:18510] [--json=ws://127.0.0.1:18511]
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const { values: A } = parseArgs({ options: { borsh: { type: 'string', default: 'ws://127.0.0.1:18510' }, json: { type: 'string', default: 'ws://127.0.0.1:18511' } } });
for (const u of [A.borsh, A.json]) if (!/^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(u)) throw new Error(`REFUSE: 只允许本机回环地址, 收到 ${u}`);

const req = createRequire(path.join(REPO, 'kasia-relay', 'package.json'));
const kaspa = await import(pathToFileURL(req.resolve('kaspa-wasm')).href);
const { handleGetAddressUtxos, handleGetPastMedianTime, FACTS_LIST_MAX } = await import(pathToFileURL(path.join(REPO, 'kasia-relay/src/lib/utxo-facts.mjs')).href);
const { signOnlyDeclaredInputs } = await import(pathToFileURL(path.join(REPO, 'kasia-relay/src/lib/covenant-broadcast.mjs')).href);

const NETWORK = 'simnet';
const PROTO_V0_COMPUTE_BUDGET = 70;            // = kasia-console/src/lib/proto-tx-assembly.mjs:51(v1 交易 sigOpCount=0 + computeBudget)
const COV_VALUE = 100_000_000n;                // 测试用面值(1 KAS): 远高于 DUST_MIN, 避开 KIP-9 p²/v 放大(见 J2 接位纪律 8)
const evidence = { startedAt: new Date().toISOString(), rows: [], checks: [] };
const log = (...a) => console.log(...a);
const check = (name, ok, detail) => { evidence.checks.push({ name, ok: !!ok, detail }); log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) process.exitCode = 1; };

// ── 连接与网络护栏 ────────────────────────────────────────────────────────────────────────────────
const rpc = new kaspa.RpcClient({ url: A.borsh, networkId: NETWORK });
await rpc.connect();
const ws = new WebSocket(A.json);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('json wRPC 连接失败')); });
let rid = 0;
const rawCall = (method, params = {}) => new Promise((res, rej) => {
  const id = ++rid;
  const h = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id !== id) return; ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.params); };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id, method, params }));
});
const dagB = await rpc.getBlockDagInfo();
const dagJ = await rawCall('getBlockDagInfo');
if (String(dagB.network) !== NETWORK || String(dagJ.network) !== NETWORK) throw new Error(`REFUSE: 网络不是 ${NETWORK}: borsh=${dagB.network} json=${dagJ.network}`);
log(`网络护栏通过: borsh.network=${dagB.network} json.network=${dagJ.network}`);

// ── 工具 ─────────────────────────────────────────────────────────────────────────────────────────
const priv = new kaspa.PrivateKey(crypto.randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress(NETWORK).toString();
const relaySpk = kaspa.payToAddressScript(new kaspa.Address(relayAddr));
const p2shSpk = (label) => new kaspa.ScriptPublicKey(0, 'aa20' + crypto.createHash('sha256').update(label).digest('hex') + '87');   // 形状同 P2SH; 脚本哈希是占位承诺(本测试不花它)
const mine = async (n) => { for (let i = 0; i < n; i++) { const { block } = await rpc.getBlockTemplate({ payAddress: relayAddr }); const r = await rpc.submitBlock({ block, allowNonDAABlocks: true }); if (r.report?.type !== 'success' && !JSON.stringify(r.report).includes('success')) throw new Error('submitBlock: ' + JSON.stringify(r.report)); } };
const utxosWasm = async (addr) => (await rpc.getUtxosByAddresses({ addresses: [addr] })).entries || [];

// S2: 节点直读(原始 JSON wRPC)。scriptPublicKey 在该编码里是 "<u16 version 4 hex><script hex>"。
const nodeDirect = async (addr) => {
  const r = await rawCall('getUtxosByAddresses', { addresses: [addr] });
  return (r.entries || []).map((e) => {
    const s = String(e.utxoEntry.scriptPublicKey);
    return { key: `${e.outpoint.transactionId}:${e.outpoint.index}`, amount: String(e.utxoEntry.amount), version: parseInt(s.slice(0, 4), 16), scriptHex: s.slice(4), covenantId: e.utxoEntry.covenantId ?? null };
  });
};
const fromFacts = (it) => ({ key: `${it.outpoint.transactionId}:${it.outpoint.index}`, amount: it.amount, version: it.scriptPublicKey.version, scriptHex: it.scriptPublicKey.scriptHex, covenantId: it.covenantId });
const fields = (x) => JSON.stringify([x.amount, x.version, x.scriptHex, x.covenantId]);
const same = (a, b) => fields(a) === fields(b);

// ── 1. 挖矿资金 ───────────────────────────────────────────────────────────────────────────────────
// coinbase 成熟期: 第一次运行挖到 ~725 块仍报 "spends an immature coinbase output"(留档在 run-attempt1-immature.txt), 故起始挖 1100 块。
//   副产品: relay 地址上会有 ~1100 个同面值 coinbase UTXO, 远超 FACTS_LIST_MAX(200) ⇒ 形态 L 的截断与全序 tiebreak 在真实节点数据上被走一遍。
await mine(1100);
let coinbase = (await utxosWasm(relayAddr)).sort((a, b) => Number(a.entry.blockDaaScore - b.entry.blockDaaScore))[0];
log(`资金: relay 地址上 coinbase UTXO 数=${(await utxosWasm(relayAddr)).length}, 用最老的一枚(daa=${coinbase.entry.blockDaaScore}) 作 genesis fee 输入`);

// ── 2. 造并提交 genesis 交易: 2 个 covenant 输出(各自独立 GenesisCovenantGroup) + 1 个普通 P2SH(无 covenant) + 找零 P2PK ────
const cov1Spk = p2shSpk('j2-9-0-covenant-1'), cov2Spk = p2shSpk('j2-9-0-covenant-2'), plainSpk = p2shSpk('j2-9-0-plain-p2sh-ticketlike');
const inOutpoint = { transactionId: String(coinbase.outpoint.transactionId), index: Number(coinbase.outpoint.index) };
const inAmount = BigInt(coinbase.amount);
let fee = 3_000_000n, submitted = null, tx = null;
for (let attempt = 1; attempt <= 6 && !submitted; attempt++) {
  const change = inAmount - 3n * COV_VALUE - fee;
  tx = new kaspa.Transaction({
    version: 1, lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    inputs: [{ previousOutpoint: inOutpoint, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: PROTO_V0_COMPUTE_BUDGET, utxo: { outpoint: inOutpoint, amount: inAmount, scriptPublicKey: relaySpk, blockDaaScore: BigInt(coinbase.entry.blockDaaScore) } }],
    outputs: [new kaspa.TransactionOutput(COV_VALUE, cov1Spk), new kaspa.TransactionOutput(COV_VALUE, cov2Spk), new kaspa.TransactionOutput(COV_VALUE, plainSpk), new kaspa.TransactionOutput(change, relaySpk)],
  });
  tx.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(0, [0]), new kaspa.GenesisCovenantGroup(0, [1])]);
  signOnlyDeclaredInputs({ tx, signInputIndices: [0], privateKey: priv, kaspa });      // 生产签名函数
  tx.finalize();
  try { await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); submitted = tx.id; }
  catch (e) {
    const m = String(e.message || e);
    const need = m.match(/required amount of (\d+)/);
    log(`  提交尝试 ${attempt} 被拒: ${m.slice(0, 160)}`);
    if (need && BigInt(need[1]) > fee) { fee = BigInt(need[1]); continue; }
    if (/maturity|immature/i.test(m)) { await mine(500); coinbase = (await utxosWasm(relayAddr)).sort((a, b) => Number(a.entry.blockDaaScore - b.entry.blockDaaScore))[0]; continue; }
    throw e;
  }
}
if (!submitted) throw new Error('genesis 交易 6 次尝试均未被接受');
await mine(1);
log(`genesis 交易已上链: txid=${submitted} fee=${fee} sompi`);

// S3: 构造期望
const covId = (i, spk) => String(kaspa.covenantId(inOutpoint, [{ index: i, output: new kaspa.TransactionOutput(COV_VALUE, spk) }]));
const expected = {
  [`${submitted}:0`]: { amount: COV_VALUE.toString(), version: 0, scriptHex: cov1Spk.script, covenantId: covId(0, cov1Spk), label: 'covenant#1 (P2SH 形状, 带 covenant 绑定)' },
  [`${submitted}:1`]: { amount: COV_VALUE.toString(), version: 0, scriptHex: cov2Spk.script, covenantId: covId(1, cov2Spk), label: 'covenant#2 (P2SH 形状, 带 covenant 绑定)' },
  [`${submitted}:2`]: { amount: COV_VALUE.toString(), version: 0, scriptHex: plainSpk.script, covenantId: null, label: '普通 P2SH(无 covenant, ticket 形状)' },
  [`${submitted}:3`]: { amount: (inAmount - 3n * COV_VALUE - fee).toString(), version: 0, scriptHex: relaySpk.script, covenantId: null, label: '找零 P2PK(relay fee 输入形状)' },
};
check('S3 两个 covenant 的期望 covenantId 互不相同且是 64 位 hex', expected[`${submitted}:0`].covenantId !== expected[`${submitted}:1`].covenantId && /^[0-9a-f]{64}$/.test(expected[`${submitted}:0`].covenantId));

const addrOf = (spk) => String(kaspa.addressFromScriptPublicKey(spk, NETWORK));
const targets = [
  { addr: addrOf(cov1Spk), keys: [`${submitted}:0`] }, { addr: addrOf(cov2Spk), keys: [`${submitted}:1`] },
  { addr: addrOf(plainSpk), keys: [`${submitted}:2`] }, { addr: relayAddr, keys: [`${submitted}:3`] },
];
const spentKey = `${inOutpoint.transactionId}:${inOutpoint.index}`;

// ── 3. 三源逐字段比对: 形态 O(outpoints) ───────────────────────────────────────────────────────────
for (const t of targets) {
  const s2all = await nodeDirect(t.addr);
  const raw = await handleGetAddressUtxos({
    cmd: { address: t.addr, facts: true, outpoints: t.keys.map((k) => ({ transactionId: k.split(':')[0], index: Number(k.split(':')[1]) })) },
    getSharedRpc: async () => rpc, legacyGetAddressUtxos: async () => { throw new Error('facts 路径不该走旧函数'); }, getNetworkId: () => NETWORK,
  });
  check(`O 形态响应带回声 facts:true/factsVersion:1/form:outpoints 且无 truncated (${expected[t.keys[0]].label})`, raw.ok === true && raw.facts === true && raw.factsVersion === 1 && raw.form === 'outpoints' && !('truncated' in raw));
  for (const k of t.keys) {
    const s1 = raw.found.map(fromFacts).find((x) => x.key === k);
    const s2 = s2all.find((x) => x.key === k);
    const s3 = { key: k, ...expected[k] };
    const row = { form: 'outpoints', key: k, label: expected[k].label, S1_relay: s1 ?? null, S2_node_json: s2 ?? null, S3_constructed: { amount: s3.amount, version: s3.version, scriptHex: s3.scriptHex, covenantId: s3.covenantId } };
    evidence.rows.push(row);
    check(`O ${expected[k].label} ${k.slice(0, 10)}…:${k.split(':')[1]}  S1==S2==S3 (amount/version/scriptHex/covenantId)`, s1 && s2 && same(s1, s2) && same(s1, s3) && same(s2, s3), s1 ? `covenantId=${s1.covenantId ? s1.covenantId.slice(0, 16) + '…' : 'null'} scriptHex=${s1.scriptHex.slice(0, 12)}…` : 'S1 缺失');
  }
}

// ── 4. 形态 L(list): relay 地址上有 120 个 coinbase + 找零 ──────────────────────────────────────────
{
  const s2 = await nodeDirect(relayAddr);
  const r = await handleGetAddressUtxos({ cmd: { address: relayAddr, facts: true }, getSharedRpc: async () => rpc, legacyGetAddressUtxos: async () => { throw new Error('x'); }, getNetworkId: () => NETWORK });
  const s1 = r.utxos.map(fromFacts);
  const byKey2 = new Map(s2.map((x) => [x.key, x]));
  const allSame = s1.every((x) => byKey2.has(x.key) && same(x, byKey2.get(x.key)));
  check(`L 形态: relay 地址节点共 ${s2.length} 个 UTXO, relay 回 ${s1.length} 个(上限 ${FACTS_LIST_MAX}), truncated=${r.truncated}; 返回的每一项与节点直读逐字段一致`, allSame && s1.length === Math.min(s2.length, FACTS_LIST_MAX) && r.truncated === (s2.length > FACTS_LIST_MAX));
  // O1 的独立复核: 对【节点直读的原始数据】自己排序(面值降序 → txid 字节序升序 → index 升序), 取前 FACTS_LIST_MAX 项,
  //   relay 返回的 key 序列必须与之【逐项完全一致】。coinbase 全是同面值, 所以这同时验证了同额全序 tiebreak(节点自己的返回顺序不稳定)。
  const cmpNode = (a, b) => (BigInt(a.amount) !== BigInt(b.amount) ? (BigInt(a.amount) > BigInt(b.amount) ? -1 : 1) : a.key.split(':')[0] !== b.key.split(':')[0] ? (a.key.split(':')[0] < b.key.split(':')[0] ? -1 : 1) : Number(a.key.split(':')[1]) - Number(b.key.split(':')[1]));
  const expectOrder = s2.slice().sort(cmpNode).slice(0, FACTS_LIST_MAX).map((x) => x.key);
  check(`L 形态: relay 返回的 ${s1.length} 项顺序 == 对节点原始数据独立排序后的前 ${FACTS_LIST_MAX} 项(逐项完全一致; 含 ${s2.filter((x) => x.amount === s2[0].amount).length > 1 ? '大量同面值' : '无同面值'} 的 tiebreak)`, JSON.stringify(s1.map((x) => x.key)) === JSON.stringify(expectOrder));
  check('L 形态: 找零(4.7e9 < coinbase 5e9)因面值较小被降序窗口正确排在 200 之外(truncated=true 时), 而不是被"dust 优先"挤进或随机取舍', !s1.some((x) => x.key === `${submitted}:3`) === (s2.length > FACTS_LIST_MAX));
  const capped = await handleGetAddressUtxos({ cmd: { address: relayAddr, facts: true, minAmount: '1', maxAmount: '4999999999' }, getSharedRpc: async () => rpc, legacyGetAddressUtxos: async () => { throw new Error('x'); }, getNetworkId: () => NETWORK });
  check('L 形态: maxAmount 过滤生效(去掉 50 KAS 的 coinbase 后只剩找零)', capped.utxos.every((u) => BigInt(u.amount) <= 4999999999n) && capped.utxos.some((u) => u.outpoint.transactionId === submitted));
}

// ── 5. 形态 O 的 missing: 已被花掉的 coinbase / 从未存在的 outpoint ───────────────────────────────────
{
  const r = await handleGetAddressUtxos({
    cmd: { address: relayAddr, facts: true, outpoints: [{ transactionId: inOutpoint.transactionId, index: inOutpoint.index }, { transactionId: 'ab'.repeat(32), index: 7 }, { transactionId: submitted, index: 3 }] },
    getSharedRpc: async () => rpc, legacyGetAddressUtxos: async () => { throw new Error('x'); }, getNetworkId: () => NETWORK,
  });
  const missKeys = r.missing.map((m) => `${m.transactionId}:${m.index}`);
  check('O 形态 missing: 已被花掉的 outpoint 与从未存在的 outpoint 都在 missing, 存在的找零在 found(节点侧确认已花: 也不在直读集合里)',
    missKeys.includes(spentKey) && missKeys.includes(`${'ab'.repeat(32)}:7`) && r.found.length === 1 && !(await nodeDirect(relayAddr)).some((x) => x.key === spentKey));
}

// ── 6. 比较器红灯对照: 故意翻 1 个 nibble, 比较器必须报不一致(否则上面的 PASS 是空判据) ────────────────────
{
  const k = `${submitted}:0`;
  const good = (await nodeDirect(targets[0].addr)).find((x) => x.key === k);
  const flip = (h) => h.slice(0, -1) + (h.slice(-1) === '0' ? '1' : '0');
  const badScript = { ...good, scriptHex: flip(good.scriptHex) }, badCov = { ...good, covenantId: flip(good.covenantId) }, badAmt = { ...good, amount: String(BigInt(good.amount) + 1n) }, badNull = { ...good, covenantId: null };
  check('红灯对照: 翻 1 个 nibble(scriptHex / covenantId)、金额+1、covenantId 抹成 null 四种破坏, 比较器全部判为不一致; 未破坏的判一致',
    !same(good, badScript) && !same(good, badCov) && !same(good, badAmt) && !same(good, badNull) && same(good, { ...good }));
}

// ── 7. R2: get_past_median_time 与节点直读的 pastMedianTime(此刻不再挖矿, 两次读应稳定相等) ─────────────
{
  const before = Date.now();
  const r2 = await handleGetPastMedianTime({ getSharedRpc: async () => rpc });
  const after = Date.now();
  const direct = (await rawCall('getBlockDagInfo')).pastMedianTime;
  const borsh = Number((await rpc.getBlockDagInfo()).pastMedianTime);
  check(`R2 pastMedianTimeMs(${r2.pastMedianTimeMs}) == 节点原始 JSON 直读(${direct}) == borsh(${borsh})`, r2.pastMedianTimeMs === direct && direct === borsh);
  check('R2 只回三个字段 {ok,pastMedianTimeMs,observedAtMs}, observedAtMs 落在调用前后墙钟之间', JSON.stringify(Object.keys(r2)) === JSON.stringify(['ok', 'pastMedianTimeMs', 'observedAtMs']) && r2.observedAtMs >= before && r2.observedAtMs <= after);
}

evidence.finishedAt = new Date().toISOString();
evidence.summary = { passed: evidence.checks.filter((c) => c.ok).length, failed: evidence.checks.filter((c) => !c.ok).length };
fs.writeFileSync(path.join(HERE, 'facts-vs-node.json'), JSON.stringify(evidence, null, 2));
log(`\n${evidence.summary.passed} passed, ${evidence.summary.failed} failed  (明细 facts-vs-node.json)`);
ws.close();
await rpc.disconnect();
process.exit(process.exitCode ?? 0);
