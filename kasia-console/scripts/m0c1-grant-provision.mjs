#!/usr/bin/env node
// M0c-1 grant provision — operator 离线带外脚本 (grant registry 唯一写入方)
// 设计: docs/2026-07-23-m0c-1-app-provision-design.md §4 + 母卡 §4.3 (M1-5 静态可枚举)
//
// 🔴 信任根焊死: 本脚本 = m0c1_app_grants 全仓唯一写入方 (operator 本机手跑, 直写 DB)。
//   零 HTTP 写路径 / 零 IPC 写路径 / 不经共享 ingest secret / 不经 A 能力网关 / 不新增任何
//   relay IPC provision 命令 — 场景 A (被攻陷应用) 结构上够不到 provision (§6-7)。
//   任何请求处理代码 (HTTP handler/IPC handler/daemon tick) 出现本表写入 = diff 审打回。
// 🔴 app 私钥不入库: gen-key 只打印, operator 带外交付 app; registry 只存公钥 (app_pubkey)。
//
// 用法 (operator 手跑, cwd 任意):
//   node kasia-console/scripts/m0c1-grant-provision.mjs gen-key
//   node kasia-console/scripts/m0c1-grant-provision.mjs issue \
//     --app-key-id <id> --app-pubkey <xonly-hex> --commands <a,b,c> --relay <relay_node_id[,..]> \
//     --network <testnet-12> --payee <addr1,addr2>(涉款命令必传, 见下方) [--source <addr1,addr2>] \
//     [--max-amount-kas <N>] [--market <m1,m2>] [--branch <b1,b2>] [--valid-days <30>] \
//     [--intent-version <1>] [--db <path>]
//     (--source = Path B pilot 围栏 §2.1: custodial_transfer 限定 fromAddress 出账源钱包集合)
//     (--payee 对涉款命令[如 custodial_transfer]必传, 缺省即拒绝签发不写库——见下方 issue 分支
//      MONEY_MOVING_COMMANDS 检查; synopsis 里特意不给它套 [] 方括号, 跟其余真可选参数区分开,
//      避免 operator 一眼扫过 usage 就把它当"全局可选"——只对纯只读/非涉款 grant 才真可省略)
//   node kasia-console/scripts/m0c1-grant-provision.mjs revoke --grant-id <G> [--db <path>]
//   node kasia-console/scripts/m0c1-grant-provision.mjs list [--db <path>]
//
// scope 语义 (schema 单一真相源 src/db/m0c1-grant-registry-schema.js): 未传的维度列存 NULL =
//   该维度未授权 → relay gate 对触及该维度的 intent 一律拒 (缺维度默认最严), 不是"不限制"。

import { randomUUID, randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { M0C1_GRANT_TABLE, M0C1_GRANT_DDL } from '../src/db/m0c1-grant-registry-schema.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = resolve(join(__dir, '..', 'data', 'console.db'));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
    else out._.push(a);
  }
  return out;
}

function openDb(args) {
  const db = new Database(args.db ? resolve(args.db) : DEFAULT_DB);
  // 幂等建表 (与 migrate v190 同一 DDL 源): console 未重启装载 v190 前 operator 也能先 provision。
  const has = db.prepare("SELECT count(*) AS cnt FROM sqlite_master WHERE type='table' AND name=?")
    .get(M0C1_GRANT_TABLE).cnt > 0;
  if (!has) db.exec(M0C1_GRANT_DDL);
  return db;
}

function csv(v) { return String(v).split(',').map((s) => s.trim()).filter(Boolean); }

function kasToSompiInt(s) {
  const m = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`--max-amount-kas 非法 KAS 十进制: ${s}`);
  return (BigInt(m[1]) * 100000000n + BigInt((m[2] || '').padEnd(8, '0'))).toString();
}

const XONLY_HEX = /^[0-9a-f]{64}$/i;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (cmd === 'gen-key') {
    // app 密钥对生成: 私钥只打印带外交付, 绝不写任何文件/DB。
    const kaspa = await import('kaspa-wasm');
    const privHex = randomBytes(32).toString('hex');
    const priv = new kaspa.PrivateKey(privHex);
    const xonly = priv.toPublicKey().toXOnlyPublicKey().toString();
    console.log('app 私钥 (⚠ 带外交付 app, 不入库, 本脚本不落盘):');
    console.log(`  ${privHex}`);
    console.log('app 公钥 (x-only, issue 时作 --app-pubkey 入 registry):');
    console.log(`  ${xonly}`);
    return;
  }

  if (cmd === 'issue') {
    for (const req of ['app-key-id', 'app-pubkey', 'commands', 'relay', 'network']) {
      if (!args[req]) { console.error(`缺 --${req}`); process.exit(1); }
    }
    if (!XONLY_HEX.test(args['app-pubkey'])) { console.error('--app-pubkey 须为 64 位 hex (x-only)'); process.exit(1); }
    // Codex 三审 A3: --payee 对涉款命令(如 custodial_transfer)必须显式传, 否则 payee_scope 写 NULL
    // ("缺维度默认最严", relay 会拒所有触及 payee 的 intent)——技术上是 fail-closed 安全的, 但会
    // 让 operator 以为 grant 签发成功、pilot 却整体不可用(排错噪音), 尤其 Path B pilot 首签就该
    // 是收窄成单 smoke 目标的 singleton payee_scope。commands 里没有涉款命令的一般用途 grant(如纯
    // 只读 grant)不强制——payee_scope 对它们本来就是不相关维度, 硬性要求会过度约束通用工具。
    const MONEY_MOVING_COMMANDS = ['custodial_transfer'];
    const commandList = csv(args.commands);
    if (commandList.some((c) => MONEY_MOVING_COMMANDS.includes(c)) && !args.payee) {
      console.error(`--payee 必传（commands 含涉款命令 ${MONEY_MOVING_COMMANDS.filter((c) => commandList.includes(c)).join(',')}，缺省会让 payee_scope=NULL 导致所有 intent 被拒，非"不限制"）`);
      process.exit(1);
    }
    const db = openDb(args);
    const grantId = randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const validDays = Number(args['valid-days'] || 30);
    if (!Number.isFinite(validDays) || validDays <= 0) { console.error('--valid-days 非法'); process.exit(1); }
    const row = {
      grant_id: grantId,
      app_key_id: args['app-key-id'],
      app_pubkey: args['app-pubkey'].toLowerCase(),
      allowed_commands: JSON.stringify(csv(args.commands)),
      typed_intent_version: Number(args['intent-version'] || 1),
      relay_scope: JSON.stringify(csv(args.relay)),
      network: args.network,
      market_scope: args.market ? JSON.stringify(csv(args.market)) : null,
      outpoint_scope: null, // 复杂结构维度精判归 M0c-2, 本脚本乙期不放开
      branch_scope: args.branch ? JSON.stringify(csv(args.branch)) : null,
      payee_scope: args.payee ? JSON.stringify(csv(args.payee)) : null,
      source_scope: args.source ? JSON.stringify(csv(args.source)) : null, // Path B pilot 围栏 §2.1: 限定 fromAddress 出账源钱包集合
      max_amount_sompi: args['max-amount-kas'] ? kasToSompiInt(args['max-amount-kas']) : null,
      max_cumulative_sompi: null, // 累计上限 enforcement 归 M0c-3 审计派生
      max_fee_sompi: null,
      valid_from: nowSec,
      valid_until: nowSec + Math.floor(validDays * 86400),
      grant_version: 1,
      created_at: nowSec,
    };
    db.prepare(`
      INSERT INTO ${M0C1_GRANT_TABLE} (
        grant_id, app_key_id, app_pubkey, allowed_commands, typed_intent_version,
        relay_scope, network, market_scope, outpoint_scope, branch_scope, payee_scope, source_scope,
        max_amount_sompi, max_cumulative_sompi, max_fee_sompi,
        valid_from, valid_until, grant_version, created_at
      ) VALUES (
        @grant_id, @app_key_id, @app_pubkey, @allowed_commands, @typed_intent_version,
        @relay_scope, @network, @market_scope, @outpoint_scope, @branch_scope, @payee_scope, @source_scope,
        @max_amount_sompi, @max_cumulative_sompi, @max_fee_sompi,
        @valid_from, @valid_until, @grant_version, @created_at
      )
    `).run(row);
    console.log(`grant 签发: grant_id=${grantId}`);
    console.log(`  app_key_id=${row.app_key_id} commands=${row.allowed_commands} relay=${row.relay_scope}`);
    console.log(`  network=${row.network} payee=${row.payee_scope} max_amount_sompi=${row.max_amount_sompi}`);
    console.log(`  有效期: ${new Date(row.valid_from * 1000).toISOString()} → ${new Date(row.valid_until * 1000).toISOString()}`);
    return;
  }

  if (cmd === 'revoke') {
    if (!args['grant-id']) { console.error('缺 --grant-id'); process.exit(1); }
    const db = openDb(args);
    const r = db.prepare(`UPDATE ${M0C1_GRANT_TABLE} SET revoked = 1, revoked_at = ? WHERE grant_id = ? AND revoked = 0`)
      .run(Math.floor(Date.now() / 1000), args['grant-id']);
    if (r.changes === 0) { console.error('未找到未吊销的该 grant_id'); process.exit(1); }
    console.log(`grant 已吊销: ${args['grant-id']} (relay fresh 读 → 下条命令即拒, §6-11)`);
    return;
  }

  if (cmd === 'list') {
    const db = openDb(args);
    const rows = db.prepare(`
      SELECT grant_id, app_key_id, allowed_commands, network, revoked, valid_until
      FROM ${M0C1_GRANT_TABLE} ORDER BY created_at DESC
    `).all();
    if (rows.length === 0) { console.log('(registry 空)'); return; }
    for (const r of rows) {
      console.log(`${r.grant_id}  app=${r.app_key_id}  cmds=${r.allowed_commands}  net=${r.network}`
        + `  revoked=${r.revoked}  until=${new Date(r.valid_until * 1000).toISOString()}`);
    }
    return;
  }

  console.error('用法: gen-key | issue | revoke | list (详见文件头注释)');
  process.exit(1);
}

main().catch((e) => { console.error(`[m0c1-grant-provision] 失败: ${e.message}`); process.exit(1); });
