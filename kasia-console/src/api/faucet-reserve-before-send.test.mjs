// faucet-reserve-before-send.test.mjs — regression: faucet 发放必须【先预留、后转账】(J2 2026-07-29)
//
// 被测不变量:【预留必须发生在不可逆动作之前】。
//   faucet_grants.wallet_address 上的 UNIQUE 是这条路径唯一的并发闸;它只有在转账【之前】
//   就被触发,才能在冲突时保证"还没花钱"。
//
// 🔵 判别式(不需要 mock、不花钱、不碰 live relay):
//   把 FAUCET_RELAY_ID 指向一个【不存在的 relay】⇒ relay-manager.sendCommandAsync 在
//   任何 IPC 发出【之前】就 reject('Relay not running')⇒ 转账必然失败。
//   于是:
//     · 若预留在转账【之后】(改动前的码)⇒ 请求失败 ⇒ 🔴 表里【一行都没有】
//     · 若预留在转账【之前】(改动后的码)⇒ 请求失败 ⇒ ✅ 表里留下一行 status='pending'
//   ⇒ 🔵 失败之后那一行【存在】这件事本身,就证明了它是在转账之前写的。
//
// 🔴 阴性对照(Bettor 2026-07-29 定的硬判据:regression case 必须能在改动前的码上失败):
//   本文件读 env FAUCET_TEST_CHAT_MODULE(默认 './chat.js')。把它指向一份含【旧块】的
//   chat.js 副本再跑一次 ⇒ 应当【红】。两次都跑过才算这个 case 有判别力。
//
// Run: cd kasia-console && node src/api/faucet-reserve-before-send.test.mjs
// 🟡 与同目录其余 5 个 *.test.mjs 一样,它是【手工跑】的 —— scripts/test.mjs 的 --domain
//    只扫 test-framework/cases/,扫不到本文件。这一点在交付说明里已写清,不假装它会被自动跑。
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._FAUCET_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_faucet_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _FAUCET_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const CHAT_MODULE = process.env.FAUCET_TEST_CHAT_MODULE || './chat.js';
const { registerChatRoutes } = await import(CHAT_MODULE);

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// 🔴 指向一个不存在的 relay ⇒ 转账必失败, 且失败发生在【任何链上动作之前】
process.env.FAUCET_RELAY_ID = 'no-such-relay-for-test';
process.env.FAUCET_AMOUNT_KAS = '1';

const app = Fastify();
await registerChatRoutes(app);
await app.ready();

const W1 = 'kaspatest:qtestwalletaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const W2 = 'kaspatest:qtestwalletbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const post = (wallet) => app.inject({ method: 'POST', url: '/api/faucet/request', payload: { wallet_address: wallet } });
const rowsFor = (w) => sqlite.prepare('SELECT id, status, txid FROM faucet_grants WHERE wallet_address = ?').all(w);

console.log('[test] ① 转账失败之后, 预留行【仍然存在】⇒ 证明它写在转账之前:');
{
  const res = await post(W1);
  const rows = rowsFor(W1);
  ok(res.statusCode >= 400, `请求确实失败了 (status=${res.statusCode}) — 前提成立, 否则本用例无意义`);
  ok(rows.length === 1, `失败后仍留下【1】行 (实得 ${rows.length}) — 🔴 改动前的码这里是 0`);
  ok(rows[0]?.status === 'pending', `那一行 status='pending' (实得 ${JSON.stringify(rows[0]?.status)})`);
  // 🔴 这里必须先断言"行存在"再断言"txid 为空" —— 否则没有行时 rows[0]?.txid 是 undefined,
  //   而 undefined == null 为真 ⇒ 这条断言会在【改动前的码上空过】(实测确认过它会空过)。
  //   一条在两种码上都绿的断言, 是零信息量的。
  ok(rows.length === 1 && rows[0].txid == null, `那一行存在【且】txid 为空 (未确认发放)`);
}

console.log('[test] ② 同一钱包再请求 ⇒ 被唯一约束挡在【花钱之前】, 返回 429 而不是 5xx:');
{
  const res = await post(W1);
  ok(res.statusCode === 429, `第二次请求返回 429 (实得 ${res.statusCode}) — 🔴 改动前的码这里会再走一次转账`);
  ok(rowsFor(W1).length === 1, `表里仍然只有 1 行, 没有重复预留`);
}

console.log('[test] ③ 另一个钱包不受影响 (闸是 per-wallet, 不是全局卡死):');
{
  const res = await post(W2);
  ok(res.statusCode >= 400, `同样因 relay 不存在而失败 (status=${res.statusCode})`);
  ok(rowsFor(W2).length === 1, `W2 也留下自己的预留行`);
  ok(rowsFor(W1).length === 1, `而 W1 的行没被影响`);
}

console.log(fails === 0 ? '\n✅ faucet-reserve-before-send: ALL PASS' : `\n❌ faucet-reserve-before-send: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
