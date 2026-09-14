// pool-template-artifact.mjs — foreign-template artifact builder for validateOutputStateWithTemplate /
// readInputStateWithTemplate (J2, 2026-06-15, bshard register↔PoolSide leaf-side binding).
//
// 🔴 作用域收窄(2026-09-15, 账本 1412/1413, NWT+Bettor 用 silverscript v1.0.0 权威源码订正——J2 KTT v0.3
// 落码期间实测撞出): 下面的 extractTemplateArtifact()(blake2b(prefix‖suffix), 无长度前缀)**仅对旧版
// (2026-06 前后)编译器编出的 legacy PoolLeaf/PoolRoot/PoolSideTicket 族产物有效**——那批产物的
// template_hash 校验走的是当年的 blake2b 手写公式, 本函数当时是对着那份公式写的, 没有错, 到今天也没有错。
// **v1.0.0(D-019 pin, commit 3ed973335b)换了公式**: template_hash = blake3(i64_8B(prefix.len) ‖ prefix ‖
// i64_8B(suffix.len) ‖ suffix)(源码见 silverscript-lang/src/template.rs +
// silverscript-lang/src/compiler/compile/state.rs 的 compile_read_input_state_with_template_validation/
// compile_validate_output_state_with_template_inner_statement), `readInputStateWithTemplate`/
// `validateOutputStateWithTemplate`/`validateOutputStateWithInputTemplate` 内建原语与显式 blake3(...) 源码
// 校验用的都是这同一个公式, 编译器自己也把它算好放在 compiled.template_hash 里(`compileSilV100(...)`
// 返回的 `template_hash_bytes` 字段——这是权威值, 不要再手算)。
// 🚫 **v1.0.0 编译的合约禁止调本文件的 extractTemplateArtifact()**——用blake2b公式算出的值对v1.0.0产物
// 是错的(J2 KTT v0.3 落码时实测: 241e5206...(旧公式) vs 225ebcde...(compiled.template_hash, 真值)不同,
// 且 241e5206... 一度被写进 T3 四文件 ctor 常量草案, 未落库前拦下)。**v1.0.0 合约一律改用下面的
// `extractTemplateArtifactV100()`**, 用 lint 规则 R-TEMPLATE-HASH-SOURCE 挡住误用(src/lib/sil-v1/**、
// T3 四文件 builder、src/api/proto.js、scripts/proto-v0-*)。
//
// 旧函数原始文档(仍对 legacy 族成立, 未改动):
// The bshard shard-leaf covenant binds a bettor's stake to a real PoolSide output via
// validateOutputStateWithTemplate(psIdx, {PoolSide State}, templatePrefix, templateSuffix, expectedTemplateHash).
// J1's leaf .sil bakes (templatePrefix, templateSuffix, expectedTemplateHash) as constants. This module
// produces those constants from the silverc-compiled PoolSide artifact — byte-matching the on-chain check.
//
// EXACT FORMULA (source-verified, silverscript-lang/src/compiler/compile.rs L1871-1883, NOT assumed;
// 这是 legacy 编译器的坐标, 不是 v1.0.0 的——v1.0.0 的坐标见上方新注记):
//   prefix = redeem[0 .. state_layout.start]
//   state  = redeem[state_layout.start .. state_layout.start + state_layout.len]   (EXCLUDED from template)
//   suffix = redeem[state_layout.start + state_layout.len .. ]
//   actual_template = prefix ‖ suffix
//   expected_template_hash = blake2b(actual_template)          // dkLen 32
//   P2SH = ScriptPubKeyP2SHFromRedeemScript(prefix ‖ state ‖ suffix)
//
// state_layout {start, len} is emitted by silverc (compile.rs L185: start = selector_prefix_len,
// len = field_prolog_script.len()). A contract with NO explicit State has len 0 → not templatable
// (the sharded PoolSide variant must declare its State fields explicitly — J1 SS domain).

import { blake2b } from '@noble/hashes/blake2b';
import { blake3 } from '@noble/hashes/blake3';

/**
 * @param {{script:number[]|Buffer, state_layout:{start:number,len:number}}} compiled  silverc output JSON
 * @returns {{templatePrefix:Buffer, templateSuffix:Buffer, templatePrefixLen:number, templateSuffixLen:number,
 *            encodedStateLen:number, expectedTemplateHash:Buffer, expectedTemplateHashHex:string}}
 */
export function extractTemplateArtifact(compiled) {
  const script = Buffer.from(compiled.script);
  const sl = compiled.state_layout;
  if (!sl || typeof sl.start !== 'number' || typeof sl.len !== 'number') {
    throw new Error('compiled.state_layout {start,len} required (recompile with silverc that emits state_layout)');
  }
  if (sl.len <= 0) {
    throw new Error('contract has no explicit State (state_layout.len=0) — cannot template; declare State fields');
  }
  if (sl.start < 0 || sl.start + sl.len > script.length) {
    throw new Error(`state_layout out of bounds: start=${sl.start} len=${sl.len} script=${script.length}`);
  }
  const prefix = script.subarray(0, sl.start);
  const stateRegion = script.subarray(sl.start, sl.start + sl.len);
  const suffix = script.subarray(sl.start + sl.len);
  // round-trip invariant: prefix ‖ state ‖ suffix == full redeem
  if (Buffer.concat([prefix, stateRegion, suffix]).compare(script) !== 0) {
    throw new Error('internal: prefix+state+suffix != redeem');
  }
  const template = Buffer.concat([prefix, suffix]);
  const expectedTemplateHash = Buffer.from(blake2b(template, { dkLen: 32 }));
  return {
    templatePrefix: prefix,
    templateSuffix: suffix,
    templatePrefixLen: prefix.length,
    templateSuffixLen: suffix.length,
    encodedStateLen: stateRegion.length,
    expectedTemplateHash,
    expectedTemplateHashHex: expectedTemplateHash.toString('hex'),
  };
}

/** Convenience: load a silverc output JSON file and extract the artifact. */
export function extractTemplateArtifactFromFile(path, readFileSync) {
  const compiled = JSON.parse(readFileSync(path, 'utf8'));
  return extractTemplateArtifact(compiled);
}

// 🔴 长度前缀字节序(2026-09-15 实测订正, 不是猜的): template_hash 的 8 字节长度前缀是**小端**, 不是最初
// 记的大端——用 Cargo.lock 钉死的精确版本 github.com/kaspanet/rusty-kaspa@v2.0.1
// (cfafeb4c093fa37a303f1b9f19c58f986b870ce3) 的 crypto/txscript/src/data_stack.rs::serialize_i64(这是
// template.rs 实际调用的函数)逐字节核过算法, 再用 template.rs 自带的 golden_classic 单元测试向量
// (template_hash(b"\x00\xff", b"\x10\x00\x80") == "6616a667...96905") 验证: 小端编码算出的 hash 与 golden
// 值逐字节相同, 大端编码对不上。下面 le8() 就是这份 serialize_i64(n, Some(8)) 的等价实现(定长 8 字节,
// 小端, 零扩展——不处理负数, 长度值不会是负数)。
function le8(n) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(n >>> 0, 0);
  b.writeUInt32LE(Math.floor(n / 0x100000000) >>> 0, 4);
  return b;
}

/**
 * silverscript v1.0.0(D-019 pin, commit 3ed973335b)专用版本——`extractTemplateArtifact`(上面, blake2b 公式)
 * 只对 legacy(2026-06 前后)编译器产物有效, v1.0.0 换了公式, 用错公式算出的 hash 会跟编译器自己/运行期
 * 内建原语实际比对时用的值不一致(J2 KTT v0.3 落码期间实测撞出, 见文件头注记)。
 *
 * 权威值直接来自编译器自报字段 `compiled.template_hash_bytes`(`compileSilV100(...)` 的返回值)——不重算,
 * 不重新派生。本函数只做两件事: ①切出 prefix/suffix(供需要 witness 字节的调用方, 如
 * readInputStateWithTemplate/validateOutputStateWithTemplate 的实参)②断言编译器自报值与独立按公式复算的
 * blake3(len8LE(prefix.len)‖prefix‖len8LE(suffix.len)‖suffix) 完全一致——这条断言只是自证公式理解没错,
 * 不是"信不过编译器", 复算失败说明本文件这份公式理解本身又漂移了, 应该报错而不是静默吃掉。
 *
 * @param {{script:number[]|Buffer, state_layout:{start:number,len:number}, template_hash_bytes:number[]|Buffer}} compiled
 *   compileSilV100(...) 的返回值(注意字段名是 template_hash_bytes, 不是 template_hash——这是本文件适配层
 *   进一步包了一层的字段名, 见 pool-bshard-artifacts.mjs)
 * @returns {{templatePrefix:Buffer, templateSuffix:Buffer, templatePrefixLen:number, templateSuffixLen:number,
 *            templateHash:Buffer, templateHashHex:string}}
 */
export function extractTemplateArtifactV100(compiled) {
  const script = Buffer.from(compiled.script);
  const sl = compiled.state_layout;
  if (!sl || typeof sl.start !== 'number' || typeof sl.len !== 'number') {
    throw new Error('compiled.state_layout {start,len} required');
  }
  if (sl.len <= 0) {
    throw new Error('contract has no explicit State (state_layout.len=0) — cannot template');
  }
  if (sl.start < 0 || sl.start + sl.len > script.length) {
    throw new Error(`state_layout out of bounds: start=${sl.start} len=${sl.len} script=${script.length}`);
  }
  if (!Array.isArray(compiled.template_hash_bytes) && !Buffer.isBuffer(compiled.template_hash_bytes)) {
    throw new Error('compiled.template_hash_bytes missing — recompile via compileSilV100(...) (v1.0.0 silverc), not the legacy compiler path');
  }
  const prefix = script.subarray(0, sl.start);
  const stateRegion = script.subarray(sl.start, sl.start + sl.len);
  const suffix = script.subarray(sl.start + sl.len);
  if (Buffer.concat([prefix, stateRegion, suffix]).compare(script) !== 0) {
    throw new Error('internal: prefix+state+suffix != redeem');
  }
  const templateHash = Buffer.from(compiled.template_hash_bytes);
  if (templateHash.length !== 32) {
    throw new Error(`compiled.template_hash_bytes must be 32 bytes, got ${templateHash.length}`);
  }
  const recomputed = Buffer.from(blake3(Buffer.concat([le8(prefix.length), prefix, le8(suffix.length), suffix])));
  if (recomputed.compare(templateHash) !== 0) {
    throw new Error(
      `extractTemplateArtifactV100: recomputed blake3(len8LE+prefix+len8LE+suffix)=${recomputed.toString('hex')} != ` +
      `compiled.template_hash_bytes=${templateHash.toString('hex')} — formula understanding has drifted again, do not silently trust either value`
    );
  }
  return {
    templatePrefix: prefix,
    templateSuffix: suffix,
    templatePrefixLen: prefix.length,
    templateSuffixLen: suffix.length,
    templateHash,
    templateHashHex: templateHash.toString('hex'),
  };
}
