// scripts/simnet/mine-loop.mjs — 账本1473/1480 Bettor批准的本地simnet挖矿循环，仅用于结算全链条真实
// 共识验证（绕开cli-debugger harness的4个已知坑）。只连本机simnet RPC(127.0.0.1)，不碰主网。
//
// 用法: node scripts/simnet/mine-loop.mjs [--blocks=N] [--rpc=ws://127.0.0.1:18510]
//
// 原理: simnet的SIMNET_PARAMS.skip_proof_of_work=true(rusty-kaspa v2.0.1
// consensus/core/src/config/params.rs确认)——getBlockTemplate返回的block可以直接submitBlock，
// 不需要真实PoW nonce grinding。
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    blocks: { type: 'string', default: '1' },
    rpc: { type: 'string', default: 'ws://127.0.0.1:18510' },
    payAddress: { type: 'string' }, // 不传则自动生成一个新的测试地址(打印出来供后续复用)
  },
});

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');

const rpc = new kaspa.RpcClient({ url: values.rpc, networkId: 'simnet' });
await rpc.connect();
console.log('connected to', values.rpc);

let payAddress = values.payAddress;
if (!payAddress) {
  const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  payAddress = priv.toPublicKey().toAddress('simnet').toString();
  console.log('生成新的simnet测试地址(仅用于挖矿奖励去向, 非真实资金):', payAddress);
  console.log('对应私钥(仅simnet测试用, 不是任何真实账户): 0x' + priv.toString());
}

const n = parseInt(values.blocks, 10);
let mined = 0;
for (let i = 0; i < n; i++) {
  const { block } = await rpc.getBlockTemplate({ payAddress });
  const res = await rpc.submitBlock({ block, allowNonDAABlocks: true });
  const ok = res.report === 'success' || res.report?.type === 'success' || JSON.stringify(res.report).includes('success');
  console.log(`block ${i + 1}/${n}: report=${JSON.stringify(res.report)}`);
  if (ok) mined++;
}
console.log(`\n完成: ${mined}/${n} 块提交成功`);

const info = await rpc.getInfo();
console.log('当前节点状态:', JSON.stringify(info, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
const dagInfo = await rpc.getBlockDagInfo();
console.log('virtualDaaScore:', String(dagInfo.virtualDaaScore));

await rpc.disconnect();
