// fund-relay.mjs — 给 relay 充值 4×0.99 KAS(4 个干净 UTXO; PROTO_MAX_BALANCE_KAS=5 硬顶 ⇒ 总额 3.96)。只对 simnet。
// 单块币基奖励实测 = 50 KAS(> 5 KAS 顶), 所以【不能】直接往 relay 地址挖块。做法(复用 relay 的 custodialSendKaspa, 不另造发币逻辑):
//   一次性 funder 私钥(只在本进程内存, 不读不打印不落盘)→ 往 funder 地址挖 1 个块(50 KAS)→ 等币基成熟(靠外部持续矿工推进 DAA)→ custodialSendKaspa 转 4×0.99 到 relay。
// 用法: node fund-relay.mjs measure | node fund-relay.mjs fund
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_e2e';
const state = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_j2_f1adv_run/state.json', 'utf8'));
process.env.KASPA_NETWORK = 'simnet'; process.env.KASPA_RPC_URL = state.rpc; process.env.KASPA_RPC_LOCAL_ONLY = '1';
const require = createRequire(`${WT}/kasia-relay/`);
const kaspa = require('kaspa-wasm'); const { RpcClient, Encoding, PrivateKey } = kaspa;
const cmd = process.argv[2];
const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo(); if (info.networkId !== 'simnet') { console.error('REFUSE: networkId != simnet'); process.exit(3); }
const balKas = async (addr) => { const b = await rpc.getBalanceByAddress({ address: addr }); return Number(b.balance) / 1e8; };
if (cmd === 'measure') {
  const tpl = await rpc.getBlockTemplate({ payAddress: state.relayAddress, extraData: [] });
  const reward = tpl.block.transactions[0].outputs.reduce((a, o) => a + BigInt(o.value), 0n);
  console.log(`coinbase reward_sompi=${reward} = ${Number(reward) / 1e8} KAS daa=${tpl.block.header.daaScore}`);
} else if (cmd === 'fund' || cmd === 'topup') {
  // fund: 只对余额为 0 的干净 relay 首次充 4×0.99。topup <N>: 运行期滚动补 N 个 0.99 KAS 输出——硬保护: 补后【流动余额】必须 < 4.9 KAS
  //   (两个 driver 每个 tick 都断言 relay 地址流动余额 < PROTO_MAX_BALANCE_KAS=5, 超了整轮停摆; 锁进 covenant 的资金不在该地址上、不计入)。
  const before = await balKas(state.relayAddress);
  const nOut = cmd === 'fund' ? 4 : Number(process.argv[3]);
  if (cmd === 'fund' && before !== 0) { console.error(`REFUSE: relay 已有余额 ${before} KAS(只对干净地址首次充值)`); process.exit(4); }
  if (!Number.isInteger(nOut) || nOut < 1 || nOut > 4 || !(before + nOut * 0.99 < 4.9)) { console.error(`REFUSE: 补 ${process.argv[3]} 个 0.99 后流动余额 ${before} + ${nOut * 0.99} 不 < 4.9 KAS(或 N 非法)`); process.exit(4); }
  console.log(`relay liquid before=${before} KAS, adding ${nOut} x 0.99`);
  const priv = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
  const fundAddr = priv.toPublicKey().toAddress('simnet').toString();
  const tpl = await rpc.getBlockTemplate({ payAddress: fundAddr, extraData: [] });
  const r = await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false }); console.log(`funder block mined report=${JSON.stringify(r.report?.type ?? r)} (funder=<throwaway ${fundAddr.slice(0, 16)}…>)`);
  // 发送: 参考 relay 的 utxo-split.mjs 的 Generator 用法(relay 的 sendKaspa 要走公共 REST 费率接口 getApi(network), simnet 没有 ⇒ 用不了)。
  //   一笔交易 4 个 0.99 KAS 输出 ⇒ 4 个干净 UTXO; 币基未成熟时 submit 会失败 ⇒ 重试直到成熟(持续矿工在外面推 DAA), 最多 5 分钟
  const { Generator, Address, PaymentOutput } = kaspa;
  const t0 = Date.now(); let txId = ''; let lastErr = '';
  while (!txId && Date.now() - t0 < 1500000) {   // F1 对抗重跑(J2, scratch-only 本地copy改): coinbase maturity=1000 DAA, 1 blk/s 矿工需要 ~1000s+余量, 原 300000ms 不够一次等成熟
    try {
      const { entries } = await rpc.getUtxosByAddresses([new Address(fundAddr)]);
      if (!entries || entries.length === 0) throw new Error('funder 还没有可见 UTXO');
      const outputs = Array.from({ length: nOut }, () => new PaymentOutput(new Address(state.relayAddress), 99_000_000n));
      const generator = new Generator({ entries, outputs, priorityFee: 500_000n, changeAddress: new Address(fundAddr), networkId: 'simnet' });
      let pending = null;
      while ((pending = await generator.next())) { await pending.sign([priv]); txId = await pending.submit(rpc); }
    } catch (e) { const m = String(e?.message ?? e).slice(0, 420); if (m !== lastErr) { console.log('send attempt failed (等成熟/重试): ' + m); lastErr = m; } txId = ''; await new Promise((r) => setTimeout(r, 3000)); }
  }
  console.log('funding tx=' + (txId ? String(txId).slice(0, 16) + '…' : 'NONE'));
  const sent = txId ? nOut : 0;
  await new Promise((s) => setTimeout(s, 4000));
  const after = await balKas(state.relayAddress); console.log(`relay balance now = ${after} KAS (sent ${sent}/4)`);
  if (!(after > 0 && after < 4.95)) { console.error('relay 流动余额不在 (0,4.95) KAS 内'); process.exit(5); }
}
await rpc.disconnect().catch(() => {}); process.exit(0);
