// RefundClaim.refund_payout v0.3 §2/§3 代币化(ledger 1164③)向量: 退款目的地改成新建 KanetTokenClaim 输出
// + 代币 owner 转移, 而不是裸 P2PK。
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const { blake3 } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake3.js');
const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
const hex = (a) => '0x' + Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + Buffer.from(b2b(bytecode)).toString('hex') + '87';
const SILVERC = 'D:/kanet-tn12/scratch/_j2_silverc_v100/target/release/silverc.exe';
const KTT = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const KTC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/KanetTokenClaim.sil';
const STUB = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/docs/provenance/2026-09-14-j2-t3-v03-drawdown-mustfix/PoolSideStub.sil';
const RC = 'D:/kanet-tn12/scratch/_j2_wt_t3_market/kasia-console/src/lib/RefundClaim.sil';
const CWD = 'D:/kanet-tn12/scratch/_j2_wt_t3_market';

const ZERO32 = new Array(32).fill(0);
const RC_COV = new Array(32).fill(0xcc);
const BETTOR_PK = new Array(32).fill(0x22);
const SHARD_POOL_ID = new Array(32).fill(0x37);
const MARKET_TMPL_SUFFIX = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];

function compileGeneric(sil, ctor, tag) {
  const ctorPath = `scratch/_t1v06_check/RCtok_${tag}.ctor.json`;
  const outPath = `scratch/_t1v06_check/RCtok_${tag}.compiled.json`;
  fs.writeFileSync(ctorPath, JSON.stringify(ctor, null, 1));
  execSync(`"${SILVERC}" "${sil}" --ctor "${ctorPath}" -o "${outPath}"`, { cwd: CWD });
  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const c = Object.values(compiled.contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { prefix: bc.slice(0, offset), suffix: bc.slice(offset + len), templateHash: c.template_hash, bc, scriptHex: '0x' + p2sh(bc), fullBytecodeHex: '0x' + Buffer.from(bc).toString('hex') };
}

function compileKTT(ownerCov, amount, tag) {
  const ctor = [
    { kind: 'int', value: amount }, { kind: 'bytes', value: ownerCov }, { kind: 'byte', value: 4 }, { kind: 'byte', value: 0 },
    { kind: 'bytes', value: ZERO32 }, { kind: 'bytes', value: ZERO32 },
    { kind: 'bytes', value: MARKET_TMPL_SUFFIX }, { kind: 'int', value: MARKET_TMPL_SUFFIX.length },
    { kind: 'int', value: 3 }, { kind: 'int', value: 3 },
  ];
  return compileGeneric(KTT, ctor, `ktt_${tag}`);
}
function compileTicket(bettorPk, direction, stake, shardPoolId, tag) {
  const ctor = [
    { kind: 'bytes', value: bettorPk }, { kind: 'int', value: direction },
    { kind: 'int', value: stake }, { kind: 'bytes', value: shardPoolId },
  ];
  return compileGeneric(STUB, ctor, `ticket_${tag}`);
}

// ---------- KanetTokenClaim compile helper (for both claim_tmpl_hash derivation AND real target instances) ----------
function compileKTC({ marketCovId, winnerPk, amount, tokenTmplHash, marketSuffixHash }, tag) {
  const ctor = [
    { kind: 'bytes', value: marketCovId }, { kind: 'bytes', value: winnerPk }, { kind: 'int', value: amount },
    { kind: 'bytes', value: tokenTmplHash }, { kind: 'bytes', value: marketSuffixHash },
  ];
  return compileGeneric(KTC, ctor, `ktc_${tag}`);
}

// Derive claim_tmpl_hash/prefix/suffix from ANY KanetTokenClaim instance (template_hash is ctor-value-invariant,
// same T1 "template invariance" property already relied on throughout this project for token/claim templates).
const ktcAnyInstance = compileKTC({ marketCovId: ZERO32, winnerPk: ZERO32, amount: 0, tokenTmplHash: ZERO32, marketSuffixHash: ZERO32 }, 'anchor');
const claimTmplHash = ktcAnyInstance.templateHash;

// Token template anchor (KTT template invariant across ctor values, same pattern used throughout).
const tokAnchor = compileKTT(RC_COV, 1, 'anchor');
const tokenTmplHash = tokAnchor.templateHash;

const marketSuffixHash = [...blake3(Uint8Array.from(MARKET_TMPL_SUFFIX))]; // arbitrary stand-in value for RefundClaim's own "market_suffix_hash" ctor field

function ctorArgsRC({ pool_value, closed = 2, psTmplHash, tokenTmplHashOverride = tokenTmplHash, claimTmplHashOverride = claimTmplHash }) {
  return [hex(psTmplHash), hex(SHARD_POOL_ID), 0, 0, 0, pool_value, closed, 0, hex(ZERO32), hex(tokenTmplHashOverride), hex(claimTmplHashOverride), hex(marketSuffixHash)];
}
function selfInput(pool_value) { return { utxo_value: 1, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value, closed: 2, winningSide: 0, payoutRoot: ZERO32 } }; }
function ticketInput(t) { return { utxo_value: 1, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }
function tokenInput(t) { return { utxo_value: 10, utxo_script_hex: t.scriptHex, signature_script_hex: t.fullBytecodeHex }; }

const tests = [];

// Helper: build the full tx/args/outputs shape for a given (pool_value, stake) scenario. Index layout (fixed
// across all vectors for consistency): inputs=[self(0), tokenHeld(1), ticket(2)]; outputs=[rootCont(0),
// claimOut(1), tokenOutToClaim(2), remainTokenOut(3)] (remainTokenOut/rootCont only present/meaningful when
// pool_value != stake).
function buildScenario({ pool_value, stake, tag, tokenTmplHashOverride, claimTmplHashOverride, wrongClaimOut, wrongTokenOwner, wrongTokPrefix, wrongClaimPrefix }) {
  const ticket = compileTicket(BETTOR_PK, 0, stake, SHARD_POOL_ID, `ticket_${tag}`);
  const heldTok = compileKTT(RC_COV, pool_value, `held_${tag}`);
  const realClaimOut = compileKTC({ marketCovId: RC_COV, winnerPk: BETTOR_PK, amount: stake, tokenTmplHash, marketSuffixHash }, `claimout_${tag}`);
  const claimOut = wrongClaimOut || realClaimOut;
  // ★ debugger genesis-covenant quirk (established project convention): an output declaring a `covenant_id`
  // with no matching continuation input anywhere in the tx is treated as a GENESIS output, whose covenant_id
  // gets cryptographically recomputed from the spending input's real previous_outpoint (kaspa-txscript
  // covenants.rs `hashing::covenant_id::covenant_id(...)`) -- NOT from blake2b(bytecode). Test fixtures can't
  // (and don't need to) replicate that real derivation; the established workaround throughout this project is
  // the "continuation case" trick: pick an ARBITRARY covenant_id, declare it on BOTH the new output AND a
  // dedicated dummy filler input, with `authorizing_input` pointing at that filler -- this makes
  // `input_covenant_id == covenant_id` true, which short-circuits the whole genesis-recompute path (the value
  // returned by OpOutputCovenantId is unaffected either way, since it just reads back whatever was declared).
  const claimCovId = new Array(32).fill(0xdd);
  const tokenOutOwner = wrongTokenOwner || claimCovId;
  const tokenOutToClaim = compileKTT(tokenOutOwner, stake, `tokoutclaim_${tag}`);

  const exact = pool_value === stake;
  const outputs = [];
  outputs.push(exact
    ? { value: 1, covenant_id: hex(RC_COV) } // rootOutIdx unused in exact branch, dummy placeholder
    : { value: pool_value - stake, covenant_id: hex(RC_COV), state: { local_yes: 0, local_no: 0, count: 0, pool_value: pool_value - stake, closed: 2, winningSide: 0, payoutRoot: ZERO32 } });
  outputs.push({ value: 1, covenant_id: hex(claimCovId), authorizing_input: 3, script_hex: claimOut.scriptHex });
  outputs.push({ value: 1, script_hex: tokenOutToClaim.scriptHex });
  if (!exact) {
    const remainTokenOut = compileKTT(RC_COV, pool_value - stake, `remaintok_${tag}`);
    outputs.push({ value: 1, script_hex: remainTokenOut.scriptHex });
  } else {
    outputs.push({ value: 1, covenant_id: hex(RC_COV) }); // remainTokenOutIdx unused, dummy placeholder
  }

  const tokPrefix = wrongTokPrefix || heldTok.prefix;
  const claimPrefix = wrongClaimPrefix || ktcAnyInstance.prefix;

  return {
    function: 'refund_payout',
    constructor_args: ctorArgsRC({ pool_value, psTmplHash: ticket.templateHash, tokenTmplHashOverride, claimTmplHashOverride }),
    args: [0, 1, 1, 2, 3, 2, ticket.prefix.length, ticket.suffix.length, hex(tokPrefix), hex(heldTok.suffix), hex(claimPrefix), hex(ktcAnyInstance.suffix)],
    tx: {
      active_input_index: 0,
      inputs: [
        selfInput(pool_value), tokenInput(heldTok), ticketInput(ticket),
        { utxo_value: 1, covenant_id: hex(claimCovId), signature_script_hex: '0x00ff' }, // dummy filler: authorizes claimOut's covenant_id via the continuation-case trick
      ],
      outputs,
    },
  };
}

// V-RC-TOK-1: pass -- partial refund with remainder token + bookkeeping continuation.
tests.push({ name: 'V-RC-TOK-1_pass_partial_refund_with_remainder', expect: 'pass', ...buildScenario({ pool_value: 100, stake: 30, tag: '1' }) });
// V-RC-TOK-2: pass -- exact refund, pool_value==stake, no remainder token / no bookkeeping continuation.
tests.push({ name: 'V-RC-TOK-2_pass_exact_no_remainder', expect: 'pass', ...buildScenario({ pool_value: 80, stake: 80, tag: '2' }) });
// V-RC-TOK-3: fail -- destination "claim" output is NOT a real compiled KanetTokenClaim instance (a fake
// same-size-ish blob) -- must be rejected as a fake claim shell, not silently accepted.
{
  const fakeClaimOut = compileKTT(RC_COV, 1, 'fake_claim_shell'); // wrong contract entirely, same test harness compile path
  tests.push({ name: 'V-RC-TOK-3_fail_destination_not_real_claim_template', expect: 'fail', ...buildScenario({ pool_value: 100, stake: 30, tag: '3', wrongClaimOut: fakeClaimOut }) });
}
// V-RC-TOK-4: fail -- token output owner diverted to a stranger covenant instead of the real new claim's cov id.
tests.push({ name: 'V-RC-TOK-4_fail_token_owner_diverted_to_stranger', expect: 'fail', ...buildScenario({ pool_value: 100, stake: 30, tag: '4', wrongTokenOwner: new Array(32).fill(0x99) }) });
// V-RC-TOK-5: fail -- witness supplies a wrong tok_prefix (blake3 mismatch against token_tmpl_hash).
tests.push({ name: 'V-RC-TOK-5_fail_witness_wrong_tok_prefix', expect: 'fail', ...buildScenario({ pool_value: 100, stake: 30, tag: '5', wrongTokPrefix: [0xff] }) });
// V-RC-TOK-6: fail -- witness supplies a wrong claim_prefix (blake3 mismatch against claim_tmpl_hash).
tests.push({ name: 'V-RC-TOK-6_fail_witness_wrong_claim_prefix', expect: 'fail', ...buildScenario({ pool_value: 100, stake: 30, tag: '6', wrongClaimPrefix: [0xff] }) });

fs.writeFileSync('scratch/_t1v06_check/RefundClaim.tokenization.test.json', JSON.stringify({ tests }, null, 1));
console.log('wrote', tests.length, 'vectors');
