// seg2_handoff.mjs — 账本 1832 段2 验收: zk_handoff(PayoutShardV2 → CloseZkV2, 代币全额转移) simnet 官方 2.0.1 真共识。
//   前置(由生产自治 tick 完成, 本脚本只等): judge+propose → consolidate(段1) → 5 委员 V2 voter(含修复后的 N3/C1 门)签 → submit V2 close_attest 落链(closed==1)。
//   本脚本: ① 负向 H1~H4(每条: dry_run 真字节 → cli-debugger 定位 PayoutShardV2.sil 失败行 + 真共识拒收) ② 诚实: 走【生产 admin 端点】buildZkHandoffRequestV2(probe→tok_out→签发→landed→writeZkContinuation)
//   ③ 读回按 UTXO: PS 与 PS 名下代币消失; 新 CloseZkV2 UTXO(带新 covenant)+ 新 KTT UTXO(amount=池, owner=新 CloseZkV2 cov)出现。
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { http, relays, kaspa, rpcConnect, sleep, log, FUNDS_SECRET } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const { readPayoutShardV2AttestedState } = await imp('lib/bshard-close-enforce.mjs');
const { computeCloseZkTmplAnchor, settleDispatchTags } = await imp('lib/pool-shard-register.mjs');
const { computeKttTokenArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
const settler = relays.settler;
const STATE_PREP = 'simnet-state-prep';
const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount), covenantId: e.covenantId ? String(e.covenantId) : null })); };
const landed = async (txid, addr) => { for (let i = 0; i < 100; i++) { if ((await getUtxos(addr)).some((u) => u.outpoint.transactionId === txid)) return true; await sleep(300); } return false; };
const sendRaw = async (cmd) => { const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 900)); e.raw = j; throw e; } return j; };
const transfer = async (addr, sompi) => {
  const j = await http('POST', `/api/relay/${settler.id}/transfer`, { to: addr, amount: (Number(sompi) / 1e8).toFixed(8) }, { 'x-kanet-admin-secret': FUNDS_SECRET });
  if (!j.txId) throw new Error('transfer fail ' + JSON.stringify(j));
  if (!(await landed(j.txId, addr))) throw new Error('transfer not landed ' + j.txId);
  return j.txId;
};

// ── 等 close_attest 落链(closed==1) ──
let ps, state;
for (let i = 0; i < 480; i++) {   // ≤ 40 min
  ps = db.prepare('select * from payout_shards where logical_market_id = ?').get(m.market_id);
  try { state = readPayoutShardV2AttestedState(ps.payout_redeem_hex); break; } catch { /* closed != 1 */ }
  if (i % 12 === 0) log('waiting close_attest landed (closed==1)…', ps?.payout_ps_outpoint?.slice(0, 12));
  await sleep(5000);
}
if (!state) throw new Error('close_attest never landed (closed != 1)');
log('close_attest landed. PS outpoint', ps.payout_ps_outpoint, 'pool', state.consolidatedPool.toString(), 'winner', state.attestedWinner);
const [psTx, psIdxS] = ps.payout_ps_outpoint.split(':');
const psAddr = addrOf(ps.payout_redeem_hex);
const pool = Number(state.consolidatedPool);
const psTokArt = computeKttTokenArtifact({ amount: pool, ownerCovIdHex: ps.payout_cov_id });
const psTokAddr = addrOf(psTokArt.script.toString('hex'));
const before = { ps: await getUtxos(psAddr), psToken: await getUtxos(psTokAddr) };
log('BEFORE PS UTXO:', JSON.stringify(before.ps), '\nBEFORE PS-held token UTXO:', JSON.stringify(before.psToken));
if (before.ps.length !== 1 || before.psToken.length !== 1) throw new Error('precondition: PS / PS-token UTXO count != 1');

// ── 构造(镜像生产 buildZkHandoffRequestV2) + 变异 ──
const tmplA = computeCloseZkTmplAnchor(process.env.ZK_CLOSEZK_SIL_PATH, process.env.ZK_GATE_TMPL_HASH, process.env.ZK_TOKEN_TMPL_HASH, process.env.ZK_CLAIM_TMPL_HASH);
const tags = settleDispatchTags();
async function buildCmd({ mutate = (c) => {}, tokOutAmount = pool, tokOutOwnerOverride = null }) {
  const feeTx = await transfer(settler.address, 30_000_000);
  const cmd = {
    type: 'bshard_zk_handoff', dryRun: false,
    inputs: {
      payoutshard: { redeem_hex: ps.payout_redeem_hex, outpointTxid: psTx, index: Number(psIdxS),
        state: { consolidated_pool: state.consolidatedPool.toString(), attestedWinner: state.attestedWinner, attestedAtMs: state.attestedAtMs, betsRootBaked: state.betsRootHex, refundRootBaked: state.refundRootHex } },
      ps_token: { redeem_hex: psTokArt.script.toString('hex'), outpointTxid: before.psToken[0].outpoint.transactionId, index: Number(before.psToken[0].outpoint.index) },
      fee: { address: settler.address, outpointTxid: feeTx, index: 0 },
    },
    witness: { self_out_idx: 0, token_out_idx: 1,
      template_a_hex: tmplA.templateA.toString('hex'), template_b_hex: tmplA.templateB.toString('hex'), template_c_hex: tmplA.templateC.toString('hex'), template_d_hex: tmplA.templateD.toString('hex'),
      handoff_dispatch_tag_hex: tags.zk_handoff, tok_prefix_hex: psTokArt.templatePrefix.toString('hex'), tok_suffix_hex: psTokArt.templateSuffix.toString('hex'),
      token_transfer_dispatch_tag_hex: psTokArt.entryAbi.dispatch_tag, token_transfer_state_field_count: psTokArt.stateFieldCount },
    outputs: { change_address: settler.address },
  };
  mutate(cmd);
  const probe = await sendRaw({ ...cmd });
  if (!probe.probe) throw new Error('no probe ' + JSON.stringify(probe).slice(0, 200));
  const art = computeKttTokenArtifact({ amount: tokOutAmount, ownerCovIdHex: tokOutOwnerOverride ?? probe.zkCovId });
  cmd.outputs = { change_address: settler.address, tok_out: { redeem_hex: art.script.toString('hex'), owner_cov_id_hex: probe.zkCovId } };   // owner_cov_id_hex 恒=真 zkCovId ⇒ 绕过 relay 预检, 让合约/共识来拒
  return { cmd, probe };
}

// ── cli-debugger ──
const H = (x) => '0x' + x;
const z = '0x' + '00'.repeat(32);
const ownRedeemLen = Buffer.from(ps.payout_redeem_hex, 'hex').length;
const ctor = [H(ps.pool_merkle_root), H(ps.predicate_commit), H(tmplA.anchorHex), H(process.env.ZK_TOKEN_TMPL_HASH), pool, 1, H(state.payoutRootHex), ...Array(17).fill(0), state.attestedWinner, state.attestedAtMs, H(state.betsRootHex), H(state.refundRootHex), H(process.env.ZK_CLAIM_TMPL_HASH), ownRedeemLen];
const dbgExe = 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function dbgHandoff(label, dump, w) {
  const tx = { active_input_index: 0,
    inputs: dump.inputs.map((i) => ({ prev_txid: i.prev_txid, prev_index: i.prev_index, sequence: 0, sig_op_count: 0, utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
    outputs: dump.outputs.map((o) => ({ value: Number(o.value), script_hex: H(o.script_hex), ...(o.covenant_id ? { covenant_id: H(o.covenant_id), authorizing_input: 2 } : {}) })) };   // 两个 genesis 输出由 fee 输入(idx 2)授权
  const args = [0, 1, 1, H(w.tok_prefix_hex), H(w.tok_suffix_hex), H(w.template_a_hex), H(w.template_b_hex), H(w.template_c_hex), H(w.template_d_hex)];
  const file = `dbg_${label}.test.json`; writeFileSync(file, JSON.stringify({ tests: [{ name: label, function: 'zk_handoff', constructor_args: ctor, args, expect: 'pass', tx }] }));
  let out = ''; try { out = execFileSync(dbgExe, ['D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/PayoutShardV2.sil', '--test-file', file, '--run-all'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const pass = /\bPASS\b/.test(out) && !/\bFAIL\b/.test(out);
  const at = /-->\s*(\d+):\d+/.exec(out); const lineNo = at ? Number(at[1]) : null;
  const reqLine = lineNo ? (out.split(/\r?\n/).map((l) => l.trimStart()).find((l) => l.startsWith(`${lineNo} |`))?.slice(`${lineNo} |`.length).trim() ?? null) : null;
  writeFileSync(`dbg_${label}.out.txt`, out.slice(0, 2500));
  return { pass, lineNo, reqLine };
}

const out = { before, negatives: {} };
async function negative(label, opts) {
  const { cmd } = await buildCmd(opts);
  const dry = await sendRaw({ ...cmd, dryRun: true });
  const dbg = dbgHandoff(label, dry, cmd.witness);
  let rejected = null; try { await sendRaw(cmd); } catch (e) { rejected = e.message; }
  log(`NEG ${label}: consensus=${rejected ? 'REJECTED ✓' : '‼️ ACCEPTED (BAD)'} | debugger=${JSON.stringify(dbg)}`);
  log(`   node text: ${(rejected || '').slice(0, 500)}`);
  out.negatives[label] = { consensusRejected: !!rejected, nodeText: rejected, debugger: dbg };
  if (!rejected) throw new Error('negative accepted: ' + label);
}
const flip = (hex) => hex.slice(0, -2) + (hex.slice(-2) === 'ff' ? '00' : 'ff');
await negative('H1_token_amount_short', { tokOutAmount: pool - 1 });
await negative('H2_token_owner_wrong', { tokOutOwnerOverride: ps.payout_cov_id });
await negative('H3_template_tampered', { mutate: (c) => { c.witness.template_a_hex = flip(c.witness.template_a_hex); } });
await negative('H4_state_tampered', { mutate: (c) => { c.inputs.payoutshard.state.betsRootBaked = flip(c.inputs.payoutshard.state.betsRootBaked); } });
const still = { ps: await getUtxos(psAddr), psToken: await getUtxos(psTokAddr) };
out.negativesLeftStateUntouched = still.ps.length === 1 && still.psToken.length === 1;
log('after negatives PS/PS-token untouched:', out.negativesLeftStateUntouched);

// ── 诚实: 生产 admin 端点 ──
const r = await http('POST', '/api/admin/pool/zk-handoff-v2', { market_id: m.market_id, settler_relay_id: settler.id, dry_run: false }, { 'x-kanet-admin-secret': STATE_PREP });
log('HONEST zk-handoff-v2 =>', JSON.stringify(r).slice(0, 700));
out.honest = r;
if (!r.txId) throw new Error('honest handoff failed');
const zkAddr = r.closeZkAddress;
const tokOutArt = computeKttTokenArtifact({ amount: pool, ownerCovIdHex: r.zkCovId });
const after = { ps: await getUtxos(psAddr), psToken: await getUtxos(psTokAddr), closeZk: await getUtxos(zkAddr), newToken: await getUtxos(addrOf(tokOutArt.script.toString('hex'))) };
log('AFTER PS UTXO:', JSON.stringify(after.ps), '| PS-held token:', JSON.stringify(after.psToken));
log('AFTER CloseZkV2 UTXO:', JSON.stringify(after.closeZk));
log(`AFTER 新 KTT UTXO (amount=${pool}, owner=新 CloseZkV2 cov ${r.zkCovId.slice(0, 12)}…):`, JSON.stringify(after.newToken));
out.after = after;
const zc = JSON.parse(db.prepare('select metadata from pool_markets where id = ?').get(m.market_id).metadata || '{}').zk_continuation;
log('DB zk_continuation:', JSON.stringify(zc)?.slice(0, 400));
out.zk_continuation = zc;
log('SUMMARY', JSON.stringify({ psGone: after.ps.length === 0 && after.psToken.length === 0, closeZk: after.closeZk.length, newToken: after.newToken.length, zkCovBound: after.closeZk[0]?.covenantId === r.zkCovId }));
writeFileSync('seg2_handoff_result.json', JSON.stringify(out, null, 1));
process.exit(0);
