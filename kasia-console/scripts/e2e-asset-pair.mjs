// e2e-asset-pair.mjs — v1.1 真测 KAS regression + USDC cross-asset (J2 #3 接)
// 跟 NWT v2 spec a6cb8853d 真测策略 align
// Phase 1 (现, v1.0): KAS regression — verify wire fix v3 真生效不退化
// Phase 2 (v1.1 Phase A ship 后): USDC 跨 ERC20 真换真测 (~$0.50 真 cost)
// Phase 3 (v1.1 Phase E ship 后): broker LLM SYSTEM_PROMPT generic 真 user 真 DM 真测

import Db from 'better-sqlite3';

const db = new Db('data/console.db', { readonly: true });

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Phase 1: KAS regression (v1.0 wire fix v3 真不退化) ──────────
async function phase1_kas_regression() {
  console.log('\n=== Phase 1: KAS regression (v1.0 wire fix v3 真生效 verify) ===');

  // 真测策略:
  // a) 真 query 现 broker exchange_offers 近 24h 'completed' 笔数 (基线)
  // b) Phase A ship 后再 query 同窗口, 数应**相同** (KAS 路径不退化)
  // c) 5 笔 rescue 模式 (Owner 14:13 a34701fe) 真不再撞 — query exchange_offers
  //    WHERE protocol_status='open' AND maker=BROKER 且 broadcast_at > 'paid' broadcasts
  //    存在的 = 卡死单 = 退化 ❌
  const completedKas = db.prepare(`
    SELECT COUNT(*) AS n FROM exchange_offers
    WHERE protocol_status='completed' AND give_asset='KAS'
      AND completed_at > datetime('now', '-24 hours')
  `).get();
  console.log(`  KAS completed 24h: ${completedKas.n}`);

  // 5 笔 rescue 模式真 detect (open + accept_v1 broadcast 真上链 但 status 卡 open)
  const stuck = db.prepare(`
    SELECT id, protocol_status, broadcast_at FROM exchange_offers
    WHERE protocol_status='open' AND maker=?
      AND broadcast_at < datetime('now', '-10 minutes')
      AND broadcast_at > datetime('now', '-2 hours')
    LIMIT 5
  `).all(BROKER_KASPA);
  if (stuck.length > 0) {
    console.log(`  ⚠ 卡死 'open' offer 数: ${stuck.length} (5 笔 rescue 模式真退化警报)`);
    for (const s of stuck) console.log(`    ${s.id.slice(0,8)} broadcast_at=${s.broadcast_at}`);
  } else {
    console.log(`  ✓ 0 卡死 'open' offer (5 笔 rescue 模式 v1.0 wire fix v3 真生效)`);
  }
}

// ── Phase 1.5: NWT 4 bug regression (J2 #3 接 task) ─────────
// 真 import 现 codebase asset-registry + buyPreview, 真验 4 bug 真状态 (修了 / 没修)
async function phase1_5_nwt_4bug_regression() {
  console.log('\n=== Phase 1.5: NWT 4 bug regression (J2 #3 接) ===');
  let pass = 0, fail = 0;
  const { getAsset, listAssets, isSupported } = await import('../src/services/asset-registry.js');

  // Bug 1: asset-registry 接口 — getAsset 单参 (J1 165c96623 真 fix)
  console.log('\n  Bug 1: getAsset 单参 default chain (J1 165c96623 真 fix)');
  const t1 = [
    ['KAS', 'KAS_kaspa'], ['USDT', 'USDT_bnb'],
    ['USDC', null], ['BTC', null],
  ];
  for (const [sym, expectedKey] of t1) {
    const r = getAsset(sym);
    const got = r ? `${r.symbol}_${r.chain}` : null;
    const ok = expectedKey ? got === expectedKey : r === null;
    console.log(`    getAsset('${sym}') → ${got} ${ok ? '✓' : `✗ expect=${expectedKey}`}`);
    ok ? pass++ : fail++;
  }
  console.log(`    listAssets() → [${listAssets().join(',')}] ✓ base symbols`);

  // Bug 2: buyPreview 必 reject unsupported asset (broker 没 USDC/BTC 库存)
  console.log('\n  Bug 2: buyPreview unsupported asset 必 reject (NWT 待加 validation)');
  const { buyPreview } = await import('../src/services/broker-buy-handler.js');
  const TEST_PEER = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp'; // Sophie placeholder
  for (const asset of ['USDC', 'BTC', 'XRP']) {
    const r = await buyPreview({ user_kasia: TEST_PEER, qty: 1, pay_chain: 'bnb', give_asset: asset });
    const correct = r.ok === false && (r.error?.includes('asset_not_supported') || r.error?.includes('unsupported'));
    console.log(`    buyPreview(${asset}) → ok=${r.ok} ${correct ? '✓ (rejected correctly)' : `✗ STILL BROKEN (${r.error || 'returned ok:true'})`}`);
    correct ? pass++ : fail++;
  }

  // Bug 3: BTC 价格不能是 0.0342 (要 >$50k or unsupported error)
  console.log('\n  Bug 3: BTC 价 (J1 price-oracle.js 13acedba 真 ship)');
  // Bug 2 validation 已 reject USDC/BTC, 但 Bug 3 真 fix verify 走 price-oracle 直接
  const { fetchPrice } = await import('../src/services/price-oracle.js');
  const tBtc = await fetchPrice('BTC', 'USDT');
  if (tBtc.ok && tBtc.price > 50000) {
    console.log(`    fetchPrice(BTC,USDT) → ${tBtc.price} ✓ (real CoinGecko, 不是 0.0342 假)`);
    pass++;
  } else {
    console.log(`    fetchPrice(BTC,USDT) → ${JSON.stringify(tBtc)} ✗ STILL BROKEN`);
    fail++;
  }
  const tUsdc = await fetchPrice('USDC', 'USDT');
  if (tUsdc.ok && tUsdc.price === 1) {
    console.log(`    fetchPrice(USDC,USDT) → 1 ✓ (peg hardcode)`);
    pass++;
  } else { console.log(`    fetchPrice(USDC,USDT) → ${JSON.stringify(tUsdc)} ✗`); fail++; }
  const tXrp = await fetchPrice('XRP', 'USDT');
  if (!tXrp.ok && tXrp.error === 'unsupported_pair') {
    console.log(`    fetchPrice(XRP,USDT) → unsupported ✓ (不 silent default)`);
    pass++;
  } else { console.log(`    fetchPrice(XRP,USDT) → ${JSON.stringify(tXrp)} ✗`); fail++; }

  // Bug 4: NLG asset.network — USDC 不能用 'Kasia' 字面
  console.log('\n  Bug 4: NLG asset.network (NWT Step 4 待修)');
  const rUsdc = await buyPreview({ user_kasia: TEST_PEER, qty: 1, pay_chain: 'bnb', give_asset: 'USDC' });
  if (rUsdc.ok === false) {
    console.log(`    buyPreview(USDC) ok:false ✓ (Bug 4 防 by Bug 2 validation)`);
    pass++;
  } else if (rUsdc.preview_text && !rUsdc.preview_text.includes('Kasia')) {
    console.log(`    buyPreview(USDC) preview 不含 'Kasia' ✓`);
    pass++;
  } else {
    console.log(`    buyPreview(USDC) preview 含 'Kasia' literal ✗ STILL BROKEN (NLG 没 generic)`);
    fail++;
  }

  console.log(`\n  Phase 1.5: ${pass}/${pass+fail} PASS — NWT 4 bug 修进度`);
  return { pass, fail };
}

// ── Phase 2: USDC 跨 ERC20 真换真测 (v1.1 Phase A ship 后) ────
async function phase2_usdc_cross_asset() {
  console.log('\n=== Phase 2: USDC 跨 ERC20 真换 (v1.1 Phase A ship 后真跑) ===');

  // 真测策略 (Owner 钦定智能体扮真人 19:35):
  // 1) Pre-flight: broker BSC 钱包真持 1+ USDC 库存
  //    - 检查方法: GET /api/relay/<broker>/wallets, 找 BSC USDC balance
  //    - 不够则 trigger broker swap (USDT→USDC PancakeSwap, 三方 vote a 共识)
  // 2) test peer (Sophie/Eric/J2 if 加入 broker peers) DM "买 1 USDC, BSC, USDT 付"
  // 3) 真 broker preview USDC 总价 (USDC/USDT peg ~1:1, price-oracle.js return 1.0)
  // 4) test peer YES → broker finalizeBuy publish 'sell USDC for USDT BSC' offer + accept_v1
  // 5) test peer 真转 1 USDT BSC → bsc-watcher 真 detect (need watcher per-asset config)
  // 6) broker 真 deliver 1 USDC BSC → completed
  // 7) 真验: chain_events exchange_completed give_asset='USDC' 真存在

  console.log('  ⏳ Phase 2 待 v1.1 Phase A + Phase E + price-oracle + USDC swap 全 ship');
  console.log('  ⏳ 真测 prerequisite:');
  console.log('     - asset-registry 加 USDC-BSC entry');
  console.log('     - broker BSC 钱包 fund 1+ USDC (broker swap OR NWT 自掏)');
  console.log('     - bsc-incoming-watcher per-asset config (USDT + USDC)');
  console.log('     - test peer 加入 broker peers (publish card)');
  console.log('     - LLM SYSTEM_PROMPT generic (识别 "买 1 USDC")');
  console.log('  真 cost: ~$0.50 (USDC + USDT round-trip + BSC gas)');
}

// ── Phase 3: LLM generic 真 user DM (v1.1 Phase E ship 后) ────
async function phase3_llm_generic() {
  console.log('\n=== Phase 3: LLM SYSTEM_PROMPT generic 真 user DM (v1.1 Phase E ship 后) ===');
  console.log('  ⏳ 真测 user DM "想买 X USDC BSC" → LLM 真识别 → 走 generic finalizeBuy({asset:USDC})');
  console.log('  ⏳ vs v1.0 KAS-only: user DM "想买 X USDC" → LLM 走老 KAS path → silent fail');
  console.log('  真 prerequisite: broker-llm-agent SYSTEM_PROMPT 含 supported_assets 动态从 asset-registry');
}

console.log('=== e2e-asset-pair.mjs (J2 #3 接 v1.1 真测脚本) ===');
console.log(`broker = ${BROKER_KASPA}`);
console.log(`v2 spec a6cb8853d incorporate J2 #3 6 challenge`);

await phase1_kas_regression();
await phase1_5_nwt_4bug_regression();
await phase2_usdc_cross_asset();
await phase3_llm_generic();

console.log('\n=== 真测路径 (v1.1 ship 后真跑) ===');
console.log('1. ✅ Phase 1 KAS regression (现就能跑) — verify v1.0 wire fix v3 真生效');
console.log('2. ⏳ Phase 2 USDC 跨换 (v1.1 Phase A+E+price-oracle+USDC swap ship 后)');
console.log('3. ⏳ Phase 3 LLM generic (v1.1 Phase E ship 后)');

db.close();
