// driver.mjs — ShardLeaf D-020 register_append 端到端 simnet 驱动。
// 直接调用生产 registerBettorOnShard(pool-shard-register.mjs) + 生产 relay unlock*(p2sh.mjs)函数——
// 不经过完整 console/relay IPC 进程, 但用的是同一套生产代码, 不是另写一套模拟逻辑。
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WT = 'D:/kanet-tn12/scratch/_j2_wt_pm_a';
const DB_PATH = 'D:/kanet-tn12/scratch/_j2_pm_a_simnet/console.simnet.db';
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
process.env.DB_PATH = DB_PATH;
process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:29617';
process.env.KASPA_NETWORK = 'simnet';
process.env.ZK_TOKEN_TMPL_HASH = '225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e';   // KanetTestToken v1 模板(C 组现算)
process.env.ZK_CLAIM_TMPL_HASH = '395949e1b6079c79bc5c36565188fd67afca7b75fd37adf264bd44bdbefd21e1';   // KanetTokenClaim 模板(C 组现算)
process.env.ZK_MARKET_SUFFIX_HASH = '00'.repeat(32);   // 源字段已删, 仅声明值
process.env.ZK_GATE_TMPL_HASH = 'a1'.repeat(32);        // 测试值(只影响 V2 的 closeZkTmplAnchor 烤入, 本验不涉 zk_close)
process.env.KASPA_RPC_LOCAL_ONLY = '1';

const require = createRequire(`${WT}/kasia-relay/`);
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Generator, PaymentOutput, payToScriptHashScript, addressFromScriptPublicKey } = kaspa;

const imp = (p) => import(pathToFileURL(p).href);
const { runMigrations } = await imp(`${WT}/kasia-console/src/db/migrate.js`);
runMigrations();
const { sqlite: db } = await imp(`${WT}/kasia-console/src/db/client.js`);

const { registerBettorOnShard, readZkTemplateHashes, computeCloseZkTmplAnchor } = await imp(`${WT}/kasia-console/src/lib/pool-shard-register.mjs`);
const { assertZkHandoffTmplCoherent } = await imp(`${WT}/kasia-console/src/lib/bshard-close-transport.mjs`);
const { computeKttTokenArtifact } = await imp(`${WT}/kasia-console/src/lib/pool-bshard-artifacts.mjs`);
const { unlockBshardGenesisMintPayout, unlockBshardGenesisMintShardLeaf, unlockBshardGenesisMintStakeChip, unlockBshardRegister } = await imp(`${WT}/kasia-relay/src/lib/p2sh.mjs`);

const rpc = new RpcClient({ url: process.env.KASPA_RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo();
if (info.networkId !== 'simnet') { console.error('REFUSE: networkId != simnet'); process.exit(3); }
console.log(`[driver] connected networkId=${info.networkId}`);

const priv = new PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('simnet').toString();
const wallet = { getPrivateKey: () => priv, getNetworkId: () => 'simnet' };
console.log(`[driver] relay addr = ${relayAddr}`);

// ── fund relay: mine 1 block to a throwaway addr, wait maturity, send to relay ──
async function balKas(addr) { const b = await rpc.getBalanceByAddress({ address: addr }); return Number(b.balance) / 1e8; }
async function fundRelay(kasAmount) {
  const funderPriv = new PrivateKey(randomBytes(32).toString('hex'));
  const funderAddr = funderPriv.toPublicKey().toAddress('simnet').toString();
  const tpl = await rpc.getBlockTemplate({ payAddress: funderAddr, extraData: [] });
  await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false });
  console.log(`[driver] mined 1 block to funder ${funderAddr.slice(0, 20)}... waiting maturity`);
  const t0 = Date.now();
  let txId = '';
  let attempts = 0;
  while (!txId && Date.now() - t0 < 900000) {
    attempts++;
    try {
      const { entries } = await rpc.getUtxosByAddresses([new Address(funderAddr)]);
      if (!entries || entries.length === 0) throw new Error('no utxo yet');
      const sompi = BigInt(Math.round(kasAmount * 1e8));
      const outputs = [new PaymentOutput(new Address(relayAddr), sompi)];
      const generator = new Generator({ entries, outputs, priorityFee: 500_000n, changeAddress: new Address(funderAddr), networkId: 'simnet' });
      let pending;
      while ((pending = await generator.next())) { await pending.sign([funderPriv]); txId = await pending.submit(rpc); }
    } catch (e) {
      const m = String(e?.message ?? e).slice(0, 160);
      if (attempts % 20 === 0) {
        const daa = (await rpc.getBlockDagInfo().catch(() => ({}))).virtualDaaScore;
        console.log(`[driver] fund attempt #${attempts} (daa=${daa}): ` + m);
      }
      txId = '';
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!txId) throw new Error('fundRelay: timed out after ' + attempts + ' attempts');
  console.log(`[driver] funding tx = ${txId}`);
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    const b = await balKas(relayAddr);
    if (b > 0) { console.log(`[driver] relay balance = ${b} KAS`); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('fundRelay: balance never appeared');
}
await fundRelay(30);

// ── callbacks for registerBettorOnShard ──
async function transfer(address, sompiAmount) {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try {
      const { entries } = await rpc.getUtxosByAddresses([new Address(relayAddr)]);
      const outputs = [new PaymentOutput(new Address(address), BigInt(sompiAmount))];
      const generator = new Generator({ entries, outputs, priorityFee: 500_000n, changeAddress: new Address(relayAddr), networkId: 'simnet' });
      let pending, txId = '';
      while ((pending = await generator.next())) { await pending.sign([priv]); txId = await pending.submit(rpc); }
      // 等它真落地再返回(同 NO TX NO STATE 纪律: transfer() 的调用方(ensurePayoutShard 等)紧接着就要
      // _matchUtxo 这笔钱, 不等确认直接返回会撞"UTXO not found"——真实 relay 的 transfer 实现应当也是
      // 等落地才返回, 这里补上这一步, 不是绕过检查)。
      const tLand0 = Date.now();
      while (Date.now() - tLand0 < 30000) {
        const chk = await rpc.getUtxosByAddresses([new Address(address)]);
        if (chk.entries && chk.entries.some(e => e.outpoint.transactionId === txId)) return txId;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`transfer: tx ${txId} submitted but never landed at ${address}`);
    } catch (e) {
      const m = String(e?.message ?? e).slice(0, 160);
      console.log('[driver] transfer retry: ' + m);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('transfer: timed out');
}
async function landed(txid, address) {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try {
      const { entries } = await rpc.getUtxosByAddresses([new Address(address)]);
      if (entries && entries.some(e => e.outpoint.transactionId === txid)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
function p2sh(redeemHex) {
  const spk = payToScriptHashScript(new Uint8Array(Buffer.from(redeemHex, 'hex')));
  return addressFromScriptPublicKey(spk, 'simnet').toString();
}
async function rc(cmd) {
  const args = { wallet, cmd, networkId: 'simnet', lockTime: 0n };
  if (cmd.type === 'bshard_genesis_mint_payout') return unlockBshardGenesisMintPayout(args);
  if (cmd.type === 'bshard_genesis_mint_shardleaf') return unlockBshardGenesisMintShardLeaf(args);
  if (cmd.type === 'bshard_genesis_mint_stake_chip') return unlockBshardGenesisMintStakeChip(args);
  if (cmd.type === 'bshard_register_bet') return unlockBshardRegister(args);
  throw new Error('unknown cmd.type ' + cmd.type);
}


// ── 生产读取点(账本 1813 A1): 注册侧与结算侧同一个 readZkTemplateHashes ──
const tmpl = readZkTemplateHashes();
if (!tmpl.ok) throw new Error('readZkTemplateHashes not ok: ' + JSON.stringify(tmpl));
const { tokenTmplHash, claimTmplHash, marketSuffixHash } = tmpl;
console.log('[driver] tmpl from production reader:', JSON.stringify(tmpl));

const sealCount = 1000;
const deadline = Math.floor(Date.now() / 1000) + 3600;
const bettorsAll = [];
function mkMarketHelpers(logicalMarketId) {
  return {
    createShardMarketRow(shardIndex, shardP2sh) {
      const id = `${logicalMarketId}#${shardIndex}`;
      db.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, protocol_version, created_at, updated_at)
        VALUES (?, 'e2e-driver', ?, ?, ?, 'collecting_sigs', 'v0.8-shard', datetime('now'), datetime('now'))`).run(id, shardP2sh, randomBytes(32).toString('hex'), deadline);
      return id;
    },
    recordBettor(o) {
      bettorsAll.push(o);
      db.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, created_at)
        VALUES (?, ?, ?, ?, 'e2e-no-side-p2sh', ?, datetime('now'))`).run(o.shardMarketId, o.bettorPk, o.direction, String(o.stakeSompi), o.leafTx);
    },
  };
}
async function runMarket(label, { zkNative }) {
  const logicalMarketId = `e2e-${label}-` + randomBytes(6).toString('hex');
  const poolMerkleRoot = randomBytes(32).toString('hex');
  const predicateCommit = randomBytes(32).toString('hex');
  const h = mkMarketHelpers(logicalMarketId);
  let zk = {};
  if (zkNative) {
    const { anchorHex } = computeCloseZkTmplAnchor(WT + '/kasia-console/src/lib/CloseZkV2.sil', process.env.ZK_GATE_TMPL_HASH, tokenTmplHash, claimTmplHash);
    zk = { zkNative: true, closeZkTmplAnchor: anchorHex };
  }
  const base = { db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, relayAddr, sealCount, deadline,
    createShardMarketRow: h.createShardMarketRow, recordBettor: h.recordBettor, tokenTmplHash, claimTmplHash, marketSuffixHash, ...zk };
  console.log(`
=== [${label}] BET 1 (建盘后首注: PayoutShard${zkNative ? 'V2' : ''} 创世 + ShardLeaf 创世 + 首笔 register_append) ===`);
  const r1 = await registerBettorOnShard({ ...base, bettorPk: randomBytes(32).toString('hex'), direction: 0, stakeSompi: 10_000_000 });
  console.log(`[${label}] bet1:`, JSON.stringify(r1));
  console.log(`
=== [${label}] BET 2 (第二注: 续笔 register_append) ===`);
  const r2 = await registerBettorOnShard({ ...base, bettorPk: randomBytes(32).toString('hex'), direction: 1, stakeSompi: 15_000_000 });
  console.log(`[${label}] bet2:`, JSON.stringify(r2));
  const ps = db.prepare('SELECT covenant_family, payout_ps_outpoint, token_tmpl_hash, claim_tmpl_hash, market_suffix_hash, payout_redeem_hex FROM payout_shards WHERE logical_market_id = ?').get(logicalMarketId);
  console.log(`[${label}] payout_shards row:`, JSON.stringify({ ...ps, payout_redeem_hex: ps.payout_redeem_hex.slice(0, 16) + '…(' + ps.payout_redeem_hex.length / 2 + 'B)' }));
  if (zkNative) {
    assertZkHandoffTmplCoherent(ps, logicalMarketId, { tokenTmplHash, claimTmplHash, marketSuffixHash });
    console.log(`[${label}] assertZkHandoffTmplCoherent(payout_shards 行 vs 生产读取点 env 值) PASS — zk_handoff 的一致性门不会因 NULL 拒绝`);
  }
  return { logicalMarketId, r1, r2, ps };
}
const resA = await runMarket('v1committee', { zkNative: false });
const resB = await runMarket('v2zk', { zkNative: true });

// 节点原文: 四笔 register 相关 tx 是否被节点收入(getMempoolEntry 应 not-found=已确认, 或 getBlock 可查)
console.log('=== 节点读回 ===');
for (const [lab, r] of [['v1 bet1', resA.r1], ['v1 bet2', resA.r2], ['v2 bet1', resB.r1], ['v2 bet2', resB.r2]]) {
  const tx = r.leafTx;
  const m = await rpc.getMempoolEntry({ txId: tx, includeOrphanPool: false, filterTransactionPool: false }).then(() => 'IN-MEMPOOL(未确认)').catch((e) => 'not-in-mempool(已出块或不存在): ' + String(e?.message ?? e).slice(0, 80));
  console.log(lab, 'leafTx', tx, '|', m);
}
console.log('payout genesis txids:', resA.ps.payout_ps_outpoint, resB.ps.payout_ps_outpoint);
const dag = await rpc.getBlockDagInfo();
console.log('virtualDaaScore:', dag.virtualDaaScore, 'networkId:', info.networkId);
await rpc.disconnect().catch(() => {});
console.log('[driver] DONE');
process.exit(0);
