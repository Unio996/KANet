// encoding-vector.mjs — 最小编码向量草案(J2, Bettor 要求"§4③ AB11 stateBytes 拷贝 token_tmpl_hash
// 的最小编码向量草案", 2026-09-14)。不改任何生产 .sil 文件, 只用 JS 精确复刻合约里 AB11 手写
// stateBytes 编码逻辑, 验证"续约前后 token_tmpl_hash 保持不变"这条性质在字节层面是对的。
//
// 背景: docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.2.md §4③ 要求 register_append 的
// AB11 stateBytes 手写编码新增一行原样拷贝 token_tmpl_hash(32B)——本脚本真实编译实验性副本
// (docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/
// ShardLeaf_direct.v4-tokenhash-in-state.sil, 已经加了这一行)确认 state_layout.len 精确吻合
// "36(原4个int字段) + 33(新 token_tmpl_hash: 1B长度头+32B内容)= 69"，本脚本进一步在纯 JS 层面
// 复刻这段编码逻辑, 验证 blake2b(ownPrefix + stateBytes + ownSuffix) 这条 P2SH 承诺计算在
// "续约前后 token_tmpl_hash 不变"这个前提下确实能算出稳定、可预测的结果——不是完整的
// cli-debugger 端到端交易向量(那需要同时满足 ps ticket genesis / scanOwnedTokenInputs 等其余
// require, 工作量大得多), 是聚焦"这一处编码本身对不对"的最小向量。
//
// Run: cd kasia-console && node ../docs/provenance/2026-09-14-j2-shardleaf-ab11-token-tmpl-hash-encoding-vector/encoding-vector.mjs
// 🔴 相对路径直连(同 kaspa-wasm 那批脚本的既有坑, 见 bet-mint-stepA provenance 头注)——本文件位于
// docs/provenance/, 不在 kasia-console/ 的祖先链上, 裸 specifier 找不到 kasia-console/node_modules。
import { blake2b } from '../../../kasia-console/node_modules/@noble/hashes/blake2b.js';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';

// 🔴 注意: 不复用 2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/ 目录下那份同名文件——
// 那份是①②③三项 hash 不变性验证用的快照, 当时还没加 AB11 stateBytes 的 token_tmpl_hash 拷贝这行
// (它的 OWN_STATE_LEN 仍是旧值 36, 与真实 state_layout.len=69 不一致——这正是本 provenance 要补的
// 缺口, 那份文件的"已知限制"一节已经诚实标注了这一点, 不是本次才发现的新问题)。本目录另存一份
// 已经加上 AB11 修复的完整版本, 内部自洽(OWN_STATE_LEN 与真实 state_layout.len 一致)。
const M_SIL = '../docs/provenance/2026-09-14-j2-shardleaf-ab11-token-tmpl-hash-encoding-vector/ShardLeaf_direct.v4-with-ab11-fix.sil';
const OWN_PREFIX_LEN = 1;
const OWN_STATE_LEN = 69; // 同 .sil 源码里的常量, 见其头注推导(36+33)

// 复刻合约里的编码原语: byte[](n, 8) 是"把 int n 编成定长 8 字节"; 手写字段一律"1字节长度头+值"。
function encInt8(n) {
  const buf = Buffer.alloc(9);
  buf[0] = 8;
  buf.writeBigInt64BE(BigInt(n), 1);
  return buf;
}
function encBytes32(hexOrBuf) {
  const b = Buffer.isBuffer(hexOrBuf) ? hexOrBuf : Buffer.from(hexOrBuf, 'hex');
  if (b.length !== 32) throw new Error('encBytes32 需要恰好 32 字节');
  return Buffer.concat([Buffer.from([32]), b]);
}

// 复刻 AB11 stateBytes 编码(5 字段版, 含 token_tmpl_hash) —— 与 .sil 源码里的表达式逐行对应。
function encodeStateBytes({ localYes, localNo, count, poolValue, tokenTmplHashHex }) {
  return Buffer.concat([
    encInt8(localYes), encInt8(localNo), encInt8(count), encInt8(poolValue), encBytes32(tokenTmplHashHex),
  ]);
}

const TOKEN_TMPL_HASH = 'ab'.repeat(32); // 市场生命周期内固定不变(genesis 写一次, 之后每次续约原样携带)

console.log('=== ① 编译真实 M(ShardLeaf_direct v4), 取真实 prefix/suffix 用于本向量 ===');
const Z32 = '00'.repeat(32);
const ctorFor = (tokenHash) => [ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(2), ctorIntV100(100000), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(0), ctorIntV100(1), ctorIntV100(100000), ctorBytes32V100(tokenHash)];
const compiled = compileSilV100(M_SIL, ctorFor(TOKEN_TMPL_HASH), 'ShardLeaf_direct');
const script = Buffer.from(compiled.script);
console.log('state_layout:', JSON.stringify(compiled.state_layout), '(期望 start=1, len=69)');
if (compiled.state_layout.len !== OWN_STATE_LEN) throw new Error(`state_layout.len=${compiled.state_layout.len} 与手写 OWN_STATE_LEN=${OWN_STATE_LEN} 不一致 —— 编码逻辑与常量脱节, 这正是本向量要抓的那类漏配置`);
const realPrefix = script.subarray(0, OWN_PREFIX_LEN);
const realSuffix = script.subarray(OWN_PREFIX_LEN + OWN_STATE_LEN);
console.log('真实 prefix(hex):', realPrefix.toString('hex'), '真实 suffix 长度:', realSuffix.length);

console.log('\n=== ② genesis 态(count=0, pool_value=0) → register_append 一次(stake=100000, side=0) → 续约态(count=1, pool_value=100000) ===');
console.log('两次编码都用同一个 token_tmpl_hash =', TOKEN_TMPL_HASH, '(genesis 写一次, 续约原样携带, 不重新赋值)');

const genesisState = encodeStateBytes({ localYes: 0, localNo: 0, count: 0, poolValue: 0, tokenTmplHashHex: TOKEN_TMPL_HASH });
const genesisScript = Buffer.concat([realPrefix, genesisState, realSuffix]);
const genesisHash = Buffer.from(blake2b(genesisScript, { dkLen: 32 }));
console.log('genesis stateBytes 长度:', genesisState.length, '(期望 69, 与 state_layout.len 吻合)');
console.log('genesis 完整脚本 blake2b:', genesisHash.toString('hex'));

const stake = 100000, side = 0;
const continuationState = encodeStateBytes({ localYes: 0 + stake * (1 - side), localNo: 0 + stake * side, count: 0 + 1, poolValue: 0 + stake, tokenTmplHashHex: TOKEN_TMPL_HASH });
const continuationScript = Buffer.concat([realPrefix, continuationState, realSuffix]);
const continuationHash = Buffer.from(blake2b(continuationScript, { dkLen: 32 }));
console.log('续约后 stateBytes 长度:', continuationState.length);
console.log('续约后完整脚本 blake2b:', continuationHash.toString('hex'));

console.log('\n=== ③ 验证: 若续约时误把 token_tmpl_hash 编码漏掉(回退到旧 4 字段版), hash 会完全不同 ===');
function encodeStateBytesOld4Field({ localYes, localNo, count, poolValue }) {
  return Buffer.concat([encInt8(localYes), encInt8(localNo), encInt8(count), encInt8(poolValue)]);
}
const buggyState = encodeStateBytesOld4Field({ localYes: 0 + stake * (1 - side), localNo: 0 + stake * side, count: 1, poolValue: stake });
console.log('漏拷贝版 stateBytes 长度:', buggyState.length, '(只有 36, 比正确的 69 少 33 字节——');
console.log('  若合约仍按 OWN_STATE_LEN=69 去 slice ownSuffix, 这个漏拷贝的构造根本对不上 state_layout, 会在更早的字节比较就失败;');
console.log('  这正是"漏加这一行=continuation 丢失 token_tmpl_hash"这条 Bettor 要求的字面意思——不是"能跑但语义错", 是"编码长度都对不上, 直接构造失败", 危害更明确、更容易在测试阶段就抓到, 不会悄悄放过一笔坏交易。');

console.log('\n✅ 最小编码向量验证通过: state_layout.len 与手写常量吻合(69) + genesis/续约两次编码 token_tmpl_hash 保持一致 + 漏拷贝版本会产生明显不匹配的长度(可在落码阶段的单元测试里直接断言这一点，不需要等到完整交易broadcast才发现)。');
