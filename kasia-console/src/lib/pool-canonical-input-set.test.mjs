// CIS 用例。**第一格就是 Codex 那个利用** —— 它是这份实现存在的理由。
import assert from 'node:assert';
import {
  sealCis, verifyCis, cisDigest, inputSetRoot, assertCisStructure, betLeaf,
  CIS_PROTOCOL, CIS_DOMAIN, CIS_SCHEMA_VERSION,
} from './pool-canonical-input-set.mjs';

const betLeafHexOf = (b) => betLeaf(b).toString('hex');
// 金标准向量: 由本实现产出并钉死。改动它们 = 改动跨实现的字节契约, 必须是有意的。
const GOLDEN_BET_LEAF = '734ea2149b433d91b24cb1bdc9a39411e59f6e031a0421528389a33de73c778b';
const GOLDEN_INPUT_SET_ROOT = 'blake2b256:088bda02deb2d3a79b3519e85e571681f57a02493cefad0a2b2c1d9a10676d6a';

let pass = 0; let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};
const hex = (n) => n.toString(16).padStart(64, '0');
const bet = (i, over = {}) => ({
  txid: hex(0x1000 + i), index: i, pk: hex(0x2000 + i), addr_commit: hex(0x3000 + i),
  stake: String(100 + i), direction: i % 2, lock_daa: String(70000000 + i), ...over,
});
const baseBody = (over = {}) => ({
  protocol: CIS_PROTOCOL, domain: CIS_DOMAIN, schema_version: CIS_SCHEMA_VERSION,
  network: 'testnet-12', genesis_hash: hex(0xabc), market_id: 'mkt-1',
  prior_state: { outpoint: `${hex(9)}:0`, version: '1' },
  bets: [bet(0), bet(1)],
  bets_excluded: [],
  other_inputs: [{ txid: hex(0x50), index: 0, role_code: 1, addr_commit: hex(0x60), value: '5000' }],
  outputs: [{ index: 0, role_code: 2, addr_commit: hex(0x70), value: '4900' }],
  output_layout_version: '1',
  order_rule: { by: 'lock_daa_asc', tiebreak: 'lock_tx_asc' },
  policy: { fee_bps: '30', dust: '600', bond: '0' },
  payout_root: `blake2b256:${hex(0xdd)}`,
  accounting: { total_in: '5200', total_out: '4900' },
  producer_pk: hex(0x80), nonce: '1', validity: { not_after: '99999999' },
  ...over,
});

// ── 🔴 头一格: Codex 主 RED 的那个利用 ──────────────────────────────────────
// 旧公式只 hash domain/policy/order_rule/prior_state + 三棵树根 ⇒ **排除集不进承诺**
// ⇒ 两个带不同 bets_excluded 的 CIS 算出同一个 root, 击穿"让隐藏排除可见且被绑"。
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
    network: 'testnet-11', market_id: 'mkt-2', output_layout_version: '2',
    payout_root: `blake2b256:${hex(0xde)}`, producer_pk: hex(0x81), nonce: '2',
  };
  for (const [k, v] of Object.entries(mutations)) {
    const m = sealCis(baseBody({ [k]: v }));
    assert.notStrictEqual(m.cis_digest, base.cis_digest, `改 ${k} 后 cis_digest 没变 ⇒ 它没被绑`);
  }
  // accounting / validity 是嵌套对象, 单列
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
  const lying = { ...c, bets: [bet(0), bet(1), bet(2)] };   // 加一笔注但不动 root
  const r = verifyCis(lying);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /input_set_root/, `理由应指向 root 重算不符, 实际: ${r.reason}`);
});

t('自引用集 S 穷举: cis_digest 自己不进 body', () => {
  const c = sealCis(baseBody());
  // 把 cis_digest 换成别的值后重算, 应得到同一个 digest(因为它被排除在 body 外)
  const d1 = cisDigest({ ...c, cis_digest: `blake2b256:${hex(1)}` });
  const d2 = cisDigest({ ...c, cis_digest: `blake2b256:${hex(2)}` });
  assert.strictEqual(d1, d2, 'cis_digest 必须被排除在自己的 body 之外');
  assert.strictEqual(d1, c.cis_digest);
});

t('正常对象 verify 通过', () => { assert.strictEqual(verifyCis(sealCis(baseBody())).ok, true); });

// ── 结构闸 ─────────────────────────────────────────────────────────────────
t('未知键即拒(不静默剥除)', () => {
  const c = sealCis(baseBody());
  assert.throws(() => assertCisStructure({ ...c, surprise: 1 }), /多 \[surprise\]/);
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
  assert.throws(() => sealCis(baseBody({ bets: [bet(0, { stake: 100 })] })), /十进制字符串/);
});
t('大数不许前导零', () => {
  assert.throws(() => sealCis(baseBody({ bets: [bet(0, { stake: '0100' })] })), /十进制字符串/);
});
t('摘要字段必须带算法标识', () => {
  assert.throws(() => assertCisStructure({ ...sealCis(baseBody()), payout_root: hex(0xdd) }), /blake2b256:/);
});

// ── 数组序即语义序 ──────────────────────────────────────────────────────────
t('bets 顺序不同 ⇒ 两个承诺都不同(canonicalJson 不重排数组)', () => {
  const a = sealCis(baseBody({ bets: [bet(0), bet(1)] }));
  const b = sealCis(baseBody({ bets: [bet(1), bet(0)] }));
  assert.notStrictEqual(a.input_set_root, b.input_set_root, '位置感知 merkle 必须对顺序敏感');
  assert.notStrictEqual(a.cis_digest, b.cis_digest);
});


// ── 变异测试揪出的四个缺口(读代码看不出来, 用例全绿而守卫已被拆) ─────────────
t('只篡改 cis_digest(root 保持正确) ⇒ verify 必须拒', () => {
  const c = sealCis(baseBody());
  const r = verifyCis({ ...c, cis_digest: `blake2b256:${hex(0xbeef)}` });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /cis_digest/, `理由应指向 cis_digest, 实际: ${r.reason}`);
});

// 🔴 lock_daa 是【排序键】。设计 §2.0 点名过 v0.7 的洞: "排序键本身不在叶子里 ⇒ 排序输入未被承诺"。
//    这一格就是钉住"我没有把那个洞复制过来"。
t('只改 bets[].lock_daa ⇒ input_set_root 必须变(排序键进了叶子)', () => {
  const a = sealCis(baseBody({ bets: [bet(0, { lock_daa: '70000000' }), bet(1)] }));
  const b = sealCis(baseBody({ bets: [bet(0, { lock_daa: '70000001' }), bet(1)] }));
  assert.notStrictEqual(a.input_set_root, b.input_set_root, 'lock_daa 没进叶子 ⇒ 排序输入未被承诺');
});

// 🔴 LP(长度前缀)只在变长拼接时必需, 而【域标签是变长的】。丢掉 LP 的既有反例在册:
//    computeCommitteePkHash 是裸 concat, 它今天安全只因输入恰好定宽、函数里没有任何校验。
//    这两格用金标准向量钉死字节 —— 丢 LP 会改变前像 ⇒ 向量不符 ⇒ 自己红。
t('金标准向量: bet 叶子(丢 LP 域标签会红)', () => {
  const c = sealCis(baseBody());
  assert.strictEqual(betLeafHexOf(c.bets[0]), GOLDEN_BET_LEAF,
    'bet 叶子字节变了 —— 若这是有意改动, 连同跨实现参考一起更新');
});
t('金标准向量: input_set_root(归并处丢 LP 会红)', () => {
  assert.strictEqual(sealCis(baseBody()).input_set_root, GOLDEN_INPUT_SET_ROOT,
    'input_set_root 字节变了 —— 同上');
});

console.log('');
console.log(`result: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
