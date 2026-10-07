// mailbox_probe.mjs — 账本1877 步2 simnet 实测: 信箱转账(经 relay delivery_mailbox_send, 走既有 sendKaspa/Generator 通路)的 最小可行面值 / 网络费 / payload 上限。
// 只对 simnet 跑。用法: node mailbox_probe.mjs <out.json>     需: simnet console(:3298, relay 代码已临时放宽面值区间做探测) + kaspad + 矿工
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relays, kaspa, rpcConnect, cmd, sleep } from '../2026-10-05-j2-strict-zero/szlib.mjs';
const OUT = process.argv[2] || 'mailbox_probe_result.json';
const require = createRequire(import.meta.url);
const rpc = await rpcConnect();
const mkAddr = (seed) => new kaspa.PrivateKey(seed.padEnd(64, '0').slice(0, 64)).toPublicKey().toAddress('simnet').toString();
const payload = (n) => '4b444c31' + 'ab'.repeat(n - 4);   // KDL1 魔数 + 填充到 n 字节
const sender = relays.maker;
const res = { network: 'simnet', sender_balance_sompi: String((await rpc.getBalanceByAddress({ address: sender.address })).balance), cases: [] };
const AMOUNTS = ['0.0001', '0.001', '0.005', '0.01', '0.02', '0.03', '0.05', '0.08', '0.1', '0.15', '0.2'];
for (const bytes of [44, 1056]) {
  for (const amt of AMOUNTS) {
    const target = mkAddr(Buffer.from(`mb-${bytes}-${amt}-${Date.now()}`).toString('hex'));
    const r = await cmd('maker', { type: 'delivery_mailbox_send', target, amount: amt, payload_hex: payload(bytes) });
    const row = { payload_bytes: bytes, amount_kas: amt, ok: r.ok === true, txId: r.txId, fee_kas: r.fee, error: r.ok ? undefined : String(r.error || JSON.stringify(r)).replace(/\s+/g, ' ').slice(0, 260) };
    res.cases.push(row); console.log(JSON.stringify(row));
    await sleep(2500);   // 让上一笔的找零 UTXO 回到可用集合(relay 对 pending UTXO 有 60s 影子排除; 失败的探测不占 UTXO)
  }
}
writeFileSync(OUT, JSON.stringify(res, null, 1)); process.exit(0);
