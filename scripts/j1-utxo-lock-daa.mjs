#!/usr/bin/env node
/**
 * 从【UTXO 条目本身】读出它被创建时的 DAA —— 一个**不受剪裁影响、且是共识值**的来源。
 *
 * 🔵 为什么需要它(2026-08-10): 7 个盘的 deadline 全在剪裁墙下 1210 万–2014 万 DAA,
 *    `getBlock(hash)` 一律 `cannot find header`, 而 @J2 又把 `block_time` 派生判死在
 *    **确定性**那一轴上(`kaspa_tx_log` 是本机索引器记录, 各节点未必逐位相同 ⇒ 差 1 bit 就是分叉)。
 *    ⇒ 换一个**本身就是共识状态**的来源: **UTXO 集合正是剪裁【不删】的那部分**(剪裁点 UTXO 承诺),
 *      而每个 UTXO 条目自带它被创建时的 DAA。
 *
 * 🔴 语义查过源码, 不是按字段名推(它必须对得上 bshard-close-transport 那句
 *    "链上共识事实·接受块 DAA·跨节点收敛"):
 *      virtual_processor/utxo_validation.rs:147  mergeset_diff.add_transaction(tx, pov_daa_score)
 *      utxo_diff.rs:234                          UtxoEntry::new(value, spk, block_daa_score, ...)
 *    ⇒ 条目里的 daa = pov_daa_score = **接受块(chain block)** 的 DAA。同一个量。
 *    ⇒ 它被剪裁点 UTXO 承诺(MuHash)覆盖 ⇒ **逐位相同由构造保证**, 不是"通常一致"。
 *
 * 🔴 作用域四条, 引用时必须连着带走:
 *    ① **只对【未花】的 UTXO 成立** —— 花掉即离开 UTXO 集合, 这条什么也救不了。
 *    ② 它给的是【某个锁的创建 DAA】, **不是【任意 DAA → 块】的映射** ⇒ **救不了 `getBlockAtDaa`**。
 *    ③ 🔴🔴 **本方法对 `side_lock_daa` 【无效】—— 这一条是被 @J2 当天打掉的, 而我原先在这里写反了。**
 *       原话是"打在 side_p2sh 上才是 side_lock_daa"。**错在哪**: bshard 是**共享池形态**,
 *       **每个 bettor 根本没有独立的 side UTXO**(那 0.2 KAS 是 `PS_SEED`,
 *       `pool-shard-register.mjs:79` = 20,000,000 sompi, **不是任何人的注**)。
 *       ⇒ 照原话去跑会拿到**分片种子块的 DAA、十个人完全相同**, 而输出长得像"🟢 8/8 可取"。
 *       ⇒ **本脚本只对【脊类 / 每个锁真有一个独立 UTXO】的值成立。**
 *       (另有一条更早的记录也在挡这条路: `2026-07-08 method switch` 注释写明
 *        bet 落地后可能被 register-v07 吸收进 shard 聚合 leaf ⇒ UTXO 不再"未花费"。)
 *    ④ 读到的是**本节点当前 UTXO 集合**; 节点没同步完时结论不作数(脚本会自己拒绝)。
 *
 * 用法:
 *   node scripts/j1-utxo-lock-daa.mjs <kaspatest:addr> [更多地址...]
 *   J1_NODE_URL=ws://host:17210 覆盖节点地址
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
// 路径从本文件位置推导, 不写死 —— @NWT 2026-08-10 实测: 她的检出在 /d/kanet-tn12,
// 写死 /d/kanet/kanet/... 的脚本在她机器上根本跑不起来。
const kaspa = require(join(HERE, '..', 'shared', 'vendor', 'kaspa-wasm', 'kaspa.js'));
const { RpcClient, Encoding } = kaspa;

const ADDRS = process.argv.slice(2).filter((a) => a.startsWith('kaspa'));
if (!ADDRS.length) {
  console.error('用法: node scripts/j1-utxo-lock-daa.mjs <kaspatest:addr> [...]');
  process.exit(2);
}

const c = new RpcClient({
  url: process.env.J1_NODE_URL || 'ws://127.0.0.1:17210',
  encoding: Encoding.Borsh,
  networkId: 'testnet-12',
});
await c.connect();

// 🔴 先自证仪器: 没同步完 / 没有 utxoindex 的节点给出的 "utxo=0" 与 "确实没有" 读数相同。
const si = await c.getServerInfo();
if (si.networkId !== 'testnet-12' || !si.isSynced || !si.hasUtxoIndex) {
  console.error(`INSTRUMENT-INVALID: networkId=${si.networkId} isSynced=${si.isSynced} hasUtxoIndex=${si.hasUtxoIndex}`);
  console.error('  ⇒ 本次读数【不作数】: 未同步或无 utxoindex 时, "查不到" 不构成 "不存在"。');
  await c.disconnect();
  process.exit(2);
}

const di = await c.getBlockDagInfo();
const pp = await c.getBlock({ hash: di.pruningPointHash, includeTransactions: false });
const ppDaa = BigInt(pp.block.header.daaScore);
console.log(`node=${si.serverVersion} pruningPoint.daaScore=${ppDaa} virtual=${di.virtualDaaScore}`);

let below = 0;
for (const a of ADDRS) {
  try {
    const r = await c.getUtxosByAddresses({ addresses: [a] });
    const es = r.entries || [];
    if (!es.length) { console.log(`${a}  utxo=0  (未花的没有 —— 可能已被花, 本脚本对已花的无话可说)`); continue; }
    for (const e of es) {
      const d = BigInt(e.utxoEntry?.blockDaaScore ?? e.blockDaaScore ?? 0);
      const amt = Number(e.utxoEntry?.amount ?? e.amount) / 1e8;
      const mark = d < ppDaa ? `BELOW-PRUNING by ${ppDaa - d}` : 'above pruning point';
      if (d < ppDaa) below += 1;
      console.log(`${a}  lockDaa=${d}  amount=${amt} KAS  ${mark}`);
    }
  } catch (e) {
    console.log(`${a}  ERR: ${String(e.message || e).slice(0, 120)}`);
  }
}
console.log(`\n${below} 个条目的创建块已在本节点被剪掉, 而它们的精确 DAA 仍然读得出。`);
await c.disconnect();
