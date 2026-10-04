// seg3_zkclose.mjs — 账本 1832 段3 验收: CloseZkV2.zk_close(真 RISC0 Groth16 gate) simnet 官方 kaspad 2.0.1 真共识。
//   前置(生产自治完成, 本脚本只等): judge+propose → consolidate → 委员签 → close_attest → zk_handoff(tick) → prove worker(WSL+Docker 真 Groth16, 串行) 出证并注资 gate → zk_continuation.proving.status=ready。
//   本脚本: ① 负向 Z1 guestPayoutRoot 被改 / Z2 gate_suffix 被改 / Z3 proof 被破坏 ② 诚实: 生产 admin 端点 /api/admin/pool/zk-close-v2(dry_run:false → dispatchUnlockZkClose → bshard_zk_close)
//   ③ 读回: CloseZkV2 续约 closed=2 + payoutRoot; 池代币 UTXO(owner=CloseZkV2 cov)原封不动(zk_close 不动代币); gate UTXO 消费 + 找零。
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { http, relays, kaspa, rpcConnect, sleep, log } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const { dispatchUnlockZkClose } = await imp('lib/zk-close-dispatch.mjs');
const { readPayoutShardV2AttestedState } = await imp('lib/bshard-close-enforce.mjs');
const { computeKttTokenArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const kaspaZkMod = createRequire(import.meta.url)(process.env.ZKSDK_WASM_PATH || 'D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js');
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
const settler = relays.settler;
const BROADCAST_SECRET = 'simnet-zkclose';
const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount), covenantId: (e.covenantId ?? e.utxoEntry?.covenantId) ? String(e.covenantId ?? e.utxoEntry?.covenantId) : null })); };
const sendRaw = async (cmd) => { const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 700)); e.raw = j; throw e; } return j; };
const metaOf = () => JSON.parse(db.prepare('select metadata from pool_markets where id = ?').get(m.market_id)?.metadata || '{}');

for (let i = 0; i < 600; i++) {   // ≤ 50 min
  const zc = metaOf().zk_continuation;
  if (zc?.proving?.status === 'ready') break;
  if (i % 12 === 0) log('waiting proving ready…', JSON.stringify({ handoff: !!zc, proving: zc?.proving?.status, job: db.prepare('select id,status from zk_prove_jobs where market_id=? order by id desc limit 1').get(m.market_id) }));
  await sleep(5000);
}
const zkCont = metaOf().zk_continuation;
if (zkCont?.proving?.status !== 'ready') throw new Error('proving never ready');
log('proving ready. continuation', zkCont.outpoint.txid.slice(0, 12), 'pool(token)', zkCont.valueSompi, 'utxoValue(KAS)', zkCont.utxoValueSompi, 'gate', JSON.stringify(zkCont.proving.gate));
const ps = db.prepare('select * from payout_shards where logical_market_id = ?').get(m.market_id);
const att = readPayoutShardV2AttestedState(ps.payout_redeem_hex);
const czAddr = addrOf(zkCont.redeemHex);
const before = { closeZk: await getUtxos(czAddr), gate: await getUtxos(zkCont.proving.gate.address) };
const czCov = before.closeZk[0]?.covenantId;
log('BEFORE CloseZkV2 UTXO:', JSON.stringify(before.closeZk), '| gate UTXO:', JSON.stringify(before.gate));
const pool = Number(zkCont.valueSompi);
const tokArt = czCov ? computeKttTokenArtifact({ amount: pool, ownerCovIdHex: czCov }) : null;
const tokBefore = tokArt ? await getUtxos(addrOf(tokArt.script.toString('hex'))) : null;
log('BEFORE 池代币 UTXO(owner=CloseZkV2 cov):', JSON.stringify(tokBefore));
if (before.closeZk.length !== 1 || before.gate.length !== 1) throw new Error('precondition: CloseZk/gate UTXO != 1');

// ── cli-debugger ──
const H = (x) => '0x' + x;
const z = '0x' + '00'.repeat(32);
const ctor = [H(process.env.ZK_GATE_TMPL_HASH), H(att.betsRootHex), H(att.refundRootHex), att.attestedAtMs, att.attestedWinner, 1, z, pool, ...Array(17).fill(0), H(process.env.ZK_TOKEN_TMPL_HASH), H(process.env.ZK_CLAIM_TMPL_HASH), Buffer.from(zkCont.redeemHex, 'hex').length];
const dbgExe = 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function dbgClose(label, dump, w) {
  const tx = { active_input_index: 0,
    inputs: dump.inputs.map((i) => ({ prev_txid: i.prev_txid, prev_index: i.prev_index, sequence: 0, sig_op_count: 0, utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
    outputs: dump.outputs.map((o) => ({ value: Number(o.value), script_hex: H(o.script_hex), ...(o.covenant_id ? { covenant_id: H(o.covenant_id) } : {}) })) };
  const args = [H(w.gate_suffix_hex), H(w.guest_payout_root_hex), 0, H(w.tok_prefix_hex), H(w.tok_suffix_hex)];
  const file = `dbg_${label}.test.json`; writeFileSync(file, JSON.stringify({ tests: [{ name: label, function: 'zk_close', constructor_args: ctor, args, expect: 'pass', tx }] }));
  let out = ''; try { out = execFileSync(dbgExe, ['D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/CloseZkV2.sil', '--test-file', file, '--run-all'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const pass = /\bPASS\b/.test(out) && !/\bFAIL\b/.test(out);
  const at = /-->\s*(\d+):\d+/.exec(out); const lineNo = at ? Number(at[1]) : null;
  const reqLine = lineNo ? (out.split(/\r?\n/).map((l) => l.trimStart()).find((l) => l.startsWith(`${lineNo} |`))?.slice(`${lineNo} |`.length).trim() ?? null) : null;
  writeFileSync(`dbg_${label}.out.txt`, out.slice(0, 2500));
  return { pass, lineNo, reqLine };
}
const out = { before: { ...before, tokBefore }, negatives: {} };
const flip = (hex, at = hex.length - 2) => hex.slice(0, at) + (hex.slice(at, at + 2) === 'ff' ? '00' : 'ff') + hex.slice(at + 2);

async function negative(label, mutate, { debuggable = true } = {}) {
  let dbg = null, rejected = null;
  const ctx = {
    getMarket: (mid) => db.prepare('select metadata from pool_markets where id = ?').get(mid),
    getDoneJob: (mid) => db.prepare("select receipt_hex from zk_prove_jobs where market_id = ? and status = 'done' order by id desc limit 1").get(mid),
    kaspaZk: () => kaspaZkMod,
    relayCall: async (cmd) => {
      mutate(cmd);
      if (debuggable) { const dry = await sendRaw({ ...cmd, dry_run: true }); dbg = dbgClose(label, dry, cmd.witness); }
      return sendRaw(cmd);
    },
  };
  const r = await dispatchUnlockZkClose({ marketId: m.market_id, continuationOutpoint: zkCont.outpoint, attestedWinner: zkCont.attestedWinner }, ctx);
  rejected = r.ok ? null : r.error;
  log(`NEG ${label}: consensus=${rejected ? 'REJECTED ✓' : '‼️ ACCEPTED (BAD)'} | debugger=${JSON.stringify(dbg)}`);
  log(`   node text: ${(rejected || '').slice(0, 520)}`);
  out.negatives[label] = { consensusRejected: !!rejected, nodeText: rejected, debugger: dbg };
  if (!rejected) throw new Error('negative accepted: ' + label);
}
await negative('Z1_guest_payout_root_tampered', (c) => { c.witness.guest_payout_root_hex = flip(c.witness.guest_payout_root_hex); });
await negative('Z2_gate_suffix_tampered', (c) => { c.witness.gate_suffix_hex = flip(c.witness.gate_suffix_hex); });
await negative('Z3_proof_corrupted', (c) => { c.inputs.gate.sig_script_hex = flip(c.inputs.gate.sig_script_hex, Math.floor(c.inputs.gate.sig_script_hex.length / 2)); }, { debuggable: false });
const still = { closeZk: await getUtxos(czAddr), gate: await getUtxos(zkCont.proving.gate.address) };
out.negativesLeftStateUntouched = still.closeZk.length === 1 && still.gate.length === 1;
log('after negatives CloseZk/gate untouched:', out.negativesLeftStateUntouched);

// ── 诚实: 生产 admin 端点 ──
const r = await http('POST', '/api/admin/pool/zk-close-v2', { market_id: m.market_id, settler_relay_id: settler.id, dry_run: false }, { 'x-kanet-admin-secret': BROADCAST_SECRET });
log('HONEST zk-close-v2 =>', JSON.stringify(r).slice(0, 500));
out.honest = r;
if (!r.txId) throw new Error('honest zk_close failed');
const zc2 = metaOf().zk_continuation;
const after = { closeZkOld: await getUtxos(czAddr), gate: await getUtxos(zkCont.proving.gate.address), closeZkNew: await getUtxos(addrOf(zc2.redeemHex)), tok: tokArt ? await getUtxos(addrOf(tokArt.script.toString('hex'))) : null };
log('AFTER 旧 CloseZkV2(closed=1) UTXO:', JSON.stringify(after.closeZkOld), '| gate UTXO:', JSON.stringify(after.gate));
log('AFTER 新 CloseZkV2(closed=2) UTXO:', JSON.stringify(after.closeZkNew));
log('AFTER 池代币 UTXO(应原封不动):', JSON.stringify(after.tok));
const st = Buffer.from(zc2.redeemHex, 'hex');
log('AFTER 续约 state: closed=', Number(st.readBigInt64LE(1 + 9 + 1)), 'payoutRootField=', st.subarray(1 + 18 + 1, 1 + 18 + 1 + 32).toString('hex'), '| proving.guestPayoutRoot=', zkCont.proving.guestPayoutRootHex);
log('DB zk_continuation(after):', JSON.stringify({ valueSompi: zc2.valueSompi, utxoValueSompi: zc2.utxoValueSompi, poolAtZkCloseSompi: zc2.poolAtZkCloseSompi, outpoint: zc2.outpoint }));
out.after = after; out.zk_continuation_after = zc2;
log('SUMMARY', JSON.stringify({ oldGone: after.closeZkOld.length === 0, gateConsumed: after.gate.length === 0, newCloseZk: after.closeZkNew.length, tokenIntact: JSON.stringify(after.tok) === JSON.stringify(tokBefore) }));
writeFileSync('seg3_zkclose_result.json', JSON.stringify(out, null, 1));
process.exit(0);
