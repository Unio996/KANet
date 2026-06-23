// 门C 档1 攻击样本 harness — DoD① prevet 收窄 bypass (NWT-tn red-team)
// 实打 LIVE :3200 /api/pool/prevet-extract。J2 ship 题型 gate + 部署后重跑出 verdict。
// 用法: node scripts/gateC-d1-prevet-redteam.mjs  (Console :3200 须 up)
const BASE = process.env.PREVET_BASE || 'http://127.0.0.1:3200';
const post = async (body) => {
  try {
    const r = await fetch(`${BASE}/api/pool/prevet-extract`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    return { code: r.status, j: await r.json().catch(() => ({})) };
  } catch (e) { return { code: 0, j: { error: e.message } }; }
};
const results = { pass: 0, fail: 0, gap: 0, rows: [] };
const A = (name, cond, detail, isGap = false) => {
  const v = isGap ? 'GAP' : (cond ? 'PASS' : 'FAIL');
  if (isGap) results.gap++; else if (cond) results.pass++; else results.fail++;
  results.rows.push(`${v} | ${name} | ${detail}`);
};

(async () => {
  // ── A1: findExtractor host-anchor (源/URL 边界 — 已 live PASS 期望) ──
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401815659';
  const CG = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
  const legit = [['legit-ESPN', ESPN], ['legit-CoinGecko', CG]];
  const spoof = [
    ['spoof-path', 'https://nonexist-xyz.invalid/site.api.espn.com/x'],
    ['spoof-query', 'https://nonexist-xyz.invalid/?ref=site.api.espn.com'],
    ['spoof-subdomain', 'https://site.api.espn.com.nonexist-xyz.invalid/x'],
    ['spoof-userinfo', 'https://site.api.espn.com@nonexist-xyz.invalid/x'],
    ['ssrf-localhost', 'http://127.0.0.1:9999/site.api.espn.com'],
    ['ssrf-metadata', 'http://169.254.169.254/site.api.espn.com'],
    ['ssrf-ipv6', 'http://[::1]/site.api.espn.com'],
    ['ssrf-internal', 'http://192.168.1.1/api.coingecko.com'],
    ['prefix-xespn', 'https://xespn.com/x'],
    ['dash-spoof', 'https://espn-com.nonexist.invalid/x'],
    ['suffix-evil', 'https://espn.com.nonexist-xyz.invalid/x'],
    ['http-scheme', 'http://site.api.espn.com/x'],
  ];
  for (const [n, u] of legit) {
    const r = await post({ data_source_canonical: u });
    A(`A1.${n}`, r.j.kind === 'espn' || r.j.kind === 'coingecko', `verdict=${r.j.verdict} kind=${r.j.kind || '-'} (期望 match)`);
  }
  for (const [n, u] of spoof) {
    const r = await post({ data_source_canonical: u });
    // 修后期望: spoof/ssrf → no_extractor (无 kind=espn/coingecko)。kind 命中 = 漏(脆)
    A(`A1.${n}`, r.j.verdict === 'no_extractor' || (r.j.kind !== 'espn' && r.j.kind !== 'coingecko'), `verdict=${r.j.verdict} kind=${r.j.kind || '-'} (期望 no_extractor)`);
  }

  // ── A2: 伪结构化源 / 畸形 JSON shape (extractor 返 null → abstain, 非瞎判) ──
  // 注: 需可达且返畸形 JSON 的源才能直打; 此处记为关2 fixture 项 (mock 源)。
  results.rows.push('NOTE | A2 伪结构化/畸形 shape | 需 mock 源 (关2 fixture), 关1 trace: extractor JSON.parse 失败/字段缺 → null → ABSTAIN (extractEspnEvidence L28-50)');

  // ── A3: 题型 gate (直接字段 vs 复杂推理) — 待 J2 ship ──
  // 现 diagnoseSource 只 source 维度无题型维度 → 复杂推理题仍过 = gap。
  // 题型 gate 实现前, 此组全 GAP (J2 认领未 ship)。
  A('A3.推理题 gate', false, '题型维度未实现 (diagnoseSource verdict 无题型档): "赢>3分" 复杂推理题仍过 LLM 推理步 = 注入面 (NWT r22-A-2)。待 J2 ship 后改 critical 拒。', true);

  // ── 输出 ──
  console.log('=== 门C 档1 prevet bypass harness ===');
  for (const r of results.rows) console.log(r);
  console.log(`\nSUMMARY: PASS=${results.pass} FAIL=${results.fail} GAP(待ship)=${results.gap}`);
  console.log(results.fail === 0 ? '① 源/URL 边界面: 现 PASS (题型 gate 待 J2 ship 后补)' : '⚠ 有 FAIL — 见上');
})();
