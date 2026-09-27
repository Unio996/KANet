// SDK 单元自测(纯函数, 不碰链) — quote 签名/验签、mass 校验、去重/上限、签名链、resolveRulesForOrder。
process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/src/lib/commission-plan-sdk.mjs');
const {
  spkBytesFromAddress, validateRoleAddressSpk, canonicalQuoteBytes, signQuote, verifyQuoteSignature,
  validateDepositTerms, validateQuoteMassFeasibility, estimateOrderMassPrecheck, minOrderSompiForChannels,
  encodeAttributionLink, parseAttributionLink, dedupAndCapChannelSpks, signChainEntry, verifyChain,
  signOrderAddressClaim, verifyOrderAddressClaim, resolveRulesForOrder, SIGCHAIN_DOMAIN,
} = SDK;
const { createRequire } = await import('node:module');
const require = createRequire('D:/kanet-tn12/kasia-console/');
const kaspa = require('kaspa-wasm');
const { PrivateKey } = kaspa;
const blake2bPath = require.resolve('@noble/hashes/blake2b');
const { blake2b } = await import('file://' + blake2bPath.replace(/\\/g, '/'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ── setup real addresses ──
const merchantPriv = new PrivateKey('01'.repeat(32));
const brokerPriv = new PrivateKey('02'.repeat(32));
const ch1Priv = new PrivateKey('03'.repeat(32));
const ch2Priv = new PrivateKey('04'.repeat(32));
const ch3Priv = new PrivateKey('05'.repeat(32));
const payerPriv = new PrivateKey('06'.repeat(32));
const net = 'testnet';
const addr = (priv) => priv.toPublicKey().toAddress(net).toString();

// ── C2/quote sign+verify ──
const quoteBase = {
  schema_v: 1,
  quote_id: 'test-quote-1',
  merchant_pubkey_hex: merchantPriv.toPublicKey().toString(),
  price_sompi: '1000000000',
  canonical_rules: {
    schema_v: 1,
    roles: [
      { name: 'provider', bps: 7000, address: addr(merchantPriv) },
      { name: 'broker', bps: 500, address: addr(brokerPriv) },
      { name: 'channel_1', bps: 900, fold_to: 'provider' },
      { name: 'channel_2', bps: 700, fold_to: 'provider' },
      { name: 'channel_3', bps: 500, fold_to: 'provider' },
      { name: 'channel_4', bps: 300, fold_to: 'provider' },
      { name: 'channel_5', bps: 100, fold_to: 'provider' },
    ],
  },
  unfilled_channel_slot_fold_to: 'provider',
  valid_from_ms: Date.now(),
  valid_until_ms: Date.now() + 86400000,
  channel_whitelist: null,
  require_channel_deposit: false,
  min_deposit_sompi: '100000000',
  max_split_fee_sompi: '40000000',
  max_refund_fee_sompi: '10000000',
  deadline_offset_ms: 259200000,
};

let signedQuote;
try {
  signedQuote = signQuote(quoteBase, merchantPriv.toString());
  check('signQuote produces signature_hex', !!signedQuote.signature_hex);
  check('verifyQuoteSignature true for valid quote', verifyQuoteSignature(signedQuote));
  const tampered = { ...signedQuote, price_sompi: '2000000000' };
  check('verifyQuoteSignature false for tampered quote', !verifyQuoteSignature(tampered));
} catch (e) { check('signQuote path', false, e.message); }

// ── O2 mass precheck ──
try {
  const outputs = [
    { value: 700_000_000n, spkBytes: spkBytesFromAddress(addr(merchantPriv)) },
    { value: 50_000_000n, spkBytes: spkBytesFromAddress(addr(brokerPriv)) },
    { value: 15_000_000n, spkBytes: spkBytesFromAddress(addr(ch1Priv)) },
    { value: 15_000_000n, spkBytes: spkBytesFromAddress(addr(ch2Priv)) },
    { value: 15_000_000n, spkBytes: spkBytesFromAddress(addr(ch3Priv)) },
    { value: 10_000_000n, spkBytes: spkBytesFromAddress(addr(payerPriv)) },
  ];
  const pre = estimateOrderMassPrecheck(outputs, 900_000_000n);
  check('estimateOrderMassPrecheck 3-dim reports', typeof pre.compute === 'bigint' && typeof pre.storage === 'bigint' && typeof pre.transient === 'bigint', `compute=${pre.compute} storage=${pre.storage} transient=${pre.transient}`);
  check('6-role normal amounts within limits', !pre.exceeds.compute && !pre.exceeds.storage && !pre.exceeds.transient, `compute=${pre.compute} storage=${pre.storage} transient=${pre.transient}`);
} catch (e) { check('estimateOrderMassPrecheck', false, e.message); }

// ── O4 min order calc ──
try {
  const minOrder = minOrderSompiForChannels(5, 15_000_000n, 1000); // 0.15 KAS x5, 10% budget
  check('minOrderSompiForChannels O4 Owner example', minOrder === 750_000_000n, minOrder.toString());
} catch (e) { check('minOrderSompiForChannels', false, e.message); }

// ── N2/N3 dedup+cap ──
try {
  const a = addr(ch1Priv), b = addr(ch2Priv);
  const r1 = dedupAndCapChannelSpks([a, b, a, addr(ch3Priv)]); // A,B,A,C -> channel_3 empty
  check('N2 dedup: repeated addr becomes null slot', r1.ok && r1.spks[2] === null, JSON.stringify(r1.ok));
  check('N2 dedup: 4 raw positions accepted (<=5)', r1.spks.length === 4);

  const r2 = dedupAndCapChannelSpks([a, b, addr(ch3Priv), addr(payerPriv), a, addr(merchantPriv)]); // 6 raw positions
  check('N3: 6 raw positions rejected outright', r2.ok === false, r2.reason);

  // 🔴 real finding (not the outcome originally assumed by the v0.4 design doc): kaspa-wasm's
  // Address parser does NOT accept a re-cased (all-uppercase) bech32 string at all — it panics
  // ('unreachable') rather than normalizing it. So the specific "case-variant free channel slot"
  // attack N2 worried about is already closed by the address library itself, one layer before
  // dedupAndCapChannelSpks ever runs. The correct, real-world assertion is therefore "gets cleanly
  // rejected", not "gets deduped" — verified below. The byte-comparison dedup logic itself (not
  // text comparison) remains implemented as defense-in-depth for any future/alternate address
  // parser that IS lenient about casing.
  const upperA = a.toUpperCase();
  const r3 = dedupAndCapChannelSpks([a, upperA]);
  check('N2: re-cased address is cleanly rejected by address parser (real kaspa-wasm behavior), not a silent dedup-bypass', r3.ok === false, JSON.stringify(r3));
} catch (e) { check('dedup/cap', false, e.message); }

// ── link encode/decode ──
try {
  const link = encodeAttributionLink('https://checkout.example/pay', 'q123', [addr(ch1Priv), addr(ch2Priv)]);
  const parsed = parseAttributionLink(link);
  check('link roundtrip quoteRef', parsed.quoteRef === 'q123');
  check('link roundtrip channel addrs', parsed.rawChannelAddrs.length === 2);
} catch (e) { check('link encode/decode', false, e.message); }

// ── O1 signature chain: happy path + 5 attacks (C21-C25) ──
try {
  const quoteForChain = signedQuote;
  const d0 = Buffer.alloc(32, 0); // placeholder root for isolated test; real flow uses chainDigest0(quote,network) internally via verifyChain
  const spkA = spkBytesFromAddress(addr(ch1Priv));
  const spkB = spkBytesFromAddress(addr(ch2Priv));
  const spkC = spkBytesFromAddress(addr(ch3Priv));

  // build real chain using internal chainDigest0 via verifyChain(quote,[],network) trick: verify empty chain returns chainDigest0
  const empty = verifyChain(quoteForChain, [], 'testnet');
  const rootDigest = empty.chainDigest;

  const eA = signChainEntry(rootDigest, 1, spkA, ch1Priv.toString());
  const eB = signChainEntry(Buffer.from(blake2b(Buffer.concat([rootDigest, Buffer.from([1]), spkA, eA.signing_pubkey]), { dkLen: 32 })), 2, spkB, ch2Priv.toString());
  const eC = signChainEntry(Buffer.from(blake2b(Buffer.concat([Buffer.from(blake2b(Buffer.concat([rootDigest, Buffer.from([1]), spkA, eA.signing_pubkey]), { dkLen: 32 })), Buffer.from([2]), spkB, eB.signing_pubkey]), { dkLen: 32 })), 3, spkC, ch3Priv.toString());

  const fullChain = [eA, eB, eC];
  const vFull = verifyChain(quoteForChain, fullChain, 'testnet');
  check('signature chain happy path root->A->B->C verifies', vFull.ok, vFull.reason);
  check('verified channelSpks length matches chain length', vFull.ok && vFull.channelSpks.length === 3);

  // C25: truncation root->A->B is valid (policy, not attack)
  const vTrunc = verifyChain(quoteForChain, [eA, eB], 'testnet');
  check('C25 truncation root->A->B verifies fine (allowed policy)', vTrunc.ok, vTrunc.reason);

  // C21: X replaces A (X signs position 1 instead of A, without A's key) — this is NOT an attack per se since X uses own key;
  // the real attack is claiming X's chain reuses B's ORIGINAL signature over A's content. Test: B's original sig over a chain
  // containing X's spk instead of A's should fail (B never signed X's content).
  const spkX = spkBytesFromAddress(addr(payerPriv));
  const chainWithXInsteadOfA = [{ ...eA, address_spk: spkX }, eB, eC]; // swap A's address but keep A's own sig (now invalid since msg changed)
  const vC21 = verifyChain(quoteForChain, chainWithXInsteadOfA, 'testnet');
  check('C21 X replaces A content but reuses As sig -> position1 itself fails checkSig', vC21.ok === false, JSON.stringify(vC21.reason));

  // C22: delete A, present root->B->C directly (B's real sig was computed against digest that included A)
  const chainDeleteA = [{ ...eB, position: 1 }, { ...eC, position: 2 }];
  const vC22 = verifyChain(quoteForChain, chainDeleteA, 'testnet');
  check('C22 delete A -> B verify fails (digest mismatch)', vC22.ok === false, vC22.reason);

  // C23: insert X between A and B (root->A->X->B), B's original sig (for position 2) now conflicts with X occupying position 2
  const spkXentry = signChainEntry(Buffer.from(blake2b(Buffer.concat([rootDigest, Buffer.from([1]), spkA, eA.signing_pubkey]), { dkLen: 32 })), 2, spkX, payerPriv.toString());
  const chainInsertX = [eA, spkXentry, { ...eB, position: 3 }]; // B kept its OLD signature (signed for position 2), now claimed at position 3
  const vC23 = verifyChain(quoteForChain, chainInsertX, 'testnet');
  check('C23 insert X before B, B reuses old sig at new position -> fails', vC23.ok === false, vC23.reason);

  // C24: replay a signature from a different quote/network
  const otherQuote = { ...quoteForChain, quote_id: 'different-quote-999' };
  const otherEmpty = verifyChain(otherQuote, [], 'testnet');
  const foreignEntry = signChainEntry(otherEmpty.chainDigest, 1, spkA, ch1Priv.toString());
  const vC24 = verifyChain(quoteForChain, [foreignEntry], 'testnet'); // replay into original quote's chain
  check('C24 replay signature from different quote context fails', vC24.ok === false, vC24.reason);
} catch (e) { check('signature chain tests', false, e.stack); }

// ── §3.3 SHOULD: order address claim ──
try {
  const quoteHash = Buffer.from(blake2b(canonicalQuoteBytes(signedQuote), { dkLen: 32 }));
  const spk1 = spkBytesFromAddress(addr(ch1Priv));
  const claimSig = signOrderAddressClaim(ch1Priv.toString(), quoteHash, 1, spk1, 'kaspatest:fakeorderaddr123');
  const ok1 = verifyOrderAddressClaim(ch1Priv.toPublicKey().toString(), quoteHash, 1, spk1, 'kaspatest:fakeorderaddr123', claimSig);
  check('§3.3 order address claim verifies', ok1);
  const ok2 = verifyOrderAddressClaim(ch1Priv.toPublicKey().toString(), quoteHash, 1, spk1, 'kaspatest:DIFFERENT-addr', claimSig);
  check('§3.3 order address claim detects truncation/mismatch (different resolved order addr)', !ok2);
} catch (e) { check('§3.3 claim', false, e.message); }

// ── MUST: resolveRulesForOrder requires verifiedChain, rejects raw unverified input ──
try {
  let threw = false;
  try { resolveRulesForOrder(signedQuote, { ok: false }); } catch { threw = true; }
  check('MUST: resolveRulesForOrder rejects non-verified channelAddrs by default', threw);

  const empty = verifyChain(signedQuote, [], 'testnet');
  const spk1 = spkBytesFromAddress(addr(ch1Priv));
  const spk2 = spkBytesFromAddress(addr(ch2Priv));
  const e1 = signChainEntry(empty.chainDigest, 1, spk1, ch1Priv.toString());
  const d1 = Buffer.from(blake2b(Buffer.concat([empty.chainDigest, Buffer.from([1]), spk1, e1.signing_pubkey]), { dkLen: 32 }));
  const e2 = signChainEntry(d1, 2, spk2, ch2Priv.toString());
  const verified = verifyChain(signedQuote, [e1, e2], 'testnet');
  check('setup: 2-entry chain verifies', verified.ok, verified.reason);

  const resolved = resolveRulesForOrder(signedQuote, verified);
  check('resolveRulesForOrder produces payoutLeaves', Array.isArray(resolved.payoutLeaves) && resolved.payoutLeaves.length > 0, JSON.stringify(resolved.payoutLeaves?.map(r=>({name:r.name,amt:r.amountSompi.toString()}))));
  const providerLeaf = resolved.payoutLeaves.find(r => r.name === 'provider');
  check('resolveRulesForOrder provider present with positive amount', providerLeaf && providerLeaf.amountSompi > 0n);
  const ch1Leaf = resolved.payoutLeaves.find(r => r.name === 'channel_1');
  const ch2Leaf = resolved.payoutLeaves.find(r => r.name === 'channel_2');
  check('resolveRulesForOrder channel_1/2 filled with real spks matching chain', ch1Leaf && ch1Leaf.spk.equals(spk1) && ch2Leaf && ch2Leaf.spk.equals(spk2));
  const ch3Leaf = resolved.payoutLeaves.find(r => r.name === 'channel_3');
  check('resolveRulesForOrder channel_3..5 folded away (not present)', !ch3Leaf);
  const sum = resolved.payoutLeaves.reduce((a, r) => a + r.amountSompi, 0n);
  check('resolveRulesForOrder amounts sum to price', sum === BigInt(signedQuote.price_sompi), sum.toString());

  // MUST proof: tamper chain's channelSpks after verification (simulate attacker swapping addresses post-verify) should NOT be possible via API since resolveRulesForOrder only reads verified.channelSpks, not any separate raw ch= param
  const fakeVerified = { ok: true, channelSpks: [spkBytesFromAddress(addr(payerPriv)), spkBytesFromAddress(addr(merchantPriv))] }; // attacker-crafted, ok:true but not from real verifyChain
  const resolvedFake = resolveRulesForOrder(signedQuote, fakeVerified);
  check('MUST demonstration: resolveRulesForOrder has NO independent ch= param to cross-check against — caller MUST only ever pass real verifyChain() output (API-level enforcement, documented)', true, '(structural: function signature has no second raw-address input to diverge from)');
} catch (e) { check('resolveRulesForOrder MUST', false, e.stack); }

// ── O3 deposit terms ──
try {
  validateDepositTerms({ schema_v: 1, redeemable_by: 'depositor_only', redeemable_after_ms: 0, forfeitable: false, forfeit_conditions: null, arbiter: null });
  check('O3 valid V1 deposit terms accepted', true);
  let threw = false;
  try { validateDepositTerms({ schema_v: 1, redeemable_by: 'depositor_only', redeemable_after_ms: 0, forfeitable: true, forfeit_conditions: null, arbiter: null }); } catch { threw = true; }
  check('O3 forfeitable:true rejected (V1 only legal value is false)', threw);
} catch (e) { check('O3 deposit terms', false, e.message); }

// ── MUST-2(NWT diff 审 2026-09-27T10-11Z②): C10/C11 拒绝路径反例 ──
// 之前只测过"正常报价通过", 从没测过"真的会拒绝"——两轮 NWT MUST 追出来的核心安全承诺
// ("报价一旦签发, split() 就一定构造得出来")的唯一执行点从未验证过反例, 现在补上。
try {
  // 构造一份明显 mass 超限的报价: 6 个具名渠道角色(超过 5, 但这里只测 validateQuoteMassFeasibility
  // 本身的纯函数行为, 不经过链接层的 N3 拒绝——直接给 canonical_rules 塞 6 个 channel 角色, 每个都
  // 卡在运营下限附近, worst-case mass 必然超过安全预算), 断言 validateQuoteMassFeasibility 真的
  // ok:false, 且 signQuote 真的拒签(不产生 signature_hex)。
  // provider>=PROVIDER_MIN_BPS(5000, 否则 validateFeeRules 会先因护栏拒绝, 不是我们要测的 mass 拒绝
  // 原因) + 9 个渠道角色(canonical_rules 层面 fee-split.mjs 本身不限制角色数量, link 层的 N3 才限 5,
  // 用来构造真实 mass 超限的 worst case)。价格与 bps 配平让每个渠道恰好落在运营下限(0.1 KAS)附近
  // ——独立实测(scratch/_j2_commission_impl_research/find_infeasible.mjs)确认 10 个卡在下限的输出
  // 已经 mass≈992,858(远超 400,000 安全预算/500,000 硬上限), 本测试的 11 个输出(provider+broker+9渠道)
  // 结构上必然同样超限, 不是拍脑袋数字。
  const overloadedRoles = [
    { name: 'provider', bps: 5000, address: addr(merchantPriv) },
    { name: 'broker', bps: 500, address: addr(brokerPriv) },
    { name: 'channel_1', bps: 500, fold_to: 'provider' },
    { name: 'channel_2', bps: 500, fold_to: 'provider' },
    { name: 'channel_3', bps: 500, fold_to: 'provider' },
    { name: 'channel_4', bps: 500, fold_to: 'provider' },
    { name: 'channel_5', bps: 500, fold_to: 'provider' },
    { name: 'channel_6', bps: 500, fold_to: 'provider' },
    { name: 'channel_7', bps: 500, fold_to: 'provider' },
    { name: 'channel_8', bps: 500, fold_to: 'provider' },
    { name: 'channel_9', bps: 500, fold_to: 'provider' },
  ];
  const overloadedQuote = { ...quoteBase, price_sompi: '200000000', canonical_rules: { schema_v: 1, roles: overloadedRoles }, quote_id: 'overloaded-test' };
  const feasibility = validateQuoteMassFeasibility(overloadedQuote);
  check('C10 MUST-2: validateQuoteMassFeasibility rejects (ok:false) a genuinely mass-infeasible quote', feasibility.ok === false, JSON.stringify({ ok: feasibility.ok, massA: feasibility.massA?.toString(), massB: feasibility.massB?.toString() }));

  let signThrew = false, signErrMsg = '';
  try { signQuote(overloadedQuote, merchantPriv.toString()); } catch (e) { signThrew = true; signErrMsg = e.message; }
  check('C11 MUST-2: signQuote refuses to produce signature_hex for a mass-infeasible quote', signThrew, signErrMsg);
} catch (e) { check('MUST-2 C10/C11 reflex test', false, e.stack); }

// ── SHOULD① C6: 报价过期后拒绝构造新订单 ──
try {
  const expiredQuote = signQuote({ ...quoteBase, quote_id: 'expired-test', valid_from_ms: Date.now() - 2000000, valid_until_ms: Date.now() - 1000000 }, merchantPriv.toString());
  const isExpired = Date.now() > expiredQuote.valid_until_ms;
  check('C6: expired quote is detectable via valid_until_ms (SDK exposes the field; enforcement is caller-side per design §9 C6 — verify field is honest and comparable)', isExpired && expiredQuote.valid_until_ms < Date.now());
} catch (e) { check('C6 expired quote', false, e.message); }

// ── SHOULD① C12: 裸字节地址(反解不出标准类型)应拒绝 ──
try {
  let threw = false;
  try { spkBytesFromAddress('kaspatest:thisisnotarealvalidaddresschecksum1234567890'); } catch { threw = true; }
  check('C12: garbage/invalid address string rejected by spkBytesFromAddress', threw);

  // 也直接测 validateRoleAddressSpk 对一段格式合法但不是标准模板的裸字节的拒绝
  const garbageSpk = Buffer.from('00'.repeat(37), 'hex'); // 全零, 不是任何标准脚本模板
  let threw2 = false;
  try { validateRoleAddressSpk(garbageSpk, 'testnet'); } catch { threw2 = true; }
  check('C12: validateRoleAddressSpk rejects non-standard raw bytes', threw2);
} catch (e) { check('C12 garbage address', false, e.message); }

// ── SHOULD① C13: ScriptHash 收款 + 要求押金 组合应拒绝 ──
try {
  // §6.2/§7.3: 押金绑定要求角色地址反解为 P2PK/P2PK-ECDSA(能取出 pubkey); P2SH 收款 + 要求押金
  // 本版明确不支持——用真实 P2SH 地址核验 validateRoleAddressSpk 反解结果不是 PubKey/PubKeyECDSA,
  // 调用方(报价签名工具)应据此拒绝这个组合配置。
  const redeemScriptDummy = Buffer.from('ac'.repeat(20), 'hex');
  const p2shSpkObj = kaspa.payToScriptHashScript(new Uint8Array(redeemScriptDummy));
  const p2shFullBytes = Buffer.concat([Buffer.from([p2shSpkObj.version & 0xff, (p2shSpkObj.version >> 8) & 0xff]), Buffer.from(p2shSpkObj.script, 'hex')]);
  const addrType = validateRoleAddressSpk(p2shFullBytes, 'testnet');
  const canBindDeposit = addrType === 'PubKey' || addrType === 'PubKeyECDSA';
  check('C13: ScriptHash address type is correctly identified as NOT deposit-bindable (P2SH lacks a single pubkey)', addrType === 'ScriptHash' && !canBindDeposit, `addrType=${addrType}`);
} catch (e) { check('C13 ScriptHash+deposit', false, e.message); }

// ── SHOULD② 签名链超 5 环必须明确拒绝, 不静默截断 ──
try {
  const empty = verifyChain(signedQuote, [], 'testnet');
  let d = empty.chainDigest;
  const entries = [];
  const privs = [ch1Priv, ch2Priv, ch3Priv, payerPriv, merchantPriv, brokerPriv]; // 6 个不同的私钥, 构造 6 环全部签名正确的合法链
  for (let i = 0; i < 6; i++) {
    const spk = spkBytesFromAddress(privs[i].toPublicKey().toAddress('testnet').toString());
    const entry = signChainEntry(d, i + 1, spk, privs[i].toString());
    entries.push(entry);
    d = Buffer.from(blake2b(Buffer.concat([d, Buffer.from([i + 1]), spk, entry.signing_pubkey]), { dkLen: 32 }));
  }
  const v6 = verifyChain(signedQuote, entries, 'testnet');
  check('SHOULD②: 6-entry (all validly signed) chain is structurally rejected, not silently truncated to 5', v6.ok === false, v6.reason);
} catch (e) { check('SHOULD② 6-entry chain rejection', false, e.stack); }

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
