// pool-market-anchor.mjs — CP4 §4 身份锚 provenance (J2, 2026-08-13, 方案 A · Codex 66d5f287 两 MUST).
//
// 承重问题(Codex 311f12f8 + NWT ②): buildRefundCommand 原先收 `expectedRootTmplHashHex` = **调用方任意 32B 串**,
// builder 不约束来源 ⇒ 循环调用方(拿同一 poolRedeem 去 state 窗、hash 剩余、当 expected 传回)使跨边界比对
// 同义反复、白验。修法 = 把锚从「自由参数」改成「builder/数据访问模块自己拥有的命名可信 resolver」：
//
//   构造 artifact(computeMarketGenesis 烤进 PoolLeaf ctor) → write-once 市场承诺(pool_markets.root_tmpl_hash)
//   → 命名 marketId resolver(getMarketRootAnchor) → builder 校验 → relay
//
//   ✗ 非: 退款调用方 → 任意 hash/getter → builder。
//
// 🔴 **不可用**才叫结构、**不该用**只是纪律(J1 (218) 判对 Codex 要害): builder 的公共签名里**没有**任何
//    "可以传 hash/getter 进来"的口子; 它只收 marketId + db 句柄, 自己调本模块的 resolver。DI(注入 db)只许测试。
//
// 权威记录: docs/2026-08-13-j2-cp4-identity-anchor-typed-source-design.md · COORD-LEDGER (216)-(225)。
// 先例: pool_markets.fee_rules 的 write-once trigger `trg_pool_markets_fee_rules_write_once`(migrate.js v184b)。

import { blake2b } from '@noble/hashes/blake2b';

// pool_markets 承载建市身份锚的列名(v197 加)。64 hex(32B) blake2b(prefix‖suffix)。
export const ROOT_TMPL_HASH_COLUMN = 'root_tmpl_hash';

// write-once trigger 名(照 fee_rules 先例族命名)。
export const ROOT_TMPL_HASH_TRIGGER_NAME = 'trg_pool_markets_root_tmpl_hash_write_once';

// 🔴 **单源** write-once trigger DDL —— migrate.js(v197) 与 DB 层测试都 import 此常量, 不各存一份(防漂)。
//    语义与 fee_rules 那条同构: 已有值的行禁改写/清空(RAISE ABORT); NULL→值 允许一次; 等值 UPDATE 放行
//    (settler 整行 UPDATE 不误伤)。
export const ROOT_TMPL_HASH_WRITE_ONCE_TRIGGER_SQL = `
  CREATE TRIGGER ${ROOT_TMPL_HASH_TRIGGER_NAME}
  BEFORE UPDATE OF ${ROOT_TMPL_HASH_COLUMN} ON pool_markets
  WHEN OLD.${ROOT_TMPL_HASH_COLUMN} IS NOT NULL AND (NEW.${ROOT_TMPL_HASH_COLUMN} IS NULL OR NEW.${ROOT_TMPL_HASH_COLUMN} != OLD.${ROOT_TMPL_HASH_COLUMN})
  BEGIN
    SELECT RAISE(ABORT, 'root_tmpl_hash is write-once (CP4 §4 身份锚): committed 建市锚 禁止改写/清空');
  END
`;

// leafCtor 里 root_tmpl_hash 的槽位下标 —— pool-bshard-market-setup.mjs::computeMarketGenesis 的 leafCtor
// 第 9 项(index 8) = `ctorBytes32(rootTmplHash)`。**MUST1 结构绑定的锚**: 持久化的值必须**恰是**烤进这个
// ctor 槽的字节, 而不是事后重编/退款时从 redeem 重算的值。
export const ROOT_TMPL_HASH_CTOR_INDEX = 8;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * ctorBytes32 槽(`{kind:'array', data:[{kind:'byte',data:x}×32]}`)→ 32B hex。
 * pool-bshard-artifacts.mjs::ctorBytes32 的产物形状; 这里逆出字节以做结构绑定核对。
 */
function ctorSlotToHex(slot) {
  if (!slot || slot.kind !== 'array' || !Array.isArray(slot.data) || slot.data.length !== 32) return null;
  const bytes = slot.data.map((e) => (e && typeof e === 'object' ? e.data : e));
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  return Buffer.from(bytes).toString('hex');
}

/**
 * MUST1 结构绑定: 从 computeMarketGenesis 的产物里取出**那次构造烤进 PoolLeaf ctor 的确切** root_tmpl_hash,
 * 并证明 `gen.rootTmplHash` 与 `gen.leafCtor[8]` 的烤死字节**逐字节相等** —— 证不了绑定就抛(fail-closed),
 * 绝不持久化一个"事后重编 / 从 redeem 重算"的值。
 * @param {{rootTmplHash:string, leafCtor:Array}} gen
 * @returns {string} 64 hex(lowercase)
 */
export function deriveRootAnchorFromGenesis(gen) {
  if (!gen || typeof gen.rootTmplHash !== 'string') {
    throw new Error('deriveRootAnchorFromGenesis: gen.rootTmplHash(建市构造产出) 缺失 — fail-closed, 不默认');
  }
  const hash = gen.rootTmplHash.toLowerCase();
  if (!HEX64.test(hash)) throw new Error(`deriveRootAnchorFromGenesis: rootTmplHash 必须 32B hex, 得到 ${gen.rootTmplHash}`);
  if (!Array.isArray(gen.leafCtor)) {
    throw new Error('deriveRootAnchorFromGenesis: gen.leafCtor 数组缺失 — 无法证明锚绑定到烤进 PoolLeaf ctor 的字节 ⇒ 拒');
  }
  const bakedHex = ctorSlotToHex(gen.leafCtor[ROOT_TMPL_HASH_CTOR_INDEX]);
  if (bakedHex === null) {
    throw new Error(`deriveRootAnchorFromGenesis: leafCtor[${ROOT_TMPL_HASH_CTOR_INDEX}] 不是 32B bytes32 ctor 槽 — 无法证明绑定 ⇒ 拒`);
  }
  if (bakedHex !== hash) {
    throw new Error(`deriveRootAnchorFromGenesis: rootTmplHash(${hash.slice(0, 12)}) != 烤进 PoolLeaf ctor[${ROOT_TMPL_HASH_CTOR_INDEX}] 的字节(${bakedHex.slice(0, 12)}) — 该值证明不了"那次构造"的绑定 ⇒ 拒持久化`);
  }
  return hash;
}

/**
 * MUST1 写入点: 把建市锚持久化到 pool_markets.root_tmpl_hash(write-once, DB 层 trigger 强制)。
 * 值经 deriveRootAnchorFromGenesis 结构绑定校验 = **那次构造烤进 PoolLeaf ctor 的确切值**。
 * 建市行必须先存在(fail-closed)。write-once 由 trigger 保证(已有值改写 → RAISE ABORT)。
 * @param {object} db  (better-sqlite3 句柄; 生产=共享 console 连接)
 * @param {string} marketId  pool_markets.id
 * @param {{rootTmplHash:string, leafCtor:Array}} gen  computeMarketGenesis 产物
 * @returns {{marketId:string, anchor:string, changed:number}}
 */
export function persistMarketRootAnchor(db, marketId, gen) {
  if (!db || typeof db.prepare !== 'function') throw new Error('persistMarketRootAnchor: db 句柄(better-sqlite3)必需');
  if (!marketId || typeof marketId !== 'string') throw new Error('persistMarketRootAnchor: marketId 必需');
  const anchor = deriveRootAnchorFromGenesis(gen); // 结构绑定(证不了绑定就在这里抛)
  const row = db.prepare('SELECT id FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) throw new Error(`persistMarketRootAnchor: market ${marketId} 不存在 — 建市行必须先建 ⇒ fail-closed`);
  const stmt = db.prepare(`UPDATE pool_markets SET ${ROOT_TMPL_HASH_COLUMN} = ? WHERE id = ?`);
  const res = stmt.run(anchor, marketId);
  return { marketId, anchor, changed: res.changes };
}

/**
 * MUST2 命名可信 resolver: buildRefundCommand **自持**的取锚口。生产退款路径**只**经此函数拿锚,
 * 调用方给不了 hash/getter —— 只能给 marketId(名字), 由本函数去 write-once 列取"那次构造的承诺"。
 * 查不到 / NULL(老市场·未绑锚) ⇒ 抛(fail-closed), 绝不默认、绝不回落。
 * @param {object} db  (better-sqlite3 句柄; 生产=共享 console 连接)
 * @param {string} marketId
 * @returns {string} 64 hex(lowercase) —— 建市烤死的 root_tmpl_hash
 */
export function getMarketRootAnchor(db, marketId) {
  if (!db || typeof db.prepare !== 'function') throw new Error('getMarketRootAnchor: db 句柄(better-sqlite3)必需 — 缺失即 fail-closed');
  if (!marketId || typeof marketId !== 'string') throw new Error('getMarketRootAnchor: marketId 必需');
  const row = db.prepare(`SELECT ${ROOT_TMPL_HASH_COLUMN} AS anchor FROM pool_markets WHERE id = ?`).get(marketId);
  if (!row) throw new Error(`getMarketRootAnchor: market ${marketId} 不存在 ⇒ fail-closed(不默认不回落)`);
  if (row.anchor == null) {
    throw new Error(`getMarketRootAnchor: market ${marketId} 的 root_tmpl_hash 为 NULL(老市场 / 建市未绑锚) ⇒ fail-closed`);
  }
  const anchor = String(row.anchor).toLowerCase();
  if (!HEX64.test(anchor)) throw new Error(`getMarketRootAnchor: market ${marketId} 的 root_tmpl_hash 非 32B hex(${row.anchor}) ⇒ 拒`);
  return anchor;
}

// blake2b re-export 便于测试构造 rogue redeem 的自算 hash(证"候选自算经 legacy 参仍失败")。
export function _blake2b32Hex(buf) {
  return Buffer.from(blake2b(buf, { dkLen: 32 })).toString('hex');
}
