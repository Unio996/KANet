// proto-tx-assembly.test.mjs — Bettor 1425 复核清单向量①④(账本1425续)。原③(assertKttOutpointRecorded,
// 守 bet_mint 步骤A铸出的独立stake筹码 outpoint 来源)已随 D-020(账本1446/1448)取消步骤A一起删除,
// 见 kasia-console/src/lib/proto-tx-assembly.mjs 文件头注。
// ①②④ 纯 JS/真 DB, 零链零 IPC。②(CovenantBinding 遗漏→mass >10x)是独立的真 kaspa-wasm 构造实验,
// 见 docs/provenance/2026-09-15-j2-market-genesis-tx-assembly-vectors/vector2-covenant-binding-omission.mjs
// (真链构造成本高、依赖 kaspa-wasm 全量, 不适合塞进这个跑得快的离线测试文件)。
// Run: cd kasia-console && node src/lib/proto-tx-assembly.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_TX_ASSEMBLY_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_tx_assembly_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_TX_ASSEMBLY_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const {
  GENESIS_OUTPUT_SOMPI, CONTINUATION_OUTPUT_SOMPI, GLOBAL_ABS_FEE_CAP_SOMPI, assertFixedOutputValue,
  computeRequiredFeeSompiOrThrow, selectFeeUtxo, selectChangeShape, dynamicNetLossCeiling,
} = await import('./proto-tx-assembly.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

// ============ 向量① genesisOutputValue 用"seed 减法"算出非常量值 ⇒ 构造层拒绝 ============
t('①-1 精确等于协议常量 ⇒ 通过', () => {
  assertFixedOutputValue(20_000_000n, GENESIS_OUTPUT_SOMPI, 'genesis');
});
t('①-2 用"种子减法"算出的近似值(例如 seedValue - feeEstimate 凑出来的 19,999,999) ⇒ 拒绝', () => {
  const seedValue = 120_000_000n;
  const feeEstimateGuess = 100_000_001n; // 故意"减法凑数"而非直接用协议常量
  const computedBySubtraction = seedValue - feeEstimateGuess; // = 19_999_999n, 差 1 sompi
  let threw = null;
  try { assertFixedOutputValue(computedBySubtraction, GENESIS_OUTPUT_SOMPI, 'genesis'); } catch (e) { threw = e; }
  if (!threw) throw new Error('减法算出的非常量值应该被拒绝, 但没有抛错');
  if (!/!= 协议常量/.test(threw.message)) throw new Error(`错误信息不对: ${threw.message}`);
});
t('①-3 续约输出同理: 差 1 sompi 也必须拒绝(不是只查"大致相等")', () => {
  let threw = null;
  try { assertFixedOutputValue(CONTINUATION_OUTPUT_SOMPI + 1n, CONTINUATION_OUTPUT_SOMPI, 'continuation'); } catch (e) { threw = e; }
  if (!threw) throw new Error('多 1 sompi 也应该被拒绝');
});
t('①-4 非 bigint 类型直接拒绝(防止 Number 精度静默出错)', () => {
  let threw = null;
  try { assertFixedOutputValue(20000000, GENESIS_OUTPUT_SOMPI, 'genesis'); } catch (e) { threw = e; }
  if (!threw || !/must be bigint/.test(threw.message)) throw new Error('非 bigint 应该被拒绝并明确报错');
});

// ============ 向量④ console 侧调用 calculateTransactionMass 不可用 ⇒ fail-loud ============
t('④-1 kaspa 对象完全没有 calculateTransactionMass 方法 ⇒ 立即 throw, 不回退估算值', () => {
  let threw = null;
  try { computeRequiredFeeSompiOrThrow({}, 'mainnet', {}); } catch (e) { threw = e; }
  if (!threw || !/不可用/.test(threw.message)) throw new Error('应该 throw 且提示不可用');
});
t('④-2 calculateTransactionMass 抛错(例如 v1 covenant tx panic) ⇒ 原样冒泡, 不吞掉不估算', () => {
  const fakeKaspa = { calculateTransactionMass: () => { throw new Error('wasm unreachable'); } };
  let threw = null;
  try { computeRequiredFeeSompiOrThrow(fakeKaspa, 'mainnet', {}); } catch (e) { threw = e; }
  if (!threw || !/wasm unreachable/.test(threw.message)) throw new Error('原始错误信息应该冒泡出来');
});
t('④-3 calculateTransactionMass 返回 null ⇒ 视为不可用, 不当 0 处理', () => {
  const fakeKaspa = { calculateTransactionMass: () => null };
  let threw = null;
  try { computeRequiredFeeSompiOrThrow(fakeKaspa, 'mainnet', {}); } catch (e) { threw = e; }
  if (!threw || !/返回空值/.test(threw.message)) throw new Error('应该拒绝空返回值');
});
t('④-4 calculateTransactionMass 正常返回 ⇒ fee = mass * 100(SOMPI_PER_MASS)', () => {
  const fakeKaspa = { calculateTransactionMass: () => 3000n };
  const fee = computeRequiredFeeSompiOrThrow(fakeKaspa, 'mainnet', {});
  if (fee !== 300000n) throw new Error(`fee 应该是 300000, 实际 ${fee}`);
});

// ============ §9.5 fee-UTXO 选择器附带向量(non-required, 但同一批交付, 一并验证) ============
t('fee-UTXO: 有单个够用的 UTXO ⇒ 选中它', () => {
  const u = selectFeeUtxo([{ txid: 'a', vout: 0, value: 500_000_000n }, { txid: 'b', vout: 0, value: 5_000_000_000n }], 100_000_000n);
  if (u.txid !== 'a') throw new Error('应该选最小的够用 UTXO');
});
t('fee-UTXO: 没有任何单个 UTXO 够用 ⇒ no_suitable_fee_utxo, 不自动拆分', () => {
  let threw = null;
  try { selectFeeUtxo([{ txid: 'a', vout: 0, value: 1_000n }], 100_000_000n); } catch (e) { threw = e; }
  if (!threw || !/no_suitable_fee_utxo/.test(threw.message)) throw new Error('应该 fail-loud 报 no_suitable_fee_utxo');
});
// ============ selectChangeShape(账本1427 订正: 按真实成本二选一, 不设人为 0/20M 门槛) ============
// 用假 kaspa(固定 mass 函数)构造确定性向量——真实 mass 依赖真 kaspa-wasm 编译产物, 在下面的
// genesis-e2e 段用真链路再验一次这条逻辑真的接得上。
function fakeTxWithMassOf(massValue) { return { finalize() {}, _mass: massValue }; }
function fakeKaspaMass(massFn) { return { calculateTransactionMass: (net, tx) => massFn(tx) }; }

t('selectChangeShape-1: leftover=0 ⇒ 只走无找零形状, requiredFee<=0 时通过', () => {
  const kaspa = fakeKaspaMass(() => 0n); // mass=0 ⇒ requiredFee=0
  const r = selectChangeShape({
    kaspa, network: 'mainnet', leftoverSompi: 0n,
    buildTxWithChange: () => { throw new Error('leftover=0 不该调用 buildTxWithChange'); },
    buildTxNoChange: () => fakeTxWithMassOf(0n),
    absFeeCapSompi: GLOBAL_ABS_FEE_CAP_SOMPI,
  });
  if (r.includeChange !== false || r.netLoss !== 0n) throw new Error(`结果不对: ${JSON.stringify(r, (k,v)=>typeof v==='bigint'?v.toString():v)}`);
});

t('selectChangeShape-2: 0.95 KAS 种子步骤B真实形状(找零约15,000,000) ⇒ 带找零形状通过, 不再被硬门槛拒绝', () => {
  // mass 与结构相关: 带找零(2 输出)mass 比不带找零(1 输出)略高, 用固定值模拟真实量级(sompi_per_mass=100)。
  const kaspa = fakeKaspaMass((tx) => tx._mass);
  const leftover = 95_000_000n; // 0.95 KAS 种子面值扣掉续约输出后的剩余
  const r = selectChangeShape({
    kaspa, network: 'mainnet', leftoverSompi: leftover,
    buildTxWithChange: (changeSompi) => fakeTxWithMassOf(changeSompi === leftover ? 400_000n : 500_000n), // 占位算 mass=400000(fee=40,000,000); 找零=leftover-40,000,000=55,000,000...
    buildTxNoChange: () => fakeTxWithMassOf(300_000n), // fee=30,000,000, netLoss=leftover=95,000,000 > ceiling 可能超, 视 cap 而定
    absFeeCapSompi: 100_000_000n,
  });
  if (r.requiredFee <= 0n) throw new Error('requiredFee 应该 > 0');
  if (r.netLoss > r.ceiling) throw new Error(`选中的形状不该超过 ceiling: netLoss=${r.netLoss} ceiling=${r.ceiling}`);
});

t('selectChangeShape-3: 找零很小(1,000 sompi)时选中"并入手续费"形状, 不构造 dust 找零输出', () => {
  const kaspa = fakeKaspaMass((tx) => tx._mass);
  const leftover = 51_000n; // 极小剩余, 带找零形状的 requiredFee 若 > leftover 直接不可行, 迫使选 (b)
  const r = selectChangeShape({
    kaspa, network: 'mainnet', leftoverSompi: leftover,
    buildTxWithChange: () => fakeTxWithMassOf(1_000n), // requiredFee=100,000 > leftover=51,000 ⇒ changeA<0 不可行
    buildTxNoChange: () => fakeTxWithMassOf(400n), // requiredFee=40,000 <= leftover=51,000 ⇒ 可行
    absFeeCapSompi: GLOBAL_ABS_FEE_CAP_SOMPI,
  });
  if (r.includeChange !== false) throw new Error('应该选中不带找零的形状(带找零形状不可行: fee 超过剩余额度)');
});

t('selectChangeShape-4: 两种形状的 net_loss 都超过 ceiling ⇒ throw no_viable_change_shape, 报文带两种形状的数字', () => {
  const kaspa = fakeKaspaMass((tx) => tx._mass);
  let threw = null;
  try {
    selectChangeShape({
      kaspa, network: 'mainnet', leftoverSompi: 500_000_000n, // 巨大剩余, 若 cap 很小两种形状都超
      buildTxWithChange: () => fakeTxWithMassOf(1_000_000n), // requiredFee=100,000,000
      buildTxNoChange: () => fakeTxWithMassOf(900_000n), // requiredFee=90,000,000, netLoss=leftover=500,000,000 远超小 cap
      absFeeCapSompi: 1_000_000n, // 故意设一个极小的 per-kind cap, 逼两种形状都不可行
    });
  } catch (e) { threw = e; }
  if (!threw || !/no_viable_change_shape/.test(threw.message)) throw new Error('两种形状都不可行时应该 throw no_viable_change_shape');
  if (!/withChange/.test(threw.message) || !/noChange/.test(threw.message)) throw new Error('错误信息应该带上两种形状各自的数字');
});

t('selectChangeShape-5: 20M 边界上下各一个点各自选中的形状(不再是硬门槛, 只是观察真实选择结果)', () => {
  const kaspa = fakeKaspaMass((tx) => tx._mass);
  const mk = (leftover) => selectChangeShape({
    kaspa, network: 'mainnet', leftoverSompi: leftover,
    buildTxWithChange: () => fakeTxWithMassOf(2_000n), // requiredFee=200,000(带找零形状本身很便宜)
    buildTxNoChange: () => fakeTxWithMassOf(1_500n), // requiredFee=150,000
    absFeeCapSompi: GLOBAL_ABS_FEE_CAP_SOMPI,
  });
  const below = mk(19_999_999n); // 20M 以下
  const above = mk(20_000_001n); // 20M 以上
  // 两个都应该能选出一个可行形状(fee 远小于 leftover), 且 netLoss 都应该约等于 requiredFee(带找零形状胜出, 因为它 netLoss 更小)
  if (below.netLoss > below.ceiling || above.netLoss > above.ceiling) throw new Error('两个边界点都应该有可行形状');
  if (below.includeChange !== true || above.includeChange !== true) throw new Error(`两个边界点在这套 mass 假设下都应该选中带找零形状(netLoss 更小): below=${JSON.stringify(below.includeChange)} above=${JSON.stringify(above.includeChange)}`);
});

t('dynamicNetLossCeiling: min(requiredFee×2, absFeeCapSompi, GLOBAL_ABS_FEE_CAP_SOMPI) 三者取最小(与 relay 侧 validateNetLoss 公式一致)', () => {
  if (dynamicNetLossCeiling(10n, 1000n) !== 20n) throw new Error('应该是 requiredFee×2 最小');
  if (dynamicNetLossCeiling(1000n, 50n) !== 50n) throw new Error('应该是 absFeeCapSompi 最小');
  if (dynamicNetLossCeiling(999_999_999_999n, 999_999_999_999n) !== GLOBAL_ABS_FEE_CAP_SOMPI) throw new Error('应该被 GLOBAL 硬顶钳住(requiredFee×2 与 absFeeCapSompi 都故意设得很大)');
});

// 🔴 NWT 非阻断建议(2026-09-15): GLOBAL_ABS_FEE_CAP_SOMPI 在 console(本文件)与 relay
// (kasia-relay/src/lib/covenant-broadcast.mjs)各自独立声明一份同名常量(角色分工铁律——Console 不
// import relay 代码), 两边靠"人记得同步改"维持一致, 没有任何机制在数值漂移时报警。本测试从 relay
// 源码文本里现读它自己声明的值(不 import relay 模块——那会违反"Console 传导不碰链"的角色分工;
// 只读文件文本, 同 proto-bet-intent.test.mjs⑦对 PROTO_COVENANT_BROADCAST_TYPE 的既有手法), 与
// console 侧的 GLOBAL_ABS_FEE_CAP_SOMPI 逐值比对——防止未来只改一边、另一边悄悄过期。
t('GLOBAL_ABS_FEE_CAP_SOMPI 两侧不漂移: console侧常量与relay侧源码里声明的值逐字节相等', () => {
  const relaySrcPath = new URL('../../../kasia-relay/src/lib/covenant-broadcast.mjs', import.meta.url);
  const relaySrc = fs.readFileSync(relaySrcPath, 'utf8');
  const m = relaySrc.match(/export const GLOBAL_ABS_FEE_CAP_SOMPI\s*=\s*([0-9_]+)n\s*;/);
  if (!m) throw new Error('relay 源码里找不到 GLOBAL_ABS_FEE_CAP_SOMPI 的声明行(covenant-broadcast.mjs 的导出写法变了? 需要同步更新这条正则)');
  const relayValue = BigInt(m[1].replace(/_/g, ''));
  if (relayValue !== GLOBAL_ABS_FEE_CAP_SOMPI) {
    throw new Error(`两侧漂移了: console侧=${GLOBAL_ABS_FEE_CAP_SOMPI}, relay侧(covenant-broadcast.mjs现读)=${relayValue}——改任一侧必须同步改另一侧`);
  }
});

// ============ market_genesis tx_json 真实端到端组装(真 kaspa-wasm + 真编译 ShardLeaf_direct) ============
// 目的: 证明 buildMarketGenesisTxJson 产出的 tx_json 不只是"格式对", 而是 relay 侧真代码
// (Transaction.deserializeFromSafeJSON → extractTxShape → validateFixedValueOutputs → 签名 →
// assertFinalTxid)能够真的吃下去、真的通过、txid 真的对得上——这是"两边分开写的代码是否真的接得上"
// 这一层, 光测 proto-tx-assembly.mjs 自己内部逻辑测不出这种问题。
// relay 侧函数只在测试里做只读交叉核验(不是生产依赖——"Console 传导不碰链"角色分工不变, 生产代码
// 从不 import kasia-relay)。
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
{
  const kaspa = await import('kaspa-wasm');
  const { buildMarketGenesisTxJson, GENESIS_OUTPUT_SOMPI: GOS } = await import('./proto-tx-assembly.mjs');
  const { computeMarketGenesisArtifacts } = await import('./proto-covenant-builder.mjs');
  const { extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');
  const { randomBytes } = await import('node:crypto');

  const artifacts = await computeMarketGenesisArtifacts({ marketId: 'ab'.repeat(32), minBet: 100, deadlineMs: 1700000000000 });

  const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
  const relayAddr = priv.toPublicKey().toAddress('mainnet');
  const relaySpk = kaspa.payToAddressScript(relayAddr);
  const feeUtxo = { txid: 'ee'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: '0x' + relaySpk.script };

  const FEE_PROFILE_MARKET_GENESIS_CAP = 80_000_000n; // 与 kasia-console/scripts/proto-v0-template-anchors.json 的 feeProfile.market_genesis.cap 一致(真实生产值)
  let built;
  t('genesis-e2e-1 buildMarketGenesisTxJson 真实构造成功(真 mass 计算, 真实 per-kind cap 下选中带找零形状, 返回 shardLeafCovId)', () => {
    built = buildMarketGenesisTxJson({ kaspa, network: 'mainnet', feeUtxo, relayChangeScriptPublicKeyHex: '0x' + relaySpk.script, shardLeafScriptPubKeyHex: artifacts.shardLeafDirect.scriptPubKeyHex, absFeeCapSompi: FEE_PROFILE_MARKET_GENESIS_CAP });
    if (!built.txJson || built.signInputIndices.length !== 1 || built.genesisOutputIndices.length !== 1) throw new Error('返回形状不对');
    if (!built.shardLeafCovId || built.shardLeafCovId === '0'.repeat(64)) throw new Error(`shardLeafCovId 应该是非零派生值, 实际 ${built.shardLeafCovId}`);
    if (built.includeChange !== true) throw new Error('这个测试用的 fee UTXO(100 KAS)剩余远超协议输出, 真实 mass 下带找零形状 netLoss 应该远小于不带找零(netLoss=剩余全部), 应该选中带找零');
    if (built.netLoss > FEE_PROFILE_MARKET_GENESIS_CAP) throw new Error(`netLoss=${built.netLoss} 不该超过 cap=${FEE_PROFILE_MARKET_GENESIS_CAP}`);
  });

  t('genesis-e2e-2 relay 侧真代码能反序列化 + extractTxShape + validateFixedValueOutputs 通过(未签名阶段), covenant_id 在序列化往返后不变(populateGenesisCovenants 声明真的被序列化保留, 不是本地对象独有的临时状态)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    const shape = extractTxShape(tx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
    if (!fv.ok) throw new Error(`relay 真代码拒绝了 console 构造出的 tx: ${fv.reason}`);
    if (shape.outputs[0].valueSompi !== GOS) throw new Error(`genesis 输出值不是协议常量: ${shape.outputs[0].valueSompi}`);
    const covIdAfterRoundtrip = String(tx.outputs[0].covenant?.covenantId ?? '');
    if (covIdAfterRoundtrip !== built.shardLeafCovId) throw new Error(`反序列化后 covenant_id=${covIdAfterRoundtrip} != 构造时算出的 ${built.shardLeafCovId}(populateGenesisCovenants 声明在序列化往返中丢失/改变了)`);
  });

  t('genesis-e2e-3 relay 真签名(signOnlyDeclaredInputs)后 finalize, txid 与 console 预期的 expectedTxid 一致(txid 不含 witness)', () => {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
    signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
    tx.finalize();
    const r = assertFinalTxid(tx, built.expectedTxid);
    if (!r.ok) throw new Error(`签名后 txid=${r.actualTxid} != console 预期的 expectedTxid=${built.expectedTxid}(说明 txid 计算不是真的不受 witness 影响, 或者构造有 bug)`);
  });

  t('genesis-e2e-4 篡改 genesis 输出值后(模拟构造层被绕过), relay 真代码 validateFixedValueOutputs 必须拦下', () => {
    // 用一个更小/不同的输出值重建交易, 模拟"如果某处绕过了构造层的常量写死"这个反例。
    const feeSpk2 = kaspa.payToAddressScript(relayAddr);
    const genesisSpk2 = new kaspa.ScriptPublicKey(0, artifacts.shardLeafDirect.scriptPubKeyHex.slice(2));
    const tamperedTx = new kaspa.Transaction({
      version: 1,
      inputs: [{ previousOutpoint: { transactionId: feeUtxo.txid, index: feeUtxo.vout }, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 1, computeBudget: 0, utxo: { outpoint: { transactionId: feeUtxo.txid, index: feeUtxo.vout }, amount: feeUtxo.value, scriptPublicKey: feeSpk2, blockDaaScore: 0n } }],
      outputs: [
        new kaspa.TransactionOutput(GOS - 1n, genesisSpk2),
        new kaspa.TransactionOutput(feeUtxo.value - GOS - 100000n, feeSpk2),
      ],
      lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '',
    });
    const shape = extractTxShape(tamperedTx);
    const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: [0], continuationOutputIndices: [] });
    if (fv.ok) throw new Error('relay 真代码本该拒绝差 1 sompi 的 genesis 输出, 却放行了');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
// 🔴 用 process.exitCode(不强制终止, 让事件循环自然收尾)而不是 process.exit(): 实测
// kaspa.createInputSignature() 之后立即 process.exit() 会在 kaspa-wasm 的 wasm 异步句柄清理未完成时
// 被强行掐断, 触发 Windows 下 libuv 断言崩溃(`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`,
// src\win\async.c:76) —— 退出码变成 127, 会被外层 spawnSync 误判成"测试失败", 但其实全部断言已经真的
// 跑完并且是真的 pass。不是 kaspa-wasm 用错了, 是"签名后立刻强制退出"这个动作本身撞了 wasm 的异步
// 清理时序——用 process.exitCode 交给事件循环自然收尾就不会崩(已用 scratch/_bisect2~5 四步二分定位到
// 触发点确切是 createInputSignature 之后的 process.exit(), 不是 deserialize/finalize/tx 构造)。
process.exitCode = fail === 0 ? 0 : 1;
