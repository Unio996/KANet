/**
 * fake-relay-sink — 假 relay 子进程(⑤阳性臂 (d) · 卡 P5-POSITIVE-VIA-FAKE-RELAY-SINK)
 *
 * 用法: 把 `RELAY_DIR` 指向本文件所在目录的上一级(即 .../fixtures/fake-relay-sink),
 *       relay-manager.js:90 的 `fork('src/relay.mjs', { cwd: RELAY_DIR })` 就会 fork 本文件。
 *       ⚠ 相对脚本路径按 `cwd` 选项解析(J2 2026-08-08 双臂实测: 父进程 cwd 放同名不同内容脚本,
 *          跑起来的是 cwd 选项那一份) —— 这条是本手法成立的前提, 已实测非推断。
 *
 * 🔴 它存在的理由: settler 的退款路只有一面墙 —— buildMakerRefundPreimage:2682 的
 *    `sendCommandAsync(maker_relay_id, {type:'prediction_settle_build_preimage'})`。
 *    没有 relay 在 `_relays` 里, P1 阳性臂永远走不到落库那一步。
 *
 * 🔴 为什么是【结构性】不广播, 而不是【选择】不广播:
 *    本文件 **零 import**(连 node: 内置的网络/子进程模块都不引), 没有任何对外通路。
 *    "它不会广播"因此不是一句承诺, 是读一眼 import 列表就能核的事实。
 *
 * 🔴 哨兵(判据①): 必须由 env `FAKE_SINK_SENTINEL` 传入【每次运行现生的 UUID】。
 *    缺失即 **exit(2) 吵闹地死**, 绝不退化成"一个没有哨兵但照样能应答的假 relay" ——
 *    那正是本仓反复吃亏的形状: 失败长得像一个合法答案(见 g4-pilot:62-65,
 *    RELAY_DIR 没设时 spawn ENOENT 而 startRelay() 仍返回 {ok:true})。
 */

const SENTINEL = process.env.FAKE_SINK_SENTINEL || '';
if (!SENTINEL) {
  // 不用 console.error 之外的任何东西; 立刻死, 不进 message 循环。
  console.error('[fake-relay-sink] 🔴 FAKE_SINK_SENTINEL 未设 — 拒绝以"无哨兵假 relay"的形态运行(exit 2)');
  process.exit(2);
}

// 收到的每条命令都留痕: 本 sink 的价值一半在"拦住广播", 一半在"记下 settler 到底想发什么"。
const LOG_PATH = process.env.FAKE_SINK_LOG || '';
const received = [];

function record(msg) {
  received.push({ at: new Date().toISOString(), type: msg?.type ?? null, msg });
  if (!LOG_PATH) return;
  // fs 是本文件唯一的 node: 依赖, 且只写本地文件 — 仍然没有任何对外通路。
  import('node:fs')
    .then((fs) => fs.appendFileSync(LOG_PATH, JSON.stringify(received[received.length - 1]) + '\n'))
    .catch((e) => console.error(`[fake-relay-sink] log write fail: ${e.message}`));
}

process.on('message', (msg) => {
  const requestId = msg?.requestId;
  record(msg);
  if (!requestId) return; // 无 requestId 的消息 sendCommandAsync 不会等回执
  const reply = (result) => { try { process.send({ requestId, result }); } catch { /* 父进程已走 */ } };

  switch (msg?.type) {
    case 'prediction_settle_build_preimage':
      // dispatchRefund 只校验 `preimage?.ok && preimage.tx_obj`, tx_obj 形状不限。
      // 🔴 哨兵嵌在 tx_obj 里: 它会被原样落进 metadata.refund_tx_obj ⇒ 断言读到它
      //    就证明【settler 自己那条 sendCommandAsync 打到了本 sink】, 而不是另起一条平行探针。
      // 🔴 自证伪造: 任何人 dump 到这个对象都能一眼看出它不是可签的 tx。
      reply({
        ok: true,
        tx_obj: {
          __FAKE_SINK_NOT_A_REAL_TX__: true,
          __fake_sink_sentinel: SENTINEL,
          echo_p2sh: msg.p2sh_address ?? null,
          echo_required_input_outpoints: msg.required_input_outpoints ?? null,
          echo_outputs: msg.outputs ?? null,
        },
      });
      break;

    case 'sign_input_for_settle':
      // 🔴 前置④ 要数的就是这条命令。sink 无论认不认都会 record(), 但认它可以让
      //    handler 走完整条成功路径, 从而把"该签的场景确实签了 N 次"测准。
      //    返回的签名是【显式伪造】的: 带 __FAKE_SINK_NOT_A_REAL_SIGNATURE__, 任何人 dump 到都看得出。
      reply({ ok: true, signature: '00'.repeat(64), __FAKE_SINK_NOT_A_REAL_SIGNATURE__: true, __fake_sink_sentinel: SENTINEL });
      break;

    case 'get_pubkey':
      // 两个用途, 都保留哨兵(实 relay 回 {ok,pubkey}, 永远没有 __fake_sink_sentinel 这个 key):
      //  ① 备用探针路(⑤(d) 用不到, 但留着);
      //  ② 🔴 前置④ handler 级用例【必须】用到 —— `handlePoolOracleTxSignReq` 是经 IPC 问 relay 要
      //     公钥的(`trade-protocol-filter.js:594` `sendCommandAsync(oracle.id,{type:'get_pubkey'})`),
      //     拿不到 `x_only_pubkey` 就 `continue` 跳过该 oracle ⇒ 永远走不到签名循环 ⇒ "零签名调用"
      //     会因为【根本没跑到】而恒真。要让那条断言有判别力, sink 必须能回一个落在 committee_pks
      //     里的公钥。⇒ 由 env 传入, 不写死。
      //  ⚠ 附加而非改写: 未设 env 时行为与原来【逐字节相同】(只有哨兵), 故不影响已过审的 ⑤(d) 用例。
      reply(process.env.FAKE_SINK_XONLY_PUBKEY
        ? { ok: true, x_only_pubkey: process.env.FAKE_SINK_XONLY_PUBKEY, __fake_sink_sentinel: SENTINEL }
        : { ok: true, __fake_sink_sentinel: SENTINEL });
      break;

    default:
      // 未处理的命令一律显式失败 —— 不装作成功。哨兵同带, 便于分辨"打到了 sink 但类型没覆盖"
      // 与"根本没打到 sink"(后者是 sendCommandAsync reject, 连回执都没有)。
      reply({
        ok: false,
        error: `fake-relay-sink: 未处理的命令 type=${JSON.stringify(msg?.type ?? null)}`,
        __fake_sink_sentinel: SENTINEL,
      });
  }
});

// 心跳: relay-manager 的 isRelayAlive 用 lastLogAt(stdout/stderr 落时刷新)判活, 60s 新鲜度;
// 首条输出前用 startedAt 兜底。跑超过 60s 的用例若没有输出会被判死 ⇒ 定期出一行。
console.log(`[fake-relay-sink] up sentinel=${SENTINEL.slice(0, 8)}… pid=${process.pid}`);
const hb = setInterval(() => {
  console.log(`[fake-relay-sink] heartbeat received=${received.length}`);
}, 20_000);

// 🔴 自我了断(两条, 缺一就会留孤儿进程):
//  ① 父进程走了 ⇒ IPC 'disconnect' ⇒ 立即退。测试 runner 没有 stopRelay 那一步(声明式 steps
//     调不到 relay-manager), 不自己退就会在跑完之后常驻 —— 而它是个【会应答结算命令的东西】,
//     留着比没用更坏。
//  ② 父进程被 -9 之类打掉时 'disconnect' 可能不来 ⇒ 加一道空闲兜底。
process.on('disconnect', () => {
  console.log('[fake-relay-sink] 父进程断开 — 退出');
  process.exit(0);
});
const IDLE_EXIT_MS = Number(process.env.FAKE_SINK_IDLE_EXIT_MS || 300_000);
let lastSeen = Date.now();
process.on('message', () => { lastSeen = Date.now(); });
setInterval(() => {
  if (Date.now() - lastSeen > IDLE_EXIT_MS) {
    console.log(`[fake-relay-sink] 空闲超过 ${Math.round(IDLE_EXIT_MS / 1000)}s — 退出`);
    clearInterval(hb);
    process.exit(0);
  }
}, 10_000);
// 两个 timer 都【不】 unref: 本进程没有别的活儿, unref 会让它立刻自然退出而不是待命。
