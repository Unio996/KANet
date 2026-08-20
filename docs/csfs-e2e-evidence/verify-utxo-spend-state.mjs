// 跨节点核验: CLEAN 轮 PASS/REJECT 的划分能否【纯从链上 UTXO 状态】复现。
// 只读, 不签不广播。**不需要 txindex** —— 只用 getUtxosByAddresses。
// 用法: 改下面 url 为你自己节点的 RPC, 然后 node verify-utxo-spend-state.mjs
//
// 🔵 它证什么 / 不证什么(别读大):
//   ✅ 证【未被接受】: REJECT 格那笔 UTXO 至今未花 ⇒ 那笔花费从未落链。
//   🔴 不证【因脚本验证拒】: 拒因那一半只由捕获的 RPC 原文支撑, 天然非 DAG 可查。
//   ⇒ 与 RPC 拒因证据是【互补】, 不是替代。
const W = await import('file:///D:/rusty-kaspa/wasm/nodejs/kaspa/kaspa.js');
const rpc = new W.RpcClient({ url: 'ws://127.0.0.1:17210', encoding: W.Encoding.Borsh, networkId: 'testnet-12' });
await rpc.connect();
const P = 'kaspatest:pq646mlq82wt79kqkdhcpme2wwa072uwxdu6ectwk5qqa6r8hlpjzpys2te5s';
const { entries } = await rpc.getUtxosByAddresses([P]);
const live = new Set(entries.map((e) => e.outpoint.transactionId.slice(0, 12)));
// CLEAN 轮消耗顺序(取自运行日志), 奇数位=同窗V0(PASS) 偶数位=判读格
const consumed = [
  ['64582e2aab86', 'V0@V1窗', 'PASS'], ['d257a0395537', 'V1', 'REJECT'],
  ['7f2addd29361', 'V0@V2窗', 'PASS'], ['6ce7b041d7d1', 'V2', 'REJECT'],
  ['2ea7f32ac1e5', 'V0@V3窗', 'PASS'], ['275af1eed99c', 'V3', 'REJECT'],
  ['55dab27d4ba7', 'V0@V4窗', 'PASS'], ['8c0032def890', 'V4', 'REJECT'],
  ['ee7d45d43061', 'V0@V5a窗', 'PASS'], ['6ef06a74623f', 'V5a', 'REJECT'],
  ['f995d8c19823', 'V0@V5b窗', 'PASS'], ['97549e97d829', 'V5b', 'REJECT'],
  ['224b2136c5aa', 'V0@V5c窗', 'PASS'], ['903a8f335433', 'V5c', 'PASS'],
  ['81e45d9e915f', 'V0-final', 'PASS'],
];
console.log('预言: PASS 格的 UTXO 应【已被花掉=不在列】; REJECT 格的应【仍在列】\n');
let ok = 0, bad = 0;
for (const [tx, cell, exp] of consumed) {
  const stillLive = live.has(tx);
  const good = (exp === 'PASS') ? !stillLive : stillLive;
  if (good) ok++; else bad++;
  console.log(`  ${good ? '✅' : '🔴'} ${tx} ${cell.padEnd(9)} 判 ${exp.padEnd(6)} · 链上${stillLive ? '仍在' : '已花'}`);
}
console.log(`\n吻合 ${ok}/15 · 不符 ${bad}`);
console.log(bad === 0
  ? '🔵 15/15 全中 ⇒ 【纯从链上 UTXO 状态】即可复现 PASS/REJECT 的划分,\n   不依赖任何人转述的 RPC 拒因。这给负例补了一条【可跨节点独立验】的旁证。'
  : '🔴 有不符 ⇒ 需解释');
await rpc.disconnect();
