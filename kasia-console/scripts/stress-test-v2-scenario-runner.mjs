#!/usr/bin/env node
// stress-test-v2-scenario-runner.mjs — KI 65 Step 2 Phase 2.0 (NWT N19.243 Path A parallel ship)
//
// Scenario runner skeleton — does NOT invoke real-money. Plan + dry-run only.
// Phase 5 (= 24h 真跑) is where real wallets execute.
//
// Architecture:
//   1. RNG: seeded mulberry32 (= reproducible runs via STRESS_TEST_SEED)
//   2. 17 scenarios (Group A happy 6 + B stress 3 + C 0库存 3 + D production gap 5)
//   3. Each scenario: { id, group, description, dryRun() }
//   4. Runner: select scenario via seed RNG, execute dryRun(), collect result
//
// dryRun semantics: print intent + check pre-conditions WITHOUT real transfer.
// Phase 2.2 will replace stubs with real flow invocation.

import { sqlite } from '../src/db/client.js';

const SEED = parseInt(process.env.STRESS_TEST_SEED || String(Date.now()), 10);

// Seeded RNG (mulberry32 — fast, good distribution, reproducible)
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 17 scenario stubs (Phase 2.0 — descriptors only, Phase 2.2 fills dryRun + real flow)
const SCENARIOS = [
  // Group A — happy path (6)
  { id: 'A1', group: 'happy', desc: 'SELL 1 KAS 小单' },
  { id: 'A2', group: 'happy', desc: 'SELL 25 KAS 中单 (hedge trigger)' },
  { id: 'A3', group: 'happy', desc: 'SELL 100 KAS 大单 (multi-leg hedge)' },
  { id: 'A4', group: 'happy', desc: 'BUY 1 KAS 小单' },
  { id: 'A5', group: 'happy', desc: 'BUY 25 KAS 中单' },
  { id: 'A6', group: 'happy', desc: 'BUY 100 KAS 大单' },
  // Group B — stress path (3)
  { id: 'B1', group: 'stress', desc: '并发 3 user 同时不同 size' },
  { id: 'B2', group: 'stress', desc: 'timeout (30min 不付 → reopen verify)' },
  { id: 'B3', group: 'stress', desc: 'cancel mid-flight (fund release verify)' },
  // Group C — 0库存 broker path (Trader-B simplified mining pool template)
  { id: 'C1', group: 'simplified', desc: 'SELL via Trader-B 兼 broker+marketmaker' },
  { id: 'C2', group: 'simplified', desc: 'BUY via Trader-B 兼' },
  { id: 'C3', group: 'simplified', desc: 'MarketMaker-A template 真不参与 (verify isolation)' },
  // Group D — production gap (J2 #666 catch, 5)
  { id: 'D1', group: 'gap', desc: 'multi-chain race (user pay USDT BSC, broker primary ARB)' },
  { id: 'D2', group: 'gap', desc: 'auto-replenish trigger (KI 50-52)' },
  { id: 'D3', group: 'gap', desc: 'reputation gate fail (KI 12)' },
  { id: 'D4', group: 'gap', desc: 'cross-chain hedge failover (KI 42 F-1)' },
  { id: 'D5', group: 'gap', desc: 'stuck escrow surface (KI 63 type)' },
];

function loadStressRelays() {
  return sqlite.prepare(`
    SELECT id, name FROM relay_nodes
    WHERE name LIKE 'stress-%'
    ORDER BY name
  `).all();
}

// Phase 2.0 stub — Phase 2.2 will implement real dryRun per scenario.
async function executeScenarioStub(scenario, ctx) {
  const { rng, relays } = ctx;
  if (relays.length === 0) {
    return { ok: false, scenario: scenario.id, error: 'no stress relays found — run Phase 1A setup first' };
  }
  // Random select 1-3 relays for this scenario (= Phase 2.2 will tune per group)
  const relayCount = scenario.group === 'stress' ? 3 : 1;
  const selected = [];
  for (let i = 0; i < relayCount && i < relays.length; i++) {
    const idx = Math.floor(rng() * relays.length);
    selected.push(relays[idx]);
  }
  return {
    ok: true,
    scenario: scenario.id,
    group: scenario.group,
    desc: scenario.desc,
    selected_relays: selected.map(r => r.name),
    note: 'Phase 2.0 stub — Phase 2.2 will implement real dryRun + Phase 5 real-fire',
  };
}

// Phase 2.1 — pre-flight fold (reuse phase1-setup pattern, lighter check).
//   Verify Console alive + 10 stress relays exist + autoTaker config sane.
//   Returns { ok, checks } — abort if any fail BEFORE scenario fire.
async function preflightLite() {
  const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
  const checks = [];
  try {
    const r = await fetch(`${CONSOLE_URL}/api/admin/overview`);
    checks.push({ name: 'console_health', ok: r.ok });
    if (!r.ok) return { ok: false, checks };
  } catch (e) {
    checks.push({ name: 'console_health', ok: false, err: e.message });
    return { ok: false, checks };
  }
  const relays = loadStressRelays();
  checks.push({ name: 'stress_relays_count', ok: relays.length === 10, count: relays.length });
  if (relays.length !== 10) return { ok: false, checks };
  return { ok: true, checks };
}

// Phase 2.1 — scheduler: spaced scenario fire over a window.
//   Each scenario waits intervalMs between fires.
//   abort flag (= SIGINT / abort hook) stops loop cleanly + dumps pending state.
//   dryRun (default true) prevents any real-money side effect via scenario.dryRun().
//   Phase 2.2 will wire real per-scenario dryRun(); Phase 2.0 stub used here.
async function runScheduled({ scenarios, ctx, intervalMs, dryRun, abortRef }) {
  const results = [];
  for (let i = 0; i < scenarios.length; i++) {
    if (abortRef.aborted) {
      console.log(`[scheduler] ABORT signal — stopping at ${i}/${scenarios.length}`);
      break;
    }
    const s = scenarios[i];
    const start = Date.now();
    console.log(`[scheduler] [${i + 1}/${scenarios.length}] firing ${s.id} (dryRun=${dryRun})`);
    const r = await executeScenarioStub(s, ctx);
    r.dryRun = dryRun;
    r.fired_at = new Date(start).toISOString();
    results.push(r);
    console.log(`[scheduler]   → ${r.ok ? 'planned' : 'failed'}: ${(r.selected_relays || []).join(',') || r.error || ''}`);

    // Inter-scenario delay (= avoid Kaspa fee storm + RPC throttle).
    if (i < scenarios.length - 1) {
      const remaining = scenarios.length - i - 1;
      console.log(`[scheduler]   wait ${intervalMs}ms (${remaining} scenario(s) remaining)`);
      await new Promise(res => setTimeout(res, intervalMs));
    }
  }
  return results;
}

function setupAbortHandler() {
  const ref = { aborted: false };
  process.on('SIGINT', () => {
    if (ref.aborted) {
      console.log('[abort] forcing exit');
      process.exit(2);
    }
    console.log('[abort] SIGINT received — finishing current scenario then stopping (Ctrl+C again to force)');
    ref.aborted = true;
  });
  return ref;
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioFilter = args.find(a => a.startsWith('--scenario='))?.slice('--scenario='.length);
  const listOnly = args.includes('--list');
  // Phase 2.1 args:
  const dryRun = !args.includes('--no-dry-run');  // default TRUE (production safety)
  const intervalMs = parseInt(args.find(a => a.startsWith('--interval-ms='))?.slice('--interval-ms='.length) || '5000', 10);
  const useScheduler = args.includes('--scheduler');

  console.log(`[stress-runner] Phase 2.1 — seed=${SEED} dryRun=${dryRun} scheduler=${useScheduler} interval=${intervalMs}ms`);

  if (listOnly) {
    console.log('\n17 scenarios:');
    for (const s of SCENARIOS) {
      console.log(`  ${s.id.padEnd(3)} [${s.group.padEnd(11)}] ${s.desc}`);
    }
    return;
  }

  // Phase 2.1 — pre-flight check (= 跑前 verify, abort if fail).
  console.log('[stress-runner] pre-flight check...');
  const pre = await preflightLite();
  for (const c of pre.checks) {
    console.log(`  [${c.ok ? '✓' : '✗'}] ${c.name}` + (c.count != null ? ` count=${c.count}` : '') + (c.err ? ` err=${c.err}` : ''));
  }
  if (!pre.ok) {
    console.error('[stress-runner] ABORT — pre-flight fail');
    process.exit(1);
  }

  const relays = loadStressRelays();
  const rng = makeRng(SEED);
  const ctx = { rng, relays };

  const toRun = scenarioFilter ? SCENARIOS.filter(s => s.id === scenarioFilter) : SCENARIOS;
  if (toRun.length === 0) {
    console.error(`[stress-runner] ABORT — no scenarios matched filter '${scenarioFilter}'`);
    process.exit(1);
  }

  if (!dryRun) {
    console.warn('[stress-runner] ⚠ dryRun=false — real-money side effects WOULD trigger in Phase 2.2+ (currently stub mode no-op)');
  }

  let results;
  if (useScheduler) {
    console.log(`[stress-runner] scheduler mode — ${toRun.length} scenarios, ${intervalMs}ms inter-fire delay`);
    const abortRef = setupAbortHandler();
    results = await runScheduled({ scenarios: toRun, ctx, intervalMs, dryRun, abortRef });
  } else {
    console.log(`[stress-runner] burst mode — ${toRun.length} scenarios back-to-back`);
    results = [];
    for (const s of toRun) {
      const r = await executeScenarioStub(s, ctx);
      r.dryRun = dryRun;
      console.log(`[${r.ok ? '✓' : '✗'}] ${s.id} ${s.desc}`);
      if (r.selected_relays) console.log(`    → relays: ${r.selected_relays.join(', ')}`);
      results.push(r);
    }
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n[stress-runner] Phase 2.1 ${useScheduler ? 'scheduled' : 'burst'}: ${passed}/${results.length} scenarios planned (dryRun=${dryRun})`);
  console.log('[stress-runner] Phase 2.2 will fill real dryRun per scenario. Phase 5 = 24h real-money execute.');
}

main().catch(e => { console.error(e); process.exit(1); });
