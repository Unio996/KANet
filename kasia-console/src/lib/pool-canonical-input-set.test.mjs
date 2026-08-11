// CIS 用例。**第一格就是 Codex 那个利用** —— 它是这份实现存在的理由。
//
// 🔴 夹具形状照 precond6 v0.2.1 §2.1 字段表【逐字段】对过, 不是我编的:
//    bets[]        = {outpoint:{txid,index}, bettor_pk, address_commitment, direction, stake_sompi, lock_daa}
//    other_inputs[]= {outpoint:{txid,index}, role, value_sompi, address_commitment}
//    outputs[]     = {index, role, address_commitment, value_sompi}
//    prior_state   = {outpoint:{txid,index}, script_pubkey_digest, value_sompi, state_digest}
//    (第一版我把它们写成了扁平的 {txid,index,pk,...} —— 那是我自己编的, 与设计对不上;
//     用例当时全绿, 因为它们钉的是我的发明。⇒ **用例绿不代表实现符合规格。**)
import assert from 'node:assert';
import {
  sealCis, verifyCis, cisDigest, assertCisStructure, betLeaf,
  CIS_PROTOCOL, CIS_DOMAIN, CIS_SCHEMA_VERSION, ROLE_CODES_RATIFIED, assertRoleCodesRatified,
} from './pool-canonical-input-set.mjs';

const betLeafHexOf = (b) => betLeaf(b).toString('hex');
// 金标准向量: 由本实现产出并钉死。改动它们 = 改动跨实现的字节契约, 必须是有意的。
//
// 🔴 一个必须写下来的近失: 形状改对之后, **bet 叶子的字节一个都没变**(还是 734ea2…)——
//    我编错的是【属性名】, 喂进 concat 的字节序列碰巧一模一样。
//    ⇒ 金标准向量【挡不住这类错】。挡住它的是 outpointOf() 那道结构闸, 不是这两行。
//    (input_set_root 变了, 变的是 other_inputs/outputs 那两棵 —— role 现在走 role_code 一字节。)
const GOLDEN_BET_LEAF = '734ea2149b433d91b24cb1bdc9a39411e59f6e031a0421528389a33de73c778b';
const GOLDEN_INPUT_SET_ROOT = 'blake2b256:54d21129df750b30009e3f8d90aa504196871c1dd239922043f43ac90c8a5a3f';

let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};
const hex = (n) => n.toString(16).padStart(64, '0');
const bet = (i, over = {}) => ({
  outpoint: { txid: hex(0x1000 + i), index: i },
  bettor_pk: hex(0x2000 + i), address_commitment: hex(0x3000 + i),
  direction: i % 2, stake_sompi: String(100 + i), lock_daa: String(70000000 + i), ...over,
});
const baseBody = (over = {}) => ({
  protocol: CIS_PROTOCOL, domain: CIS_DOMAIN, schema_version: CIS_SCHEMA_VERSION,
  network: 'testnet-12', genesis_hash: hex(0xabc), market_id: 'mkt-1',
  market_state_version: '3',
  prior_state: {
    outpoint: { txid: hex(9), index: 0 }, script_pubkey_digest: hex(0x11),
    value_sompi: '5200', state_digest: hex(0x12),
  },
  bets: [bet(0), bet(1)],
  bets_excluded: [],
  bets_root_legacy: null,
  other_inputs: [{ outpoint: { txid: hex(0x50), index: 0 }, role: 'maker_stake', value_sompi: '5000', address_commitment: hex(0x60) }],
  outputs: [{ index: 0, role: 'winner', address_commitment: hex(0x70), value_sompi: '4900' }],
  output_layout_version: '1',
  order_rule: { by: 'lock_daa_asc', tiebreak: 'lock_tx_asc' },
  policy: { fee_bps: '30', dust: '600', bond: '0' },
  payout_root: `blake2b256:${hex(0xdd)}`,
  accounting: { total_in: '5200', total_out: '4900' },
  producer_pk: hex(0x80), nonce: '1', validity: { not_after: '99999999' },
  ...over,
});

// ── 🔴 头一格: Codex 主 RED 的那个利用 ──────────────────────────────────────
t('🔴 Codex 利用: 只改 bets_excluded, 授权承诺必须改变', () => {
  const a = sealCis(baseBody({ bets_excluded: [] }));
  const b = sealCis(baseBody({ bets_excluded: [{ txid: hex(0x99), index: 3, reason: 'no-utxo' }] }));
  assert.notStrictEqual(a.cis_digest, b.cis_digest, 'cis_digest 必须不同 —— 否则隐藏排除可以不被察觉');
  // 而派生索引【确实】相同 —— 这正是为什么它不能当授权承诺。这一行把那个理由钉在用例里。
  assert.strictEqual(a.input_set_root, b.input_set_root,
    'input_set_root 对排除集不敏感(事实如此), 所以它只能是索引, 不能是授权承诺');
});

t('每个被绑字段: 改它 cis_digest 必变', () => {
  const base = sealCis(baseBody());
  const mutations = {
    network: 'testnet-11', market_id: 'mkt-2', market_state_version: '4',
    output_layout_version: '2', payout_root: `blake2b256:${hex(0xde)}`,
    producer_pk: hex(0x81), nonce: '2',
  };
  for (const [k, v] of Object.entries(mutations)) {
    assert.notStrictEqual(sealCis(baseBody({ [k]: v })).cis_digest, base.cis_digest, `改 ${k} 后 cis_digest 没变 ⇒ 它没被绑`);
  }
  assert.notStrictEqual(sealCis(baseBody({ accounting: { total_in: '5201', total_out: '4900' } })).cis_digest, base.cis_digest);
  assert.notStrictEqual(sealCis(baseBody({ validity: { not_after: '88888888' } })).cis_digest, base.cis_digest);
});

t('input_set_root 被 cis_digest 传递绑定: 换不掉', () => {
  const c = sealCis(baseBody());
  const tampered = { ...c, input_set_root: `blake2b256:${hex(0xbad)}` };
  assert.notStrictEqual(cisDigest(tampered), c.cis_digest, '改 input_set_root 必须改 cis_digest');
  assert.strictEqual(verifyCis(tampered).ok, false, '改了 root 必须 verify 失败');
});

t('input_set_root 撒不了谎: 数组改了而 root 没改 ⇒ 拒', () => {
  const c = sealCis(baseBody());
  const r = verifyCis({ ...c, bets: [bet(0), bet(1), bet(2)] });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /input_set_root/, `理由应指向 root 重算不符, 实际: ${r.reason}`);
});

t('只篡改 cis_digest(root 保持正确) ⇒ verify 必须拒', () => {
  const c = sealCis(baseBody());
  const r = verifyCis({ ...c, cis_digest: `blake2b256:${hex(0xbeef)}` });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /cis_digest/, `理由应指向 cis_digest, 实际: ${r.reason}`);
});

t('自引用集 S 穷举: cis_digest 自己不进 body', () => {
  const c = sealCis(baseBody());
  const d1 = cisDigest({ ...c, cis_digest: `blake2b256:${hex(1)}` });
  const d2 = cisDigest({ ...c, cis_digest: `blake2b256:${hex(2)}` });
  assert.strictEqual(d1, d2, 'cis_digest 必须被排除在自己的 body 之外');
  assert.strictEqual(d1, c.cis_digest);
});

t('正常对象 verify 通过', () => { assert.strictEqual(verifyCis(sealCis(baseBody())).ok, true); });

// ── 🔴 bets_root_legacy: 设计写死「两个都算、两个都比」 ──────────────────────
// 链上已烤的 hash-chain(CloseZkV2.sil:18)与 CIS 的集合承诺【并存不合并】——
// 只比其中一个就等于放掉另一半。
t('bets_root_legacy 对不上 ⇒ 拒', () => {
  const c = sealCis(baseBody({ bets_root_legacy: hex(0xfeed) }));
  const r = verifyCis(c);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /bets_root_legacy/, `理由应指向 legacy 重算不符, 实际: ${r.reason}`);
});
t('bets_root_legacy = null 表示不针对已烤市场 ⇒ 放行', () => {
  assert.strictEqual(verifyCis(sealCis(baseBody({ bets_root_legacy: null }))).ok, true);
});

// ── 结构闸 ─────────────────────────────────────────────────────────────────
t('未知键即拒(不静默剥除)', () => {
  assert.throws(() => assertCisStructure({ ...sealCis(baseBody()), surprise: 1 }), /多 \[surprise\]/);
});
t('缺键即拒', () => {
  const c = sealCis(baseBody()); delete c.nonce;
  assert.throws(() => assertCisStructure(c), /缺 \[nonce\]/);
});
t('schema_version 不匹配即拒, 不降级', () => {
  assert.throws(() => assertCisStructure({ ...sealCis(baseBody()), schema_version: 2 }), /不做兼容降级/);
});
t('hex 大小写混用视为非法而非归一化', () => {
  assert.throws(() => sealCis(baseBody({ genesis_hash: hex(0xabc).toUpperCase() })), /全小写 hex/);
});
t('大数必须十进制字符串, 不收 number', () => {
  assert.throws(() => sealCis(baseBody({ bets: [bet(0, { stake_sompi: 100 })] })), /十进制字符串/);
});
t('大数不许前导零', () => {
  assert.throws(() => sealCis(baseBody({ bets: [bet(0, { stake_sompi: '0100' })] })), /十进制字符串/);
});
t('摘要字段必须带算法标识', () => {
  assert.throws(() => assertCisStructure({ ...sealCis(baseBody()), payout_root: hex(0xdd) }), /blake2b256:/);
});

// ── outpoint 与 role: 设计写死"地址是类型, outpoint 才是那一个" ──────────────
t('outpoint 必须恰好 {txid,index}, 多一个键即拒', () => {
  assert.throws(() => sealCis(baseBody({ bets: [bet(0, { outpoint: { txid: hex(1), index: 0, extra: 1 } })] })), /恰好 \{txid,index\}/);
});
t('outpoint 扁平写法(旧的我编错那种)即拒', () => {
  assert.throws(() => sealCis(baseBody({ bets: [{ txid: hex(1), index: 0, bettor_pk: hex(2), address_commitment: hex(3), direction: 0, stake_sompi: '1', lock_daa: '1' }] })), /outpoint/);
});
t('不认识的 role 即拒(不静默当 0)', () => {
  assert.throws(() => sealCis(baseBody({ outputs: [{ index: 0, role: 'mystery', address_commitment: hex(0x70), value_sompi: '1' }] })), /role 不认识/);
});
t('不同 role ⇒ 不同 input_set_root', () => {
  const a = sealCis(baseBody({ outputs: [{ index: 0, role: 'winner', address_commitment: hex(0x70), value_sompi: '4900' }] }));
  const b = sealCis(baseBody({ outputs: [{ index: 0, role: 'maker_fee', address_commitment: hex(0x70), value_sompi: '4900' }] }));
  assert.notStrictEqual(a.input_set_root, b.input_set_root);
});
// 🔴 outpoint 进叶子是为了挡 commingled-spine 攻击族(本仓实数: 49 组、最大一组 97 个)
t('只改 bets[].outpoint ⇒ input_set_root 必须变', () => {
  const a = sealCis(baseBody({ bets: [bet(0), bet(1)] }));
  const b = sealCis(baseBody({ bets: [bet(0, { outpoint: { txid: hex(0x1000), index: 7 } }), bet(1)] }));
  assert.notStrictEqual(a.input_set_root, b.input_set_root, 'outpoint 没进叶子 ⇒ 挡不住 commingled-spine');
});

// ── 数组序即语义序 ──────────────────────────────────────────────────────────
t('bets 顺序不同 ⇒ 两个承诺都不同(canonicalJson 不重排数组)', () => {
  const a = sealCis(baseBody({ bets: [bet(0), bet(1)] }));
  const b = sealCis(baseBody({ bets: [bet(1), bet(0)] }));
  assert.notStrictEqual(a.input_set_root, b.input_set_root, '位置感知 merkle 必须对顺序敏感');
  assert.notStrictEqual(a.cis_digest, b.cis_digest);
});

// 🔴 lock_daa 是【排序键】。设计 §2.0 点名过 v0.7 的洞: "排序键本身不在叶子里 ⇒ 排序输入未被承诺"。
t('只改 bets[].lock_daa ⇒ input_set_root 必须变(排序键进了叶子)', () => {
  const a = sealCis(baseBody({ bets: [bet(0, { lock_daa: '70000000' }), bet(1)] }));
  const b = sealCis(baseBody({ bets: [bet(0, { lock_daa: '70000001' }), bet(1)] }));
  assert.notStrictEqual(a.input_set_root, b.input_set_root, 'lock_daa 没进叶子 ⇒ 排序输入未被承诺');
});

// 🔴 LP 只在变长拼接时必需, 而域标签是变长的。金标准向量钉死字节 —— 丢 LP 会改前像 ⇒ 自己红。
t('金标准向量: bet 叶子(丢 LP 域标签会红)', () => {
  assert.strictEqual(betLeafHexOf(sealCis(baseBody()).bets[0]), GOLDEN_BET_LEAF,
    'bet 叶子字节变了 —— 若这是有意改动, 连同跨实现参考一起更新');
});
t('金标准向量: input_set_root(归并处丢 LP 会红)', () => {
  assert.strictEqual(sealCis(baseBody()).input_set_root, GOLDEN_INPUT_SET_ROOT, 'input_set_root 字节变了 —— 同上');
});

// ── role_code 未裁定标记(NWT 2026-08-11 复审 note)──────────────────────────
// 🔴 这三格守的是【状态被程序读得到】, 不是「有守卫了」。库拦不住不肯配合的调用方,
//    真正的闸在签名边界(D-012 ②)。名字里不写"守卫"两个字, 免得下一个人读大一档。
t('未裁定标记为 false(裁定前它必须是假的)', () => {
  assert.strictEqual(ROLE_CODES_RATIFIED, false, '若这格红了: 要么已裁定(那就同时把表搬回设计稿), 要么有人擅自翻了它');
});
t('assertRoleCodesRatified 在未裁定时必抛', () => {
  assert.throws(() => assertRoleCodesRatified('测试调用点'), /尚未裁定/);
});
t('抛出的话里必须点出【是哪个调用点】(否则报错等于没报)', () => {
  assert.throws(() => assertRoleCodesRatified('some-signing-path'), /some-signing-path/);
});

console.log('');
console.log(`result: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
