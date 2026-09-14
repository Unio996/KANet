// proto-tx-assembly-ktt-genesis.test.mjs — buildKttGenesisTxJson 真实端到端组装验证
// (账本1425/1436, bet_mint 步骤A: 铸stake筹码, owner=STAKE_CHIP_OWNER_UNBOUND)。
// 真 kaspa-wasm + 真编译, relay 真代码交叉核验, 零mock。
// Run: cd kasia-console && node src/lib/proto-tx-assembly-ktt-genesis.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_TX_ASSEMBLY_KTTGENESIS_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_kttgenesis_e2e_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_TX_ASSEMBLY_KTTGENESIS_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

const kaspa = await import('kaspa-wasm');
const { randomBytes } = await import('node:crypto');
const { buildKttGenesisTxJson } = await import('./proto-tx-assembly.mjs');
const { computeKttGenesisArtifact, STAKE_CHIP_OWNER_UNBOUND } = await import('./proto-covenant-builder.mjs');
const { extractTxShape, validateFixedValueOutputs, signOnlyDeclaredInputs, assertFinalTxid } = await import('../../../kasia-relay/src/lib/covenant-broadcast.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message + '\n' + e.stack); } };

const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
const relayAddr = priv.toPublicKey().toAddress('mainnet');
const relaySpk = kaspa.payToAddressScript(relayAddr);
const relaySpkHex = '0x' + relaySpk.script;

const STAKE_AMOUNT = 20;
const kttArtifact = computeKttGenesisArtifact({ amount: STAKE_AMOUNT, ownerCovIdHex: STAKE_CHIP_OWNER_UNBOUND });
const feeUtxo = { txid: 'ff'.repeat(32), vout: 0, value: 10_000_000_000n, scriptPublicKeyHex: relaySpkHex };

let built;
t('①buildKttGenesisTxJson 真实构造成功(真 mass 计算, 真实 per-kind cap 下选中带找零形状, 返回 stakeCovId)', () => {
  built = buildKttGenesisTxJson({
    kaspa, network: 'mainnet', feeUtxo, relayChangeScriptPublicKeyHex: relaySpkHex,
    kttScriptPubKeyHex: kttArtifact.scriptPubKeyHex, absFeeCapSompi: 80_000_000n,
  });
  if (!built.txJson) throw new Error('txJson 为空');
  if (!/^[0-9a-f]{64}$/.test(built.stakeCovId)) throw new Error(`stakeCovId 形状不对: ${built.stakeCovId}`);
  if (built.includeChange !== true) throw new Error(`本笔 feeUtxo 面值下应选中带找零形状, 实际 includeChange=${built.includeChange}`);
});

t('②relay真代码能反序列化+extractTxShape+validateFixedValueOutputs通过(未签名阶段), covenant_id 序列化往返后不变', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  const shape = extractTxShape(tx);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (!fv.ok) throw new Error(`relay 真代码拒绝了 console 构造出的 tx: ${fv.reason}`);
  const roundTripCovId = String(tx.outputs[built.genesisOutputIndices[0]].covenant?.covenantId ?? '');
  if (roundTripCovId.toLowerCase() !== built.stakeCovId.toLowerCase()) {
    throw new Error(`反序列化后 covenant_id=${roundTripCovId} != 构造时算出的 ${built.stakeCovId}`);
  }
});

t('③relay真签名(signOnlyDeclaredInputs)后 finalize, txid 与 expectedTxid 一致', () => {
  const tx = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  signOnlyDeclaredInputs({ tx, signInputIndices: built.signInputIndices, privateKey: priv, kaspa });
  tx.finalize();
  const r = assertFinalTxid(tx, built.expectedTxid);
  if (!r.ok) throw new Error(`签名后 txid=${r.actualTxid} != expectedTxid=${built.expectedTxid}`);
});

t('④篡改genesis输出值后(模拟构造层被绕过), relay真代码 validateFixedValueOutputs 必须拦下', () => {
  const tampered = kaspa.Transaction.deserializeFromSafeJSON(built.txJson);
  tampered.outputs[built.genesisOutputIndices[0]].value = 19_999_999n;
  const shape = extractTxShape(tampered);
  const fv = validateFixedValueOutputs({ outputs: shape.outputs, genesisOutputIndices: built.genesisOutputIndices, continuationOutputIndices: built.continuationOutputIndices });
  if (fv.ok) throw new Error('篡改后 validateFixedValueOutputs 应该拒绝, 但通过了');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
