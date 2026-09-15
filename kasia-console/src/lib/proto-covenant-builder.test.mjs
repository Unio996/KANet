// proto-covenant-builder.test.mjs — market_genesis ctor 推导链 + bet_mint 步骤A(KTT genesis)真实
// 编译向量(J2, 账本1423/1425)。真调 D-019 pin 的 v1.0.0 silverc(compileSilV100), 零 mock——这是
// "构造出的字节到底对不对"这一层, mock 编译器就测不出真问题。
// Run: cd kasia-console && node src/lib/proto-covenant-builder.test.mjs
//
// 需要 CONSOLE_ENCRYPTION_KEY(64 hex 字符)——encryptCommitteePrivkey 依赖它, 测试用固定占位值,
// 不是真密钥, 只为了让 encrypt() 不 throw。

if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);

import assert from 'node:assert';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { extractTemplateArtifactV100 } from './pool-template-artifact.mjs';
import {
  computeMarketGenesisArtifacts, computeKttGenesisArtifact, computeTicketGenesisArtifact, loadProtocolConstants, p2sh, ZERO32,
  convergeShardLeafOwnRedeemLen, computeShardLeafRedeemScript,
} from './proto-covenant-builder.mjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

const ROOT_CLOSE_SIL = new URL('./RootClose.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHARD_LEAF_DIRECT_SIL = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const byteN = (n) => ({ kind: 'byte', value: n });

await t('①(T4-lite 前提)协议常量文件存在且三项都非空', () => {
  const c = loadProtocolConstants();
  assert.match(c.ps_tmpl_hash, /^[0-9a-f]{64}$/);
  assert.match(c.token_tmpl_hash, /^[0-9a-f]{64}$/);
  assert.match(c.claim_tmpl_hash, /^[0-9a-f]{64}$/);
});

let artifacts;
const MARKET_ID = 'aa'.repeat(32);
const MIN_BET = 100;
const DEADLINE_MS = 1700000000000;

await t('② 完整 market_genesis 推导链真实编译成功(committee keypair→RootClaim→RefundClaim→RootClose→ShardLeaf_direct)', async () => {
  artifacts = await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: MIN_BET, deadlineMs: DEADLINE_MS });
  assert.match(artifacts.committeePubkeyHex, /^[0-9a-f]{64}$/);
  assert.ok(artifacts.committeePrivkeyEnvelope && artifacts.committeePrivkeyEnvelope.length > 0, '私钥信封非空(已加密, 本测试不解密验证内容——decryptCommitteePrivkey 是 proto-committee-key.mjs 自己的既有职责, 不重复测)');
  assert.match(artifacts.committeeHash, /^[0-9a-f]{64}$/);
  assert.match(artifacts.rootClaimTmplHash, /^[0-9a-f]{64}$/);
  assert.match(artifacts.refundClaimTmplHash, /^[0-9a-f]{64}$/);
  assert.match(artifacts.rootCloseTmplHash, /^[0-9a-f]{64}$/);
  assert.ok(artifacts.shardLeafDirect.script.length > 10000, `ShardLeaf_direct 真实编译产物应是大脚本(实际 ${artifacts.shardLeafDirect.script.length} 字节, 量级应与 provenance 记录的 ~15687 一致)`);
  assert.match(artifacts.shardLeafDirect.scriptPubKeyHex, /^0xaa20[0-9a-f]{64}87$/, 'P2SH 包装形状正确(aa20<32字节hash>87)');
  // 🔴 账本1469: own_redeem_len 必须已经不动点收敛出来并随 artifacts 一起返回。
  assert.ok(Number.isInteger(artifacts.shardLeafOwnRedeemLen) && artifacts.shardLeafOwnRedeemLen > 0, `shardLeafOwnRedeemLen 应是正整数, 实际 ${artifacts.shardLeafOwnRedeemLen}`);
  assert.strictEqual(artifacts.shardLeafOwnRedeemLen, artifacts.shardLeafDirect.script.length, 'fail-closed 前提: own_redeem_len 必须等于真实编译产物长度');
});

await t('③ rootClaimTmplHash != refundClaimTmplHash(不同合约, 不应该恰好撞同一个值)', () => {
  assert.notStrictEqual(artifacts.rootClaimTmplHash, artifacts.refundClaimTmplHash);
});

await t('④(T4-lite 硬要求, spec §2 T4 清单第 3 条)独立重编译 RootClose(同一套真实 ctor 值)与 builder 算出的 rootCloseTmplHash 逐字节一致——防"编译了两次但用错了哪一次的产物"', () => {
  const c = loadProtocolConstants();
  const independentCtor = [
    ctorBytes32V100(artifacts.committeeHash), ctorIntV100(DEADLINE_MS),
    ctorBytes32V100(artifacts.rootClaimTmplHash), ctorBytes32V100(artifacts.refundClaimTmplHash), ctorBytes32V100(c.token_tmpl_hash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorBytes32V100(ZERO32.toString('hex')),
  ];
  const independentCompiled = compileSilV100(ROOT_CLOSE_SIL, independentCtor, 'RootClose');
  const independentHash = extractTemplateArtifactV100(independentCompiled).templateHashHex;
  assert.strictEqual(independentHash, artifacts.rootCloseTmplHash, '独立重编译的 RootClose template_hash 必须与 builder 内部算出的值逐字节一致');
});

await t('⑤(硬条件④要求的 T4 对照, 账本1425向量⑤) 独立用 V100 helper 重编 ShardLeaf_direct(同一套真实 ctor)算出的 P2SH 与 builder 返回值逐字节一致', () => {
  const c = loadProtocolConstants();
  const independentCtor = [
    ctorBytes32V100(MARKET_ID), ctorBytes32V100(c.ps_tmpl_hash), ctorBytes32V100(MARKET_ID),
    ctorIntV100(2), ctorIntV100(MIN_BET), ctorBytes32V100(artifacts.rootCloseTmplHash), ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(c.token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorIntV100(artifacts.shardLeafOwnRedeemLen),
  ];
  const independentCompiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, independentCtor, 'ShardLeaf_direct');
  const independentScript = Buffer.from(independentCompiled.script);
  const independentP2sh = '0x' + p2sh(independentScript);
  assert.strictEqual(independentP2sh, artifacts.shardLeafDirect.scriptPubKeyHex, '独立重编译算出的 P2SH 必须与 builder 返回的 scriptPubKeyHex 逐字节一致(T4-lite 交叉验证, 防"广播了一个跟本地记录不一致的脚本")');
  assert.strictEqual(Buffer.compare(independentScript, artifacts.shardLeafDirect.script), 0, '编译产物字节本身也逐字节一致(不止 P2SH 哈希一致, 底层脚本也要一致——防哈希碰撞级别的巧合掩盖真实差异)');
});

await t('⑥ marketId 格式校验: 非 32 字节 hex 直接 throw, 不静默截断/填充', async () => {
  let threw = null;
  try { await computeMarketGenesisArtifacts({ marketId: 'not-hex', minBet: 100, deadlineMs: 1700000000000 }); }
  catch (e) { threw = e; }
  assert.ok(threw && /32-byte hex/.test(threw.message), 'marketId 格式错误应该 throw 明确信息');
});

await t('⑦ minBet/deadlineMs 非正数 ⇒ throw', async () => {
  let threw1 = null;
  try { await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: 0, deadlineMs: 1700000000000 }); } catch (e) { threw1 = e; }
  assert.ok(threw1 && /minBet/.test(threw1.message));
  let threw2 = null;
  try { await computeMarketGenesisArtifacts({ marketId: MARKET_ID, minBet: 100, deadlineMs: 0 }); } catch (e) { threw2 = e; }
  assert.ok(threw2 && /deadlineMs/.test(threw2.message));
});

await t('⑧ bet_mint 步骤A: KTT genesis ctor 真实编译, token_tmpl_hash 与协议常量逐字节一致(证明 owner 值不同不影响模板哈希, invariance 在真实流水线里成立)', () => {
  const c = loadProtocolConstants();
  const ktt = computeKttGenesisArtifact({ amount: 20, ownerCovIdHex: 'bb'.repeat(32) });
  assert.strictEqual(ktt.templateHashHex, c.token_tmpl_hash, 'KTT genesis(owner=bb×32)的 template_hash 必须等于协议常量(与 owner 具体值无关)');
  const ktt2 = computeKttGenesisArtifact({ amount: 999, ownerCovIdHex: 'cc'.repeat(32) });
  assert.strictEqual(ktt2.templateHashHex, c.token_tmpl_hash, '换一组完全不同的 amount/owner 仍然是同一个协议常量(再次确认 invariance, 不是巧合)');
  assert.notStrictEqual(Buffer.compare(ktt.script, ktt2.script), 0, '但两次编译产物的完整字节不同(owner/amount 在 State 区域, 影响脚本字节但不影响 template_hash——两条性质分开验证)');
});

await t('⑨ computeKttGenesisArtifact: ownerCovIdHex 格式错误 ⇒ throw', () => {
  let threw = null;
  try { computeKttGenesisArtifact({ amount: 1, ownerCovIdHex: 'short' }); } catch (e) { threw = e; }
  assert.ok(threw && /32-byte hex/.test(threw.message));
});

await t('⑩ computeShardLeafRedeemScript(genesis state 全0, 从已存 own_redeem_len 重建) 与 computeMarketGenesisArtifacts 算出的 shardLeafDirect 逐字节一致(确定性重算, 不依赖随机委员会密钥, 不重新收敛)', async () => {
  const r = computeShardLeafRedeemScript({
    marketId: MARKET_ID, minBet: MIN_BET, sealCount: 2, rootcloseTmplHash: artifacts.rootCloseTmplHash,
    state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, ownRedeemLen: artifacts.shardLeafOwnRedeemLen,
  });
  assert.strictEqual(r.scriptPubKeyHex, artifacts.shardLeafDirect.scriptPubKeyHex, 'genesis state 下应该与 computeMarketGenesisArtifacts 的产物完全一致');
  assert.strictEqual(Buffer.compare(r.script, artifacts.shardLeafDirect.script), 0, '脚本字节也完全一致');
});

await t('⑪ computeShardLeafRedeemScript 换一组非零 state ⇒ 产出不同的 scriptPubKey(证明真的把 state 编码进去参与了哈希), own_redeem_len 不受影响', async () => {
  const r1 = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: 2, rootcloseTmplHash: artifacts.rootCloseTmplHash, state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, ownRedeemLen: artifacts.shardLeafOwnRedeemLen });
  const r2 = computeShardLeafRedeemScript({ marketId: MARKET_ID, minBet: MIN_BET, sealCount: 2, rootcloseTmplHash: artifacts.rootCloseTmplHash, state: { local_yes: 100, local_no: 20, count: 2, pool_value: 120 }, ownRedeemLen: artifacts.shardLeafOwnRedeemLen });
  assert.notStrictEqual(r1.scriptPubKeyHex, r2.scriptPubKeyHex);
  assert.strictEqual(r2.stateLayout.len, 36, 'ShardLeaf_direct 的 state_layout.len 应该恒为36(4个int字段)');
  assert.strictEqual(r1.script.length, artifacts.shardLeafOwnRedeemLen, 'state=0 与 state 非零两次脚本长度应该相同(state 不影响长度, 账本1468矩阵实测结论)');
  assert.strictEqual(r2.script.length, artifacts.shardLeafOwnRedeemLen);
});

await t('⑭(账本1469 Bettor④) ctor 取值矩阵: seal_count/min_bet 跨 minimal-push 编码宽度门槛, 不动点收敛必须成功(≤4轮), 且每组收敛结果通过 fail-closed 断言', () => {
  const c = loadProtocolConstants();
  const dummyRootClose = 'cd'.repeat(32);
  const zeroState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };
  const matrix = [
    { sealCount: 2, minBet: 1 }, { sealCount: 2, minBet: 15 }, { sealCount: 2, minBet: 16 }, { sealCount: 2, minBet: 17 },
    { sealCount: 2, minBet: 255 }, { sealCount: 2, minBet: 256 }, { sealCount: 2, minBet: 65535 }, { sealCount: 2, minBet: 65536 },
    { sealCount: 2, minBet: 2 ** 31 }, { sealCount: 2, minBet: 2 ** 32 }, { sealCount: 2, minBet: 2 ** 40 },
    { sealCount: 1000, minBet: 100000 }, { sealCount: 2 ** 32, minBet: 1 }, { sealCount: 2, minBet: Number.MAX_SAFE_INTEGER },
  ];
  const seenLens = new Set();
  for (const m of matrix) {
    const marketId = 'ab'.repeat(32);
    const { ownRedeemLen, artifact } = convergeShardLeafOwnRedeemLen({
      marketId, psTmplHash: c.ps_tmpl_hash, sealCount: m.sealCount, minBet: m.minBet,
      rootCloseTmplHash: dummyRootClose, tokenTmplHash: c.token_tmpl_hash, state: zeroState,
    });
    assert.strictEqual(artifact.script.length, ownRedeemLen, `(seal_count=${m.sealCount}, min_bet=${m.minBet}) fail-closed: 编译长度必须等于收敛值`);
    seenLens.add(ownRedeemLen);
    // register_append 侧原样重建(不重新收敛)也必须通过同一个 fail-closed 断言。
    const rebuilt = computeShardLeafRedeemScript({
      marketId, minBet: m.minBet, sealCount: m.sealCount, rootcloseTmplHash: dummyRootClose, state: zeroState, ownRedeemLen,
    });
    assert.strictEqual(rebuilt.script.length, ownRedeemLen, `(seal_count=${m.sealCount}, min_bet=${m.minBet}) register_append 重建后长度必须仍等于已存 own_redeem_len`);
  }
  assert.ok(seenLens.size > 1, `矩阵应该证明 own_redeem_len 确实随 seal_count/min_bet 变化(不是恒定单一值), 实际观测到 ${seenLens.size} 种不同长度: ${[...seenLens].join(',')}`);
});

await t('⑮(账本1469 Bettor③) fail-closed 断言真的会拦: 传一个错误的 ownRedeemLen 给 computeShardLeafRedeemScript 必须 throw, 不能静默放行', () => {
  const c = loadProtocolConstants();
  let threw = null;
  try {
    computeShardLeafRedeemScript({
      marketId: MARKET_ID, minBet: MIN_BET, sealCount: 2, rootcloseTmplHash: artifacts.rootCloseTmplHash,
      state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, ownRedeemLen: artifacts.shardLeafOwnRedeemLen + 1,
    });
  } catch (e) { threw = e; }
  assert.ok(threw && /fail-closed/.test(threw.message), `传错误的 own_redeem_len(实际值+1)必须 fail-closed throw, 实际 ${threw?.message}`);
});

await t('⑯ computeShardLeafRedeemScript: ownRedeemLen 缺失/非正整数 ⇒ throw(不静默当0/undefined处理)', () => {
  let threw = null;
  try {
    computeShardLeafRedeemScript({
      marketId: MARKET_ID, minBet: MIN_BET, sealCount: 2, rootcloseTmplHash: artifacts.rootCloseTmplHash,
      state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 },
    });
  } catch (e) { threw = e; }
  assert.ok(threw && /ownRedeemLen/.test(threw.message), 'ownRedeemLen 未传应该 throw 明确信息, 而不是让 ctorIntV100(undefined) 静默产出错误字节');
});

await t('⑫(账本1439) computeTicketGenesisArtifact: PoolSideTicket genesis ctor 真实编译, 不同 bettorPk/stake 产出不同脚本', () => {
  const t1 = computeTicketGenesisArtifact({ bettorPk: 'dd'.repeat(32), direction: 0, stake: 20, shardPoolId: MARKET_ID });
  const t2 = computeTicketGenesisArtifact({ bettorPk: 'ee'.repeat(32), direction: 1, stake: 30, shardPoolId: MARKET_ID });
  assert.match(t1.scriptPubKeyHex, /^0xaa20[0-9a-f]{64}87$/);
  assert.notStrictEqual(Buffer.compare(t1.script, t2.script), 0, '不同参数应该产出不同脚本');
});

await t('⑬ computeTicketGenesisArtifact: bettorPk 格式错误 ⇒ throw', () => {
  let threw = null;
  try { computeTicketGenesisArtifact({ bettorPk: 'short', direction: 0, stake: 1, shardPoolId: MARKET_ID }); } catch (e) { threw = e; }
  assert.ok(threw && /32-byte hex/.test(threw.message));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
