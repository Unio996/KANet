// dbg_absorb.mjs — 用生产 builder 的 dry_run 取真实 tx 各输入/输出字节, 生成 cli-debugger 测试(PayoutShardV2.absorb / ShardLeaf.consolidate_to_payout), 逐入口执行定位。
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { http, relays, kaspa, rpcConnect, sleep, log } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const { consolidateAllShards } = await imp('lib/pool-shard-settle.mjs');
const { computeCloseZkTmplAnchor } = await imp('lib/pool-shard-register.mjs');
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
const settler = relays.settler;
const ps0 = db.prepare('select * from payout_shards where logical_market_id = ?').get(m.market_id);
const market = db.prepare('select deadline from pool_markets where id = ?').get(m.market_id);
const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount) })); };
const landed = async (txid, addr) => { for (let i = 0; i < 100; i++) { if ((await getUtxos(addr)).some((u) => u.outpoint.transactionId === txid)) return true; await sleep(300); } return false; };
const transfer = async (addr, sompi) => { const j = await http('POST', `/api/relay/${settler.id}/transfer`, { to: addr, amount: (Number(sompi) / 1e8).toFixed(8) }, { 'x-kanet-admin-secret': 'simnet-funds-secret-e2e' }); if (!j.txId) throw new Error('transfer ' + JSON.stringify(j)); await landed(j.txId, addr); return j.txId; };
let dump = null, sentCmd = null;
const rc = async (cmd) => { sentCmd = cmd; cmd.dry_run = true; const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.error) throw new Error(JSON.stringify(j).slice(0, 500)); dump = j; throw new Error('DRYRUN_STOP'); };
try { await consolidateAllShards({ db, rc, landed, p2sh: addrOf, logicalMarketId: m.market_id, payoutShard: { payout_redeem_hex: ps0.payout_redeem_hex, payout_ps_outpoint: ps0.payout_ps_outpoint, payout_cov_id: ps0.payout_cov_id }, relayAddr: settler.address, transfer, deadline: Number(market.deadline), getUtxos, tokenized: true }); } catch (e) { if (e.message !== 'DRYRUN_STOP') throw e; }
writeFileSync('dbg_dump.json', JSON.stringify({ dump, cmdWitness: sentCmd.witness }, null, 1));
log('dry-run dump inputs:', dump.inputs.length, 'outputs:', dump.outputs.length, 'sigScript lens', dump.inputs.map((i) => i.signature_script_hex.length / 2).join(','));
// ── PS absorb 测试 ──
const H = (x) => '0x' + x;
const tmpl = { tok: process.env.ZK_TOKEN_TMPL_HASH, claim: process.env.ZK_CLAIM_TMPL_HASH };
const { anchorHex } = computeCloseZkTmplAnchor(process.env.ZK_CLOSEZK_SIL_PATH, process.env.ZK_GATE_TMPL_HASH, tmpl.tok, tmpl.claim);
const z = '0x' + '00'.repeat(32);
const ctor = [H(ps0.pool_merkle_root), H(ps0.predicate_commit), H(anchorHex), H(tmpl.tok), 0, 0, z, ...Array(17).fill(0), -1, 0, z, z, H(tmpl.claim)];
const w = sentCmd.witness;
const tx = { active_input_index: 0,
  inputs: dump.inputs.map((i, k) => ({ utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
  outputs: dump.outputs.map((o, k) => ({ value: Number(o.value), script_hex: H(o.script_hex), ...(o.covenant_id && k === 0 ? { covenant_id: H(o.covenant_id) } : {}) })) };
const absorbTest = { tests: [{ name: 'absorb_real_tx', function: 'absorb', constructor_args: ctor, args: [0, 2, 1, Number(w.shard_amount), H(w.tok_prefix_hex), H(w.tok_suffix_hex)], expect: 'pass', tx }] };
writeFileSync('dbg_absorb.test.json', JSON.stringify(absorbTest, null, 1));
const dbgExe = 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
try { const o = execFileSync(dbgExe, ['D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/PayoutShardV2.sil', '--test-file', 'dbg_absorb.test.json', '--run-all'], { encoding: 'utf8', maxBuffer: 1 << 28 }); console.log('ABSORB DEBUGGER:\n' + o.slice(-1800)); }
catch (e) { console.log('ABSORB DEBUGGER (nonzero):\n' + String(e.stdout || '').slice(-1800) + String(e.stderr || '').slice(-1500)); }
process.exit(0);
