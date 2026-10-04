// mk_e2e.mjs — 由 s3_e2e.mjs 生成 sz_e2e.mjs(账本1850 严格零): 同一套 A/B/C 零 KAS 断言 + 开头"一次一盘 409" + 结尾 D 段(ticket/claim 无 bettor/winner 密钥路径, 真实 claim 家族 UTXO retire→sink)。
import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('D:/kanet-tn12/scratch/_j2_s3/s3_e2e.mjs', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.split(a).join(b); };
rep("from './s3lib.mjs'", "from './szlib.mjs'");
rep("const OUT = 'D:/kanet-tn12/scratch/_j2_s3';", "const OUT = 'D:/kanet-tn12/scratch/_j2_sz';");
rep("const WT = 'D:/kanet-tn12/scratch/_j2_wt_s12';", "const WT = 'D:/kanet-tn12/scratch/_j2_wt_sz';");
rep("s3_e2e_result.json", "sz_e2e_result.json");
rep("env.s3.simnet", "env.sz.simnet");
rep("s3_console_slice.log", "sz_console_slice.log");
rep("S3 no-KAS parity market", "SZ strict-zero parity market");

// ── 开头: 一次一盘 409(S3 的 btduw 盘在副本库里仍卡在 collecting_sigs) ──
rep("// ── 1. 建盘(无 KAS 模式: 不传 maker_stake_kas) ──", `// ── 0b. 账本1850 一次一盘闸: 库里还有一个未完结 zk_native 盘(S3 run1 的 btduw, 卡在 collecting_sigs) ⇒ create-v07 必须 409 ──
{
  const probeBody = { maker_relay_id: W.maker.id, outcome_side: 'YES', outcome_end_date: new Date(Date.now() + 600_000).toISOString(), resolution_rule_spec: JSON.stringify({ title: 'gate probe', resolution_criteria: 'x', data_source_canonical: 'kaspa-simnet:blockhash_parity@1', judge_type: 'blockhash_parity' }), pool_merkle_root: 'auto' };
  const g = await http('POST', '/api/pool/market/create-v07', probeBody);
  log('create-v07 with unfinished market ⇒', JSON.stringify(g).slice(0, 300));
  ok(g.status === 409 && g.code === 'another_zk_market_unfinished' && /btduw/.test(g.blocking_market_id || ''), '一次一盘闸: 另有未完结 zk_native 盘 ⇒ 409 another_zk_market_unfinished(blocking=btduw)');
  const { createRequire } = await import('node:module'); const req = createRequire('D:/kanet-tn12/kasia-console/'); const Db = req('better-sqlite3');
  const d = new Db(\`\${OUT}/console.sz.db\`); const n = d.prepare("UPDATE pool_markets SET protocol_status='cancelled' WHERE id LIKE '%btduw'").run().changes; d.close();
  ok(n === 1, '把那个卡死的 simnet 盘在 scratch 副本里标 cancelled(仅 simnet 副本), 再开新盘');
}

// ── 1. 建盘(无 KAS 模式: 不传 maker_stake_kas) ──`);

// ── D 段 ──
rep("results.finishedAt = new Date().toISOString(); results.failures = fails;", `// ═══ D. 账本1850 严格零: ticket / claim 没有 bettor|winner 密钥路径; 真实 claim 家族 UTXO retire → sink ═══
log('— D. 严格零 —');
const { blake2b } = await import(pathToFileURL(\`\${WT}/kasia-console/node_modules/@noble/hashes/blake2b.js\`).href).catch(async () => import('@noble/hashes/blake2b'));
const hex32 = (str) => Buffer.from(blake2b(Buffer.from(str), { dkLen: 32 })).toString('hex');
const { computePoolSideTicketArtifact, compileSilV100, ctorBytes32V100, ctorIntV100 } = await imp('lib/pool-bshard-artifacts.mjs');
const { resolveSinkConfig } = await imp('lib/zk-sink-config.mjs');
const P = await import(pathToFileURL(\`\${WT}/kasia-relay/src/lib/p2sh.mjs\`).href);
const cfg = resolveSinkConfig();
const sinkPriv = new kaspa.PrivateKey(readFileSync(\`\${OUT}/sink.key\`, 'utf8').trim());
const sinkAddr = sinkPriv.toPublicKey().toAddress('simnet').toString();
ok(Buffer.from(kaspa.payToAddressScript(sinkPriv.toPublicKey().toAddress('mainnet')).script, 'hex').subarray(1, 33).toString('hex') === cfg.sinkPkHex, 'D. env ZK_SYSTEM_SINK_PK == 我方 sink 私钥的公钥');
const RD = cfg.retireDaa;
// D1. 票: 链上每张票的地址 == 新模板(sweep-only)重算地址, 且 != 旧模板(authorize_spend, bettor 密钥可花)重算地址
const LEG = \`\${WT}/kasia-console/src/lib/legacy-proto/PoolSideTicket.sil\`;
const betDefs = [['bettorA', 0, 1_000_000_000], ['bettorB', 1, 2_000_000_000]];
let ticketsOk = 0; results.tickets = [];
for (const [who, dir, units] of betDefs) {
  let found = null;
  for (let si = 0; si < 4 && !found; si++) {
    const spid = hex32(\`\${marketId}-shard-\${si}\`);
    const art = computePoolSideTicketArtifact({ bettorPk: W[who].xonly, direction: dir, stake: units, shardPoolId: spid });
    const addr = p2shAddr(art.script.toString('hex'));
    for (const [k, o] of outMap) { if (o.addr === addr) { found = { k, addr, v: o.value, spid, art }; break; } }
  }
  if (!found) { ok(false, \`D. \${who} 的 ticket 在链上找不到(新模板重算地址未命中)\`); continue; }
  const legacy = compileSilV100(LEG, [ctorBytes32V100(W[who].xonly), ctorIntV100(dir), ctorIntV100(units), ctorBytes32V100(found.spid)], 'PoolSideTicket');
  const legacyAddr = p2shAddr(Buffer.from(legacy.script).toString('hex'));
  ok(found.addr !== legacyAddr, \`D. \${who} 的 ticket 地址 == 新模板(sweep-only)重算地址 且 ≠ 旧模板(bettor 签名可花)地址\`);
  const live = (await rpc.getUtxosByAddresses([new kaspa.Address(found.addr)])).entries.some((e) => \`\${e.outpoint.transactionId}:\${e.outpoint.index}\` === found.k);
  ok(live && found.v === 7_000_000n, \`D. \${who} 的 ticket 仍在链上(未被任何人花), 面值 \${found.v} sompi(= 0.07 KAS)\`);
  ticketsOk++; results.tickets.push({ who, outpoint: found.k, addr: found.addr, valueSompi: String(found.v) });
}
ok(ticketsOk === 2, 'D. 两张 ticket 都核到');

// D2. claim 家族: 对每笔真实 claim, 取 claim_out + tok_out 做 retire; 先负向后正向
const { Transaction, TransactionOutput, Address, ScriptBuilder, payToAddressScript } = kaspa;
const hx = (h) => new Uint8Array(Buffer.from(String(h).replace(/^0x/, ''), 'hex'));
const combine = (actionHex, redeemHex) => { const b = ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } }); b.addData(new Uint8Array(Buffer.from(redeemHex, 'hex'))); return b.drain(); };
const tryTx = async (tx) => { try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { accepted: true, txid: r.transactionId }; } catch (e) { return { accepted: false, err: String(e.message || e).slice(0, 300) }; } };
const spkOf = (priv) => payToAddressScript(priv.toPublicKey().toAddress('simnet'));
const retireTag = (() => { const c = compileSilV100(\`\${WT}/kasia-console/src/lib/KanetTokenClaim.sil\`, [ctorBytes32V100('11'.repeat(32)), ctorBytes32V100('22'.repeat(32)), ctorIntV100(5), ctorBytes32V100(process.env.ZK_TOKEN_TMPL_HASH), ctorBytes32V100(cfg.sinkPkHex), ctorIntV100(RD)], 'KanetTokenClaim'); return c._raw.contracts.KanetTokenClaim.entries.retire.dispatch_tag; })();
const sinkBefore = BigInt((await rpc.getBalanceByAddress({ address: sinkAddr })).balance);
const rUtxos = [];
for (const c of results.claims) {
  const claimTx = txById.get(c.txid);
  const claimIdx = claimTx.outputs.findIndex((o) => o.verboseData?.scriptPublicKeyAddress === c.claimOutAddr);
  const tokIdx = claimTx.outputs.findIndex((o) => o.verboseData?.scriptPublicKeyAddress === c.tokOutAddr);
  const cov = claimTx.outputs[claimIdx].covenant.covenantId;
  const who = nameByPrefix(c.winner === 'bettorA' ? W.bettorA.xonly.slice(0, 12) : W.bettorB.xonly.slice(0, 12));
  const claimArt = computeKanetTokenClaimArtifact({ marketCovIdHex: marketCov, winnerPkHex: W[c.winner].xonly, amount: BigInt(c.payoutUnits), tokenTmplHashHex: process.env.ZK_TOKEN_TMPL_HASH });
  const ktt = computeKttTokenArtifact({ amount: Number(c.payoutUnits), ownerCovIdHex: cov });
  const cu = (await rpc.getUtxosByAddresses([new kaspa.Address(c.claimOutAddr)])).entries.find((e) => e.outpoint.transactionId === c.txid && Number(e.outpoint.index) === claimIdx);
  const tu = (await rpc.getUtxosByAddresses([new kaspa.Address(c.tokOutAddr)])).entries.find((e) => e.outpoint.transactionId === c.txid && Number(e.outpoint.index) === tokIdx);
  if (!cu || !tu) { ok(false, \`D. claim idx=\${c.idx}: claim_out/tok_out UTXO 取不到\`); continue; }
  rUtxos.push({ c, cu, tu, claimArt, ktt, born: Number(cu.blockDaaScore) });
}
const retireTx = (r, { seq = RD, outs, cbClaim = 70, cbTok = 30 }) => {
  const action = (() => { const b = new ScriptBuilder({ flags: { covenantsEnabled: true } }); b.addI64(1n); b.addData(new Uint8Array(r.ktt.templatePrefix)); b.addData(new Uint8Array(r.ktt.templateSuffix)); b.addData(hx(retireTag)); return b.drain(); })();
  const claimSig = combine(action, r.claimArt.script.toString('hex'));
  const tokSig = combine(P._encodeKttTransferZeroOutAction(r.ktt.entryAbi.dispatch_tag, r.ktt.stateFieldCount, [0]), r.ktt.script.toString('hex'));
  return new Transaction({ version: 1, inputs: [
    { previousOutpoint: { transactionId: r.cu.outpoint.transactionId, index: r.cu.outpoint.index }, signatureScript: claimSig, sequence: BigInt(seq), sigOpCount: 0, computeBudget: cbClaim },
    { previousOutpoint: { transactionId: r.tu.outpoint.transactionId, index: r.tu.outpoint.index }, signatureScript: tokSig, sequence: 0n, sigOpCount: 0, computeBudget: cbTok }],
    outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
};
const FEE = 2_000_000n;
const reachable = [];   // 赢家/下注人密钥可单独花的 KAS(应为 0)
let retiredTotal = 0n; results.retire = [];
for (const r of rUtxos) {
  const total = BigInt(r.cu.amount) + BigInt(r.tu.amount);
  // 负向: 年龄未到 / 输出给赢家钱包 / 多一个输出
  const winnerSpk = payToAddressScript(new kaspa.Address(W[r.c.winner].address));
  const n1 = await tryTx(retireTx(r, { outs: [new TransactionOutput(total - FEE, payToAddressScript(sinkPriv.toPublicKey().toAddress('simnet')))] }));
  const ageNow = (await daa(rpc)) - r.born;
  if (ageNow < RD) ok(!n1.accepted, \`D. claim idx=\${r.c.idx}: age=\${ageNow} < RETIRE_DAA(\${RD}) 时 retire 被拒(\${(n1.err || '').slice(-80)})\`); else log('  (age 已 ≥ RD, 跳过"太早"负向)', ageNow);
  const n2 = await tryTx(retireTx(r, { outs: [new TransactionOutput(total - FEE, winnerSpk)] }));
  ok(!n2.accepted, \`D. claim idx=\${r.c.idx}: retire 输出给赢家钱包 \${r.c.winner} 被拒(\${(n2.err || '').slice(-70)})\`);
  results.retire.push({ idx: r.c.idx, earlyAge: ageNow, earlyRejected: !n1.accepted || ageNow >= RD, winnerPayRejected: !n2.accepted });
}
// 等所有 claim 满龄, 然后正向 retire
for (;;) { const need = Math.max(...rUtxos.map((r) => r.born)) + RD + 15; const cur2 = await daa(rpc); if (cur2 >= need) break; await sleep(2000); }
for (const r of rUtxos) {
  const total = BigInt(r.cu.amount) + BigInt(r.tu.amount);
  const n3 = await tryTx(retireTx(r, { seq: 0, outs: [new TransactionOutput(total - FEE, payToAddressScript(sinkPriv.toPublicKey().toAddress('simnet')))] }));
  ok(!n3.accepted, \`D. claim idx=\${r.c.idx}: 满龄但 sequence=0 被拒\`);
  const p = await tryTx(retireTx(r, { outs: [new TransactionOutput(total - FEE, payToAddressScript(sinkPriv.toPublicKey().toAddress('simnet')))] }));
  ok(p.accepted, \`D. claim idx=\${r.c.idx} (\${r.c.winner}, \${r.c.payoutUnits} KTT): 满龄 retire → sink 被接受 \${p.accepted ? p.txid : p.err}\`);
  if (p.accepted) { retiredTotal += total - FEE; results.retire[results.retire.findIndex((x) => x.idx === r.c.idx)].txid = p.txid; results.retire[results.retire.findIndex((x) => x.idx === r.c.idx)].valueToSink = String(total - FEE); }
}
await sleep(6000);
const sinkAfter = BigInt((await rpc.getBalanceByAddress({ address: sinkAddr })).balance);
ok(sinkAfter - sinkBefore === retiredTotal, \`D. sink 余额增量 == Σ(claim_out+tok_out − 费) = \${retiredTotal} sompi(实 \${sinkAfter - sinkBefore})\`);
let gone = 0; for (const r of rUtxos) { const a = (await rpc.getUtxosByAddresses([new kaspa.Address(r.c.claimOutAddr)])).entries.some((e) => e.outpoint.transactionId === r.c.txid); const b = (await rpc.getUtxosByAddresses([new kaspa.Address(r.c.tokOutAddr)])).entries.some((e) => e.outpoint.transactionId === r.c.txid); if (!a && !b) gone++; }
ok(gone === rUtxos.length && rUtxos.length === results.claims.length, \`D. 全部 \${gone}/\${rUtxos.length} 对 claim_out+tok_out 已被花掉(代币销毁, KAS 进 sink)\`);
// D3. 赢家/下注人密钥可达 KAS 总量: 窗口内新增的、落在两个下注人钱包 P2PK 或 旧式可签名合约里的 KAS —— 逐项为 0
const bettorWalletAddrs = new Set([W.bettorA.address, W.bettorB.address]);
let keyReachable = 0n;
for (const [k, o] of outMap) { if (bettorWalletAddrs.has(o.addr) && !spentBy.has(k)) keyReachable += o.value; }
ok(keyReachable === 0n, \`D. 窗口内落在下注人/赢家 P2PK 钱包地址的未花 KAS = \${keyReachable}(须为 0)\`);
results.keyReachableSompi = String(keyReachable);
results.sinkReceivedSompi = String(sinkAfter - sinkBefore);
results.ticketsLockedSompi = String(results.tickets.reduce((a, t) => a + BigInt(t.valueSompi), 0n));

results.finishedAt = new Date().toISOString(); results.failures = fails;`);
writeFileSync('D:/kanet-tn12/scratch/_j2_sz/sz_e2e.mjs', s);
console.log('written');
