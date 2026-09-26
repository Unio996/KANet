// independent_third_party_test.mjs — MUST-3 / 对抗测试 #10 #11 #16。
//
// 严格零 import 本仓任何 .mjs/.js 帮助函数(不用 pool-bshard-artifacts.mjs 的 compileSilV100,
// 不用 generic-entry-witness.mjs 的 encodeEntryActionGeneric——自己重新实现编译调用 + witness 编码)。
// 只用: (a) 公开发布的 silverc v1.0.0 二进制(D-019 pin, 从其发布路径直接 execFileSync 调用)
//      (b) 官方 npm 包 kaspa-wasm(公开依赖, 不是本仓内部模块)
//      (c) 本设计稿公开的 InstantSplit.sil 源文件本身(合约源码是协议的一部分而非"内部实现细节"——
//          第三方部署者理所当然需要这份 .sil 源码, 就像理所当然需要知道 ERC-20 的 solidity 源码一样;
//          这里"零 import" 指零依赖本仓的 *编排/封装 JS 代码*, 不是要求重新发明 SilverScript 合约本身)
// 只用标准 Node.js 内置模块(child_process/fs/crypto)做胶水。
//
// 证明: 一个全新第三方开发者, 拿到 (i) InstantSplit.sil 源码 (ii) 公开 JSON 配置 schema (iii) 公开
// silverc 二进制 + kaspa-wasm, 不碰我们的服务/数据库/管理员授权, 能独立推导地址、独立构造 split 与
// refund 交易、在 simnet 上真实广播成功——D-034 §7 验收③的唯一可执行证明。

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

// kaspa-wasm 是公开 npm 包(不是本仓内部代码)——独立部署者会自己 `npm install kaspa-wasm`,
// 这里只是借用本机已有的 node_modules 副本以节省重新 npm install 的时间, 不构成对本仓 JS 逻辑的依赖。
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Transaction, TransactionOutput, ScriptPublicKey, ScriptBuilder, Generator, PaymentOutput, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey } = kaspa;

const SILVERC_BIN = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';   // D-019 公开 pin 路径
const SIL_SOURCE = 'D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/src/lib/sil-v1/InstantSplit.sil';   // 合约源码本身(协议公开件)

// ── 独立编译调用(不用 compileSilV100) ──
function independentCompile(ctorJsonArray) {
  const dir = mkdtempSync(join(tmpdir(), 'indep-test-'));
  const ctorPath = join(dir, 'ctor.json');
  const outPath = join(dir, 'out.json');
  writeFileSync(ctorPath, JSON.stringify(ctorJsonArray));
  execFileSync(SILVERC_BIN, [SIL_SOURCE, '--ctor', ctorPath, '-o', outPath], { stdio: 'pipe', timeout: 30_000 });
  const raw = JSON.parse(readFileSync(outPath, 'utf8'));
  const c = raw.contracts.InstantSplit;
  return { bytecode: Buffer.from(c.compiled.bytecode), entries: c.entries };
}

// ── 独立 witness 编码(不用 encodeEntryActionGeneric)——手写 KCC-01 编码规则 ──
// 规则(与本仓 generic-entry-witness.mjs 头注描述的一致, 但这里是独立重新实现, 不 import 那个文件):
//   int -> 8B little-endian; bool -> 8B LE(0/1); bytes(pubkey/fixed_bytes) -> 原始字节 push。
//   全部 witness 参数按声明序 push 完后, 最后 push 4 字节 dispatch_tag, 再 push 完整 redeem 脚本字节。
function pushInt(sb, n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); sb.addI64(BigInt(n)); }
function independentEncodeWitness(entryAbi, argsByName) {
  const sb = new ScriptBuilder({ flags: { covenantsEnabled: true } });
  for (const p of entryAbi.params) {
    const v = argsByName[p.name];
    if (p.type.kind === 'bool') sb.addI64(v ? 1n : 0n);
    else if (p.type.kind === 'int') sb.addI64(BigInt(v));
    else throw new Error('independentEncodeWitness: unsupported param kind ' + p.type.kind + ' (InstantSplit only uses bool/int entry params)');
  }
  sb.addData(Buffer.from(entryAbi.dispatch_tag, 'hex'));
  return sb.drain(); // hex string
}
function independentBuildSigScript(entryAbi, argsByName, redeemScriptBytes) {
  const actionHex = independentEncodeWitness(entryAbi, argsByName);
  const sb2 = ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } });
  sb2.addData(redeemScriptBytes);
  return Buffer.from(sb2.drain(), 'hex');
}

// ── 独立地址推导(不用 createSplitProtocol) ──
function independentPubkeyFromAddress(addrStr) {
  const spk = payToAddressScript(new Address(addrStr));
  const b = Buffer.from(spk.script, 'hex');
  return b.subarray(1, 33);
}
function p2pkSpkHex(pubkey32) { return Buffer.concat([Buffer.from([0x20]), Buffer.from(pubkey32), Buffer.from([0xac])]).toString('hex'); }

async function main() {
  const rpc = new RpcClient({ url: 'ws://127.0.0.1:29717', encoding: Encoding.Borsh, networkId: 'simnet' });
  await rpc.connect({});
  const info = await rpc.getServerInfo();
  if (info.networkId !== 'simnet') { console.error('REFUSE: not simnet'); process.exit(3); }
  console.log('[independent] connected, networkId=', info.networkId);

  const fundingWallet = new PrivateKey('dcb975899fc09882906beec6a51b479d4916c335dfb63991e062ffa5887cb5df');
  const fundingAddr = fundingWallet.toPublicKey().toAddress('simnet').toString();
  function genAddr() { const p = new PrivateKey(randomBytes(32).toString('hex')); return p.toPublicKey().toAddress('simnet').toString(); }

  const merchantAddr = genAddr(), brokerAddr = genAddr(), refundAddr = genAddr();
  const merchantAmt = 700_000_000n, brokerAmt = 250_000_000n;
  const maxSplitFee = 40_000_000n, maxRefundFee = 10_000_000n;
  const bdi0 = await rpc.getBlockDagInfo();
  const blk0 = await rpc.getBlock({ hash: bdi0.tipHashes[0], includeTransactions: false });
  const tipTs = Number(blk0.block.header.timestamp);
  const deadlineMs = tipTs - 600_000; // 已过期 -> refund 立即可测(#10); split 无下界随时可测(#11)

  const ctor = [
    { kind: 'bytes', value: [...independentPubkeyFromAddress(merchantAddr)] }, { kind: 'int', value: Number(merchantAmt) },
    { kind: 'bytes', value: [...independentPubkeyFromAddress(brokerAddr)] }, { kind: 'int', value: Number(brokerAmt) },
    { kind: 'bool', value: false },
    { kind: 'bytes', value: [...Buffer.alloc(32, 0)] }, { kind: 'int', value: 0 },
    { kind: 'bytes', value: [...independentPubkeyFromAddress(refundAddr)] },
    { kind: 'int', value: deadlineMs },
    { kind: 'int', value: Number(maxSplitFee) }, { kind: 'int', value: Number(maxRefundFee) },
    { kind: 'bytes', value: [...Buffer.alloc(32, 0)] },
    { kind: 'bytes', value: [...randomBytes(16)] },
  ];

  console.log('[independent] compiling InstantSplit.sil independently via raw silverc CLI...');
  const { bytecode, entries } = independentCompile(ctor);
  console.log('[independent] bytecode length', bytecode.length, 'entries', JSON.stringify(entries));

  const spk = payToScriptHashScript(new Uint8Array(bytecode));
  const address = addressFromScriptPublicKey(spk, 'simnet').toString();
  console.log('[independent] independently-derived order address:', address);

  // ── fund it ──
  const bdi = await rpc.getBlockDagInfo(); const tip = BigInt(bdi.virtualDaaScore);
  const { entries: allEntries } = await rpc.getUtxosByAddresses([new Address(fundingAddr)]);
  const matured = allEntries.filter(e => (tip - BigInt(e.blockDaaScore)) > 1000n);
  const fundAmt = merchantAmt + brokerAmt + 5_000_000n;
  const generator = new Generator({ entries: matured, outputs: [new PaymentOutput(new Address(address), fundAmt)], priorityFee: 0n, changeAddress: new Address(fundingAddr), networkId: 'simnet' });
  let fundTxId = ''; let pending;
  while ((pending = await generator.next())) { await pending.sign([fundingWallet]); fundTxId = await pending.submit(rpc); }
  console.log('[independent] fund txid', fundTxId);
  for (let i = 0; i < 3; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: fundingAddr, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); }

  const { entries: e2 } = await rpc.getUtxosByAddresses([address]);
  const utxo = { transactionId: e2[0].outpoint.transactionId, index: e2[0].outpoint.index, amountSompi: e2[0].amount };
  console.log('[independent] order utxo amt', utxo.amountSompi.toString());

  // ── #11: independently construct + broadcast split (no dependency on our services/db) ──
  const sigScriptSplit = independentBuildSigScript(entries.split, { hasChange: false }, bytecode);
  const txSplit = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigScriptSplit.toString('hex'), sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: [
      new TransactionOutput(merchantAmt, new ScriptPublicKey(0, p2pkSpkHex(independentPubkeyFromAddress(merchantAddr)))),
      new TransactionOutput(brokerAmt, new ScriptPublicKey(0, p2pkSpkHex(independentPubkeyFromAddress(brokerAddr)))),
    ],
    lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const rSplit = await rpc.submitTransaction({ transaction: txSplit, allowOrphan: false }).catch(e => ({ err: e.message }));
  console.log('[T11 independent split] result:', JSON.stringify(rSplit));

  // ── #10: independently construct + broadcast refund against a SEPARATE fresh order (deadline already past) ──
  const merchantAddr2 = genAddr(), brokerAddr2 = genAddr(), refundAddr2 = genAddr();
  const ctor2 = [
    { kind: 'bytes', value: [...independentPubkeyFromAddress(merchantAddr2)] }, { kind: 'int', value: Number(merchantAmt) },
    { kind: 'bytes', value: [...independentPubkeyFromAddress(brokerAddr2)] }, { kind: 'int', value: Number(brokerAmt) },
    { kind: 'bool', value: false },
    { kind: 'bytes', value: [...Buffer.alloc(32, 0)] }, { kind: 'int', value: 0 },
    { kind: 'bytes', value: [...independentPubkeyFromAddress(refundAddr2)] },
    { kind: 'int', value: deadlineMs },
    { kind: 'int', value: Number(maxSplitFee) }, { kind: 'int', value: Number(maxRefundFee) },
    { kind: 'bytes', value: [...Buffer.alloc(32, 0)] },
    { kind: 'bytes', value: [...randomBytes(16)] },
  ];
  const compiled2 = independentCompile(ctor2);
  const spk2 = payToScriptHashScript(new Uint8Array(compiled2.bytecode));
  const address2 = addressFromScriptPublicKey(spk2, 'simnet').toString();
  console.log('[independent] second order address (for refund test)', address2);
  const fundAmt2 = merchantAmt + brokerAmt + 5_000_000n;
  const bdi2 = await rpc.getBlockDagInfo(); const tip2 = BigInt(bdi2.virtualDaaScore);
  const { entries: allE2 } = await rpc.getUtxosByAddresses([new Address(fundingAddr)]);
  const matured2 = allE2.filter(e => (tip2 - BigInt(e.blockDaaScore)) > 1000n);
  const gen2 = new Generator({ entries: matured2, outputs: [new PaymentOutput(new Address(address2), fundAmt2)], priorityFee: 0n, changeAddress: new Address(fundingAddr), networkId: 'simnet' });
  let fundTxId2 = ''; let pending2;
  while ((pending2 = await gen2.next())) { await pending2.sign([fundingWallet]); fundTxId2 = await pending2.submit(rpc); }
  console.log('[independent] fund2 txid', fundTxId2);
  for (let i = 0; i < 3; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: fundingAddr, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); }
  const { entries: e3 } = await rpc.getUtxosByAddresses([address2]);
  const utxo2 = { transactionId: e3[0].outpoint.transactionId, index: e3[0].outpoint.index, amountSompi: e3[0].amount };

  const sigScriptRefund = independentBuildSigScript(compiled2.entries.refund, {}, compiled2.bytecode);
  const txRefund = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: utxo2.transactionId, index: utxo2.index }, signatureScript: sigScriptRefund.toString('hex'), sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: [new TransactionOutput(BigInt(utxo2.amountSompi) - 2_000_000n, new ScriptPublicKey(0, p2pkSpkHex(independentPubkeyFromAddress(refundAddr2))))],
    lockTime: BigInt(deadlineMs), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const rRefund = await rpc.submitTransaction({ transaction: txRefund, allowOrphan: false }).catch(e => ({ err: e.message }));
  console.log('[T10 independent refund] result:', JSON.stringify(rRefund));

  console.log('\n=== INDEPENDENT THIRD-PARTY TEST SUMMARY ===');
  console.log('T11 (independent split accept):', rSplit.transactionId ? 'PASS txid=' + rSplit.transactionId : 'FAIL ' + rSplit.err);
  console.log('T10 (independent refund accept):', rRefund.transactionId ? 'PASS txid=' + rRefund.transactionId : 'FAIL ' + rRefund.err);

  await rpc.disconnect().catch(() => {});
  process.exit((rSplit.transactionId && rRefund.transactionId) ? 0 : 1);
}
main();
