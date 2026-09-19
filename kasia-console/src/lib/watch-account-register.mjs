// watch-account-register.mjs — D-028: 登记只读(冷存)账户的逻辑(纯逻辑 + 注入 db/Address,无自己的进程入口;CLI = kasia-console/scripts/watch-account-register.mjs)。
// 设计 docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.2.md §2.1(NWT S-D4 / S-D5):
//   · 地址与名字【不走命令行】: 输入是文本(--from-file <仓库外路径> 或 stdin),行格式 `名字<TAB>地址[<TAB>一句话来历]`;
//   · 先规范化成 kaspa-wasm Address.toString() 再去重再入库(UNIQUE 是原文唯一,大小写/前缀变体绕得过原文);
//   · 拒绝重复: 规范化后不得已存在于 watch_accounts / relay_nodes.address / agent_wallets.address(库内值也逐个规范化后再比;解析失败的行跳过并计数);
//   · 命中"本地地址语义列"只警告并列出 表.列 与命中数(它可能曾经是本地 relay 身份,如 TN12 遗留),不拒绝;
//   · 回执(report)只含条数与每条规范化后的前缀 + 末 6 位——不回显完整地址、不回显名字;
//   · 默认 dry-run;apply=true 才写,且全有或全无(任一被拒 ⇒ 什么都不写)。
import { randomUUID } from 'node:crypto';

/** 带"本地地址"语义的列(NWT ⑤): 命中说明该地址曾是本地 relay 身份,只警告。表/列缺失则跳过。 */
export const LOCAL_ADDRESS_COLUMNS = Object.freeze([
  ['pending_actions', 'local_address'],
  ['relation_states', 'local_address'],
  ['tx_records', 'local_address'],
  ['oracle_pool_membership', 'relay_address'],
  ['oracle_stake_enrollments', 'relay_address'],
  ['reputation_summary', 'address'],
]);

/** 规范化后前缀 + 末 6 位(回执唯一允许打印的地址形态)。 */
export function shortForm(canon) { return `${canon.slice(0, 10)}...${canon.slice(-6)}`; }

/** 解析输入文本: 空行与 # 注释跳过;`名字<TAB>地址[<TAB>来历]`。格式错的行返回 { line, error }。 */
export function parseInput(text) {
  const out = [];
  String(text).split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1;
    if (/^\s*(#.*)?$/.test(raw)) return;
    const parts = raw.split('\t');
    if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) { out.push({ line, error: 'expected: name<TAB>address[<TAB>note]' }); return; }
    out.push({ line, name: parts[0].trim(), address: parts[1].trim(), note: (parts[2] || '').trim() || null });
  });
  return out;
}

function canonicalOf(Address, a) {
  try {
    if (typeof Address.validate === 'function' && !Address.validate(a)) return null;
    return new Address(a).toString();
  } catch { return null; }
}

/**
 * @param {{ db: any, entries: Array<{line:number,name?:string,address?:string,note?:string|null,error?:string}>, apply?: boolean, Address: any, now?: () => number }} p
 * @returns {{ mode: 'dry-run'|'apply', accepted: object[], rejected: object[], warnings: object[], skippedUnparseable: object, applied: number }}
 */
export function registerWatchAccounts({ db, entries, apply = false, Address, now = () => Date.now() }) {
  const rejected = [], accepted = [], warnings = [];
  const skippedUnparseable = { relay_nodes: 0, agent_wallets: 0, watch_accounts: 0 };
  const tableExists = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const canonSet = (table) => {
    const s = new Set();
    if (!tableExists(table)) return s;
    for (const r of db.prepare(`SELECT address FROM ${table} WHERE address IS NOT NULL`).all()) {
      const c = canonicalOf(Address, r.address);
      if (c) s.add(c); else skippedUnparseable[table]++;
    }
    return s;
  };
  const existing = { watch_accounts: canonSet('watch_accounts'), relay_nodes: canonSet('relay_nodes'), agent_wallets: canonSet('agent_wallets') };
  const seenInInput = new Set();
  for (const e of entries) {
    if (e.error) { rejected.push({ line: e.line, reason: `bad_line: ${e.error}` }); continue; }
    const canon = canonicalOf(Address, e.address);
    if (!canon) { rejected.push({ line: e.line, reason: 'invalid_address' }); continue; }
    if (!canon.startsWith('kaspa:')) { rejected.push({ line: e.line, short: shortForm(canon), reason: 'not_mainnet_kaspa_prefix' }); continue; }
    if (seenInInput.has(canon)) { rejected.push({ line: e.line, short: shortForm(canon), reason: 'duplicate_in_input' }); continue; }
    seenInInput.add(canon);
    const hit = ['watch_accounts', 'relay_nodes', 'agent_wallets'].find((t) => existing[t].has(canon));
    if (hit) { rejected.push({ line: e.line, short: shortForm(canon), reason: `already_in_${hit}` }); continue; }
    for (const [table, col] of LOCAL_ADDRESS_COLUMNS) {
      if (!tableExists(table)) continue;
      let cols; try { cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); } catch { continue; }
      if (!cols.includes(col)) continue;
      let hits = 0; try { hits = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${col} = ? COLLATE NOCASE`).get(canon).c; } catch { continue; }
      if (hits > 0) warnings.push({ line: e.line, short: shortForm(canon), table, column: col, hits });
    }
    accepted.push({ line: e.line, short: shortForm(canon), canon, name: e.name, note: e.note });
  }
  let applied = 0;
  if (apply && rejected.length === 0 && accepted.length > 0) {
    const ts = new Date(now()).toISOString();
    const ins = db.prepare("INSERT INTO watch_accounts (id, name, chain, network, address, custody, note, created_at, updated_at) VALUES (?, ?, 'kaspa', 'mainnet', ?, 'cold_no_key', ?, ?, ?)");
    db.transaction(() => { for (const a of accepted) { ins.run(randomUUID(), a.name, a.canon, a.note, ts, ts); applied++; } })();
  }
  return { mode: apply ? 'apply' : 'dry-run', accepted: accepted.map(({ line, short }) => ({ line, short })), rejected, warnings, skippedUnparseable, applied };
}
