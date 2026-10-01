// tokens.js — KCC-20 代币定义 API(从 proto.js 搬出, Bettor 2026-09-23T06-53Z 派工·D-017 授权的 KCC-20
//   代币机制的一部分，已在主网真实结算过一次·市场 a59c7b48)。
// 纯 DB(proto_token_defs)，不上链，不产生任何可花费余额；只迁移，逻辑与 proto.js 原版逐字节相同。
// 页面路由 GET /tokens、GET /tokens/create(渲染 .eta)留在 index.js 原处不动，本文件只提供它们调用的
// 两条 API：POST /api/tokens/create、GET /api/tokens。
//
// D-035(2026-09-27·Owner批·NWT审零MUST) §③④ 实现: KTT v2 铸币/转账/查阅——复用本文件而不另起页面
// 体系(Bettor 派工原话)。与上面 proto_token_defs(纯元数据登记簿)是两回事, 不混表, 新路由/新表
// (ktt_holdings_ledger, migrate.js v218)独立。设计: docs/2026-09-27-j2-ktt-wallet-mint-panel-design-v0.1.md。
// 真实 simnet 广播证据: docs/provenance/2026-09-27-j2-ktt-v2-simnet/(8 笔真实 txid, 含 3 条对抗拒绝)。
//
// 🔴 D-035 NWT diff 审 MUST 闭合(2026-09-27, docs/iteration/j1-inbox/2026-09-27T13-55Z-nwt-VERDICT-
// d035-ktt-v2-impl-diff-review.md §⑥): mint/transfer 两条会花 relay 真实 KAS 手续费的路由原先零鉴权
// /无开关/无限流/relay_id 由调用方裸传可指向任意 relay。照本仓既有先例(MRC-capability-gateway-
// wallet-transfer: capability.js 的 GATEWAY_ENABLED/CUSTODIAL_RELAY_ID/checkRateLimit 三件套)补齐:
//   ① KTT_PANEL_ENABLED 默认关, 关时 mint/transfer 403(holdings 只读不受限)；
//   ② relay_id 不再由调用方指定——服务端读 env KTT_PANEL_RELAY_ID(单一专用 relay), 未配置即拒；
//   ③ 限流: 每分钟 + 每日两个窗口(env 可调, 默认保守 10/分、200/日), 超限 429；
//   ④ relay 侧 ktt_v2_* 命令同样校验来源 relay 与开关(纵深, 见 p2sh.mjs unlockKttV2Mint/Transfer)。
// Bettor 派工原话, 走①既有先例, 不新起设计。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { sendCommandAsync } from '../services/relay-manager.js';
import { computeKttV2TokenArtifact, KTT_V2_SCHEME_PUBKEY, KTT_V2_SCHEME_COVENANT_ID } from '../lib/pool-bshard-artifacts.mjs';

const nowIso = () => new Date().toISOString();

// proto.js 的 PUBLIC_TOKEN_DEF_COLS 同款列清单(永不 SELECT *——同一条 MUST 在这里独立复制一份，不跨
// 文件依赖 proto.js，避免这个新位置将来又被 proto-v0 删除清单牵连)。
const PUBLIC_TOKEN_DEF_COLS = 'id, name, ticker, description, default_denomination, created_at';

const HEX32 = /^[0-9a-fA-F]{64}$/;

// ── 指定数量铸币(Bettor 2026-10-02 派工, Owner 2026-10-02「测试币非常重要, 大大减小开发成本」) ──────────
// 代币数量 = KanetTestTokenV2 的 State.amount(redeem 脚本里的整数状态字段), 与 UTXO 锁的 KAS 面值无关; 合约只要求
// 输出 value>0。所以铸币时代币 UTXO 只需锁"最小可接受 KAS", 其余 funding 找零回 relay。
// 🔴 最小锁量按节点真共识实测定(simnet, docs/provenance/2026-10-02-j2-ktt-mint-amount/README.md):
//   covenant 输出(KIP-9 plurality p=2)的 storage mass ≈ C·p²/v = 4e12/v 克, 节点最低中继费 100 sompi/克。
//   · 理论硬下限 v≥8,000,000 sompi(mass≤500,000 上限), 但那时 mint/transfer 手续费各要 ~0.5 KAS;
//   · 转账 handler 的手续费是固定 6,500,000(本次不改), 要使它对任意大小的手续费 UTXO 都够付, 需
//     4e12/v ≤ 65,000 ⇒ v ≥ 61.6M; 取 70,000,000 sompi(0.7 KAS)留余量: mint 手续费≈0.063 KAS、transfer
//     手续费 0.065 KAS(均实测落链)。v=40,000,000 实测 transfer 被 pre-submit mass 闸拒(mass 96,507 → floor 9.65M>6.5M)。
//   ⇒ 铸多少个 KTT 都只花 ≈0.7 KAS 锁量 + ≈0.06 KAS 手续费(原来: 整个 funding UTXO 全锁, 每 1 KTT=1 sompi)。
export const KTT_V2_MIN_LOCK_SOMPI = 70_000_000n;
// 找零不能太小: 找零输出(p=1)自己也有 storage mass C/chg; 要求 funding ≥ 锁量 + 0.5 KAS 余量(找零≥~0.43 KAS ⇒ ~2.3k 克)。
const KTT_V2_MIN_FUNDING_HEADROOM_SOMPI = 50_000_000n;
const KTT_V2_MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER); // 2^53-1: relay/ctor 经 JS Number 传整数, 超过会失精度(Codex R11 ②)

/** 严格解析"整数字符串"数量(也接受 JS 安全整数 number); 非法/≤0/超 2^53-1 返回 { error }。全程 BigInt, 不经 Number 中转。 */
export function parseKttAmount(raw) {
  let s;
  if (typeof raw === 'string') s = raw.trim();
  else if (typeof raw === 'number' && Number.isSafeInteger(raw)) s = String(raw);
  else return { error: 'amount 必须是整数字符串(例如 "1000000")' };
  if (!/^[0-9]+$/.test(s)) return { error: 'amount 必须是正整数(只含数字, 无小数点/符号/科学计数法)' };
  const n = BigInt(s);
  if (n <= 0n) return { error: 'amount 必须 > 0' };
  if (n > KTT_V2_MAX_AMOUNT) return { error: `amount 超过上限 ${KTT_V2_MAX_AMOUNT}(2^53-1, 超过会在 JS Number 链路上失精度)` };
  return { amount: n };
}

function relayRc(relayId) {
  // origin='app'(五值之一, R-SENDCMD-ORIGIN-REQUIRED): 面板是用户在 UI 上点按钮触发的应用层动作,
  // 不是后台 daemon tick(那是 'internal')也不是运营者直接操作(那是 'operator')。
  return (cmd) => sendCommandAsync(relayId, cmd, 90000, 'app');
}

function resolveRelayAddress(relayId) {
  const row = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(relayId);
  if (!row?.address) throw new Error(`relay_id=${relayId} 未找到或无 address(relay_nodes 表)`);
  return row.address;
}

// ── D-035 NWT MUST §① 开关 + §② relay_id 收紧 ──────────────────────────────────────
// 默认关(未设或非'1' → 关)。同 capability.js GATEWAY_ENABLED() 同款写法。
const KTT_PANEL_ENABLED = () => process.env.KTT_PANEL_ENABLED === '1';
// 🔴 不再接受调用方传入的 relay_id(mint/transfer 两条花钱路由)——服务端固定读这一个专用 relay,
// 未配置时拒绝, 不 fallback 到"随便挑一个 relay_nodes 表里的行"(同 capability.js CUSTODIAL_RELAY_ID()
// 的 Codex pre-activation C 项修正精神: 漏配 = 拒绝服务, 不是静默降级到任意身份)。
const KTT_PANEL_RELAY_ID = () => process.env.KTT_PANEL_RELAY_ID || null;

// ── D-035 NWT MUST §③ 限流: 双窗口(分钟+日), env 可调, 进程外持久化(ktt_panel_rate_limit_log,
//   migrate.js v219)。keyed by action('mint'/'transfer')——不是 grant_id(本路由固定只服务一个
//   KTT_PANEL_RELAY_ID, 无需按调用方区分), 模式照抄 capability.js checkRateLimit() 的 count+insert
//   原子事务 + 自清理 + fail-closed, 同一套先例第二次复用。
const KTT_PANEL_RATE_LIMIT_PER_MIN = () => {
  const n = Number(process.env.KTT_PANEL_RATE_LIMIT_PER_MIN);
  return Number.isFinite(n) && n > 0 ? n : 10;
};
const KTT_PANEL_RATE_LIMIT_PER_DAY = () => {
  const n = Number(process.env.KTT_PANEL_RATE_LIMIT_PER_DAY);
  return Number.isFinite(n) && n > 0 ? n : 200;
};
const KTT_PANEL_RATE_LIMIT_MIN_MS = 60 * 1000;
const KTT_PANEL_RATE_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
const KTT_PANEL_RATE_LIMIT_CLEANUP_MULTIPLE = 10; // 同 capability.js: 清理超过 10 倍最大窗口(日窗口)的旧行

// count+insert 原子化(同 capability.js _rateLimitTxn 精神: better-sqlite3 .transaction() 单事务,
// 杜绝两个并发请求都读到 count<limit 都插入的竞态)。一次事务同时检两个窗口, 任一超限即拒、不插入。
const _kttRateLimitTxn = sqlite.transaction((action, now, minWindowStart, dayWindowStart, perMin, perDay) => {
  const { cnt: minCnt } = sqlite.prepare('SELECT COUNT(*) AS cnt FROM ktt_panel_rate_limit_log WHERE action = ? AND requested_at >= ?').get(action, minWindowStart);
  if (minCnt >= perMin) return { limited: true, window: 'minute', limit: perMin };
  const { cnt: dayCnt } = sqlite.prepare('SELECT COUNT(*) AS cnt FROM ktt_panel_rate_limit_log WHERE action = ? AND requested_at >= ?').get(action, dayWindowStart);
  if (dayCnt >= perDay) return { limited: true, window: 'day', limit: perDay };
  sqlite.prepare('INSERT INTO ktt_panel_rate_limit_log (action, requested_at) VALUES (?, ?)').run(action, now);
  return { limited: false };
});

/**
 * 返回 { ok:true } 或 { ok:false, error }。fail-closed: DB 异常算拒绝, 不放行(同 capability.js
 * checkRateLimit 的 catch 分支精神)。超限不记录本次尝试(不让被拒请求继续膨胀计数)。
 */
function checkKttPanelRateLimit(action) {
  const now = Date.now();
  try {
    sqlite.prepare('DELETE FROM ktt_panel_rate_limit_log WHERE requested_at < ?').run(now - KTT_PANEL_RATE_LIMIT_DAY_MS * KTT_PANEL_RATE_LIMIT_CLEANUP_MULTIPLE);
    const minWindowStart = now - KTT_PANEL_RATE_LIMIT_MIN_MS;
    const dayWindowStart = now - KTT_PANEL_RATE_LIMIT_DAY_MS;
    const perMin = KTT_PANEL_RATE_LIMIT_PER_MIN();
    const perDay = KTT_PANEL_RATE_LIMIT_PER_DAY();
    const { limited, window, limit } = _kttRateLimitTxn(action, now, minWindowStart, dayWindowStart, perMin, perDay);
    if (limited) {
      return { ok: false, error: `ktt panel 限流(${action}): 每${window === 'minute' ? '分钟' : '天'}至多 ${limit} 次请求` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '限流检查异常(fail-closed 拒): ' + (e?.message || 'unknown') };
  }
}

/**
 * mint/transfer 两条花钱路由的共用前置闸: 开关 → relay_id 就绪 → 限流。三步任一失败即拒, 不执行
 * 到后面的余额查询/合约构建。返回 { ok:true, relayId } 或 { ok:false, code, error }。
 */
function kttPanelGate(action) {
  if (!KTT_PANEL_ENABLED()) {
    return { ok: false, code: 403, error: 'KTT panel disabled (KTT_PANEL_ENABLED != 1)' };
  }
  const relayId = KTT_PANEL_RELAY_ID();
  if (!relayId) {
    return { ok: false, code: 403, error: 'KTT panel 未配置专用 relay(KTT_PANEL_RELAY_ID 未设, 拒绝 fallback 到其他 relay 身份)' };
  }
  const rl = checkKttPanelRateLimit(action);
  if (!rl.ok) {
    return { ok: false, code: 429, error: rl.error };
  }
  return { ok: true, relayId };
}

export async function registerTokenRoutes(fastify) {
  fastify.post('/api/tokens/create', async (request, reply) => {
    const { name, ticker, faceValue, description } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ ok: false, error: 'name required' });
    if (!ticker?.trim()) return reply.code(400).send({ ok: false, error: 'ticker required' });
    const id = randomUUID();
    const ts = nowIso();
    sqlite.prepare(`
      INSERT INTO proto_token_defs (id, name, ticker, description, default_denomination, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), ticker.trim(), description || null, Number.isFinite(Number(faceValue)) ? Number(faceValue) : null, ts);
    return reply.send({ ok: true, id, name: name.trim(), ticker: ticker.trim(), created_at: ts });
  });

  fastify.get('/api/tokens', async (request, reply) => {
    const rows = sqlite.prepare(`SELECT ${PUBLIC_TOKEN_DEF_COLS} FROM proto_token_defs ORDER BY created_at DESC`).all();
    return reply.send({ ok: true, tokens: rows });
  });

  // ── D-035 §③ 铸币: 任何人可铸任意数量到任意地址(owner_scheme 决定"地址"含义) ──
  fastify.post('/api/ktt/mint', async (request, reply) => {
    const gate = kttPanelGate('mint');
    if (!gate.ok) return reply.code(gate.code).send({ ok: false, error: gate.error });
    const relay_id = gate.relayId;
    const { owner_scheme, owner_hex, amount: amountRaw } = request.body || {};
    const scheme = Number(owner_scheme);
    if (scheme !== KTT_V2_SCHEME_PUBKEY && scheme !== KTT_V2_SCHEME_COVENANT_ID) {
      return reply.code(400).send({ ok: false, error: `owner_scheme must be ${KTT_V2_SCHEME_PUBKEY}(pubkey) or ${KTT_V2_SCHEME_COVENANT_ID}(covenant-id), got ${owner_scheme}` });
    }
    if (!HEX32.test(String(owner_hex || ''))) return reply.code(400).send({ ok: false, error: 'owner_hex must be 32-byte hex' });
    const parsedAmount = parseKttAmount(amountRaw);
    if (parsedAmount.error) return reply.code(400).send({ ok: false, error: parsedAmount.error });
    const tokenAmount = parsedAmount.amount;
    try {
      const fundingAddress = resolveRelayAddress(relay_id);
      const rc = relayRc(relay_id);
      const utxoResp = await rc({ type: 'get_address_utxos', address: fundingAddress });
      const needFunding = KTT_V2_MIN_LOCK_SOMPI + KTT_V2_MIN_FUNDING_HEADROOM_SOMPI;
      const utxos = (utxoResp?.utxos || utxoResp?.entries || []).filter(u => BigInt(u.amount ?? u.entry?.amount ?? 0) >= needFunding);
      if (!utxos.length) return reply.code(409).send({ ok: false, error: `relay ${relay_id}(${fundingAddress})没有足够的资金 UTXO(需要 >= ${needFunding} sompi: 代币 UTXO 锁 ${KTT_V2_MIN_LOCK_SOMPI} + 找零余量 + 手续费)` });
      const fundUtxo = utxos[0];
      // 代币数量 = State.amount(烤进 redeem); 代币 UTXO 只锁最小 KAS, 余额由 relay 扣手续费后找零回 funding 地址。
      const seedSompi = KTT_V2_MIN_LOCK_SOMPI;
      const artifact = computeKttV2TokenArtifact({ amount: Number(tokenAmount), ownerScheme: scheme, ownerBytesHex: owner_hex.toLowerCase() });
      const mintCmd = {
        type: 'ktt_v2_mint',
        ktt: { redeem_hex: Buffer.from(artifact.script).toString('hex'), seed_sompi: seedSompi.toString(), change_address: fundingAddress },
        inputs: { funding: { address: fundingAddress, outpointTxid: fundUtxo.outpoint?.transactionId ?? fundUtxo.transactionId, index: fundUtxo.outpoint?.index ?? fundUtxo.index } },
      };
      const result = await rc(mintCmd);
      if (!result?.txId) return reply.code(502).send({ ok: false, error: result?.error || 'relay mint 失败(无 txId 回执)' });
      const id = randomUUID();
      const ts = nowIso();
      sqlite.prepare(`
        INSERT INTO ktt_holdings_ledger (id, txid, output_index, p2sh_address, amount_sompi, owner_hex, owner_scheme, contract_version, minted_by, created_at, last_verified_at)
        VALUES (?, ?, 0, ?, ?, ?, ?, 'v2', ?, ?, ?)
      `).run(id, result.txId, result.kttAddress, tokenAmount.toString(), owner_hex.toLowerCase(), scheme, relay_id, ts, ts);
      // amount_sompi 列名是历史遗留: 它存的是【代币数量】(State.amount), 不是 KAS 面值(旧记录两者恰好相等)。
      return reply.send({ ok: true, id, txid: result.txId, p2sh_address: result.kttAddress, amount_sompi: tokenAmount.toString(), amount: tokenAmount.toString(), locked_kas_sompi: seedSompi.toString(), fee_sompi: result.feeSompi ?? null, owner_scheme: scheme, owner_hex: owner_hex.toLowerCase() });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `ktt mint failed: ${e.message}` });
    }
  });

  // ── D-035 §④ 转账: 钱包持有(owner_scheme=0x00)的 KTT 转给另一地址 + 找零 ──
  fastify.post('/api/ktt/transfer', async (request, reply) => {
    const gate = kttPanelGate('transfer');
    if (!gate.ok) return reply.code(gate.code).send({ ok: false, error: gate.error });
    const relay_id = gate.relayId;
    const { ledger_id, dest_owner_hex, dest_owner_scheme } = request.body || {};
    if (!ledger_id) return reply.code(400).send({ ok: false, error: 'ledger_id required(要转账的那笔 ktt_holdings_ledger 记录)' });
    const destScheme = Number(dest_owner_scheme);
    if (destScheme !== KTT_V2_SCHEME_PUBKEY && destScheme !== KTT_V2_SCHEME_COVENANT_ID) {
      return reply.code(400).send({ ok: false, error: `dest_owner_scheme must be ${KTT_V2_SCHEME_PUBKEY} or ${KTT_V2_SCHEME_COVENANT_ID}` });
    }
    if (!HEX32.test(String(dest_owner_hex || ''))) return reply.code(400).send({ ok: false, error: 'dest_owner_hex must be 32-byte hex' });
    try {
      const row = sqlite.prepare('SELECT * FROM ktt_holdings_ledger WHERE id = ? AND spent_txid IS NULL').get(ledger_id);
      if (!row) return reply.code(404).send({ ok: false, error: `ledger_id=${ledger_id} 未找到或已标记花费` });
      if (row.owner_scheme !== KTT_V2_SCHEME_PUBKEY) return reply.code(400).send({ ok: false, error: '只有 owner_scheme=0x00(pubkey-owned) 的记录能走这条转账入口(签名花费)——covenant-owned 的转账需要在场共花, 不是简单转账' });

      const fundingAddress = resolveRelayAddress(relay_id);
      const rc = relayRc(relay_id);
      const feeResp = await rc({ type: 'get_address_utxos', address: fundingAddress });
      const feeUtxos = (feeResp?.utxos || feeResp?.entries || []).filter(u => BigInt(u.amount ?? u.entry?.amount ?? 0) > 6_500_000n);
      if (!feeUtxos.length) return reply.code(409).send({ ok: false, error: `relay ${relay_id} 没有足够的手续费 UTXO(需要 > 6,500,000 sompi)` });
      const feeUtxo = feeUtxos[0];

      const sourceArtifact = computeKttV2TokenArtifact({ amount: Number(row.amount_sompi), ownerScheme: row.owner_scheme, ownerBytesHex: row.owner_hex });
      const destArtifact = computeKttV2TokenArtifact({ amount: Number(row.amount_sompi), ownerScheme: destScheme, ownerBytesHex: dest_owner_hex.toLowerCase() });

      const xferCmd = {
        type: 'ktt_v2_transfer',
        ktt: {
          source_redeem_hex: Buffer.from(sourceArtifact.script).toString('hex'),
          dest_redeem_hex: Buffer.from(destArtifact.script).toString('hex'),
          dest_owner_hex: dest_owner_hex.toLowerCase(),
          dest_owner_scheme: destScheme,
          amount: String(row.amount_sompi), // 代币数量(State.amount); 新铸币 UTXO 的 KAS 面值≠它, relay 不能再拿面值当数量
        },
        inputs: {
          ktt: { address: row.p2sh_address, outpointTxid: row.txid, index: row.output_index },
          fee: { address: fundingAddress, outpointTxid: feeUtxo.outpoint?.transactionId ?? feeUtxo.transactionId, index: feeUtxo.outpoint?.index ?? feeUtxo.index },
        },
        outputs: { fee_change_address: fundingAddress },
      };
      const result = await rc(xferCmd);
      if (!result?.txId) return reply.code(502).send({ ok: false, error: result?.error || 'relay transfer 失败(无 txId 回执)' });

      const ts = nowIso();
      const newId = randomUUID();
      const tx = sqlite.transaction(() => {
        sqlite.prepare('UPDATE ktt_holdings_ledger SET spent_txid = ? WHERE id = ?').run(result.txId, ledger_id);
        sqlite.prepare(`
          INSERT INTO ktt_holdings_ledger (id, txid, output_index, p2sh_address, amount_sompi, owner_hex, owner_scheme, contract_version, minted_by, created_at, last_verified_at)
          VALUES (?, ?, 0, ?, ?, ?, ?, 'v2', ?, ?, ?)
        `).run(newId, result.txId, result.destAddress, row.amount_sompi, dest_owner_hex.toLowerCase(), destScheme, relay_id, ts, ts);
      });
      tx();
      return reply.send({ ok: true, new_ledger_id: newId, txid: result.txId, p2sh_address: result.destAddress, amount_sompi: row.amount_sompi, dest_owner_hex: dest_owner_hex.toLowerCase(), dest_owner_scheme: destScheme });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `ktt transfer failed: ${e.message}` });
    }
  });

  // ── D-035 §④ 查阅: 三层("自己的回执"已由铸币/转账两条 API 落表; 这里做本地记录列出 + 逐笔回链核实) ──
  // 🔴 诚实边界(设计稿④已写明, 这里不重复论证只重申措辞纪律): 本接口返回"本面板记录中"与
  // owner_hex/relay_id 相关的持仓, 不是"该 owner 的全部持仓"——没有反查表存在, 也不做任何暗示
  // "完整性"的字样。
  fastify.get('/api/ktt/holdings', async (request, reply) => {
    const { owner_hex, relay_id, verify } = request.query || {};
    if (!owner_hex && !relay_id) return reply.code(400).send({ ok: false, error: 'owner_hex or relay_id required' });
    let rows;
    if (owner_hex) {
      if (!HEX32.test(String(owner_hex))) return reply.code(400).send({ ok: false, error: 'owner_hex must be 32-byte hex' });
      rows = sqlite.prepare('SELECT * FROM ktt_holdings_ledger WHERE owner_hex = ? ORDER BY created_at DESC').all(owner_hex.toLowerCase());
    } else {
      rows = sqlite.prepare('SELECT * FROM ktt_holdings_ledger WHERE minted_by = ? ORDER BY created_at DESC').all(relay_id);
    }
    // verify=1: 逐笔回链核实是否仍未花(第三层, 需要 relay_id 才能发起只读 RPC 查询)。
    if (verify === '1' && relay_id) {
      const rc = relayRc(relay_id);
      const ts = nowIso();
      for (const r of rows) {
        if (r.spent_txid) continue; // 已经知道花了, 不需要再问链
        try {
          const resp = await rc({ type: 'get_address_utxos', address: r.p2sh_address });
          const stillThere = (resp?.utxos || resp?.entries || []).some(u => (u.outpoint?.transactionId ?? u.transactionId) === r.txid);
          sqlite.prepare('UPDATE ktt_holdings_ledger SET last_verified_at = ? WHERE id = ?').run(ts, r.id);
          r.last_verified_at = ts;
          r.still_unspent = stillThere;
        } catch (e) {
          r.verify_error = e.message; // 核实失败不代表已花——如实标注"没核成", 不猜
        }
      }
    }
    return reply.send({ ok: true, note: '本列表 = 本面板记录中与查询条件相关的持仓, 不是该 owner 的全部持仓(无反查索引, 见设计稿§④局限)', holdings: rows });
  });
}
