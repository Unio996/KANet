// M0c-1 批3 — authorizeCommand gate (relay 侧命令执行前授权闸)
// 设计: docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md §4.0(origin 判别)/§4.1(gate 流程)/§3(默认拒绝二分类)
// 插入点: relay.mjs validateCommandPayload 后、switch 前 (每命令执行前必过)。
//
// 🔴 armed 开关 (ADMIN_M0C1_GATE_ARMED, 默认 off):
//   - armed=off (批3~批F 前): gate 逻辑 inert — 放行 + warn(未标 origin 迁移驱动) = 完全等同今天(无 gate, 命令照执行)=零新暴露面。
//   - armed=on (批F, arm 前提焊死后): origin 四值 fail-closed 授权闸生效。
// 🔴 arm 前提焊死 (NWT 硬条件·防 arm stub): armed=on 但 grant/envelope 还是 stub → 启动 throw 拒 arm(LOUD)。
//   批F arm=on 的显式前置(缺一不准 arm): (1)grant/envelope 验证实实非 stub (2)批C 迁移收口全 internal 标 origin (3)grant provision operator 离线实。stub 永不准 arm。
// 🔴 armed 状态不许静默解除 (NWT 硬条件·进批F/装载设计): 批F arm 后 ADMIN_M0C1_GATE_ARMED 若重启丢 env/unset → gate 静默回 unarmed(fail-open)=现网悄悄失 M0c-1 保护。批F 需 armed 状态持久化+启动校验 or LOUD 健康告警(应 armed 却 unarmed→报警)。本模块 armReport() 供健康探针读 armed 真值。

// 无害只读白名单 (§3.1 类A: 纯计算/只读, 零链上副作用, 豁免信封)。不在白名单=默认归需信封类(§3.2 新命令默认需授权非放行)。
export const READONLY_ALLOWLIST = new Set([
  'get_rpc_state', 'get_pubkey', 'check_utxo_landed', 'get_address_utxos',
  'chain_get_current_daa_score', 'chain_get_blocks_from_daa_score', 'chain_get_block_at_daa',
  'get_per_bet_address', 'pool_v07_compute_refund_mass',
]);

// grant/envelope 验证是否实现 (批3 = stub, 占位给"应用抽离后"的 app 路径)。app provision 组件批实现后置 true。
const GRANT_ENVELOPE_IMPLEMENTED = false;

const GATE_ARMED = process.env.ADMIN_M0C1_GATE_ARMED === '1';

// 🔴 arm 前提焊死 (模块加载时校验): armed=on 但 grant/envelope 还是 stub → 拒 arm (LOUD throw, 防误 arm stub)。
if (GATE_ARMED && !GRANT_ENVELOPE_IMPLEMENTED) {
  throw new Error(
    '[M0c-1 gate] FATAL: ADMIN_M0C1_GATE_ARMED=1 但 grant/envelope 验证还是 stub — 绝不准 arm stub。' +
    'NWT 硬条件: arm 前提 = grant/envelope 非 stub + 批C 迁移收口全标 origin + provision 实。' +
    'unset ADMIN_M0C1_GATE_ARMED, 或实现 grant/envelope 后置 GRANT_ENVELOPE_IMPLEMENTED=true。'
  );
}

// armed 状态可观测 (供 relay 健康探针读, 支撑 NWT'不许静默解除'硬条件的健康告警)。
export function armReport() {
  return { armed: GATE_ARMED, grantEnvelopeImplemented: GRANT_ENVELOPE_IMPLEMENTED };
}

const _originWarnedTypes = new Set(); // armed=off 未标 origin warn 去重 (迁移驱动)

/**
 * 命令执行前授权闸。armed=off 时 inert(放行+warn=现状); armed=on 时 origin 四值 fail-closed。
 * @param {object} cmd - 命令对象 (cmd.__origin 由 sendCommandAsync origin 形参权威设置, §4.0 批A)
 * @returns {{decision:'allow'|'deny', reason:string}}
 */
export function authorizeCommand(cmd) {
  const origin = cmd?.__origin;
  const type = cmd?.type;

  // armed=off: inert 放行 + warn (=现状, 零新暴露面; warn 提示未标 origin 供批C 迁移驱动)。
  if (!GATE_ARMED) {
    if (origin === undefined && type && !_originWarnedTypes.has(type)) {
      _originWarnedTypes.add(type);
      console.warn(`[M0c-1 gate armed=off] cmd type=${type} 未标 origin — 批C 迁移驱动(inert 放行, armed=off=现状)`);
    }
    return { decision: 'allow', reason: 'gate armed=off (inert, =现状)' };
  }

  // ↓↓↓ armed=on (arm 前提焊死已保证 grant/envelope 非 stub + 批C 收口 + provision 实) ↓↓↓
  // origin 四值判别 (§4.0)。
  if (origin === 'internal') {
    // 乙路 TCB: Console daemon/内部代码静态设置, 放行 (场景 B 可伪=乙已接受 TCB 残留, R 收口才 BUST)。
    return { decision: 'allow', reason: 'origin=internal (乙路 TCB 放行)' };
  }
  if (origin === 'operator') {
    // operator-settle 端点已做白名单两档 + ADMIN_SECRET tier auth + IP allowlist (受信来源, 批B); gate 认 origin=operator 放行。
    // (operator 白名单在 operator-settle 端点做, gate 不重复; 端点是 operator 命令的唯一合法来源。)
    // 🔴 单来源假设 (J1 covenant/relay 域核·GREEN 建议·防未来打破): origin=operator 的信任前提 = 全仓**唯一**
    //   sendCommandAsync(...,'operator') 调用点在 operator-settle.js:72 (J1 grep 验证过, 非假设)。此信任同 origin=internal
    //   同款性质 (信标签非重新验证, 靠 Console=TCB + 唯一来源撑住)。**若未来新增第二个 origin=operator 调用点,
    //   必须同步: 新来源须同 operator-settle 做白名单+auth+IP allowlist, 或改 relay 侧对 operator 重新验证 ——
    //   否则单来源假设被静默打破 = 新来源绕过 operator-settle 端点的白名单/auth 直接放行 money-path。**
    return { decision: 'allow', reason: 'origin=operator (operator-settle 端点白名单+auth 受信)' };
  }
  if (origin === 'app') {
    return authorizeAppCommand(cmd); // 完整 grant/envelope 验证 (armed 时非 stub, arm 前提焊死保证)。
  }
  // origin 缺失/非法: fail-closed 拒 (§4.0 — 防悄悄全开, 与 §3.2 新命令默认需授权同构)。
  return { decision: 'deny', reason: `origin 缺失/非法 (${String(origin)}) — fail-closed 拒` };
}

// app 路径完整验证 (§4.1 step1-7)。批3 = stub 接口; app provision 组件批实现 grant/envelope 后 GRANT_ENVELOPE_IMPLEMENTED=true。
// armed=on 时到达此处的前提(arm 焊死)保证非 stub; batch3 阶段 GRANT_ENVELOPE_IMPLEMENTED=false, armed=on 已被模块加载 throw 拦。
function authorizeAppCommand(cmd) {
  // 无害只读白名单豁免信封 (§3.1)。
  if (READONLY_ALLOWLIST.has(cmd?.type)) {
    return { decision: 'allow', reason: 'readonly 白名单豁免信封 (§3.1)' };
  }
  // 需信封类 (§3.1 默认): grant/envelope 验证 (§4.1 step2-7: 解信封→验签名→canonical→intent⊆grant→nonce[M0c-3])。
  // 批3 stub — 实现在 app provision 组件批。armed=on 到此=arm 前提被违反(不该发生)。
  if (!GRANT_ENVELOPE_IMPLEMENTED) {
    // 防御性 fail-closed (理论不可达: armed=on+stub 已被模块加载 throw 拦; 此处双保险)。
    return { decision: 'deny', reason: 'app grant/envelope 验证未实现 (stub) — fail-closed (arm 前提焊死不该到此)' };
  }
  // [app provision 组件批实现]: 完整 grant/envelope 验证链。
  return { decision: 'deny', reason: 'app 路径完整验证待 app provision 组件批实现' };
}
