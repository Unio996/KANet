// 第一段验收 · default-deny probe 套 (b-2 本体 + 对照臂)
// 设计: docs/2026-07-28-seg1-default-deny-probe-design-v0.1.md (内容版本 v0.2, NWT 红队审已吸收)
// 红队 verdict: docs/2026-07-28-NWT-redteam-verdict-seg1-default-deny-probe-v0.1.md (GREEN-with-1-MUST-FIX + 4 note)
// batch: 第一段(能力清点与强制) · owner=J2 · diff 审=NWT
//
// 🔴 本文件【不是】第一段 (b) 的全部, 只是它的第一条。照设计 §4.4 照实说规模:
//   b-1(不存在的能力名) —— 【不在本用例集里】。它由 validateCommandPayload 拒, 早于闸,
//        不计入 default-deny 证据。只在报告正文里出现(见文末 REPORT_NOTES)。
//        理由(设计 §4.4): 一个绿着的、名字里带 default-deny 的用例, 迟早被人数进覆盖率。
//   b-2(已注册命令 + origin 缺失/非法) —— 本文件覆盖。这是本轮【唯一】真有内容的一条。
//   b-3(origin='app' + 凭证外意图) —— 🔴 未实现: 它依赖一份【还不存在】的 app 路径拒绝
//        reason_code 枚举(设计 §5①)。缺就是缺, 不给它编一个断言。
//
// 🔴 隔离: 全程跑 startArmedRelay 起的隔离 relay(死 RPC 端口 ws://127.0.0.1:1 · 不挂 console ·
//   throwaway 私钥零资金 · 独立 grant DB)。不碰 live relay、不碰 live 链、不碰生产库。
//
// 跑法(cwd=D:/kanet-tn12): node kasia-console/test-framework/cases/m0c1-gate/seg1-default-deny.mjs

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PROVISION = path.join(ROOT, 'kasia-console/scripts/m0c1-grant-provision.mjs');
const DB = path.join(ROOT, 'scratch/m0c1-seg1-default-deny.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const RELAY_ID = 'harness-relay-seg1';
const NETWORK = 'testnet-12';
const DUMMY_TARGET = 'kaspatest:qpseh8ah3vjm5jc38cq0xy219kvctlfmyz8k5zj7v0nfj2lldkjfqf4ppy0f7';

// ── 用例集 ──────────────────────────────────────────────────────────────────
// 🔴 b-2 用哪条命令(设计 §4.1 / NWT note-1): 指定 get_rpc_state。
//   不用 send_message/handshake —— 它们要先过【地址校验层】(relay.mjs, 在闸之前),
//   probe 会因为【与被测目标无关的理由】失败, 而下一个人最可能的"修法"是把断言放松,
//   那会把 phase 这道唯一判别力拆掉。
//
// 🔵 对照臂不必另找命令(设计 §4.1.1, Bettor 复核 NWT 建议时核出): 同一条命令换一个 origin 即可。
//   authorize.mjs:118 READONLY_ALLOWLIST 的判断在 authorizeAppCommand() 函数体内 ⇒ 只有
//   origin==='app' 才走得到; origin 缺失/非法在 :110 就 fail-closed 拒, 永远到不了白名单。
//   ⇒ 两臂【被测对象完全相同】, 排除了"两条命令走的路本来就不同"这个混淆。
//
// 🔴 本臂走 readonly 白名单豁免, 不经 envelope 验证; app 凭证链归 b-3。
//   (Bettor 06:28 派工要求逐字写死这一行 —— 否则一个绿着的、origin=app 的用例迟早被人
//    数进"app 路径覆盖率", 而它根本没碰凭证链。)
const CASES = [
  {
    id: 'b-2a',
    kind: 'deny',
    label: 'b-2 本体 · 已注册只读命令 + origin 被剥掉 ⇒ 闸层 fail-closed 拒',
    cmd: { type: 'get_rpc_state' },              // __origin 故意不设
    expect: { denied: true, phase: 'authorization', reason_code: 'ORIGIN_MISSING_OR_INVALID' },
  },
  {
    id: 'b-2b',
    kind: 'deny',
    label: 'b-2 本体 · 【钱路】命令 + origin 被剥掉 ⇒ 同样在 switch 之前被拒(NO TX NO STATE)',
    cmd: { type: 'transfer', target: DUMMY_TARGET, amount: 100000000 },
    expect: { denied: true, phase: 'authorization', reason_code: 'ORIGIN_MISSING_OR_INVALID' },
    // 🔴 ③ 无副作用证明(设计 §4.3③): deny 发生在 relay.mjs 的 `return` 处, 不进 switch
    //   ⇒ sendKaspa 从未被调用。而本用例的可观测证据是: 回执是 denied 且【没有】任何执行层
    //   错误(隔离环境 RPC 端口是死的, 只要进了 switch 就一定会看到连接失败类错误)。
    //   ⇒ 见下方 assertNoExecutionLayerTouch()。
    assertNoExec: true,
  },
  {
    id: 'arm-app',
    kind: 'allow',
    label: '对照臂 A · 同一条命令 + origin=app ⇒ 必须放行(证明这条路有功率)',
    cmd: { type: 'get_rpc_state', __origin: 'app' },
  },
  {
    id: 'arm-internal',
    kind: 'allow',
    label: '对照臂 B · 同一条命令 + origin=internal ⇒ 必须放行(第二条有功率证明, 不同分支)',
    cmd: { type: 'get_rpc_state', __origin: 'internal' },
  },
];

const brief = (c) => `type=${c.type} origin=${c.__origin === undefined ? '(缺失)' : c.__origin}`;

// 隔离环境里 RPC 端口是死的 ⇒ 任何进了 switch 的钱路命令都会留下执行层错误痕迹。
// 回执是纯 gate deny(denied=true 且 error 以 'M0c-1 gate deny:' 开头) ⇒ 没到过执行层。
function assertNoExecutionLayerTouch(res) {
  if (!res || res.denied !== true) return { ok: false, why: '不是 gate deny, 无法据此断言未到执行层' };
  const err = String(res.error || '');
  if (!err.startsWith('M0c-1 gate deny:')) return { ok: false, why: `error 前缀不是 gate deny: ${err.slice(0, 80)}` };
  return { ok: true, why: 'error 是纯 gate deny 前缀, 无执行层(死 RPC 端口)错误痕迹 ⇒ 未进 switch' };
}

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);

  const { startArmedRelay } = await import(
    pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/relay-gate-driver.mjs')).href
  );

  const gen = execFileSync('node', [PROVISION, 'gen-key'], { encoding: 'utf8' });
  const relayPriv = gen.match(/私钥[\s\S]*?\n\s+([0-9a-f]{64})/)[1];

  const evidence = [];
  let pass = 0, fail = 0;
  let relay;
  let armedTruth = null, armedReadAt = null;

  try {
    relay = await startArmedRelay({
      relayId: RELAY_ID, network: NETWORK, privkeyHex: relayPriv, grantDbPath: DB, armed: true,
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 🔴 §4.0 MUST-FIX(NWT) — armed 是【运行前置闸】, 不是"读一下写进报告"。
    //   这必须是第一件事, 而且是【代码】不是文档里的一句话。
    //   理由(NWT): b-2 是一条 origin 被剥掉的已注册命令; 而 armed=off 时 authorize.mjs:70
    //   在判 origin 之前【无条件 allow】⇒ 那条命令会真的执行 ⇒ probe 自己造成它要检测的副作用。
    //   "事后核那张表没变"能【检出】它, 但那是检出不是阻止 —— 副作用已经发生。
    //   ⇒ 读不到 / 不是 true ⇒ 拒绝运行整套 + 非 0 退出。
    // ═══════════════════════════════════════════════════════════════════════
    const armRes = await relay.send({ type: 'get_arm_status', __origin: 'app' }, 15000);
    armedReadAt = new Date().toISOString();
    armedTruth = armRes && armRes.armed;
    if (armedTruth !== true) {
      console.error('════════════════════════════════════════════════════════════');
      console.error('🔴 前置闸未过: armed !== true ⇒ 【拒绝运行整套 probe】');
      console.error(`   get_arm_status 回执: ${JSON.stringify(armRes)}`);
      console.error(`   读取时刻: ${armedReadAt}`);
      console.error('   理由(设计 §4.0): armed=off 时闸在判 origin 之前无条件放行,');
      console.error('   b-2 那条被剥 origin 的命令会真的执行 ⇒ probe 自己造成它要检测的副作用。');
      console.error('   而整套读数会全绿 —— 与"闸在工作"无法区分。');
      console.error('════════════════════════════════════════════════════════════');
      if (relay) relay.stop();
      process.exit(2);
    }
    evidence.push({
      id: '(前置闸)', label: 'armed 前置闸: get_arm_status ⇒ armed===true, 才允许开跑',
      armed: armedTruth, read_at: armedReadAt, ok: true,
    });

    for (const c of CASES) {
      let res, err = null;
      try { res = await relay.send({ ...c.cmd }, 15000); }
      catch (e) { err = e.message; }

      const checks = [];
      let ok;
      if (c.kind === 'deny') {
        // 🔴 结构化断言, 逐字段 —— 不许用 regex 猜日志文本(设计 §4.3②)
        checks.push({ field: 'denied', want: c.expect.denied, got: res && res.denied, ok: !!res && res.denied === c.expect.denied });
        checks.push({ field: 'phase', want: c.expect.phase, got: res && res.phase, ok: !!res && res.phase === c.expect.phase });
        checks.push({ field: 'reason_code', want: c.expect.reason_code, got: res && res.reason_code, ok: !!res && res.reason_code === c.expect.reason_code });
        if (c.assertNoExec) {
          const ne = assertNoExecutionLayerTouch(res);
          checks.push({ field: '无副作用(未进 switch)', want: true, got: ne.why, ok: ne.ok });
        }
        ok = checks.every((x) => x.ok) && err === null;
      } else {
        // 对照臂: 必须【实际成功过】—— 不是"应该会成功"(设计 §6)
        // 🟡 注意: allow 分支【不透传 reason_code/phase】(relay.mjs:368-377 只在 deny 分支带),
        //   所以这里不能断言 reason_code==='ALLOWED_READONLY' —— 那个值只活在 authorize.mjs 内部。
        //   见文末 REPORT_NOTES①。
        checks.push({ field: 'ok', want: true, got: res && res.ok, ok: !!res && res.ok === true });
        checks.push({ field: 'denied', want: '(不存在/非 true)', got: res && res.denied, ok: !(res && res.denied === true) });
        ok = checks.every((x) => x.ok) && err === null;
      }

      if (ok) pass++; else fail++;
      evidence.push({
        id: c.id, kind: c.kind, label: c.label,
        sent: brief(c.cmd), checks,
        raw: err ? { thrown: err } : res,
        ok,
      });
    }
  } finally {
    if (relay) relay.stop();
  }

  const REPORT_NOTES = [
    '① 对照臂断言的是 ok:true, 【不是】reason_code==="ALLOWED_READONLY" —— 设计 §4.1.1 那张表里的 ' +
    'ALLOWED_READONLY 是 authorize.mjs 的内部返回值, 而 relay.mjs:368-377 只在【deny 分支】透传 ' +
    'phase/reason_code, allow 分支不带。⇒ 该值在 IPC 线上【不可观测】, 断言它会永远失败。' +
    '这一格按"实现可观测的那个, 并把差异说出来"处理, 没有放松判据(deny 臂的三个字段一个没少)。',

    '② b-1(不存在的能力名)【不在本用例集里】。它由 validateCommandPayload 拒(早于闸), 回执是 ' +
    '{error:"invalid command: …", rejected:true}, 【没有 phase 字段】—— 那是命令校验层, 不是 ' +
    'default-deny。设计 §4.4: 不让它长得像证据。',

    '③ b-3(origin=app + 凭证外意图) 未实现 —— 依赖一份还不存在的 app 路径拒绝 reason_code 枚举' +
    '(设计 §5①)。缺就是缺, 不编断言。',

    '④ 🔴 本文件全绿【不等于】第一段验收通过: 它只是 (b) 的第一条, 而 (a) 的枚举 probe 全 BUST ' +
    '还是另一件事。二者都齐才算(设计 §6)。',

    '⑤ 覆盖边界: 本套只证 origin 缺失这一条 default-deny 路径。设计 §3 已写明 armed=on 时 ' +
    'internal/operator/legacy-unmigrated 三个 origin 是【信标签放行】不是验证 ⇒ 对外话术只能说 ' +
    '"凡走外部 app 凭证这条路的, 被授予了这些、别的做不了", 不能说全系统。',
  ];

  const logPath = path.join(LOG_DIR, 'm0c1-seg1-default-deny-latest.json');
  writeFileSync(logPath, JSON.stringify({
    design: 'docs/2026-07-28-seg1-default-deny-probe-design-v0.1.md (v0.2)',
    armed_truth: armedTruth, armed_read_at: armedReadAt,
    scope: 'b-2 only (b-1 报告正文·不计入证据; b-3 待 §5① 枚举)',
    summary: { pass, fail },
    evidence, notes: REPORT_NOTES,
  }, null, 2));

  // 报告开头第一行 = 该次运行时读到的 armed 真值 + 读取时刻(设计 §6)
  console.log(`armed=${armedTruth} (读取时刻 ${armedReadAt}) — 前置闸已过, 以下读数才有意义\n`);
  for (const e of evidence) {
    if (e.id === '(前置闸)') { console.log(`PASS ${e.id} ${e.label}`); continue; }
    console.log(`${e.ok ? 'PASS' : 'FAIL'} [${e.id}] ${e.label}`);
    console.log(`       送出: ${e.sent}`);
    for (const c of e.checks) console.log(`       ${c.ok ? '✓' : '✗'} ${c.field}: want=${JSON.stringify(c.want)} got=${JSON.stringify(c.got)}`);
  }
  console.log('\n报告正文注记:');
  for (const n of REPORT_NOTES) console.log(`  - ${n}`);
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== seg1 default-deny (b-2 only): PASS ${pass} / FAIL ${fail} ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('seg1 default-deny harness 异常:', e.stack || e.message);
  process.exit(1);
});
