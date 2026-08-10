// D-012 冻结前置④ —— 「handler 级测试: 七场景各自零签名调用」(J2, 2026-08-09)
//
// 前置④ 原文(`docs/DECISIONS.md` 六条前置之④):
//   「handler 级测试: RPC 错 / 缺输入 / 多输入 / 陈旧 outpoint / 坏金额 / 超量输出 / payout 篡改
//     **各自零签名调用**」
//
// 🔴🔴 本用例今天【应该是红的】, 而红法本身就是交付物:
//   `handlePoolOracleTxSignReq` 今天对 `phase2_tx_obj` 的形状/outpoint/金额/输出数量**零校验**
//   (2026-08-09 实核: `outputTotalSompi`/`inputTotalSompi`/`MIN_OUTPUT_RATIO`/`isCommingledSpine`
//    全文件 0 命中; `:554` 的 SELECT 逐字 `SELECT id, protocol_status, metadata` — 连 `spine_lock_tx`
//    都没取出来, 结构上无从比对 outpoint)。
//   ⇒ **六条阴性场景今天会签** ⇒ 本用例给出的是【当前缺口的实测量】, 不是"测试没写好"。
//   ⇒ 那个数正是 Owner 决定「要不要把 PB-S8-2 的闸接进 handler」时该看的证据。
//   🔴 **接闸 = 让生产真拒签 = 钱路行为改变 = Owner 闸**(Bettor 2026-08-08 10:42 裁定)。
//      ④ 与 PB-S8-2 激活是**同一个闸**, 不是两件事。本文件不接闸, 只测量。
//
// 🔴🔴 为什么必须用假 relay sink —— 它是本用例【非平凡】的必要条件, 不是方便:
//   没有 sink 时, handler 走到 `sendCommandAsync(oracle.id,{type:'sign_input_for_settle'})`
//   ⇒ 无 relay ⇒ reject ⇒ handler 自己 catch(`:676` `sign IPC fail`)
//   ⇒ **调用【发生了】但失败** ⇒ "零签名调用"**根本不可观测** —— 闸在与不在读数完全一样。
//   **这就是 precond6 设计稿 §0 说的那堵「离线恒真」墙的确切机制。**
//   有 sink 时: 调用会成功并被逐条留痕 ⇒ "零次"变成一个**能被证伪**的读数。
//   🔨 而它必须配阳性对照: 一个【该签的】场景必须记到**恰好 spine_input_count 次** ——
//      否则"零次"仍可能是【根本没跑到签名循环】, 与【闸拦住了】读数相同。
//
// 🔴 本用例【不覆盖】第七场景 `payout 篡改`, 如实写在这里而不是藏在断言里:
//   保持毛额不变、只在胜方之间重分配的篡改, **候选 B 的三个锚点结构上看不见**
//   (@J1 precond6 v0.2 §4 已判并移出候选 B: ①管 spine 身份 ②管毛额 ③管输出数量形状,
//    没有一个看逐方分配)。⇒ 写成"能过"就只能靠断言别的东西 = 在册假绿第②种。
//   **处置(该场景归候选 A 全量重算)仍待 @Bettor/@NWT 裁, 本文件不自裁。**
//
// 【怎么跑】
//   cd D:/kanet-tn12/kasia-console
//   set DB_PATH=…\test-framework\data\test-console.db   (KANET_DB_PATH 同)
//   set KASPA_RPC_URL=ws://127.0.0.1:9
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/precond4_handler_zero_sign_calls.test.mjs

import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import fs0 from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TF_ROOT = path.resolve(HERE, '../../..');
const FIXTURE_DIR = path.join(TF_ROOT, 'fixtures', 'fake-relay-sink');
const EXPECTED_DB_DIR = path.join(TF_ROOT, 'data');

const SENTINEL = randomUUID();
const RELAY_NAME = 'p4-fake-' + randomUUID().slice(0, 8);
// handler 用 IPC 问来的 x_only_pubkey 去 committee_pks 里找自己 ⇒ 两边必须是同一个值(且小写)
const ORACLE_XONLY = randomBytes(32).toString('hex');
const SPINE_TX = randomBytes(32).toString('hex');
const OTHER_TX = randomBytes(32).toString('hex');
const SPINE_INPUT_COUNT = 1;

// ── ③-a 隔离守卫: 断言而非设置, 且在任何生产模块 import 之前(理由同 ⑤(d), 见该文件头) ──
function isolationFailure() {
  const underTestDir = (raw) => {
    if (!raw) return false;
    const r = path.resolve(raw);
    return r === EXPECTED_DB_DIR || r.startsWith(EXPECTED_DB_DIR + path.sep);
  };
  for (const v of ['DB_PATH', 'KANET_DB_PATH']) {
    if (!underTestDir(process.env[v])) return `${v}=${JSON.stringify(process.env[v] || null)} 未落在 ${EXPECTED_DB_DIR} 下`;
  }
  const raw = process.env.KASPA_RPC_URL;
  try {
    const u = new URL(String(raw));
    if (!((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && (u.port === '9' || u.port === '1'))) {
      return `KASPA_RPC_URL=${JSON.stringify(raw)} 不是哨兵(不可达)地址`;
    }
  } catch { return `KASPA_RPC_URL=${JSON.stringify(raw || null)} 解析不出`; }
  return null;
}
const guardFail = isolationFailure();

// ── 七场景(第七条显式不覆盖)+ 一条阳性对照 ────────────────────────────────────
//  每条只改 phase2_tx_obj 的一处, 其余前置全部相同 ⇒ 读数差异只能来自被测的那一处。
// 🔴 底样 = 本机真实 phase2_tx_obj(fixtures/phase2-tx-sample/), 只把 txid 换成合成值。
//    理由(实撞四次才服): 逐字段合成交易形状是在跟序列化器猜谜 —— 缺 version / scriptPublicKey
//    是对象不是串 / input 缺 utxo …… 每次都在【闸之前】抛, 而那会让六条阴性因为【序列化失败】
//    显示 0 次签名 = 与【闸拦住了】读数完全相同的假绿。⇒ 用真结构当底, 每场景只改被测的那一处。
const BASE_TX = JSON.parse(fs0.readFileSync(path.join(TF_ROOT, 'fixtures/phase2-tx-sample/phase2_tx_obj.sample.json'), 'utf8'));
const deep = (o) => JSON.parse(JSON.stringify(o));
const withSpine = (txid) => { const t = deep(BASE_TX);
  t.inputs[0].previousOutpoint.transactionId = txid;
  if (t.inputs[0].utxo?.entry?.outpoint) t.inputs[0].utxo.entry.outpoint.transactionId = txid;
  return t; };
const mkOutFrom = (t, n, each) => { const proto = t.outputs[0]; t.outputs = Array.from({ length: n }, () => { const o = deep(proto); o.value = String(each); return o; }); return t; };
const SCENARIOS = [
  { id: 'P_control_wellformed_SHOULD_sign', expectSignCalls: SPINE_INPUT_COUNT,
    why: '阳性对照: 形状合法且 outpoint 对得上 ⇒ 必须记到恰好 spine_input_count 次, 证明尺子看得见签名调用',
    tx: () => withSpine(SPINE_TX) },
  { id: 'N1_rpc_unavailable', expectSignCalls: 0,
    why: '链上值取不到(§1.1 建模成【值】)⇒ cannot-verify ⇒ 不签',
    tx: () => { const t = withSpine(SPINE_TX); t.__chainValueUnavailable = true; return t; } },
  { id: 'N2_missing_input', expectSignCalls: 0, why: '缺输入',
    tx: () => { const t = withSpine(SPINE_TX); t.inputs = []; return t; } },
  { id: 'N3_extra_inputs', expectSignCalls: 0, why: '多输入(兄弟市场 UTXO 塞进 inputs[1])',
    tx: () => { const t = withSpine(SPINE_TX); t.inputs.push(deep(withSpine(OTHER_TX).inputs[0])); return t; } },
  { id: 'N4_stale_outpoint', expectSignCalls: 0, why: '陈旧/跨市场 outpoint',
    tx: () => withSpine(OTHER_TX) },
  { id: 'N5_bad_amount', expectSignCalls: 0, why: '坏金额(输出总额 >> 输入总额)',
    tx: () => mkOutFrom(withSpine(SPINE_TX), 3, 999999999999) },
  { id: 'N6_excess_outputs', expectSignCalls: 0, why: '超量输出(> 启发式上界 64+10)',
    tx: () => mkOutFrom(withSpine(SPINE_TX), 80, 10) },
  // N7 payout 篡改 —— 见文件头: 候选 B 结构上看不见, 显式不覆盖, 不写成"能过"
];

const sqlLit = (s) => String(s).replace(/'/g, "''");
const MARKET = (i) => `__p4_${i}__`;

let bootstrap = { stage: 'skipped-by-guard', detail: guardFail || '' };
const observed = [];   // { id, signCalls, expect, pass }

if (!guardFail) {
  try {
    // ✅ 认领(Bettor 2026-08-09 17:10 授权 · 档2): **本用例故意在模块体设 env** —— 假 relay 必须在
    //    任何生产模块 import 之前就位(同 p5_positive_via_fake_relay_sink 的理由)。
    //    ⇒ `scripts/test.mjs` 的**导入期 env 哨每次都会点名本文件**, 那是【预期】, **不是污染 bug**。
    //    档1(真污染: 非 case 文件改 DB_PATH 等隔离键)已于同日修掉; 本文件属档2, 保留。
    process.env.RELAY_DIR = FIXTURE_DIR;
    process.env.FAKE_SINK_SENTINEL = SENTINEL;
    process.env.FAKE_SINK_XONLY_PUBKEY = ORACLE_XONLY;   // handler 经 IPC 问公钥, 必须落在 committee_pks 里
    process.env.FAKE_SINK_IDLE_EXIT_MS = '120000';
    // 🔴 必须在 startRelay【之前】设: 子进程的 env 在 fork 那一刻就冻住了, 之后改父进程 env
    //    对它毫无影响。实撞过一次 —— 我原本在逐场景循环里改它, 结果 sink 一条也没记,
    //    阳性对照当场红(而那正是阳性对照该干的事: 它挡住了一份"六条阴性全 0"的假绿)。
    //    ⇒ 单一日志路径 + 每场景前截断; fixture 每次 appendFileSync 重开文件, 截断安全。
    process.env.FAKE_SINK_LOG = path.join(EXPECTED_DB_DIR, `p4-sink-${RELAY_NAME}.jsonl`);
    if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    if (!process.env.KASPA_NETWORK) process.env.KASPA_NETWORK = 'testnet-12';

    bootstrap.stage = 'seeding';
    const { createRelayNode } = await import('../../../../src/data/settings/relay-nodes.js');
    const relayId = createRelayNode({
      name: RELAY_NAME, privkey: 'p4-throwaway-' + randomUUID(),
      // 🔴 每次运行唯一: 固定字面量会与上一次失败跑留下的行撞 relay_nodes.address 唯一约束
      //    (实撞过一次)。而"上一次跑失败"恰恰是最需要能重跑的时候。
      address: 'kaspatest:qp4fake' + RELAY_NAME.replace(/[^a-z0-9]/g, '') + '0'.repeat(20),
      network: process.env.KASPA_NETWORK,
    });
    // ── 起假 sink(白名单裁定 Bettor 2026-08-09 18:09 = 选项1, NWT 加条目) ──
    //  🔴 startRelay().ok === true 【不是】起来了的证据(g4-pilot:62-65: spawn 失败是 fork 之后的
    //     异步事件, 追不上那个 return)。判据在下面的哨兵/计数, 不在这个返回值。
    bootstrap.stage = 'startRelay';
    const { startRelay } = await import('../../../../src/services/relay-manager.js');
    const startRes = await startRelay(relayId);

    // ── 逐场景: 种子 → 驱动真 handler → 数 sink 记到几次 sign_input_for_settle ──
    const fs = await import('node:fs');
    const { handlePoolOracleTxSignReq } = await import('../../../../src/services/trade-protocol-filter.js');
    const { sqlite } = await import('../../../../src/db/client.js');
    const now = new Date().toISOString();

    for (const sc of SCENARIOS) {
      const mid = MARKET(sc.id);
      const logPath = process.env.FAKE_SINK_LOG;   // fork 前已定, 不可改(见上)
      try { fs.writeFileSync(logPath, ''); } catch { /* 截断即可 */ }

      const txObj = sc.tx();   // 补全交易形状(见 SCENARIOS 上方注释)
      // 前置九步(逐行核自 trade-protocol-filter.js:541-670), 各场景【只差 tx_obj 那一处】
      sqlite.prepare('DELETE FROM pool_markets WHERE id = ?').run(mid);
      sqlite.prepare('DELETE FROM pool_committee WHERE market_id = ?').run(mid);
      sqlite.prepare("DELETE FROM chain_events WHERE json_extract(payload,'$.market_id') = ?").run(mid);
      sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, spine_lock_tx,
                        market_metadata_hash, deadline, protocol_status, protocol_version, metadata, maker_stake_amount)
                      VALUES (?,?,?,?,'abcd',1700000000,'collecting_sigs','v0.7',?, '10000000000')`)
        .run(mid, relayId, 'kaspatest:spine_' + mid, SPINE_TX, JSON.stringify({ phase2_tx_obj: txObj }));
      // pool_committee 六列 NOT NULL(PRAGMA 实读): handler 只读 committee_pks, 其余填形状合法的占位
      sqlite.prepare(`INSERT INTO pool_committee (market_id, committee_relay_ids, committee_pks,
                        committee_pk_hash, vrf_seed, vrf_proof, threshold, sampled_at)
                      VALUES (?,?,?,?,?,?,4,?)`)
        .run(mid, JSON.stringify([relayId]), JSON.stringify([ORACLE_XONLY]),
             '00'.repeat(32), '00'.repeat(32), '00'.repeat(32), now);
      sqlite.prepare(`INSERT INTO chain_events (txid, event_type, payload, observed_by, observed_at)
                      VALUES (?, 'pool_oracle_vote', ?, 'p4-harness', ?)`)
        .run('p4vote-' + sc.id, JSON.stringify({ market_id: mid, voter_pubkey: ORACLE_XONLY, outcome: 'YES' }), now);
      sqlite.prepare('UPDATE relay_nodes SET is_oracle = 1 WHERE id = ?').run(relayId);

      try {
        await handlePoolOracleTxSignReq({
          market_id: mid, winner: 0, input_count: 1, spine_input_count: SPINE_INPUT_COUNT,
          phase2_tx_obj: txObj,
        });
      } catch (e) { /* handler 自身抛错也算一种"没签", 由计数说话 */ }

      let signCalls = 0;
      try {
        for (const line of String(fs.readFileSync(logPath, 'utf8')).trim().split('\n')) {
          if (!line) continue;
          if (JSON.parse(line)?.type === 'sign_input_for_settle') signCalls++;
        }
      } catch { signCalls = 0; }   // 无日志 = sink 一次也没被打到 = 0 次
      observed.push({ id: sc.id, signCalls, expect: sc.expectSignCalls, pass: signCalls === sc.expectSignCalls, why: sc.why });
    }
    bootstrap = { stage: 'done', detail: 'startRelay=' + JSON.stringify(startRes), relayId };
  } catch (e) {
    bootstrap = { stage: 'threw', detail: String(e && e.message).slice(0, 300) };
  }
}

const control = observed.find((o) => o.id === 'P_control_wellformed_SHOULD_sign');
const negatives = observed.filter((o) => o.id !== 'P_control_wellformed_SHOULD_sign');
const negFail = negatives.filter((o) => !o.pass);
const gapSummary = observed.length === 0
  ? '🔴 未跑到任何场景'
  : (negFail.length === 0 ? `ALL_${negatives.length}_NEGATIVE_SCENARIOS_ZERO_SIGN`
     : `🔴 ${negFail.length}/${negatives.length} 条阴性场景【仍被签名】(= 缺口实测量): `
       + negFail.map((o) => `${o.id}=${o.signCalls}次`).join(' · '));

export default {
  id: 'precond4_handler_zero_sign_calls',
  title: '前置④: handler 七场景各自零签名调用(假 sink 计数 · 今天应红 = 缺口实测量)',
  tags: ['predictions', 'pool', 'd012-precond4'],
  skip_in_batch: true,   // 同 ⑤(d): 模块加载期改 env, 会污染同批其它用例
  steps: [
    { id: 'G0_isolation_guard', action: 'query_db',
      sql: `SELECT '${guardFail ? sqlLit('🔴 隔离守卫失败: ' + guardFail) : 'ISOLATION_OK'}' AS state`,
      expect: { must: { row_assert: { state_contains: 'ISOLATION_OK' } } } },
    { id: 'G1_bootstrap', action: 'query_db',
      sql: `SELECT '${sqlLit(['seeded','done'].includes(bootstrap.stage) ? 'BOOTSTRAP_OK' : '🔴 bootstrap ' + bootstrap.stage + ': ' + bootstrap.detail)}' AS state`,
      expect: { must: { row_assert: { state_contains: 'BOOTSTRAP_OK' } } } },
    // 🔴 阳性对照【必须排在阴性汇总之前】: 它不绿, 后面所有"零次"都可能是【根本没跑到】。
    { id: 'C0_control_arm_sink_sees_signatures', action: 'query_db',
      sql: `SELECT '${sqlLit(control
              ? (control.pass
                  ? `CONTROL_OK(阳性对照记到 ${control.signCalls} 次 = 期望 ${control.expect})`
                  : `🔴 阳性对照失败: 记到 ${control.signCalls} 次, 期望 ${control.expect} —— 这把尺子看不见签名调用, 下面的"零次"一律不作数`)
              : '🔴 阳性对照没跑到: bootstrap.stage=' + bootstrap.stage + ' ' + String(bootstrap.detail).slice(0, 140))}' AS state`,
      expect: { must: { row_assert: { state_contains: 'CONTROL_OK' } } } },

    // ④ 命题本体: 六条阴性场景各自零签名调用。
    //  🔴 今天预期为红 —— 红里那个数就是【当前缺口的实测量】, 交给 Owner 做激活决策用。
    { id: 'P4_all_negative_scenarios_zero_sign_calls', action: 'query_db',
      sql: `SELECT '${sqlLit(gapSummary)}' AS state`,
      expect: { must: { row_assert: { state_contains: `ALL_${SCENARIOS.length - 1}_NEGATIVE_SCENARIOS_ZERO_SIGN` } } } },

    // 收尾(幂等)
    ...SCENARIOS.map((sc, i) => ({ id: `td_mkt_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${MARKET(sc.id)}'` })),
    ...SCENARIOS.map((sc, i) => ({ id: `td_comm_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_committee WHERE market_id = '${MARKET(sc.id)}'` })),
    { id: 'td_relay', action: 'exec_sql', sql: `DELETE FROM relay_nodes WHERE name = '${sqlLit(RELAY_NAME)}'` },
    { id: 'td_identity', action: 'exec_sql', sql: `DELETE FROM identities WHERE display_name = '${sqlLit(RELAY_NAME)}'` },
  ],
};
