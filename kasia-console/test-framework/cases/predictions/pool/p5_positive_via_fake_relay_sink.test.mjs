// ⑤阳性臂 (d) —— 卡 P5-POSITIVE-VIA-FAKE-RELAY-SINK(J2, 2026-08-08)
//
// 它补的是什么: 姊妹用例 precond5_verification_interrupt_no_autorefund 的 **P1 阳性对照**
//   卡在第五道闸「Relay not running」——离线没有 relay, 退款交易构造不出来, 四字段不落库。
//   NWT 2026-08-07 裁: ⑤ 按 (c) 半闭交付, 该臂如实标"射程外"。**本用例就是把那个射程补上的 (d)。**
//   ⚠ 本用例【不改】那份姊妹用例(它已过审, 改它要重走审)。它是独立的一条阳性臂。
//
// 预登记判据(J2 09:52 落字 → Bettor 09:53 收 → NWT 09:54 PASS 无 MUST-FIX;
//   判据② 的形态修订 J2 09:58 提 → NWT 10:00 明确裁"接受, 不扩白名单"):
//   ① 哨兵 = 每次运行现生的 UUID, 且【实 relay 永远回不出】
//   ② 哨兵断言排第一(不中即红, 后续断言的结果一律不作数)
//   ③ DB_PATH 复合项单列一臂: 不得从 live 库解出实钥匙
//
// 🔴🔴 为什么哨兵不是形式而是【唯一证据】——本仓已经吃过一次这个亏:
//   g4-pilot-custodial-e2e.mjs:62-65 记着: RELAY_DIR 没设 ⇒ relay-manager 落到硬编码 fallback
//   `D:/Anthropic/kasia-relay`(不存在)⇒ fork 的 child cwd 指向它 ⇒ spawn ENOENT ⇒ relay
//   **从未真正启动, 而 `startRelay()` 仍然同步返回 `{ok:true}`**(spawn 失败是 fork 之后的
//   **异步** 'error' 事件, 追不上那个 return)。
//   ⇒ **`startRelay().ok === true` 不是"起来了"的证据, 一格都不是。** 只有哨兵是。
//
// 🔴 本用例【不测】的, 如实写在这里:
//   · **不测退款交易本身对不对** —— 假 sink 回的 tx_obj 是刻意伪造的占位对象(自带
//     `__FAKE_SINK_NOT_A_REAL_TX__` 标记), 本用例只证【那条 IPC 命令流被路由到了本 sink】,
//     不证 settler 构造出的交易可签、可广播、金额正确。**那是另一件事, 别拿本用例的绿去说它。**
//   · 不测 P2 臂(committee_affirmative_unjudgeable)—— 它多一段委员票据前置, 不在本卡。
//   · 不测跨节点 maker(cross-node 在 dispatchRefund 之前就被拦掉, 不走本路)。
//
// 🔴 隔离守卫为什么在本文件里【又写了一遍】(不是重造轮子):
//   runner.mjs:799-844 那套 DB_PATH/KANET_DB_PATH/KASPA_RPC_URL 断言住在 `call_module_export`
//   **里面**, 只保护"经该 action 发生的动态 import"。而本用例必须在【模块体】里
//   dynamic import relay-manager(理由见下), 那一刻 runner 的守卫**还没轮到运行**。
//   而 relay-manager.js:14 顶层 `import { sqlite } from '../db/client.js'`, 且
//   db/client.js:10-13 **在模块顶层就 resolve(DB_PATH) 并把库打开** ⇒
//   **import 一发生, 整个 runner 进程的 DB 连接就定死了**, 事后再断言是在断言一个已成事实。
//   ⇒ 所以这三条必须在本文件最前面、在任何生产模块 import 之前, 【断言而不是设置】。
//
// 🔴 为什么必须在模块体里做而不是写成 step:
//   把假 relay 塞进 relay-manager 的模块私有 `_relays` 只有一条路 —— 调它导出的 startRelay;
//   而声明式 `call_module_export` 的 ALLOWLIST(runner.mjs:745)里没有 relay-manager,
//   加进去 = 白名单扩容(自带审核闸)。NWT 10:00 裁: 不扩。⇒ 走模块体自身的 import。
//   ⚠ 如实披露: **ALLOWLIST 只约束那一个 action, 不约束用例文件自己的 import**
//   (既有先例: cases/system/relay-restart.test.mjs:16 直接静态 import relay-manager)。
//   本用例正是用了这个空间, 所以把它明写出来, 而不是默默用掉。
//
// 🔴 skip_in_batch: true —— 不是图省事, 是因为本用例在【模块加载期】改 process.env(RELAY_DIR 等),
//   而 relay-manager 的 RELAY_DIR 是加载期 const: 一旦本文件先加载, 同一次 --domain/--all 运行里
//   **后面任何调 startRelay 的用例都会 fork 到本假 sink**, 且 env 改回去也救不了(模块已缓存)。
//   ⇒ 只允许 --case= 单独跑。**代价照录: 它因此不进批量扫描面** —— 而本仓本来就无 CI 无 cron,
//   "在扫描面内" ≠ "有人在跑"(CLAUDE.md 已注)。
//
// 【怎么跑 —— 完整命令, 照抄即可】
//   cd D:/kanet-tn12/kasia-console
//   set DB_PATH=D:\kanet-tn12\kasia-console\test-framework\data\test-console.db
//   set KANET_DB_PATH=D:\kanet-tn12\kasia-console\test-framework\data\test-console.db
//   set KASPA_RPC_URL=ws://127.0.0.1:9
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/p5_positive_via_fake_relay_sink.test.mjs
//   ⚠ --case= 收的是【路径】不是 id

import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TF_ROOT = path.resolve(HERE, '../../..');                    // .../test-framework
const FIXTURE_DIR = path.join(TF_ROOT, 'fixtures', 'fake-relay-sink');
const EXPECTED_DB_DIR = path.join(TF_ROOT, 'data');

// 每次运行现生 —— 跨次运行不同 ⇒ 上一次跑剩下的假目录/陈旧行都会让断言变红。
const SENTINEL = randomUUID();
const RELAY_NAME = 'p5d-fake-' + randomUUID().slice(0, 8);
let RELAY_ID = null;   // 由仓储层 createRelayNode 现生(UUID)—— 天然不可能撞 live 库里的行
const MARKET_ID = '__test_p5d_fake_sink__';
const PAST = 1700000000;

// v0.7 spine redeem: settler:2809-2810 **只取它的字节长度**算 mass, 不解析脚本语义
// ⇒ 用合成串(1113 字节, 贴近真实 v0.7 spine 体量)。真串在 gitignored 的 scratch 里,
//   不能当仓内 fixture 依赖(别人 clone 下来跑不了 = 不算交付)。
const SYNTHETIC_SPINE_REDEEM_HEX = randomBytes(1113).toString('hex');

// ── ③-a 隔离守卫: 断言, 不设置; 且在任何生产模块 import 之前 ──────────────────────
//  形状与理由抄 runner.mjs:799-844(两个 DB 变量【各自】检查: `$db` 走 KANET_DB_PATH,
//  模块顶层 import 走 DB_PATH, 只设一个 ⇒ 另一条路悄悄落回生产库)。
//  路径分隔符边界比较, 不用裸 startsWith(否则 data2/ data-legacy/ 会被认成在 data 下)。
function isolationFailure() {
  const underTestDir = (raw) => {
    if (!raw) return false;
    const r = path.resolve(raw);
    return r === EXPECTED_DB_DIR || r.startsWith(EXPECTED_DB_DIR + path.sep);
  };
  for (const v of ['DB_PATH', 'KANET_DB_PATH']) {
    if (!underTestDir(process.env[v])) {
      return `${v}=${JSON.stringify(process.env[v] || null)} 未落在测试库目录 ${EXPECTED_DB_DIR} 下`;
    }
  }
  const raw = process.env.KASPA_RPC_URL;
  let unreachable = false;
  try {
    const u = new URL(String(raw));
    unreachable = (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && (u.port === '9' || u.port === '1');
  } catch { unreachable = false; }
  if (!unreachable) return `KASPA_RPC_URL=${JSON.stringify(raw || null)} 不是哨兵(不可达)地址, 期望 ws://127.0.0.1:9`;
  return null;
}

const guardFail = isolationFailure();

// bootstrap 结果只用于【诊断】, 不用于判定 —— 判定归哨兵(见文件头 g4-pilot 那条)。
let bootstrap = { stage: 'skipped-by-guard', detail: guardFail || '' };
let seededPrivkeyRoundTrip = 'not-run';

if (!guardFail) {
  try {
    // 本用例自己拥有的值 ⇒ 设置(不是隔离性质, 隔离性质一律断言)。
    process.env.RELAY_DIR = FIXTURE_DIR;
    process.env.FAKE_SINK_SENTINEL = SENTINEL;
    process.env.FAKE_SINK_LOG = path.join(EXPECTED_DB_DIR, `fake-sink-${RELAY_NAME}.jsonl`);
    process.env.FAKE_SINK_IDLE_EXIT_MS = '120000';
    // throwaway 加密钥: 只在未设时设 —— 设了就用现成的, 两种情况本次运行内都能 encrypt→decrypt 往返。
    if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    if (!process.env.KASPA_NETWORK) process.env.KASPA_NETWORK = 'testnet-12';

    bootstrap.stage = 'seeding';
    // 🔴 走【仓储层】而不是裸 better-sqlite3: M0a 门(R-M0A-BARE-IMPORT-DIFF)明写合法通道是
    //    "经审 manifest 或删除该 import 改走仓储层" —— 这条能改就改掉, 不去要一个能免的例外。
    //    createRelayNode 自己 encrypt + 自己生成 id, 顺带把 CONSOLE_ENCRYPTION_KEY 这一路也走通了。
    const { createRelayNode, getRelayPrivkey } = await import('../../../../src/data/settings/relay-nodes.js');
    // throwaway 私钥串: 假 sink 根本不用它 —— 它只是过 startRelay 的 `no_key` 闸。
    const THROWAWAY_PRIVKEY = 'p5d-throwaway-' + randomUUID();
    RELAY_ID = createRelayNode({
      name: RELAY_NAME,
      privkey: THROWAWAY_PRIVKEY,
      address: 'kaspatest:qp5dfakesinkmakeraddressplaceholder00000000000000',
      network: process.env.KASPA_NETWORK,
    });

    // ③-b: 读回来必须【就是我种下的那个】—— 回了别的 ⇒ 读的不是我这个库。
    seededPrivkeyRoundTrip = getRelayPrivkey(RELAY_ID) === THROWAWAY_PRIVKEY ? 'ROUNDTRIP_OK' : 'ROUNDTRIP_MISMATCH';

    // ⚠ pool_markets 的 fixture 不在这里种 —— 它挪到了声明式 exec_sql step(见 steps 首条),
    //   因为 startRelay 根本不读 pool_markets, 没有理由把它也塞进模块体。
    //   ⇒ 模块体里只剩"startRelay 真正需要的那点前置", 越小越好核。

    // ── 只有走到这里, 才 import relay-manager(它一进来 DB 就定死了) ──
    bootstrap.stage = 'startRelay';
    const { startRelay } = await import('../../../../src/services/relay-manager.js');
    const r = await startRelay(RELAY_ID);
    bootstrap = { stage: 'done', detail: JSON.stringify(r) };
  } catch (e) {
    bootstrap = { stage: 'threw', detail: String(e && e.message).slice(0, 300) };
  }
}

const sqlLit = (s) => String(s).replace(/'/g, "''");

export default {
  id: 'p5_positive_via_fake_relay_sink',
  title: '⑤阳性臂(d): 假 relay sink 打通 P1 —— bettors_absent 退款授权四字段落库',
  tags: ['predictions', 'pool', 'positive-control', 'd012-precond5'],
  skip_in_batch: true,   // 理由见文件头(模块加载期改 env, 会污染同批其它用例)
  steps: [
    // ── ③-a 隔离守卫(第 0 条: 它红了后面全部不作数) ──
    { id: 'G0_isolation_guard', action: 'query_db',
      sql: `SELECT '${guardFail ? sqlLit('🔴 隔离守卫失败(本用例已【拒绝 import 任何生产模块】): ' + guardFail
                       + ' —— 见文件头"怎么跑", 三个 env 都要设。')
                  : 'ISOLATION_OK'}' AS state`,
      expect: { must: { row_assert: { state_contains: 'ISOLATION_OK' } } } },

    // ── ③-b DB_PATH 复合项: 解出来的钥匙必须是我种的 throwaway, 不是 live 库里的实钥匙 ──
    { id: 'G1_privkey_roundtrip_is_mine', action: 'query_db',
      sql: `SELECT '${sqlLit(seededPrivkeyRoundTrip)}' AS state`,
      expect: { must: { row_assert: { state_contains: 'ROUNDTRIP_OK' } } } },

    // ── fixture: P1 那条路的前四道闸(逐道来自姊妹用例的实测记录) ──
    //  ①v0.7 ②maker_stake>=1e10(否则 MIN_POT 先取消)③relay_nodes 带 address(模块体已由
    //  createRelayNode 种)④metadata.spine_redeem_script_hex(否则 v0.7 mass 计算抛)
    //  + verifying / deadline 过去 / 零 pool_bettor_sides / 无 market_shards 行 / 无 refund_dispatched_at
    { id: 'clean_stale_market', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${MARKET_ID}'` },
    { id: 'seed_market', action: 'exec_sql',
      sql: `INSERT INTO pool_markets
              (id, maker_relay_id, spine_p2sh, spine_lock_tx, market_metadata_hash, deadline,
               protocol_status, protocol_version, metadata, maker_stake_amount)
            VALUES ('${MARKET_ID}', '${sqlLit(RELAY_ID)}', 'kaspatest:spine_${MARKET_ID}',
                    '${'0'.repeat(64)}', 'abcd', ${PAST},
                    'verifying', 'v0.7',
                    '${sqlLit(JSON.stringify({ spine_redeem_script_hex: SYNTHETIC_SPINE_REDEEM_HEX }))}',
                    '10000000000')` },

    // ── 驱动真实 settler tick(poolSettlerTick 已在 ALLOWLIST 内, 无需扩容) ──
    { id: 'drive_settler_tick', action: 'call_module_export',
      module: 'pool-market-settler', export: 'poolSettlerTick', args: [] },

    // ── 判据②: 哨兵断言【排第一】 ─────────────────────────────────────────────
    //  它读的是 settler 自己经 sendCommandAsync 拿回、再原样落库的 refund_tx_obj。
    //  ⇒ 命中 = 【被测那条命令流实际被路由到了本次运行现生的假 sink】。
    //  实 relay 回的 tx_obj 里没有 __fake_sink_sentinel 这个 key; 没连上则是 reject, 连回执都没有;
    //  上一次运行留下的陈旧行 UUID 不同 ⇒ 三种坏情况都不会伪装成绿。
    { id: 'S1_SENTINEL_FIRST_fake_sink_actually_reached', action: 'query_db',
      sql: `SELECT COALESCE((SELECT 'SENTINEL_HIT' FROM pool_markets
                               WHERE id = '${MARKET_ID}'
                                 AND json_extract(metadata,'$.refund_tx_obj.__fake_sink_sentinel')
                                     = '${sqlLit(SENTINEL)}'),
                            '🔴 哨兵未命中 ⇒ settler 那条 sendCommandAsync 没有打到本次的假 sink。'
                            || ' 本次哨兵=${sqlLit(SENTINEL.slice(0, 8))}… relay=${sqlLit(RELAY_ID)}'
                            || ' bootstrap.stage=${sqlLit(bootstrap.stage)} detail=${sqlLit(String(bootstrap.detail).slice(0, 160))}'
                            || ' ⚠ 注意: startRelay 返回 ok:true 【不是】起来了的证据(g4-pilot:62-65 已踩过:'
                            || ' spawn ENOENT 是 fork 之后的异步事件, 追不上那个 return)。'
                            || ' 本条红 ⇒ 后面两条的结果一律不作数。') AS state`,
      expect: { must: { row_assert: { state_contains: 'SENTINEL_HIT' } } } },

    // ── 命题本体: 四字段合取(单种一个字段不能满足它 —— 姊妹用例踩过的假绿) ──
    { id: 'S2_bettors_absent_four_field_conjunction', action: 'query_db',
      sql: `SELECT COALESCE((SELECT 'POSITIVE_CONTROL_ESTABLISHED' FROM pool_markets
                               WHERE id = '${MARKET_ID}'
                                 AND json_extract(metadata,'$.refund_authorization') = 'bettors_absent'
                                 AND json_extract(metadata,'$.refund_dispatched_at') IS NOT NULL
                                 AND json_extract(metadata,'$.refund_tx_obj')        IS NOT NULL
                                 AND protocol_status = 'refunding'),
                            '🔴 四字段合取未满足 —— 若上一条 S1 是绿的, 说明假 sink 已连通, 卡点在闸链而非 relay。'
                            || ' 逐道自查: v0.7 / maker_stake>=1e10 / relay_nodes 带 address /'
                            || ' metadata.spine_redeem_script_hex / 零 pool_bettor_sides / 无 market_shards 行。') AS state`,
      expect: { must: { row_assert: { state_contains: 'POSITIVE_CONTROL_ESTABLISHED' } } } },

    // ── teardown(幂等) ──
    { id: 'td_market', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${MARKET_ID}'` },
    { id: 'td_relay', action: 'exec_sql', sql: `DELETE FROM relay_nodes WHERE id = '${sqlLit(RELAY_ID)}'` },
    // startRelay 会给这个 relay 建一行 local identity(relay-manager:45), display_name = relay 的 name。
    { id: 'td_identity', action: 'exec_sql', sql: `DELETE FROM identities WHERE display_name = '${sqlLit(RELAY_NAME)}'` },
    // ⚠ 假 sink 子进程不在这里杀 —— 声明式 steps 调不到 stopRelay。它自己了断:
    //   父进程退出 ⇒ IPC 'disconnect' ⇒ exit(0); 兜底 120s 空闲自退(见 fixture 尾部)。
  ],
};
