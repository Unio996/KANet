// seg4_maker_exit.mjs — 账本 1832 段4(3): maker 质押(spine KAS 保证金)退出检查, simnet 官方 kaspad 2.0.1。
//   只核「现有机制能不能跑」, 不设计新东西: ① 生产编排 reclaimBshardMakerBond(/api/admin/reclaim-bshard-maker-bond, dryRun) 对已结算 zk_native 盘的判定
//   ② 合约退出路径 PoolSpine_v07.refund_maker_unjoined(maker 单签, deadline+7200s 后, 输出==maker P2PK, 费 ∈ [50000, 1e8])经生产 relay 命令 pool_refund_maker_unjoined_tx 真共识。
//   负向(到点后): 阈值前一刻 lock_time / 输出给别人 / 费不足 ⇒ 全拒; 诚实 ⇒ 过; 读回按 UTXO。
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { http, relays, kaspa, rpcConnect, sleep, log } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
const { sqlite: db } = await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/db/client.js').href);
const m = JSON.parse(readFileSync(process.env.MARKET_JSON || 'D:/kanet-tn12/scratch/_j2_tok_sim/market_seg3_run1.json', 'utf8'));
const row = db.prepare('select * from pool_markets where id = ?').get(m.market_id);
const meta = JSON.parse(row.metadata || '{}');
const rpc = await rpcConnect();
const out = { market: m.market_id, status: row.protocol_status, deadline: row.deadline, makerStake: String(row.maker_stake_amount), negatives: {} };
const makerRelay = Object.values(relays).find((r) => r.id === row.maker_relay_id);
if (!makerRelay) throw new Error('maker relay not found in relays.json: ' + row.maker_relay_id);
const getUtxos = async (a) => (await rpc.getUtxosByAddresses([new kaspa.Address(a)])).entries.map((e) => `${e.outpoint.transactionId}:${e.outpoint.index}=${e.amount}`);
log('market', m.market_id, 'status', row.protocol_status, 'maker stake', row.maker_stake_amount, 'spine', row.spine_p2sh);

// ① 生产编排(dryRun)
const rec = await http('POST', '/api/admin/reclaim-bshard-maker-bond', { marketIds: [m.market_id], dryRun: true }, { 'x-ingest-secret': 'simnet-e2e-ingest' });
log('① reclaimBshardMakerBond(dryRun) =>', JSON.stringify(rec.results ?? rec));
out.reclaimOrchestration = rec.results ?? rec;

// ② 合约路径: 等到 deadline+7200s+中位时间滞后(300s)
const threshold = (Number(row.deadline) + 7200) * 1000;
// 注: 节点最低中继费 100 sompi/克 × mass 4742 = 474200 > 合约 MIN_FEE 50000 ⇒ 诚实路径费取 1,000,000(合约范围内且过中继)。
// 合约 tx.time 判据按链的 pastMedianTime(落后墙钟 ~6min), 不是墙钟 ⇒ 轮询 RPC 的 pastMedianTime 过阈值再发(run1 用墙钟+330s 过早, 全部因 'input #0 is not finalized' 被拒——负向无信息, 已作废重跑)。
while (Number((await rpc.getBlockDagInfo()).pastMedianTime) < threshold + 30_000) { log('waiting pastMedianTime>threshold… 差', Math.round((threshold + 30_000 - Number((await rpc.getBlockDagInfo()).pastMedianTime)) / 1000), 's'); await sleep(20000); }
const stake = BigInt(row.maker_stake_amount);
const before = { spine: await getUtxos(row.spine_p2sh), maker: await getUtxos(makerRelay.address) };
log('BEFORE spine UTXO:', JSON.stringify(before.spine));
const send = async (extra) => { const j = await http('POST', `/api/relay/${makerRelay.id}/send-command`, { type: 'pool_refund_maker_unjoined_tx', spine_p2sh_address: row.spine_p2sh, spine_redeem_script_hex: meta.spine_redeem_script_hex, required_input_outpoint: { outpointTxid: row.spine_lock_tx }, output: { address: makerRelay.address, amountSompi: (stake - 1000000n).toString() }, lock_time: threshold, ...extra }); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 500)); throw e; } return j; };
async function negative(label, extra) {
  let rej = null; try { await send(extra); } catch (e) { rej = e.message; }
  log(`NEG ${label}: ${rej ? 'REJECTED ✓ ' + rej.slice(0, 300) : '‼️ ACCEPTED (BAD)'}`); out.negatives[label] = { rejected: !!rej, text: rej };
  if (!rej) throw new Error('negative accepted: ' + label);
}
await negative('premature_lock_time', { lock_time: threshold - 1000 });                                             // 早于 deadline+7200s ⇒ 合约 tx.time 判据拒
await negative('output_to_non_maker', { output: { address: relays.settler.address, amountSompi: (stake - 1000000n).toString() } });   // 输出必须是 maker P2PK
await negative('fee_below_min', { output: { address: makerRelay.address, amountSompi: (stake - 10000n).toString() } });            // 费 < MIN_FEE(50000)
await negative('fee_above_max', { output: { address: makerRelay.address, amountSompi: (stake - 200_000_000n).toString() } });      // 费 > MAX_FEE(1e8)
const still = await getUtxos(row.spine_p2sh); out.negativesLeftSpineUntouched = still.length === before.spine.length;
const r = await send({});
log('HONEST refund_maker_unjoined => txId', r.txId);
await sleep(4000);
const after = { spine: await getUtxos(row.spine_p2sh), maker: (await getUtxos(makerRelay.address)).filter((u) => u.startsWith(r.txId)) };
log('AFTER spine UTXO:', JSON.stringify(after.spine), '| maker 收到:', JSON.stringify(after.maker));
out.before = before; out.honest = { txId: r.txId, after };
writeFileSync('seg4_maker_exit_result.json', JSON.stringify(out, null, 1));
process.exit(0);
