import { getRpc, FUND_ADDR } from './common.mjs';
const rpc = await getRpc();
const n = Number(process.argv[2] || 5);
let blocks = 0;
while (blocks < n) {
  const tpl = await rpc.getBlockTemplate({ payAddress: FUND_ADDR, extraData: [] });
  await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true });
  blocks++;
}
console.log(`mined ${blocks} blocks`);
await rpc.disconnect();
