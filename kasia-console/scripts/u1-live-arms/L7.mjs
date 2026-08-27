// L7 · 只读 · legacy-poisoning negative: `relay_nodes.ecdsa_pubkey_xonly` 不能替代地址派生钥。
// 🔴 不在 live 改 ecdsa_pubkey_xonly(在册禁手插活表)。证据两档(如实标注是哪一档):
//   strong  = 该 relay 的 ecdsa_pubkey_xonly 非空且 ≠ fromAddress(address) ⇒ L5/L2 若按地址钥判定, 即证该列零参与;
//   degraded = 该列为空或恰等于地址钥(live 上观察不到差异) ⇒ 降级为【临时库 N11 臂(u1-registration.test.mjs)+ 代码 grep: u1-registration.mjs 零引用 ecdsa_pubkey_xonly】。
// 用法: node scripts/u1-live-arms/L7.mjs --relay <relay_id> [--db <abs>]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setArm, openDb, one, arg, addrKeyOf, emit, fail } from './common.mjs';
setArm('L7');
const relayId = arg('--relay', '');
if (!relayId) fail('ARGS', '缺 --relay <relay_id>');
const sqlite = await openDb();
const row = one(sqlite, 'SELECT id, name, address, ecdsa_pubkey_xonly FROM relay_nodes WHERE id = ?', relayId);
if (!row) fail('RELAY_UNKNOWN', `relay_nodes 无 id=${relayId}`);
let addrKey = null; try { addrKey = await addrKeyOf(row.address); } catch (e) { fail('ADDR_PARSE', `relay.address 不可解析: ${e?.message || e}`); }
const legacy = (row.ecdsa_pubkey_xonly || '').trim().toLowerCase();
const regSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/lib/u1-registration.mjs'), 'utf8');
// 只数【代码】里的引用: 去掉 // 行注释与 /* */ 块注释后再 grep(文件头注释里写着"不查 ecdsa_pubkey_xonly", 那是说明不是引用)
const codeOnly = regSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const codeRefs = (codeOnly.match(/ecdsa_pubkey_xonly/g) || []).length;
const kind = legacy && legacy !== addrKey ? 'strong' : 'degraded';
emit('L7', codeRefs === 0 ? 'PASS' : 'FAIL', {
  evidence_kind: kind, relay: row.name, address_key: addrKey, legacy_col_present: !!legacy, legacy_equals_address_key: legacy === addrKey,
  code_refs_to_ecdsa_col_in_u1_registration: codeRefs,
  note: kind === 'strong' ? 'L2/L5 的判定若按 address_key 成立即证 legacy 列零参与' : '降级: 引用临时库 N11 臂 + 代码零引用; live 上无法观察差异, 不改活表',
});
