// s3_e2e.mjs — 账本1846 S3: 主网「不收 KAS」形态的 simnet 全链验收(官方 kaspad 2.0.1 真共识, 复用 seg4 harness 的 lib/relays/miner/console 启动法)。
// 场景: 建 ZK 原生盘(无 spine, 零转账) → 两个对手方下注(stake_ktt, 下注人零转账) → 自治 7 tick(judge→close_attest→handoff→prove→zk_close→claim) → 全部 leaf claim 完。
// 硬断言:
//   A. 下注人钱包(bettorA/bettorB) KAS 余额盘前盘后【逐 sompi 相同】, 且整个窗口内没有任何已确认交易触碰过它们(输入/输出都无);
//   B. 网关(maker relay = 盘的 gateway) 与 pm-settler(settler relay) 的每一笔 KAS 变动按链上交易逐笔归类: 手续费 / dust-状态锁(落进 covenant P2SH) / 找零(回自己地址);
//      任何落到"非 covenant 的第三方 P2PK 地址"的输出 = 0; 钱包 Δ == −(手续费 + 净锁进 covenant 的量) 对每个钱包逐 sompi 成立;
//   C. 赢家拿到的是 KTT: 每笔 claim 交易的 claim_out 地址 == KanetTokenClaim(marketCov, 赢家 pk, 额度) 重算地址, tok_out 地址 == KTT(额度, owner=该 claim 的 covenant id) 重算地址, 且二者仍是链上未花 UTXO;
//   D. 创建盘不转账: 窗口内第一笔触碰网关钱包的交易晚于/不同于 create 响应(create 响应 spine_lock_tx=null, DB spine_p2sh NULL)。
// 用法: node s3_e2e.mjs   (需: simnet kaspad + 矿工 + S3 console(KANET_NO_KAS_STAKE_MODE=1) 已起)
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { http, relays, kaspa, rpcConnect, sleep, log, daa } from './s3lib.mjs';

const OUT = 'D:/kanet-tn12/scratch/_j2_s3';
const CONSOLE_LOG = `${OUT}/console.log`;
const WT = 'D:/kanet-tn12/scratch/_j2_wt_s12';
const results = { startedAt: new Date().toISOString(), asserts: [], txs: [], notes: [] };
let fails = 0;
const ok = (c, l) => { results.asserts.push({ ok: !!c, label: l }); if (c) log('  ✅', l); else { log('  ❌', l); fails++; } };
const dump = () => writeFileSync(`${OUT}/s3_e2e_result.json`, JSON.stringify(results, (k, v) => typeof v === 'bigint' ? String(v) : v, 1));
const rpc = await rpcConnect();
const W = { maker: relays.maker, settler: relays.settler, fee: relays.fee, bettorA: relays.bettorA, bettorB: relays.bettorB };
const addrToName = Object.fromEntries(Object.entries(W).map(([n, r]) => [r.address, n]));
const bal = async (n) => BigInt((await rpc.getBalanceByAddress({ address: W[n].address })).balance);
const snapBal = async () => Object.fromEntries(await Promise.all(Object.keys(W).map(async (n) => [n, await bal(n)])));
const snapUtxos = async () => { const m = new Map(); for (const [n, r] of Object.entries(W)) { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(r.address)]); for (const e of entries) m.set(`${e.outpoint.transactionId}:${e.outpoint.index}`, { value: BigInt(e.amount), addr: r.address }); } return m; };

// ── 0. 前置 ──
// 静默窗口: 取 UTXO 快照 → 取 startHash → 再取一次 UTXO 快照, 两次相同才算静止(期间没有任何钱包交易), 保证"快照"与"扫描窗口起点"之间没有漏记/重记的交易
let utxos0, startHash;
for (let t = 0; t < 30; t++) {
  const a = await snapUtxos(); const info0 = await rpc.getBlockDagInfo(); const b = await snapUtxos();
  const same = a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k).value === v.value);
  if (same) { utxos0 = b; startHash = info0.sink; break; }
  await sleep(4000);
}
if (!utxos0) throw new Error('钱包 UTXO 一直在变(还有别的活动在跑?), 拒绝开始');
results.startHash = startHash;
const bal0 = Object.fromEntries(Object.keys(W).map((n) => [n, [...utxos0.values()].filter((u) => u.addr === W[n].address).reduce((x, u) => x + u.value, 0n)]));
log('balances before (KAS):', Object.fromEntries(Object.entries(bal0).map(([k, v]) => [k, Number(v) / 1e8])));
results.bal0 = Object.fromEntries(Object.entries(bal0).map(([k, v]) => [k, String(v)]));
const logOffset0 = statSync(CONSOLE_LOG).size;

// ── 1. 建盘(无 KAS 模式: 不传 maker_stake_kas) ──
const cur = await daa(rpc);
const endMs = Date.now() + 600_000;                 // POOL_DEADLINE_MIN_OVERRIDE=2 分钟; 取 10 分钟留足两笔首注 + 创世时间
const targetDaa = cur + 1300 + 60;
const spec = { title: `S3 no-KAS parity market ${Date.now()}`, resolution_criteria: `blockhash at DAA ${targetDaa}: last byte even => YES, odd => NO`, data_source_canonical: `kaspa-simnet:blockhash_parity@${targetDaa}`, judge_type: 'blockhash_parity', target_daa: targetDaa };
const createBody = { maker_relay_id: W.maker.id, outcome_side: 'YES', outcome_end_date: new Date(endMs).toISOString(), resolution_rule_spec: JSON.stringify(spec), pool_merkle_root: 'auto' };
log('create-v07 (no maker_stake_kas) curDaa', cur, 'targetDaa', targetDaa);
const cr = await http('POST', '/api/pool/market/create-v07', createBody);
log('create-v07 =>', JSON.stringify(cr).slice(0, 700));
ok(cr.ok === true && cr.no_kas_stake === true && cr.protocol_version === 'v0.7', 'create-v07 200 + no_kas_stake=true');
ok(cr.spine_p2sh === null && cr.spine_lock_tx === null && cr.maker_stake_locked_kas === 0, '响应: spine_p2sh/spine_lock_tx=null, maker_stake_locked_kas=0');
if (!cr.ok) { dump(); process.exit(2); }
const marketId = cr.market_id; results.marketId = marketId; results.createResponse = cr;
// create 之后立刻看: 网关钱包没动(create 不转账)
await sleep(5000);
const balAfterCreate = await snapBal();
ok(balAfterCreate.maker === bal0.maker && balAfterCreate.bettorA === bal0.bettorA && balAfterCreate.bettorB === bal0.bettorB, '建盘后(未下注): 网关/下注人钱包余额逐 sompi 不变 = 建盘没有任何链上转账');

// ── 2. 两方下注(stake_ktt, 零转账) ──
const bets = [['bettorA', 0, 1_000_000_000], ['bettorB', 1, 2_000_000_000]];
results.bets = [];
for (const [who, dir, units] of bets) {
  const t0 = Date.now();
  const r = await http('POST', `/api/pool/market/${marketId}/bettor/register-v07`, { bettor_relay_id: W[who].id, direction: dir, stake_ktt: units });
  log(who, `dir=${dir} stake_ktt=${units} (${Date.now() - t0}ms) =>`, JSON.stringify(r).slice(0, 500));
  results.bets.push({ who, dir, units, status: r.status, resp: r });
  ok(r.ok === true && r.no_kas_stake === true, `${who} register-v07 stake_ktt=${units} ⇒ 200 no_kas_stake`);
  const bNow = await bal(who);
  ok(bNow === bal0[who], `${who} 钱包余额下注后逐 sompi 不变(${bNow} == ${bal0[who]})`);
  if (!r.ok) { dump(); process.exit(3); }
}
// 老字段在不收 KAS 模式下不被读取
{ const r = await http('POST', `/api/pool/market/${marketId}/bettor/register-v07`, { bettor_relay_id: W.bettorA.id, direction: 0, stake_kas: 5 });
  ok(r.status === 400 && r.code === 'stake_ktt_required', '不收 KAS 模式 stake_kas ⇒ 400 stake_ktt_required(不读老字段)');
  const p = await http('POST', `/api/pool/market/${marketId}/bettor/register-v07/prep`, { bettor_relay_id: W.bettorA.id, direction: 0, stake_kas: 5 });
  ok(p.status === 403, 'register-v07/prep ⇒ 403'); }

// ── 3. 等自治 tick 走完 ──
const shortId = marketId.slice(-8);
const readNew = () => { const size = statSync(CONSOLE_LOG).size; const fd = openSync(CONSOLE_LOG, 'r'); const buf = Buffer.alloc(size - logOffset0); readSync(fd, buf, 0, buf.length, logOffset0); closeSync(fd); return buf.toString('utf8'); };
const claimRe = new RegExp(`market=\\S*${shortId} claim idx=(\\d+) pk=([0-9a-f]+) payout=(\\d+) txId=([0-9a-f]{64})( \\(last, exhausted\\))?`, 'g');
let done = false; const t0w = Date.now(); let lastPrint = 0, text = '';
while (Date.now() - t0w < 55 * 60_000) {
  text = readNew();
  const claims = [...text.matchAll(claimRe)];
  if (claims.some((m) => m[5])) { done = true; break; }
  if (Date.now() - lastPrint > 90_000) {
    lastPrint = Date.now();
    const tail = text.split('\n').filter((l) => l.includes(shortId) || /zk-prove-worker|⏸|memory|deferred/.test(l)).slice(-4);
    log(`waiting ticks… ${Math.round((Date.now() - t0w) / 1000)}s  daa=${await daa(rpc)}  claims=${claims.length}`, JSON.stringify(tail).slice(0, 400));
  }
  await sleep(5000);
}
ok(done, `自治链走到最后一个 claim(exhausted)(${Math.round((Date.now() - t0w) / 1000)}s)`);
writeFileSync(`${OUT}/s3_console_slice.log`, text);
results.consoleLines = text.split('\n').filter((l) => l.includes(shortId) || /zk-prove-worker/.test(l)).slice(-80);
if (!done) { dump(); process.exit(4); }
await sleep(15000);   // 等最后的块把 claim 带进确认

// ── 4. 钱包余额 + 链上逐笔归类 ──
const bal1 = await snapBal();
results.bal1 = Object.fromEntries(Object.entries(bal1).map(([k, v]) => [k, String(v)]));
log('balances after (KAS):', Object.fromEntries(Object.entries(bal1).map(([k, v]) => [k, Number(v) / 1e8])));
ok(bal1.bettorA === bal0.bettorA, `A. bettorA 余额逐 sompi 相同(${bal0.bettorA} → ${bal1.bettorA})`);
ok(bal1.bettorB === bal0.bettorB, `A. bettorB 余额逐 sompi 相同(${bal0.bettorB} → ${bal1.bettorB})`);

// 扫窗口内被接受的交易
const accepted = new Set();
{ let startFrom = startHash;
  for (let i = 0; i < 400; i++) {
    const r = await rpc.getVirtualChainFromBlock({ startHash: startFrom, includeAcceptedTransactionIds: true });
    for (const a of r.acceptedTransactionIds || []) for (const t of a.acceptedTransactionIds || []) accepted.add(t);
    const added = r.addedChainBlockHashes || [];
    if (!added.length) break;
    startFrom = added[added.length - 1];
    if (added.length < 100) break;
  } }
const txById = new Map(); const outMap = new Map();
{ let low = startHash;
  for (let pages = 0; pages < 400; pages++) {
    const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
    const blocks = r.blocks || []; if (blocks.length < 2) break;
    for (const b of blocks) {
      for (const tx of b.transactions || []) {
        const id = tx.verboseData?.transactionId; if (!id || txById.has(id) || !accepted.has(id)) continue;
        txById.set(id, tx);
        tx.outputs.forEach((o, i) => outMap.set(`${id}:${i}`, { value: BigInt(o.value), addr: o.verboseData?.scriptPublicKeyAddress, cov: o.covenant?.covenantId ?? null }));
      }
      low = b.header.hash;
    }
  } }
log('scanned accepted txs in window:', txById.size, 'of accepted ids', accepted.size);
const spentBy = new Map();
for (const [id, tx] of txById) for (const inp of tx.inputs) spentBy.set(`${inp.previousOutpoint.transactionId}:${inp.previousOutpoint.index}`, id);
const lookup = (k) => outMap.get(k) ?? utxos0.get(k) ?? null;
const labelOf = (id) => { const m = text.match(new RegExp(`(\\S.*?)\\s*(?:txId=|landed txId=|tx=)${id}`)); return m ? m[1].replace(/^\[|\]$/g, '').slice(-70) : null; };
const perWallet = Object.fromEntries(Object.keys(W).map((n) => [n, { fee: 0n, covLocked: 0n, covReleased: 0n, change: 0n, outOther: 0n, delta: 0n, txs: 0 }]));
let unknownInputs = 0; const touchedBettors = [];
for (const [id, tx] of txById) {
  const isCoinbase = tx.inputs.length && /^0+$/.test(tx.inputs[0].previousOutpoint.transactionId);
  if (isCoinbase) continue;
  let inAll = 0n, inW = {}, inCov = 0n;
  for (const inp of tx.inputs) {
    const k = `${inp.previousOutpoint.transactionId}:${inp.previousOutpoint.index}`; const p = lookup(k);
    if (!p) { unknownInputs++; continue; }
    inAll += p.value;
    const wn = addrToName[p.addr]; if (wn) inW[wn] = (inW[wn] || 0n) + p.value; else inCov += p.value;
  }
  let outAll = 0n, outW = {}, outCov = 0n, outOther = 0n;
  tx.outputs.forEach((o) => { const v = BigInt(o.value); outAll += v; const a = o.verboseData?.scriptPublicKeyAddress; const wn = addrToName[a]; if (wn) outW[wn] = (outW[wn] || 0n) + v; else if (a && a.startsWith('kaspasim:p')) outCov += v; else outOther += v; });
  const touching = new Set([...Object.keys(inW), ...Object.keys(outW)]);
  if (!touching.size) continue;
  const fee = inAll - outAll;
  const funders = Object.keys(inW);
  for (const wn of touching) { const p = perWallet[wn]; p.txs++; p.delta += (outW[wn] || 0n) - (inW[wn] || 0n); p.change += outW[wn] || 0n; }
  // 归属: 恰一个钱包出资 ⇒ 记它; 无钱包出资(如 zk_close: 输入全是 covenant gate+self, 只有找零回系统钱包)而只有一个钱包收款 ⇒ 记收款方(手续费从 covenant 值里出); 多钱包出资 ⇒ 报 notes
  const owner = funders.length === 1 ? funders[0] : (funders.length === 0 && touching.size === 1 ? [...touching][0] : null);
  if (!owner) results.notes.push(`tx ${id} 无法唯一归属(出资钱包 ${funders.length} 个, 触碰钱包 ${touching.size} 个)`);
  else { const p = perWallet[owner]; p.fee += fee; p.covLocked += outCov; p.covReleased += inCov; p.outOther += outOther; }
  if (touching.has('bettorA') || touching.has('bettorB')) touchedBettors.push(id);
  results.txs.push({ txid: id, label: labelOf(id), funders, owner, fee: String(fee), covIn: String(inCov), covOut: String(outCov), toWallets: Object.fromEntries(Object.entries(outW).map(([k, v]) => [k, String(v)])), toOther: String(outOther), nOut: tx.outputs.length });
}
ok(unknownInputs === 0, `B. 窗口内所有被接受交易的输入面值都能溯源(未知输入 ${unknownInputs})`);
ok(touchedBettors.length === 0, `A. 窗口内没有任何被接受的交易触碰下注人钱包(输入/输出)(${touchedBettors.length})`);
for (const wn of ['maker', 'settler', 'fee']) {
  const p = perWallet[wn]; const dBal = bal1[wn] - bal0[wn];
  ok(p.delta === dBal, `B. ${wn}: 逐笔交易重算 Δ(${p.delta}) == 余额差(${dBal}) sompi`);
  ok(p.delta === -(p.fee + p.covLocked - p.covReleased), `B. ${wn}: Δ == −(手续费 ${p.fee} + 净锁进 covenant ${p.covLocked - p.covReleased}) 逐 sompi 成立`);
  ok(p.outOther === 0n, `B. ${wn}: 落到第三方 P2PK 地址的输出 = ${p.outOther}(须为 0)`);
  results[`wallet_${wn}`] = { deltaSompi: String(dBal), feeSompi: String(p.fee), covLockedSompi: String(p.covLocked), covReleasedSompi: String(p.covReleased), netCovLockedSompi: String(p.covLocked - p.covReleased), nTxs: p.txs };
}
// 窗口末仍锁在 covenant 里的 KAS(系统资金): 本窗口 W 出资交易产生且至今未花的 P2SH 输出
let liveCovSompi = 0n; const liveCov = [];
for (const [k, o] of outMap) { if (!o.addr || !o.addr.startsWith('kaspasim:p') || spentBy.has(k)) continue; const id = k.split(':')[0]; const rec = results.txs.find((t) => t.txid === id); if (!rec) continue; liveCovSompi += o.value; liveCov.push({ outpoint: k, value: String(o.value), addr: o.addr, cov: o.cov }); }
results.liveCovenantUtxos = liveCov; results.liveCovenantTotalSompi = String(liveCovSompi);
log('窗口末仍锁在 covenant 的 KAS(系统资金):', Number(liveCovSompi) / 1e8, 'KAS in', liveCov.length, 'UTXO');

// ── 5. 赢家拿到的是 KTT: 重算 claim_out / tok_out 地址 ──
const envTxt = readFileSync(`${OUT}/env.s3.simnet`, 'utf8'); for (const l of envTxt.split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) process.env[m[1]] = m[2]; }
process.env.DB_PATH = `${OUT}/_artifacts_probe.db`;
const imp = (p) => import(pathToFileURL(`${WT}/kasia-console/src/${p}`).href);
const { computeKttTokenArtifact, computeKanetTokenClaimArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const p2shAddr = (redeemHex) => kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(redeemHex, 'hex'))).createPayToScriptHashScript(), 'simnet').toString();
const nameByPrefix = (pre) => Object.entries(W).map(([n, r]) => [n, r.xonly]).find(([, x]) => x.startsWith(pre));
const claims = [...text.matchAll(claimRe)].map((m) => ({ idx: Number(m[1]), pkPrefix: m[2], payout: BigInt(m[3]), txid: m[4], last: !!m[5] }));
results.claims = [];
let totalPayout = 0n; let marketCov = null;
for (const c of claims) {
  const tx = txById.get(c.txid); if (!tx) { ok(false, `C. claim tx ${c.txid.slice(0, 12)} 在窗口内找不到`); continue; }
  const covOuts = tx.outputs.map((o, i) => ({ i, cov: o.covenant?.covenantId ?? null, addr: o.verboseData?.scriptPublicKeyAddress, v: BigInt(o.value) }));
  const claimIdx = c.last ? 0 : 1, tokIdx = c.last ? 1 : 2;
  if (!c.last) marketCov = covOuts[0].cov;
  const claimOut = covOuts[claimIdx], tokOut = covOuts[tokIdx];
  const who = nameByPrefix(c.pkPrefix); const fullPk = who?.[1];
  if (!fullPk) { ok(false, `C. claim idx=${c.idx} pk=${c.pkPrefix} 不是已知钱包的 x-only 公钥`); continue; }
  const mc = marketCov ?? null;
  if (!mc) { ok(false, `C. 取不到市场 covenant id(claim idx=${c.idx})`); continue; }
  const claimArt = computeKanetTokenClaimArtifact({ marketCovIdHex: mc, winnerPkHex: fullPk, amount: c.payout, tokenTmplHashHex: process.env.ZK_TOKEN_TMPL_HASH });
  const ktt = computeKttTokenArtifact({ amount: Number(c.payout), ownerCovIdHex: claimOut.cov });
  const claimAddrExp = p2shAddr(claimArt.script.toString('hex')), tokAddrExp = p2shAddr(ktt.script.toString('hex'));
  const unspent = async (addr, txid, idx) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(addr)]); return entries.some((e) => e.outpoint.transactionId === txid && Number(e.outpoint.index) === idx); };
  const claimLive = await unspent(claimOut.addr, c.txid, claimIdx), tokLive = await unspent(tokOut.addr, c.txid, tokIdx);
  ok(claimOut.addr === claimAddrExp && tokOut.addr === tokAddrExp, `C. claim idx=${c.idx} → ${who[0]} 的 claim_out 地址 == KanetTokenClaim(市场 cov, 赢家 pk, ${c.payout}) 重算地址, tok_out 地址 == KTT(${c.payout}, owner=该 claim cov) 重算地址`);
  ok(claimLive && tokLive, `C. claim idx=${c.idx}: claim_out 与 tok_out 仍是链上未花 UTXO(代币在 covenant 里, 没有任何钱包地址拿到)`);
  const toWalletOut = tx.outputs.filter((o) => addrToName[o.verboseData?.scriptPublicKeyAddress] && addrToName[o.verboseData.scriptPublicKeyAddress] !== 'settler' && addrToName[o.verboseData.scriptPublicKeyAddress] !== 'fee');
  ok(toWalletOut.length === 0, `C. claim idx=${c.idx}: 没有任何输出落到赢家/下注人/开盘人钱包地址(只有 covenant 与系统找零)`);
  totalPayout += c.payout;
  results.claims.push({ idx: c.idx, winner: who[0], payoutUnits: String(c.payout), txid: c.txid, claimOutAddr: claimOut.addr, tokOutAddr: tokOut.addr, claimLive, tokLive, outValuesSompi: covOuts.map((o) => String(o.v)) });
}
ok(totalPayout === 3_000_000_000n, `C. 全部 claim 的 KTT 总量 == 池总额 3000000000(= 1e9 + 2e9 下注筹码): ${totalPayout}`);
const winnerNames = new Set(results.claims.map((c) => c.winner));
ok([...winnerNames].some((n) => n === 'bettorA' || n === 'bettorB'), `C. 至少一个下注人是 KTT 受益人(${[...winnerNames].join(',')})`);

results.finishedAt = new Date().toISOString(); results.failures = fails;
dump();
log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
