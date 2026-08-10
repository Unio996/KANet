#!/usr/bin/env node
/**
 * 跨节点核: 给一个 txid(可选给地址/块哈希), 用【我这台独立节点】回答它到底落没落链。
 *
 * 为什么要这支: canary#2 的验收判据是「真实 settle_txid 两独立节点 confirmed」。
 * 我是队里唯一在独立硬件+自建 utxoindex 上的那台 ⇒ 我这一票的全部价值在于它【不共享】
 * 他们那台的任何东西。所以这支脚本只问我自己的 kaspad, 不碰任何 console。
 *
 * 🔴 三条我先写下来的边界, 免得读的人把它当成比它更强的东西:
 *  ① 我的 `kaspa_tx_log` 只索引【涉及我地址】的交易 —— 别人的 settle tx 大概率不在里面。
 *     所以这支【不依赖】那张表(2026-08-10 实证: J2 的 tx 在我索引里查无)。
 *  ② `getUtxosByAddresses` 给的是【活跃】UTXO 集 ⇒ **返回空 ≠ 钱没到过**(可能已被花掉)。
 *     它能证"在", 不能证"从没在"。
 *  ③ 没有块哈希时, kaspad 没有通用的 txid→tx 查询。给了块哈希我才能做逐字节确认。
 *     ⇒ 输出会明说【这一次证到了哪一层】, 而不是给一个笼统的 confirmed。
 *
 * 用法:
 *   node scripts/j1-crossnode-verify-tx.mjs --txid=<hex> [--addr=<kaspatest:...>] [--block=<hash>]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const arg = (k) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : null;
};
const TXID = arg('txid');
const ADDR = arg('addr');
const BLOCK = arg('block');
const URL_ = process.env.DAG_PROBE_URL || 'ws://127.0.0.1:17210';

if (!TXID && !ADDR) {
  console.error('用法: --txid=<hex> [--addr=<kaspatest:...>] [--block=<hash>]  (至少给一个)');
  process.exit(2);
}

const kaspa = require('D:/kanet/kanet/shared/vendor/kaspa-wasm/kaspa.js');
const { RpcClient, Encoding } = kaspa;
const rpc = new RpcClient({ url: URL_, encoding: Encoding.Borsh, networkId: 'testnet-12' });
await rpc.connect();

const out = { node: URL_, txid: TXID, addr: ADDR, proved: [], notProved: [] };

// 先证这台节点自己够格当第二源。不然下面所有读数都不作数。
// 🔴 字段来源是【实查出来的, 不是猜的】—— 第一版我从 getBlockDagInfo 读 isSynced, 而那个对象
//    【根本没有这个键】(实测键列表: network/blockCount/headerCount/tipHashes/difficulty/
//    pastMedianTime/virtualParentHashes/pruningPointHash/virtualDaaScore/sink)
//    ⇒ 恒为 undefined ⇒ 核验器【宣称自己没资格】, 而节点其实是同步的。
//    对一个核验器来说这是最坏的方向: 它会让一次有效确认看起来无效, 或者让人学会忽略那行红字。
//    正确来源是 getServerInfo(), 字段名是 isSynced 与 hasUtxoIndex(不是 isUtxoIndexed)。
const dag = await rpc.getBlockDagInfo();
const info = await rpc.getServerInfo();
out.nodeSynced = !!info?.isSynced;
out.hasUtxoIndex = info?.hasUtxoIndex ?? null;
out.serverVersion = info?.serverVersion ?? null;
out.networkId = info?.networkId ?? null;
out.virtualDaaScore = String(dag?.virtualDaaScore ?? '');
// 🔴 networkId 是承重的, 不是装饰: 用错 networkId 构造的 RpcClient 照样连得上、照样答 ——
//    "连上了" 不等于 "问的是 TN12"。核错网络的确认比没有确认更坏。
if (out.networkId !== 'testnet-12') {
  out.notProved.push(`🔴 本节点 networkId=${out.networkId} 不是 testnet-12 ⇒ 本次确认无效`);
}
if (!out.nodeSynced) { out.notProved.push('🔴 本节点未同步 ⇒ 本次读数不构成独立确认'); }
if (out.hasUtxoIndex === false) { out.notProved.push('🔴 本节点无 utxoindex ⇒ 地址查询不可用'); }

if (BLOCK) {
  try {
    const blk = await rpc.getBlock({ hash: BLOCK, includeTransactions: true });
    const txs = blk?.block?.transactions ?? blk?.transactions ?? [];
    const hit = txs.find((t) => (t.verboseData?.transactionId ?? t.id ?? '') === TXID);
    if (hit) {
      out.proved.push(`✅ txid 在块 ${BLOCK.slice(0, 12)}… 里(本节点自己取的块, ${txs.length} 笔)`);
      out.blockDaaScore = String(blk?.block?.header?.daaScore ?? blk?.header?.daaScore ?? '');
    } else {
      out.notProved.push(`🔴 给的块里【没有】这笔 tx(块含 ${txs.length} 笔) —— 块或 txid 有一个是错的`);
    }
  } catch (e) {
    out.notProved.push(`🔴 取块失败(可能已被剪裁): ${String(e).slice(0, 80)}`);
  }
} else {
  out.notProved.push('⚠ 没给 --block ⇒ 无法做"这笔 tx 在某个具体块里"的逐字节确认(kaspad 无通用 txid 查询)');
}

if (ADDR) {
  try {
    const u = await rpc.getUtxosByAddresses({ addresses: [ADDR] });
    const entries = u?.entries ?? u ?? [];
    out.utxoCount = entries.length;
    out.utxoTotalSompi = String(entries.reduce((s, e) => s + BigInt(e?.utxoEntry?.amount ?? e?.amount ?? 0), 0n));
    if (entries.length) {
      out.proved.push(`✅ 该地址此刻有 ${entries.length} 个活跃 UTXO, 合计 ${out.utxoTotalSompi} sompi(本节点 utxoindex)`);
      out.outpoints = entries.slice(0, 5).map((e) => `${e?.outpoint?.transactionId ?? '?'}:${e?.outpoint?.index ?? '?'}`);
      if (TXID && out.outpoints.some((o) => o.startsWith(TXID))) {
        out.proved.push('✅ 其中有 outpoint 的 transactionId == 给定 txid ⇒ 这笔的产出【此刻仍在链上未被花】');
      }
    } else {
      out.notProved.push('⚠ 该地址活跃 UTXO = 0。🔴 这【不等于】钱没到过 —— 也可能已被后续花掉(活跃集不含已花)');
    }
  } catch (e) {
    out.notProved.push(`🔴 getUtxosByAddresses 失败: ${String(e).slice(0, 80)}`);
  }
}

await rpc.disconnect();
// 退码: 0 = 至少证到一层且节点够格; 1 = 什么都没证到
// 退码: 0 = 【节点够格 且 至少证到一层 且 没有 notProved 里的红条】; 其它一律 1。
// 🔴 第一版只看 proved.length && nodeSynced —— 那会让一个网络错了但地址有钱的读数退 0。
// 🔴🔴 判词必须绑在【被问的那个命题】上, 而不是"有没有证到点什么"。
//    第一版只看 proved.length>0 ⇒ 给一个【根本不存在的 txid】+ 一个恰好有钱的地址, 它判 CONFIRMED。
//    也就是说它会去确认一个【我没问的命题】("这个地址有钱")并冒充回答我问的那个("这笔 tx 落链了吗")。
//    canary#2 的验收要的是 settle_txid, 不是"那个地址上有钱" —— 两者在输出里长得很像, 后果差很远。
//    ⇒ 给了 txid 就必须有 txid 级证据(在给定块里, 或匹配到某个 outpoint); 只给地址才用地址级证据。
const hasRed = out.notProved.some((x) => x.startsWith(String.fromCharCode(0xD83D, 0xDD34)));
const txidProved = out.proved.some((p) => p.includes('txid 在块') || p.includes('== 给定 txid'));
const addrProved = out.proved.some((p) => p.includes('活跃 UTXO'));
out.claim = TXID ? 'txid-landed' : 'address-funded';
const claimProved = TXID ? txidProved : addrProved;
if (TXID && !txidProved && addrProved) {
  out.notProved.push('🔴 只证到"该地址有钱", 【没有】证到给定 txid —— 这是两个不同的命题, 不许用前者冒充后者');
}
out.verdict = (claimProved && out.nodeSynced && out.networkId === 'testnet-12' && !hasRed) ? 'CONFIRMED-BY-INDEPENDENT-NODE' : 'NOT-CONFIRMED';
console.log(JSON.stringify(out, null, 1));
console.log("verdict:", out.verdict);
process.exit(out.verdict === 'CONFIRMED-BY-INDEPENDENT-NODE' ? 0 : 1);
