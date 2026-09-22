// seed-prepared-close.mjs — MUST① 红证(Codex MUST① / Bettor 定名 F1): "已备(prepared)未播的 close_commit + 后到冻结 ⇒ 下一 tick 是否仍广播"。
// simnet only · scratch only · 零改仓库码。prepared 行是 harness 用 SQL 人造的(不是自然竞态): 字节 = 仓库真 ops.build → 真 buildCloseCommitTxJson 构造, fee 输入由 throwaway 第二方签。
// 判据以【节点侧】读回为准(mempool / UTXO), 不以 driver 日志为准。期望(修复后)= 不广播; 现码预期 = 广播(红)。
// 用法: node seed-prepared-close.mjs fund2 | plan | run
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const RUN = 'D:/kanet-tn12/scratch/_nwt_f1_crash_arm'; const WT = 'D:/kanet-tn12/scratch/_nwt_wt_f1adv_review'; const EVD = `${RUN}/evidence`;
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_nwt_f1_crash_arm')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
const state = JSON.parse(fs.readFileSync(`${RUN}/state.json`, 'utf8')); const arms = JSON.parse(fs.readFileSync(`${RUN}/arms.json`, 'utf8'));
const marketId = arms[process.env.SP_ARM || 'F'];
const rec = (o) => fs.appendFileSync(`${EVD}/actions.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const lib = (rel) => import(pathToFileURL(`${WT}/kasia-console/src/${rel}`).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lc = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();
const kaspa = createRequire(`${WT}/kasia-relay/`)('kaspa-wasm'); const { RpcClient, Encoding, PrivateKey, Address, Generator, PaymentOutput } = kaspa;
const keyFile = `${RUN}/seed-payer.key.json`; const cmd = process.argv[2];
const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({});
if ((await rpc.getServerInfo()).networkId !== 'simnet') { console.error('REFUSE: networkId != simnet'); process.exit(3); }
const nodeTimes = async () => { const dag = await rpc.getBlockDagInfo(); const si = await rpc.getServerInfo(); return { isSynced: si.isSynced, pmtMs: Number(dag.pastMedianTime), wallMs: Date.now(), daa: String(dag.virtualDaaScore) }; };
const spkToAddr = (spkHex) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, lc(spkHex)), 'simnet').toString();
const done = async (code = 0) => { await rpc.disconnect().catch(() => {}); process.exitCode = code; setTimeout(() => process.exit(code), 200); };

if (cmd === 'fund2') {
  const priv = fs.existsSync(keyFile) ? new PrivateKey(JSON.parse(fs.readFileSync(keyFile, 'utf8')).privHex) : new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
  const address = priv.toPublicKey().toAddress('simnet').toString();
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, JSON.stringify({ note: 'simnet throwaway second-party fee payer for MUST-1 seeded prepared close; worthless', privHex: priv.toString(), address }));
  const tpl = await rpc.getBlockTemplate({ payAddress: address, extraData: [] }); const r = await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false });
  rec({ action: 'seed_payer_funded', why: 'throwaway payer for MUST-1 seeded prepared close_commit (coinbase, matures after 1000 DAA)', report: r.report?.type ?? String(r) }); console.log('funded', address.slice(0, 20) + '…', r.report?.type); await done();
} else if (cmd === 'plan' || cmd === 'run' || cmd === 'run-prefreeze') {
  const k = JSON.parse(fs.readFileSync(keyFile, 'utf8')); const priv = new PrivateKey(k.privHex); const payerAddr = new Address(k.address);
  const { sqlite } = await lib('db/client.js');
  const M = sqlite.prepare('SELECT id, status, winning_side, settlement_frozen_at, frozen_reason, deadline_ms FROM proto_markets WHERE id = ?').get(marketId);
  const resolveRows = sqlite.prepare("SELECT status FROM proto_settlement_intents WHERE subject_type='market' AND subject_id=? AND step='resolve'").all(marketId);
  const nt = await nodeTimes(); const openMs = Number(M.deadline_ms) + 30_000;
  const pre = { market: { status: M.status, ws: M.winning_side, frozen: M.frozen_reason }, resolveIntents: resolveRows.length, node: nt, pmtMinusDeadlinePlus30sSec: (nt.pmtMs - openMs) / 1000, wallMinusDeadlinePlus300sSec: (nt.wallMs - (Number(M.deadline_ms) + 300_000)) / 1000 };
  console.log(JSON.stringify(pre, null, 1));
  if (cmd === 'plan') { rec({ action: 'seed_prepared_plan', marketId, ...pre }); await done(); }
  else {
    // 账本1644(Bettor 转 Codex 精确崩溃恢复臂要求): run-prefreeze 在【冻结之前】建 prepared 行
    // (PROTO_SETTLEMENT_DRIVER_ENABLED=0 是这一步的 harness 屏障, 不是这里再判一次)——要求 winning_side
    // 已写∧sealed∧未冻结∧无任何既有 resolve 行(第一次建, 驱动被关不会有竞争者)。run(冻结之后建, 旧红证
    // 场景)与 run-prefreeze(冻结之前建, 本次精确崩溃恢复场景)故意分成两个前置分支, 不复用同一句判断。
    if (cmd === 'run-prefreeze') {
      if (M.winning_side == null || M.settlement_frozen_at != null || M.status !== 'sealed' || resolveRows.length !== 0) throw new Error('run-prefreeze 前置不满足: 需要 winning_side 已写 ∧ 未冻结 ∧ sealed ∧ 零既有 resolve 意图(驱动应已关, 这是第一次建)');
    } else {
      if (M.winning_side == null || M.settlement_frozen_at == null || M.status !== 'sealed' || resolveRows.some((r) => r.status !== 'pending')) throw new Error('前置不满足: 需要 winning_side 已写 ∧ 已冻结 ∧ sealed ∧ 无非 pending 的 resolve 意图(自然产生的 pending 行允许: driver 在 promote 后 1s 内先于冻结建了它, 见 F 臂记录)');
    }
    if (!(nt.pmtMs > openMs + 20_000)) throw new Error('pmt 未越过 deadline+30s+20s: 此时 tx 节点侧尚不可入, 无信息量(否则"没广播"会是假绿)');
    if (nt.wallMs < Number(M.deadline_ms) + 300_000) throw new Error('墙钟未越过 deadline+300s(builder 第二层守卫)');
    const ops = await lib('lib/proto-settlement-ops.mjs'); const { resolveStepPointers } = await lib('lib/proto-settlement-pointers.mjs'); const { withFeeParent } = await lib('lib/proto-settlement-c1.mjs');
    const asm = await lib('lib/proto-tx-assembly.mjs'); const { computeRootCloseGenesisArtifact } = await lib('lib/proto-covenant-builder.mjs');
    // fee 候选: payer 的 ≤1 KAS UTXO(选择器只收 ≤ SIGNED_INPUT_CEILING); 没有则先自转出一个 0.9 KAS
    const payerSpk = kaspa.payToAddressScript(payerAddr); const payerSpkHex = String(payerSpk.script);
    let utxos = (await rpc.getUtxosByAddresses([payerAddr])).entries || [];
    let small = utxos.filter((e) => BigInt(e.amount) <= 100_000_000n && BigInt(e.amount) >= 90_000_000n);
    if (small.length === 0) {
      const gen = new Generator({ entries: utxos, outputs: [new PaymentOutput(new Address(k.address), 95_000_000n)], priorityFee: 500_000n, changeAddress: new Address(k.address), networkId: 'simnet' });
      let p; while ((p = await gen.next())) { await p.sign([priv]); await p.submit(rpc); }
      for (let i = 0; i < 40 && small.length === 0; i++) { await sleep(1500); utxos = (await rpc.getUtxosByAddresses([payerAddr])).entries || []; small = utxos.filter((e) => BigInt(e.amount) <= 100_000_000n && BigInt(e.amount) >= 90_000_000n); }
      if (small.length === 0) throw new Error('payer 自转 0.95 KAS 未见落链');
    }
    const fu = small[0]; const feeCand = { txid: String(fu.outpoint.transactionId), vout: Number(fu.outpoint.index), value: BigInt(fu.amount), scriptPublicKeyHex: '0x' + payerSpkHex, spkLen: payerSpkHex.length / 2, covenantId: null };
    // 仓库真 ops.prepare / ops.build(close_commit)
    const pointers = resolveStepPointers({ step: 'close_commit', marketId, db: sqlite, kaspa });
    const prep = await ops.prepare('close_commit', { phase: 'inputs', marketId, subjectId: marketId, kaspa, network: 'simnet', pointers, db: sqlite });
    const rcOp = pointers.roles.rootClose.outpoint; const rcSpkLen = lc(prep.expectedSpks.rootClose).length / 2;
    const chainParents = { rootClose: { value: 20_000_000n, spkLen: rcSpkLen, hasCovenant: true, outpoint: { txid: lc(rcOp.transactionId ?? rcOp.txid), index: Number(rcOp.index ?? rcOp.vout) } } };
    const key = `settle:market:${marketId}:resolve`;   // F1 对抗重跑(J2): F3/F4 之后 ops.build 需要调用方算好的 intentKey(F4 预留记录用), 提到这里、下方复用同一个 const 改名 keyAlias 避免重复声明
    const built = await ops.build('close_commit', { kaspa, network: 'simnet', relaySpkHex: payerSpkHex, prep: { ...prep, pointers }, chainParents, feeCandidates: [feeCand], withFeeParent, subjectId: marketId, marketId, db: sqlite, intentKey: key });
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    tx.inputs[1].signatureScript = kaspa.createInputSignature(tx, 1, priv, kaspa.SighashType.All);
    const txid = tx.id; if (txid !== built.expectedTxid) throw new Error(`签 fee 输入后 txid 变了?! ${txid} != ${built.expectedTxid}`);
    const preparedJson = JSON.stringify([tx.serializeToSafeJSON()]);
    const now = new Date().toISOString();
    const target = prep.targetAddress;
    const before = { mempool: await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false }).then(() => true).catch(() => false), targetUtxos: ((await rpc.getUtxosByAddresses([new Address(target)])).entries || []).length };
    // 一个 SQLite 事务写入 prepared 行(冻结列本就已置) —— driver 下一 tick 看到的是 prepared ∧ frozen
    const existing = sqlite.prepare('SELECT status FROM proto_settlement_intents WHERE intent_key = ?').get(key);
    if (existing) sqlite.prepare("UPDATE proto_settlement_intents SET status = 'prepared', prepared_txid = ?, prepared_tx_json = ?, last_error = NULL, updated_at = ? WHERE intent_key = ? AND status = 'pending'").run(txid, preparedJson, now, key);
    else sqlite.prepare("INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, depends_on, status, prepared_txid, prepared_tx_json, created_at, updated_at) VALUES (?, 'market', ?, 'resolve', NULL, 'prepared', ?, ?, ?, ?)").run(key, marketId, txid, preparedJson, now, now);
    rec({ action: cmd === 'run-prefreeze' ? 'seed_prepared_close_inserted_prefreeze' : 'seed_prepared_close_inserted', marketId, intentKey: key, preparedTxid: txid, frozenReason: M.frozen_reason, winningSide: M.winning_side, node: nt, before, bytesSource: 'repo ops.build -> buildCloseCommitTxJson (real), fee input signed by throwaway payer', note: cmd === 'run-prefreeze' ? 'HARNESS-SEEDED prepared row (SQL) built BEFORE freeze, with PROTO_SETTLEMENT_DRIVER_ENABLED=0 as the barrier — precise crash-recovery arm (账本1644)' : 'HARNESS-SEEDED prepared row (SQL), not a natural race; market already frozen before the row exists' });
    console.log('seeded', key, txid, 'preparedTxJsonSha256=' + createHash('sha256').update(preparedJson).digest('hex'));
    if (cmd === 'run-prefreeze') { rec({ action: 'run_prefreeze_done_no_observation_here', reason: '观察要等 freeze+crash+restart 之后才有意义, 这里只建行' }); await done(); }
    // 观察窗: 90s 内每 3s 读节点侧证据(仅 run, 冻结之后建的旧场景)
    const t0 = Date.now(); let seen = null;
    while (Date.now() - t0 < 90_000) {
      const inMempool = await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: true, filterTransactionPool: false }).then(() => true).catch(() => false);
      const tgt = ((await rpc.getUtxosByAddresses([new Address(target)])).entries || []).filter((e) => String(e.outpoint.transactionId) === txid);
      const it = sqlite.prepare('SELECT status, submitted_txid, last_error FROM proto_settlement_intents WHERE intent_key = ?').get(key);
      if (inMempool || tgt.length) { seen = { inMempool, landedOutputs: tgt.length, intent: it }; break; }
      await sleep(3000);
    }
    const after = { seenBroadcast: !!seen, seen, intent: sqlite.prepare('SELECT status, submitted_txid, last_error FROM proto_settlement_intents WHERE intent_key = ?').get(key), market: sqlite.prepare('SELECT status, winning_side, settlement_frozen_at, frozen_reason FROM proto_markets WHERE id = ?').get(marketId), node: await nodeTimes(), windowSec: Math.round((Date.now() - t0) / 1000) };
    rec({ action: 'seed_prepared_close_observed', marketId, preparedTxid: txid, verdict: after.seenBroadcast ? 'RED: frozen market prepared close_commit WAS broadcast (node-side evidence)' : 'GREEN?: not seen on node within window (check tx validity control before concluding)', ...after });
    console.log(JSON.stringify(after, null, 1)); await done();
  }
}
