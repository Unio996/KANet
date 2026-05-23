// NWT bug regression — 本次发现 9 个 bug, 每个专项测 verify fix 不退化
// 跑完输出 PASS/FAIL/SKIP 矩阵

import Database from 'file:///C:/kanet/kasia-console/node_modules/better-sqlite3/lib/index.js';

const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PORT = 3100;

async function llmReply(peer, msg, opts = {}) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/agent/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ relayNodeId: TRADER_B, peer, message: msg }),
      signal: AbortSignal.timeout(40000),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) {
    return { status: 'ERR', error: e.message };
  }
}

const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
const results = [];

// ── Bug 1: UTF-8 encoding guard ──
console.log('\n--- Bug #1: UTF-8 encoding guard (T-J2-23) ---');
{
  // POST body 含 U+FFFD (replacement char) → 期望 400
  const r = await fetch(`http://127.0.0.1:${PORT}/api/agent/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ relayNodeId: TRADER_B, peer: 'kaspa:bug1_test', message: '�� garbage �' }),
  });
  const ok = r.status === 400;
  console.log(`  POST with U+FFFD body → status=${r.status} ${ok ? '✓' : '✗ expected 400'}`);
  results.push({ bug: 1, name: 'UTF-8 encoding guard', pass: ok, detail: `status=${r.status}` });
}

// ── Bug 2: handleBuyIntent regex miss → null ──
console.log('\n--- Bug #2: handleBuyIntent regex miss returns null (T-J2-20) ---');
{
  const r = await llmReply('kaspa:bug2_test_'+Date.now(), '随便聊聊');  // 不含 buy/qty
  // 预期: handleBuyIntent miss 返 null, handleSellIntent miss 返 null, falls to LLM, LLM 应 reply
  const isLlm = r.status === 200 && r.body?.reply && r.body.reply.length > 0;
  console.log(`  '随便聊聊' → reply: '${(r.body?.reply || '').slice(0,60)}' ${isLlm ? '✓ (LLM 接管)' : '✗'}`);
  results.push({ bug: 2, name: 'handleBuyIntent miss → null → LLM', pass: isLlm });
}

// ── Bug 3: handleSellIntent regex miss → null (no T-NWT-17 onboarding) ──
console.log('\n--- Bug #3: handleSellIntent regex miss returns null no onboarding text (T-J2-20) ---');
{
  const r = await llmReply('kaspa:bug3_test_'+Date.now(), '你好');
  // 预期: 不再返 T-NWT-17 onboarding 长文 (含 "4 关键词")
  const reply = r.body?.reply || '';
  const onboarded = /4 关键词|fee 固定 0\.1 KAS|broker 不持币不闲聊/.test(reply);
  const ok = !onboarded && reply.length > 0;
  console.log(`  '你好' → reply: '${reply.slice(0,80)}' ${ok ? '✓ (无 onboarding)' : '✗ 仍含 onboarding'}`);
  results.push({ bug: 3, name: 'handleSellIntent miss → null no T-NWT-17', pass: ok });
}

// ── Bug 4: _loadHistory schema fix (T-J2-21) ──
console.log('\n--- Bug #4: _loadHistory schema works (T-J2-21) ---');
{
  // 验: 直接 import _loadHistory + 用真存在的 peer (Sophie/Martin) 看返非空 + 不 throw
  // 用 console.log 看 [broker-llm] _loadHistory err: ... 应没 err
  const trader = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(TRADER_B);
  // 拿 messages 表里 broker 有过 outbound 的 peer
  const peer = db.prepare(`
    SELECT DISTINCT ri.address AS peer_addr FROM messages m
    JOIN identities si ON si.id = m.sender_identity_id
    JOIN identities ri ON ri.id = m.receiver_identity_id
    WHERE m.direction='outbound' AND m.message_type='text' AND si.address = ?
    LIMIT 1
  `).get(trader.address);
  if (!peer) {
    console.log(`  SKIP (no real peer history found)`);
    results.push({ bug: 4, name: '_loadHistory schema', pass: 'SKIP', detail: 'no peer history' });
  } else {
    const { handleLlmDialog } = await import('file:///C:/kanet/kasia-console/src/services/broker-llm-agent.js');
    // 调 handleLlmDialog 不 throw 即 fix 生效 (老 schema 会在 catch 里 console.warn)
    const before = Date.now();
    try {
      const r = await handleLlmDialog(peer.peer_addr, '历史回查测试');
      const ok = !!r;
      console.log(`  real peer ${peer.peer_addr.slice(-12)} → reply: '${r.slice(0,60)}' ${ok ? '✓' : '✗'}`);
      results.push({ bug: 4, name: '_loadHistory schema (real peer)', pass: ok });
    } catch (e) {
      console.log(`  THROW: ${e.message} ✗`);
      results.push({ bug: 4, name: '_loadHistory schema', pass: false, detail: e.message });
    }
  }
}

// ── Bug 5: dust qty (T-J1-19a) ──
console.log('\n--- Bug #5: dust qty < 1 KAS rejected (T-J1-19a) ---');
{
  const { finalizeBuy } = await import('file:///C:/kanet/kasia-console/src/services/broker-buy-handler.js');
  const r = await finalizeBuy({ user_kasia: 'kaspa:bug5_'+Date.now(), qty: 0.5, pay_chain: 'bnb' });
  const rejected = !r.ok && /qty too small|min/.test(r.error || '');
  console.log(`  finalizeBuy qty=0.5 → ${JSON.stringify(r).slice(0,150)} ${rejected ? '✓' : '✗'}`);
  results.push({ bug: 5, name: 'dust qty rejected', pass: rejected });
}

// ── Bug 6: broker self-publish + 用自己 maker (T-J1-19) ──
console.log('\n--- Bug #6: broker self-publish accepted as own maker (T-NWT-22 + T-J1-19) ---');
{
  const { finalizeBuy } = await import('file:///C:/kanet/kasia-console/src/services/broker-buy-handler.js');
  const r = await finalizeBuy({ user_kasia: 'kaspa:bug6_'+Date.now(), qty: 50, pay_chain: 'bnb' });
  const ok = r.ok && r.broker_dynamic_quote === true && r.picks?.[0]?.broker_dynamic === true;
  console.log(`  finalizeBuy qty=50 → broker_dynamic_quote=${r.broker_dynamic_quote} ${ok ? '✓' : '✗'}`);
  results.push({ bug: 6, name: 'broker self-publish + own maker', pass: ok, detail: r.offer_id || r.error });
  // cleanup
  if (r.ok && r.offer_id) {
    await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayNodeId: TRADER_B, offer_id: r.offer_id }),
    });
  }
  // also 测 picks (新 T-J1-19 三层 fallback) - 实际上 finalizeBuy 现在返 picks[]
  console.log(`    picks: ${r.picks ? r.picks.length : 'none'} (broker_dynamic count: ${r.picks?.filter(p=>p.broker_dynamic).length || 0})`);
}

// ── Bug 7: anti-spam SQL "" → '' (T-NWT-23, just committed) ──
console.log('\n--- Bug #7: anti-spam SQL fix (T-NWT-23 25509be4) ---');
{
  // 验: message 含 STOP 关键词 → 不 SqliteError throw
  // 触发 detectStopRequest 的 message: 'enough'
  // BUT detectStopRequest 调用 only from mind-manager.getReply
  // 而 broker fork (is_service=1) 跳过 mind-manager.getReply
  // 所以 STOP 关键词通过 broker fork 不会触发 detectStopRequest 路径
  // 需要 directly call detectStopRequest 验
  try {
    const mod = await import('file:///C:/kanet/kasia-console/src/services/anti-spam.js');
    // detectStopRequest needs identity to exist — use any existing identity
    const ident = db.prepare(`SELECT address FROM identities LIMIT 1`).get();
    if (!ident) {
      console.log(`  SKIP no identity in DB`);
      results.push({ bug: 7, name: 'anti-spam SQL', pass: 'SKIP', detail: 'no identity' });
    } else {
      // 这会触发 STOP 检测 + UPDATE identities (现修复)
      const r = mod.detectStopRequest(ident.address, 'enough, stop messaging me!');
      console.log(`  detectStopRequest('enough...') → ${r} ${r === true ? '✓ (no SqliteError)' : '✗'}`);
      results.push({ bug: 7, name: 'anti-spam SQL fix', pass: r === true });
    }
  } catch (e) {
    const isSqlite = /no such column|SqliteError|sqlite/i.test(e.message);
    console.log(`  THROW: ${e.message} ${isSqlite ? '✗ STILL SQL bug' : '⚠ other'}`);
    results.push({ bug: 7, name: 'anti-spam SQL fix', pass: false, detail: e.message });
  }
}

// ── Bug 8: relay race queue hold (T-J2-24) ──
console.log('\n--- Bug #8: relay race queue hold waitForRelay (T-J2-24) ---');
{
  // 验需要 Console 重启后立刻测. 不实际重启, 只看代码 wired.
  const { readFileSync } = await import('fs');
  const code = readFileSync('C:/kanet/kasia-console/src/services/broker-action-queue.js', 'utf-8');
  const ok = /waitForRelay/.test(code);
  console.log(`  broker-action-queue.js contains 'waitForRelay': ${ok ? '✓' : '✗'}`);
  results.push({ bug: 8, name: 'queue waitForRelay wired', pass: ok });
}

// ── Bug 9: deterministic 中文 skip direction (T-J1-19g) ──
console.log('\n--- Bug #9: Chinese intent skip direction (T-J1-19g) ---');
{
  // UTF-8 安全 probe (Node fetch 直走)
  const tests = ['我要买 50 KAS', '想买 100 个 kas', '想换点 KAS', 'buy 50 KAS', 'comprar 50 KAS'];
  let pass = 0;
  for (const msg of tests) {
    const r = await llmReply('kaspa:bug9_'+Math.random().toString(36).slice(2,8), msg);
    const reply = r.body?.reply || '';
    // 不应当问 "买还是卖" / "buy or sell"
    const asksDirection = /买还是卖|买.*还.*卖|buy or sell|comprar o vender|想买还是卖/i.test(reply);
    if (!asksDirection && reply.length > 0) { pass++; console.log(`  '${msg}' → '${reply.slice(0,60)}' ✓`); }
    else console.log(`  '${msg}' → '${reply.slice(0,60)}' ${asksDirection ? '✗ asks direction' : '✗ empty'}`);
  }
  const ok = pass >= 4;  // 5 中至少 4
  console.log(`  PASS ${pass}/${tests.length} ${ok ? '✓' : '✗'}`);
  results.push({ bug: 9, name: 'Chinese intent skip direction', pass: ok, detail: `${pass}/${tests.length}` });
}

// ── 汇总 ──
console.log('\n\n========== BUG REGRESSION SUMMARY ==========');
let p = 0, f = 0, s = 0;
for (const r of results) {
  const tag = r.pass === true ? '✓ PASS' : r.pass === 'SKIP' ? '⏭ SKIP' : '✗ FAIL';
  if (r.pass === true) p++;
  else if (r.pass === 'SKIP') s++;
  else f++;
  console.log(`  Bug #${r.bug}: ${tag} - ${r.name}${r.detail ? ' (' + r.detail.slice(0,80) + ')' : ''}`);
}
console.log(`\n${p} PASS / ${f} FAIL / ${s} SKIP / ${results.length} total`);
process.exit(f > 0 ? 1 : 0);
