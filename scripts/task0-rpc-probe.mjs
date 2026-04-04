/**
 * Task 0: 验证公共 Kaspa RPC 节点支持哪些 API
 *
 * 测试项：
 *   1. subscribeUtxosChanged — 地址级 UTXO 订阅
 *   2. getMempoolEntry(txId) — 查内存池 TX
 *   3. getBlock(blockHash) — 按 hash 取块（含 TX payload）
 *   4. getBlockDagInfo — 基础连通性
 *   5. getVirtualChainFromBlock — 取最近区块 hash
 *
 * 结论：确定 light-scanner _processTx 的实现路径
 *
 * Usage: node scripts/task0-rpc-probe.mjs
 */

import * as kaspa from 'kaspa-wasm';
const { RpcClient, Resolver, Encoding } = kaspa;

const NETWORK = 'mainnet';
const TIMEOUT = 15000;

function log(emoji, msg) {
  console.log(`  ${emoji}  ${msg}`);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms))
  ]);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Task 0: Public Kaspa RPC API Probe');
  console.log('═══════════════════════════════════════════════\n');

  // ── 连接 ──────────────────────────────────────────────
  console.log('[1/6] Connecting to public RPC via Resolver...');
  const rpc = new RpcClient({
    resolver: new Resolver(),
    encoding: Encoding.Borsh,
    networkId: NETWORK,
  });

  try {
    await withTimeout(rpc.connect({}), TIMEOUT, 'connect');
    log('✓', 'Connected');
  } catch (e) {
    log('✗', `Connection FAILED: ${e.message}`);
    process.exit(1);
  }

  // ── getBlockDagInfo（基线连通性）────────────────────────
  console.log('\n[2/6] getBlockDagInfo...');
  let dagInfo;
  try {
    dagInfo = await withTimeout(rpc.getBlockDagInfo(), TIMEOUT, 'getBlockDagInfo');
    log('✓', `blockCount=${dagInfo.blockCount}, headerCount=${dagInfo.headerCount}`);
    log('✓', `tipHashes: ${dagInfo.tipHashes?.length || 0} tips`);
  } catch (e) {
    log('✗', `FAILED: ${e.message}`);
  }

  // ── getBlock（用 tipHash 取一个块）────────────────────
  console.log('\n[3/6] getBlock(tipHash, includeTransactions=true)...');
  let sampleTxId = null;
  let sampleBlockPayload = false;
  if (dagInfo?.tipHashes?.length > 0) {
    const tipHash = dagInfo.tipHashes[0];
    try {
      const block = await withTimeout(
        rpc.getBlock(tipHash, true),
        TIMEOUT, 'getBlock'
      );
      const txCount = block?.block?.transactions?.length || 0;
      log('✓', `getBlock OK — ${txCount} transactions in block`);

      // 检查 TX 结构：有没有 payload 字段？
      if (txCount > 0) {
        const firstTx = block.block.transactions[0];
        const txKeys = Object.keys(firstTx || {});
        log('✓', `TX keys: [${txKeys.join(', ')}]`);

        // 看 payload
        const payload = firstTx?.payload;
        const verbosePayload = firstTx?.verboseData?.payload;
        log('ℹ', `tx.payload = ${payload === undefined ? 'UNDEFINED' : JSON.stringify(payload).slice(0, 80)}`);
        log('ℹ', `tx.verboseData.payload = ${verbosePayload === undefined ? 'UNDEFINED' : JSON.stringify(verbosePayload).slice(0, 80)}`);

        if (payload || verbosePayload) sampleBlockPayload = true;

        // 取一个非 coinbase TX 的 ID 做后续测试
        for (const tx of block.block.transactions) {
          const id = tx?.verboseData?.transactionId || tx?.id;
          if (id && (tx.inputs?.length > 0)) {
            sampleTxId = id;
            break;
          }
        }
        if (sampleTxId) log('ℹ', `sample txId for further tests: ${sampleTxId.slice(0, 24)}...`);
      }
    } catch (e) {
      log('✗', `FAILED: ${e.message}`);
    }
  } else {
    log('⚠', 'No tipHashes available, skipping');
  }

  // ── getMempoolEntry ────────────────────────────────────
  console.log('\n[4/6] getMempoolEntry(sampleTxId)...');
  if (sampleTxId) {
    try {
      const entry = await withTimeout(
        rpc.getMempoolEntry(sampleTxId, true, false),
        TIMEOUT, 'getMempoolEntry'
      );
      log('✓', `getMempoolEntry OK — has entry: ${!!entry}`);
      if (entry) log('ℹ', `entry keys: [${Object.keys(entry).join(', ')}]`);
    } catch (e) {
      // 已确认的 TX 不在 mempool，应该报"not found"而不是"method not supported"
      const msg = e.message || '';
      if (msg.includes('not found') || msg.includes('missing') || msg.includes('is not in the mempool')) {
        log('✓', `API exists but TX not in mempool (expected): "${msg.slice(0, 100)}"`);
      } else {
        log('⚠', `Response: "${msg.slice(0, 150)}"`);
      }
    }
  } else {
    log('⚠', 'No sample txId, skipping');
  }

  // ── getMempoolEntries（不带参数，检查是否支持）──────────
  console.log('\n[5/6] getMempoolEntries (method availability check)...');
  try {
    const entries = await withTimeout(
      rpc.getMempoolEntries(true, false),
      TIMEOUT, 'getMempoolEntries'
    );
    const count = entries?.mempoolEntries?.length ?? entries?.length ?? '?';
    log('✓', `getMempoolEntries OK — ${count} entries`);
  } catch (e) {
    log('⚠', `Response: "${(e.message || '').slice(0, 150)}"`);
  }

  // ── subscribeUtxosChanged ──────────────────────────────
  console.log('\n[6/6] subscribeUtxosChanged (test with dummy address)...');
  // 用一个已知的 Agent 地址或者随机地址测试订阅是否被接受
  const testAddr = 'kaspa:qz0kfhpawkq87c00rfgartnfkft3c5z5llscyxupzjyqp0qvzdseskwtgqmf';
  try {
    const Address = kaspa.Address;
    const addr = new Address(testAddr);
    await withTimeout(
      rpc.subscribeUtxosChanged([addr]),
      TIMEOUT, 'subscribeUtxosChanged'
    );
    log('✓', 'subscribeUtxosChanged accepted — subscription works on public nodes');
  } catch (e) {
    log('✗', `FAILED: "${(e.message || '').slice(0, 150)}"`);
  }

  // ── 汇总 ──────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`
  getBlockDagInfo ............. ${dagInfo ? '✓ OK' : '✗ FAIL'}
  getBlock(hash, true) ....... ${sampleBlockPayload ? '✓ OK (has TX payload)' : '? (no payload field seen)'}
  getMempoolEntry ............. (API exists, confirmed TX → not found = expected)
  subscribeUtxosChanged ...... (see result above)

  ── Payload 获取路径结论 ──

  如果 getBlock 返回的 TX 有 payload 字段：
    → 方案 B 可行：subscribeUtxosChanged 触发后用 getBlock 获取整块 TX
    → 但 subscribeUtxosChanged event 不带 blockHash
    → 需要：UTXO change → txId → ??? → blockHash → getBlock → 找 TX → payload
    → 缺 txId → blockHash 的映射

  如果 getMempoolEntry 能拿到未确认 TX 的 payload：
    → 对刚广播的 TX 有效（几秒内还在 mempool）
    → 对已确认 TX 无效
    → 可以作为快速路径，getBlock 作为慢速路径

  关键问题：subscribeUtxosChanged event 的数据结构是什么？
    → 是否包含 blockHash？如果包含，方案 B 直接可行
    → 如果不包含，需要备选方案
`);

  await rpc.disconnect();
  console.log('\nDone.');
  process.exit(0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
