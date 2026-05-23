// Verify sellPreview() generic across asset/chain combos
import { sellPreview } from '../src/services/broker-sell-handler.js';

const cases = [
  { name: '默认 KAS→USDT BSC',  args: { user_kasia: 'kaspa:qxxx', qty: 5, recv_chain: 'bnb', recv_address: '0x' + '1'.repeat(40) } },
  { name: '显式 KAS→USDC BSC',  args: { user_kasia: 'kaspa:qxxx', qty: 5, recv_chain: 'bnb', recv_address: '0x' + '2'.repeat(40), give_asset: 'KAS', recv_asset: 'USDC' } },
  { name: 'KAS→USDT Polygon',   args: { user_kasia: 'kaspa:qxxx', qty: 10, recv_chain: 'polygon', recv_address: '0x' + '3'.repeat(40) } },
  { name: 'KAS→USDT Arbitrum',  args: { user_kasia: 'kaspa:qxxx', qty: 10, recv_chain: 'arbitrum', recv_address: '0x' + '4'.repeat(40), recv_asset: 'USDT' } },
  { name: 'USDC→USDT BSC (跨稳定)', args: { user_kasia: 'kaspa:qxxx', qty: 1, recv_chain: 'bnb', recv_address: '0x' + '5'.repeat(40), give_asset: 'USDC', recv_asset: 'USDT' } },
  { name: 'KAS→USDT BSC bsc别名',  args: { user_kasia: 'kaspa:qxxx', qty: 5, recv_chain: 'bsc', recv_address: '0x' + '6'.repeat(40) } },
  { name: '不支持 BTC→USDT',     args: { user_kasia: 'kaspa:qxxx', qty: 0.001, recv_chain: 'bnb', recv_address: '0x' + '7'.repeat(40), give_asset: 'BTC' } },
  { name: '不支持 chain Solana USDC', args: { user_kasia: 'kaspa:qxxx', qty: 5, recv_chain: 'sol', recv_address: 'sol_addr_xxx', give_asset: 'KAS', recv_asset: 'USDC' } },
  { name: 'dust qty 0.05 KAS',   args: { user_kasia: 'kaspa:qxxx', qty: 0.05, recv_chain: 'bnb', recv_address: '0x' + '8'.repeat(40) } },
  { name: '坏 EVM addr',          args: { user_kasia: 'kaspa:qxxx', qty: 5, recv_chain: 'bnb', recv_address: '0xdeadbeef' } },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = await sellPreview(c.args);
  const give = c.args.give_asset || 'KAS';
  const recv = c.args.recv_asset || 'USDT';
  const expectOk = !['不支持', 'dust', '坏'].some(k => c.name.includes(k));
  const correct = r.ok === expectOk;
  console.log(`${correct ? '✓' : '✗'} ${c.name}: ok=${r.ok}${r.ok ? ` (unit=${r.unit_price} ${recv}/${give}, total=${r.total_recv} ${recv})` : ` err=${r.error}`}`);
  if (correct) pass++; else fail++;
}
console.log(`\n${pass}/${pass+fail} PASS`);
process.exit(fail ? 1 : 0);
