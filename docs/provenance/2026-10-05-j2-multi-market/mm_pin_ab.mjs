// mm_pin_ab.mjs — 账本1855 A: relay 排除名单 pin_utxo 的确定性 A/B(机制级, 独立于 e2e 的时序): 需要 simnet console + settler relay 在跑, 钱包静止。
// 1. settler 给自己转 0.5 KAS 造一个 close 费形状的 UTXO F;  2. pin F;  3. 连发 6 笔"干扰转账"(0.29 KAS 自转; 选币器取最小够用 UTXO ≥ 0.4815 KAS)——
//    断言: F 全程未花(其余同形 UTXO 被先吃掉);  4. unpin F;  5. 再发干扰转账(≤4 笔)——断言: F 被吃掉(= 没有 pin 就是 btduw 的机制)。
import { writeFileSync } from 'node:fs';
import { relays, kaspa, rpcConnect, sleep, log, cmd } from '../2026-10-05-j2-strict-zero/szlib.mjs';
const rpc = await rpcConnect(); const S = relays.settler; const OUT = 'D:/kanet-tn12/scratch/_j2_mm';
const res = { asserts: [], rounds: [] }; let fails = 0;
const ok = (c, l) => { res.asserts.push({ ok: !!c, label: l }); if (c) log('  ✅', l); else { log('  ❌', l); fails++; } };
const utxos = async () => (await rpc.getUtxosByAddresses([new kaspa.Address(S.address)])).entries.map((e) => ({ k: `${e.outpoint.transactionId}:${e.outpoint.index}`, v: BigInt(e.amount) }));
const unspent = async (k) => (await utxos()).some((u) => u.k === k);
const waitSpendable = async (txid) => { for (let i = 0; i < 40; i++) { const u = (await utxos()).find((x) => x.k.startsWith(txid) && x.v === 50_000_000n); if (u) return u; await sleep(1500); } return null; };
const before = await utxos(); const near = (us) => us.filter((u) => u.v >= 48_150_000n && u.v <= 60_000_000n).map((u) => String(u.v));
log('settler UTXOs ≥0.4815 KAS before:', near(before).join(','));
const mk = await cmd('settler', { type: 'transfer', target: S.address, amount: 0.5 });
const F = await waitSpendable(mk.txId); ok(!!F, `造出 0.5 KAS 的 close 费形状 UTXO F ${F?.k.slice(0, 16)}`); if (!F) { process.exit(2); }
const pin = await cmd('settler', { type: 'pin_utxo', txid: F.k.split(':')[0], index: Number(F.k.split(':')[1]), ttl_ms: 600000 }); ok(pin.ok === true, `pin_utxo F ⇒ ${JSON.stringify(pin).slice(0, 80)}`);
for (let i = 0; i < 6; i++) { const r = await cmd('settler', { type: 'transfer', target: S.address, amount: 0.29 }); res.rounds.push({ phase: 'pinned', i, txId: r.txId || null, err: r.ok === false ? r.error : undefined }); await sleep(5000); }
ok(await unspent(F.k), 'pin 期间连发 6 笔干扰转账后, F 仍未花(被排除出选币候选)');
const un = await cmd('settler', { type: 'unpin_utxo', txid: F.k.split(':')[0], index: Number(F.k.split(':')[1]) }); ok(un.ok === true && un.unpinned === true, `unpin_utxo F ⇒ ${JSON.stringify(un).slice(0, 80)}`);
let eaten = false;
for (let i = 0; i < 4 && !eaten; i++) { const r = await cmd('settler', { type: 'transfer', target: S.address, amount: 0.29 }); res.rounds.push({ phase: 'unpinned', i, txId: r.txId || null, err: r.ok === false ? r.error : undefined }); await sleep(6000); eaten = !(await unspent(F.k)); }
ok(eaten, '解钉后继续干扰转账, F 被选币器吃掉(= 没有 pin 时 close 费 UTXO 的下场, S3 btduw 机制)');
res.F = F.k; res.failures = fails; writeFileSync(`${OUT}/mm_pin_ab_result.json`, JSON.stringify(res, (k, v) => typeof v === 'bigint' ? String(v) : v, 1));
log(fails ? `\n${fails} FAIL` : '\nALL PASS'); process.exitCode = fails ? 1 : 0; setTimeout(() => process.exit(process.exitCode), 300);
